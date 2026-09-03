import { config } from './config.js';
import { getSettings, publicUser } from './db.js';
import { HttpError } from './http.js';
import { newToken } from './auth.js';
import { exchangeWechatCode } from './wechat.js';
import { requireUser, pagination } from './session.js';
import { saveUploadedFile } from './upload.js';

async function miniLogin(req, res, ctx) {
  const { code, nickname, avatar } = ctx.body;
  if (!code) throw new HttpError(400, '缺少 wx.login 的 code');
  const settings = getSettings(ctx.db);
  const wx = await exchangeWechatCode(String(code), {
    appid: settings.wechat_appid || config.wechatAppid,
    secret: settings.wechat_secret || config.wechatSecret
  });

  const now = new Date().toISOString();
  let user = ctx.db.prepare('SELECT * FROM users WHERE openid = ?').get(wx.openid);
  if (!user) {
    const info = ctx.db.prepare('INSERT INTO users (openid, unionid, nickname, avatar, status, created_at, last_login_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(wx.openid, wx.unionid || '', String(nickname || '微信用户'), String(avatar || ''), now, now);
    user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  } else {
    if (Number(user.status) !== 1) throw new HttpError(403, '账号已被禁用');
    ctx.db.prepare("UPDATE users SET last_login_at = ?, nickname = COALESCE(NULLIF(?, ''), nickname), avatar = COALESCE(NULLIF(?, ''), avatar) WHERE id = ?")
      .run(now, String(nickname || ''), String(avatar || ''), user.id);
  }

  const token = newToken();
  const ttlSeconds = config.userTokenTtlDays * 86400;
  ctx.db.prepare('INSERT INTO user_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, user.id, new Date(Date.now() + ttlSeconds * 1000).toISOString(), now);
  return { token, user: publicUser(user), mock: !!wx.mock };
}

async function miniConfig(req, res, ctx) {
  const settings = getSettings(ctx.db);
  return {
    config: {
      site_name: settings.site_name || '小程序',
      upload_enabled: settings.upload_enabled === '1',
      max_photo_mb: Number(settings.max_photo_mb || 8)
    }
  };
}

async function home(req, res, ctx) {
  const banners = ctx.db.prepare('SELECT * FROM banners WHERE status = 1 ORDER BY sort DESC, id ASC').all();
  const hot = ctx.db.prepare('SELECT * FROM products WHERE status = 1 ORDER BY sales DESC, id DESC LIMIT 6').all()
    .map((p) => ({ ...p, images: JSON.parse(p.images || '[]') }));
  const categories = ctx.db.prepare("SELECT DISTINCT category FROM products WHERE status = 1 AND category != '' ORDER BY category").all()
    .map((r) => r.category);
  return { banners, hot_products: hot, categories };
}

async function listPersonnel(req, res, ctx) {
  return { items: ctx.db.prepare('SELECT id, name, department, position FROM personnel WHERE status = 1 ORDER BY name').all() };
}

async function listProducts(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = ['status = 1'];
  const params = [];
  if (q) {
    conds.push('(title LIKE ? OR summary LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    conds.push('category = ?');
    params.push(category);
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM products ${where}`).get(...params).c;
  const items = ctx.db.prepare(`SELECT * FROM products ${where} ORDER BY sort DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset).map((p) => ({ ...p, images: JSON.parse(p.images || '[]') }));
  return { items, total, page, pageSize };
}

async function getProduct(req, res, ctx) {
  const row = ctx.db.prepare('SELECT * FROM products WHERE id = ? AND status = 1').get(Number(ctx.params.id));
  if (!row) throw new HttpError(404, '商品不存在或已下架');
  return { product: { ...row, images: JSON.parse(row.images || '[]') } };
}

async function getProfile(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  return { user: publicUser(user) };
}

async function updateProfile(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const { nickname, avatar, phone } = ctx.body;
  ctx.db.prepare("UPDATE users SET nickname = COALESCE(NULLIF(?, ''), nickname), avatar = COALESCE(NULLIF(?, ''), avatar), phone = COALESCE(NULLIF(?, ''), phone) WHERE id = ?")
    .run(String(nickname || ''), String(avatar || ''), String(phone || ''), user.id);
  const updated = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  return { user: publicUser(updated) };
}

function makeRecordNo() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `KC${date}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

async function uploadPhoto(req, res, ctx) {
  requireUser(req, ctx.db);
  const settings = getSettings(ctx.db);
  if (settings.upload_enabled !== '1') throw new HttpError(403, '照片上传已关闭');
  if (!ctx.multipart || !ctx.multipart.files.file) throw new HttpError(400, '缺少照片文件');
  const url = await saveUploadedFile(ctx.multipart.files.file, 'photos');
  return { url };
}

async function createInspection(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const settings = getSettings(ctx.db);
  if (settings.upload_enabled !== '1') throw new HttpError(403, '照片上传已关闭');

  let body = ctx.body;
  if (ctx.multipart) {
    const { fields, files } = ctx.multipart;
    body = { ...fields };
    const saved = {};
    for (const [key, file] of Object.entries(files)) {
      saved[key] = await saveUploadedFile(file, 'photos');
    }
    body.check_photo = body.check_photo || saved.check_photo || '';
    body.cargo_photo = body.cargo_photo || saved.cargo_photo || '';
    body.lock_photo = body.lock_photo || saved.lock_photo || '';
  }

  const checkers = String(body.checkers || '').trim();
  const lockNo = String(body.lock_no || '').trim();
  const checkPhoto = String(body.check_photo || '').trim();
  const cargoPhoto = String(body.cargo_photo || '').trim();
  const lockPhoto = String(body.lock_photo || '').trim();

  if (!checkers) throw new HttpError(400, '请填写查对人员');
  if (!lockNo) throw new HttpError(400, '请填写一次性密码锁锁号');
  if (!checkPhoto || !cargoPhoto || !lockPhoto) throw new HttpError(400, '三张照片都需要上传');

  const recordNo = makeRecordNo();
  const now = new Date().toISOString();
  const info = ctx.db.prepare(`
    INSERT INTO inspections (record_no, user_id, checkers, vehicle_no, lock_no, check_photo, cargo_photo, lock_photo, remark, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
  `).run(
    recordNo,
    user.id,
    checkers,
    String(body.vehicle_no || '').trim(),
    lockNo,
    checkPhoto,
    cargoPhoto,
    lockPhoto,
    String(body.remark || '').trim(),
    now,
    now
  );
  const record = ctx.db.prepare('SELECT * FROM inspections WHERE id = ?').get(Number(info.lastInsertRowid));
  return { record, message: '查对记录已提交' };
}

async function listMyInspections(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status') || '';
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = ['user_id = ?'];
  const params = [user.id];
  if (status) {
    conds.push('status = ?');
    params.push(status);
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM inspections ${where}`).get(...params).c;
  const items = ctx.db.prepare(`SELECT * FROM inspections ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  return { items, total, page, pageSize };
}

async function getMyInspection(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const row = ctx.db.prepare('SELECT * FROM inspections WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), user.id);
  if (!row) throw new HttpError(404, '查对记录不存在');
  return { record: row };
}

async function createOrder(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const { product_id, quantity = 1, contact_name, contact_phone, address, remark } = ctx.body;
  const product = ctx.db.prepare('SELECT * FROM products WHERE id = ? AND status = 1').get(Number(product_id));
  if (!product) throw new HttpError(404, '商品不存在或已下架');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, '数量不正确');
  if (product.stock < qty) throw new HttpError(400, '库存不足');
  if (!contact_name || !contact_phone) throw new HttpError(400, '请填写联系人和电话');

  const now = new Date().toISOString();
  const orderNo = `MP${now.slice(0, 10).replaceAll('-', '')}${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const amount = Number((product.price * qty).toFixed(2));
  const info = ctx.db.prepare(`
    INSERT INTO orders (order_no, user_id, product_id, title, cover, price, quantity, amount, status, contact_name, contact_phone, address, remark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).run(orderNo, user.id, product.id, product.title, product.cover, product.price, qty, amount, String(contact_name), String(contact_phone), String(address || ''), String(remark || ''), now, now);
  ctx.db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, product.id);
  const order = ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(info.lastInsertRowid));
  return { order };
}

async function listMyOrders(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status') || '';
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = ['user_id = ?'];
  const params = [user.id];
  if (status) {
    conds.push('status = ?');
    params.push(status);
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM orders ${where}`).get(...params).c;
  const items = ctx.db.prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  return { items, total, page, pageSize };
}

async function getMyOrder(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const row = ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), user.id);
  if (!row) throw new HttpError(404, '订单不存在');
  return { order: row };
}

async function payOrder(req, res, ctx) {
  const user = requireUser(req, ctx.db);
  const row = ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), user.id);
  if (!row) throw new HttpError(404, '订单不存在');
  if (row.status !== 'pending') throw new HttpError(400, '订单当前状态不可支付');
  const now = new Date().toISOString();
  ctx.db.prepare('UPDATE orders SET status = ?, pay_time = ?, updated_at = ? WHERE id = ?').run('paid', now, now, row.id);
  if (row.product_id) {
    ctx.db.prepare('UPDATE products SET sales = sales + ? WHERE id = ?').run(row.quantity, row.product_id);
  }
  const order = ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id);
  return { order };
}

export const miniRoutes = [
  ['post', '/api/v1/auth/login', miniLogin],
  ['get', '/api/v1/config', miniConfig],
  ['get', '/api/v1/home', home],
  ['get', '/api/v1/personnel', listPersonnel],
  ['get', '/api/v1/products', listProducts],
  ['get', '/api/v1/products/:id', getProduct],
  ['get', '/api/v1/user/profile', getProfile],
  ['patch', '/api/v1/user/profile', updateProfile],
  ['post', '/api/v1/uploads', uploadPhoto],
  ['post', '/api/v1/records', createInspection],
  ['get', '/api/v1/records', listMyInspections],
  ['get', '/api/v1/records/:id', getMyInspection],
  ['post', '/api/v1/orders', createOrder],
  ['get', '/api/v1/orders', listMyOrders],
  ['get', '/api/v1/orders/:id', getMyOrder],
  ['post', '/api/v1/orders/:id/pay', payOrder]
];
