import { config } from './config.js';
import { getSettings, saveSettings, publicUser } from './db.js';
import { HttpError, cookieHeader } from './http.js';
import { hashPassword, newToken, verifyPassword } from './auth.js';
import { requireAdmin, pagination, can, parsePermissions } from './session.js';

function publicAdmin(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    permissions: parsePermissions(row.permissions),
    status: row.status,
    created_at: row.created_at
  };
}

function withPerm(perm, handler) {
  if (!perm) return handler;
  return (req, res, ctx) => {
    const admin = requireAdmin(req, ctx.db);
    if (!can(admin, perm)) throw new HttpError(403, '没有操作权限');
    return handler(req, res, ctx);
  };
}

async function login(req, res, ctx) {
  const { username, password } = ctx.body;
  if (!username || !password) throw new HttpError(400, '请输入账号和密码');
  const admin = ctx.db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username).trim());
  if (!admin || !verifyPassword(String(password), admin.password_hash)) {
    throw new HttpError(401, '账号或密码错误');
  }
  if (Number(admin.status) !== 1) throw new HttpError(403, '账号已被禁用');
  const token = newToken();
  const ttlSeconds = config.adminTokenTtlDays * 86400;
  ctx.db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, admin.id, new Date(Date.now() + ttlSeconds * 1000).toISOString(), new Date().toISOString());
  ctx.db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(new Date().toISOString());
  res.setHeader('Set-Cookie', cookieHeader('admin_token', token, { maxAge: ttlSeconds, path: '/', sameSite: 'Lax' }));
  return { token, admin: publicAdmin(admin) };
}

async function logout(req, res, ctx) {
  const admin = requireAdmin(req, ctx.db);
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : (req.headers.cookie || '').match(/admin_token=([^;]+)/)?.[1] || '';
  if (token) ctx.db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', cookieHeader('admin_token', '', { maxAge: 0, path: '/', sameSite: 'Lax' }));
  return { ok: true, admin: publicAdmin(admin) };
}

async function me(req, res, ctx) {
  return { admin: requireAdmin(req, ctx.db) };
}

async function changePassword(req, res, ctx) {
  const admin = requireAdmin(req, ctx.db);
  const { old_password, new_password } = ctx.body;
  if (!old_password || !new_password) throw new HttpError(400, '请输入原密码和新密码');
  if (String(new_password).length < 6) throw new HttpError(400, '新密码至少 6 位');
  const row = ctx.db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.id);
  if (!verifyPassword(String(old_password), row.password_hash)) throw new HttpError(400, '原密码错误');
  ctx.db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(new_password)), admin.id);
  ctx.db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(admin.id);
  return { ok: true };
}

async function dashboard(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = `${today}T00:00:00.000Z`;
  const db = ctx.db;

  const totals = {
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    users_today: db.prepare('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?').get(dayStart).c,
    personnel: db.prepare('SELECT COUNT(*) AS c FROM personnel').get().c,
    medicines: db.prepare('SELECT COUNT(*) AS c FROM medicines').get().c,
    medicines_attention: db.prepare("SELECT COUNT(*) AS c FROM medicines WHERE status IN ('expiring', 'expired')").get().c,
    products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
    on_sale: db.prepare('SELECT COUNT(*) AS c FROM products WHERE status = 1').get().c,
    orders: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
    orders_today: db.prepare('SELECT COUNT(*) AS c FROM orders WHERE created_at >= ?').get(dayStart).c,
    revenue: db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM orders WHERE status IN ('paid', 'shipped', 'completed')").get().s,
    inspections: db.prepare('SELECT COUNT(*) AS c FROM inspections').get().c,
    inspections_pending: db.prepare("SELECT COUNT(*) AS c FROM inspections WHERE status = 'submitted'").get().c
  };

  const statusBreakdown = db.prepare('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all();
  const topProducts = db.prepare('SELECT id, title, cover, sales, price FROM products ORDER BY sales DESC LIMIT 5').all();
  const recentOrders = db.prepare(`
    SELECT o.id, o.order_no, o.amount, o.status, o.created_at, u.nickname
    FROM orders o JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC LIMIT 8
  `).all();
  const recentInspections = db.prepare(`
    SELECT i.id, i.record_no, i.vehicle_no, i.lock_no, i.status, i.created_at, u.nickname, i.check_photo, i.cargo_photo, i.lock_photo
    FROM inspections i JOIN users u ON u.id = i.user_id
    ORDER BY i.id DESC LIMIT 6
  `).all();

  const trend = [];
  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    trend.push({
      date: day.slice(5),
      orders: db.prepare('SELECT COUNT(*) AS c FROM orders WHERE substr(created_at, 1, 10) = ?').get(day).c,
      inspections: db.prepare('SELECT COUNT(*) AS c FROM inspections WHERE substr(created_at, 1, 10) = ?').get(day).c
    });
  }

  return { totals, status_breakdown: statusBreakdown, top_products: topProducts, recent_orders: recentOrders, recent_inspections: recentInspections, trend };
}

async function listUsers(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q') || '';
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const like = `%${q}%`;
  const where = q
    ? 'WHERE u.nickname LIKE ? OR u.phone LIKE ? OR u.openid LIKE ?'
    : '';
  const params = q ? [like, like, like] : [];
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM users u ${where}`).get(...params).c;
  const items = ctx.db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
    FROM users u ${where}
    ORDER BY u.id DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset).map((u) => ({ ...publicUser(u), openid: u.openid, order_count: u.order_count }));
  return { items, total, page, pageSize };
}

async function updateUser(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '用户不存在');
  const { nickname, phone, status } = ctx.body;
  const nextStatus = status === undefined ? row.status : (Number(status) === 0 ? 0 : 1);
  ctx.db.prepare('UPDATE users SET nickname = ?, phone = ?, status = ? WHERE id = ?')
    .run(nickname ?? row.nickname, phone ?? row.phone, nextStatus, id);
  const updated = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { user: publicUser(updated) };
}

async function getUser(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params.id));
  if (!row) throw new HttpError(404, '用户不存在');
  return { user: { ...publicUser(row), openid: row.openid } };
}

function productFields(body) {
  const title = String(body.title || '').trim();
  if (!title) throw new HttpError(400, '商品名称不能为空');
  const images = Array.isArray(body.images) ? body.images.map((i) => String(i).trim()).filter(Boolean) : [];
  const cover = String(body.cover || images[0] || '').trim();
  const price = Number(body.price);
  const original_price = body.original_price === undefined || body.original_price === null || body.original_price === '' ? null : Number(body.original_price);
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, '价格不正确');
  const stock = Number(body.stock ?? 0);
  if (!Number.isInteger(stock) || stock < 0) throw new HttpError(400, '库存不正确');
  return {
    title,
    subtitle: String(body.subtitle || ''),
    cover,
    images: JSON.stringify(images),
    price,
    original_price,
    stock,
    summary: String(body.summary || ''),
    content: String(body.content || ''),
    category: String(body.category || ''),
    status: Number(body.status) === 0 ? 0 : 1,
    sort: Number(body.sort || 0)
  };
}

async function listProducts(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const status = url.searchParams.get('status');
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(title LIKE ? OR subtitle LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    conds.push('category = ?');
    params.push(category);
  }
  if (status === '0' || status === '1') {
    conds.push('status = ?');
    params.push(Number(status));
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM products ${where}`).get(...params).c;
  const items = ctx.db.prepare(`SELECT * FROM products ${where} ORDER BY sort DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset).map((p) => ({ ...p, images: JSON.parse(p.images || '[]') }));
  return { items, total, page, pageSize };
}

async function getProduct(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const row = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(Number(ctx.params.id));
  if (!row) throw new HttpError(404, '商品不存在');
  return { product: { ...row, images: JSON.parse(row.images || '[]') } };
}

async function createProduct(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const f = productFields(ctx.body);
  const now = new Date().toISOString();
  const info = ctx.db.prepare(`
    INSERT INTO products (title, subtitle, cover, images, price, original_price, stock, sales, summary, content, category, status, sort, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
  `).run(f.title, f.subtitle, f.cover, f.images, f.price, f.original_price, f.stock, f.summary, f.content, f.category, f.status, f.sort, now, now);
  return { product: { id: Number(info.lastInsertRowid) } };
}

async function updateProduct(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '商品不存在');
  const merged = { ...row, ...ctx.body };
  const f = productFields(merged);
  const now = new Date().toISOString();
  ctx.db.prepare(`
    UPDATE products SET title = ?, subtitle = ?, cover = ?, images = ?, price = ?, original_price = ?, stock = ?, summary = ?, content = ?, category = ?, status = ?, sort = ?, updated_at = ?
    WHERE id = ?
  `).run(f.title, f.subtitle, f.cover, f.images, f.price, f.original_price, f.stock, f.summary, f.content, f.category, f.status, f.sort, now, id);
  return { ok: true };
}

async function deleteProduct(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const info = ctx.db.prepare('DELETE FROM products WHERE id = ?').run(Number(ctx.params.id));
  if (info.changes === 0) throw new HttpError(404, '商品不存在');
  return { ok: true };
}

async function listOrders(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q') || '';
  const status = url.searchParams.get('status') || '';
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(o.order_no LIKE ? OR o.contact_name LIKE ? OR o.contact_phone LIKE ? OR o.title LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    conds.push('o.status = ?');
    params.push(status);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM orders o ${where}`).get(...params).c;
  const items = ctx.db.prepare(`
    SELECT o.*, u.nickname, u.phone AS user_phone
    FROM orders o JOIN users u ON u.id = o.user_id
    ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return { items, total, page, pageSize };
}

async function getOrder(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const row = ctx.db.prepare(`
    SELECT o.*, u.nickname, u.phone AS user_phone, u.openid
    FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?
  `).get(Number(ctx.params.id));
  if (!row) throw new HttpError(404, '订单不存在');
  return { order: row };
}

const ORDER_TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  cancelled: []
};

async function updateOrderStatus(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '订单不存在');
  const next = String(ctx.body.status || '');
  if (!ORDER_TRANSITIONS[row.status]?.includes(next)) {
    throw new HttpError(400, `订单当前状态无法变更为 ${next}`);
  }
  const now = new Date().toISOString();
  const updates = ['updated_at = ?'];
  const params = [now];
  if (next === 'paid') {
    updates.push('pay_time = ?');
    params.push(now);
    if (row.product_id) {
      ctx.db.prepare('UPDATE products SET sales = sales + ? WHERE id = ?').run(row.quantity, row.product_id);
    }
  }
  if (next === 'cancelled' && row.status === 'pending' && row.product_id) {
    ctx.db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(row.quantity, row.product_id);
  }
  updates.push('status = ?');
  params.push(next, id);
  ctx.db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return { ok: true };
}

async function listInspections(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q') || '';
  const status = url.searchParams.get('status') || '';
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(i.record_no LIKE ? OR i.vehicle_no LIKE ? OR i.lock_no LIKE ? OR i.checkers LIKE ? OR u.nickname LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    conds.push('i.status = ?');
    params.push(status);
  }
  if (start) {
    conds.push('i.created_at >= ?');
    params.push(`${start}T00:00:00.000Z`);
  }
  if (end) {
    conds.push('i.created_at <= ?');
    params.push(`${end}T23:59:59.999Z`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM inspections i JOIN users u ON u.id = i.user_id ${where}`).get(...params).c;
  const items = ctx.db.prepare(`
    SELECT i.*, u.nickname, u.phone AS user_phone
    FROM inspections i JOIN users u ON u.id = i.user_id
    ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return { items, total, page, pageSize };
}

async function getInspection(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const row = ctx.db.prepare(`
    SELECT i.*, u.nickname, u.phone AS user_phone, u.openid
    FROM inspections i JOIN users u ON u.id = i.user_id WHERE i.id = ?
  `).get(Number(ctx.params.id));
  if (!row) throw new HttpError(404, '查对记录不存在');
  return { record: row };
}

async function updateInspection(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM inspections WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '查对记录不存在');
  const allowed = ['submitted', 'verified', 'rejected'];
  const status = ctx.body.status ?? row.status;
  if (!allowed.includes(status)) throw new HttpError(400, '状态不正确');
  const now = new Date().toISOString();
  ctx.db.prepare('UPDATE inspections SET status = ?, review_remark = ?, updated_at = ? WHERE id = ?')
    .run(status, String(ctx.body.review_remark ?? row.review_remark ?? ''), now, id);
  return { ok: true };
}

async function deleteInspection(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const info = ctx.db.prepare('DELETE FROM inspections WHERE id = ?').run(Number(ctx.params.id));
  if (info.changes === 0) throw new HttpError(404, '查对记录不存在');
  return { ok: true };
}

async function listBanners(req, res, ctx) {
  requireAdmin(req, ctx.db);
  return { items: ctx.db.prepare('SELECT * FROM banners ORDER BY sort DESC, id ASC').all() };
}

async function createBanner(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const { title, image, link_type, link_value, sort } = ctx.body;
  if (!image) throw new HttpError(400, '轮播图地址不能为空');
  const now = new Date().toISOString();
  const info = ctx.db.prepare('INSERT INTO banners (title, image, link_type, link_value, sort, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(String(title || ''), String(image), String(link_type || 'none'), String(link_value || ''), Number(sort || 0), now);
  return { banner: { id: Number(info.lastInsertRowid) } };
}

async function updateBanner(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM banners WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '轮播图不存在');
  const merged = { ...row, ...ctx.body };
  ctx.db.prepare('UPDATE banners SET title = ?, image = ?, link_type = ?, link_value = ?, sort = ?, status = ? WHERE id = ?')
    .run(String(merged.title || ''), String(merged.image || ''), String(merged.link_type || 'none'), String(merged.link_value || ''), Number(merged.sort || 0), Number(merged.status) === 0 ? 0 : 1, id);
  return { ok: true };
}

async function deleteBanner(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const info = ctx.db.prepare('DELETE FROM banners WHERE id = ?').run(Number(ctx.params.id));
  if (info.changes === 0) throw new HttpError(404, '轮播图不存在');
  return { ok: true };
}

async function getAdminSettings(req, res, ctx) {
  requireAdmin(req, ctx.db);
  return { settings: getSettings(ctx.db) };
}

const SETTING_KEYS = ['site_name', 'wechat_appid', 'wechat_secret', 'upload_enabled', 'max_photo_mb'];

async function putAdminSettings(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const values = {};
  for (const key of SETTING_KEYS) {
    if (ctx.body[key] !== undefined) values[key] = ctx.body[key];
  }
  saveSettings(ctx.db, values);
  return { settings: getSettings(ctx.db) };
}

async function listPersonnel(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q') || '';
  const department = url.searchParams.get('department') || '';
  const status = url.searchParams.get('status');
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(name LIKE ? OR phone LIKE ? OR position LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (department) {
    conds.push('department = ?');
    params.push(department);
  }
  if (status === '0' || status === '1') {
    conds.push('status = ?');
    params.push(Number(status));
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM personnel ${where}`).get(...params).c;
  const items = ctx.db.prepare(`SELECT * FROM personnel ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  return { items, total, page, pageSize };
}

async function personnelOptions(req, res, ctx) {
  requireAdmin(req, ctx.db);
  return { items: ctx.db.prepare('SELECT id, name, department, position FROM personnel WHERE status = 1 ORDER BY name').all() };
}

async function personnelDepartments(req, res, ctx) {
  requireAdmin(req, ctx.db);
  return { items: ctx.db.prepare("SELECT DISTINCT department FROM personnel WHERE department != '' ORDER BY department").all().map((r) => r.department) };
}

async function createPersonnel(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const name = String(ctx.body.name || '').trim();
  if (!name) throw new HttpError(400, '姓名不能为空');
  const now = new Date().toISOString();
  const info = ctx.db.prepare('INSERT INTO personnel (name, department, position, phone, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, String(ctx.body.department || ''), String(ctx.body.position || ''), String(ctx.body.phone || ''), Number(ctx.body.status) === 0 ? 0 : 1, now, now);
  return { personnel: { id: Number(info.lastInsertRowid) } };
}

async function getPersonnel(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const row = ctx.db.prepare('SELECT * FROM personnel WHERE id = ?').get(Number(ctx.params.id));
  if (!row) throw new HttpError(404, '人员不存在');
  return { personnel: row };
}

async function updatePersonnel(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM personnel WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '人员不存在');
  const merged = { ...row, ...ctx.body };
  if (!String(merged.name || '').trim()) throw new HttpError(400, '姓名不能为空');
  const now = new Date().toISOString();
  ctx.db.prepare('UPDATE personnel SET name = ?, department = ?, position = ?, phone = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(String(merged.name), String(merged.department || ''), String(merged.position || ''), String(merged.phone || ''), Number(merged.status) === 0 ? 0 : 1, now, id);
  return { ok: true };
}

async function deletePersonnel(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const info = ctx.db.prepare('DELETE FROM personnel WHERE id = ?').run(Number(ctx.params.id));
  if (info.changes === 0) throw new HttpError(404, '人员不存在');
  return { ok: true };
}

function medicineFields(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, '药品名称不能为空');
  const quantity = Number(body.quantity ?? 0);
  if (!Number.isInteger(quantity) || quantity < 0) throw new HttpError(400, '数量不正确');
  const status = ['normal', 'expiring', 'expired'].includes(body.status) ? body.status : 'normal';
  return {
    name,
    spec: String(body.spec || ''),
    batch_no: String(body.batch_no || ''),
    manufacturer: String(body.manufacturer || ''),
    expiry_date: String(body.expiry_date || ''),
    quantity,
    unit: String(body.unit || '盒'),
    storage: String(body.storage || ''),
    status,
    remark: String(body.remark || '')
  };
}

async function listMedicines(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q') || '';
  const status = url.searchParams.get('status') || '';
  const { page, pageSize, offset } = pagination(Object.fromEntries(url.searchParams));
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(name LIKE ? OR spec LIKE ? OR batch_no LIKE ? OR manufacturer LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    conds.push('status = ?');
    params.push(status);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS c FROM medicines ${where}`).get(...params).c;
  const items = ctx.db.prepare(`SELECT * FROM medicines ${where} ORDER BY expiry_date ASC, id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  return { items, total, page, pageSize };
}

async function createMedicine(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const f = medicineFields(ctx.body);
  const now = new Date().toISOString();
  const info = ctx.db.prepare(`
    INSERT INTO medicines (name, spec, batch_no, manufacturer, expiry_date, quantity, unit, storage, status, remark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(f.name, f.spec, f.batch_no, f.manufacturer, f.expiry_date, f.quantity, f.unit, f.storage, f.status, f.remark, now, now);
  return { medicine: { id: Number(info.lastInsertRowid) } };
}

async function getMedicine(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const row = ctx.db.prepare('SELECT * FROM medicines WHERE id = ?').get(Number(ctx.params.id));
  if (!row) throw new HttpError(404, '药品不存在');
  return { medicine: row };
}

async function updateMedicine(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM medicines WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '药品不存在');
  const f = medicineFields({ ...row, ...ctx.body });
  const now = new Date().toISOString();
  ctx.db.prepare(`
    UPDATE medicines SET name = ?, spec = ?, batch_no = ?, manufacturer = ?, expiry_date = ?, quantity = ?, unit = ?, storage = ?, status = ?, remark = ?, updated_at = ?
    WHERE id = ?
  `).run(f.name, f.spec, f.batch_no, f.manufacturer, f.expiry_date, f.quantity, f.unit, f.storage, f.status, f.remark, now, id);
  return { ok: true };
}

async function deleteMedicine(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const info = ctx.db.prepare('DELETE FROM medicines WHERE id = ?').run(Number(ctx.params.id));
  if (info.changes === 0) throw new HttpError(404, '药品不存在');
  return { ok: true };
}

function normalizePermissions(value) {
  const arr = Array.isArray(value) ? value : [];
  return [...new Set(arr.map((p) => String(p)).filter(Boolean))];
}

async function listAdmins(req, res, ctx) {
  requireAdmin(req, ctx.db);
  const rows = ctx.db.prepare('SELECT id, username, display_name, role, permissions, status, created_at FROM admins ORDER BY id ASC').all();
  return { items: rows.map(publicAdmin) };
}

async function createAdmin(req, res, ctx) {
  const current = requireAdmin(req, ctx.db);
  const username = String(ctx.body.username || '').trim();
  const password = String(ctx.body.password || '');
  if (!username || !password) throw new HttpError(400, '请填写账号和密码');
  if (password.length < 6) throw new HttpError(400, '密码至少 6 位');
  if (ctx.db.prepare('SELECT 1 AS ok FROM admins WHERE username = ?').get(username)) {
    throw new HttpError(400, '账号已存在');
  }
  const role = ctx.body.role === 'super' ? 'super' : 'admin';
  const permissions = role === 'super' ? [] : normalizePermissions(ctx.body.permissions);
  const now = new Date().toISOString();
  ctx.db.prepare('INSERT INTO admins (username, password_hash, display_name, role, permissions, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), String(ctx.body.display_name || username), role, JSON.stringify(permissions), Number(ctx.body.status) === 0 ? 0 : 1, now);
  return { ok: true };
}

async function updateAdmin(req, res, ctx) {
  const current = requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '管理员不存在');

  const isSelf = row.id === current.id;
  const superCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM admins WHERE role = 'super' AND status = 1").get().c;
  const isLastSuper = row.role === 'super' && superCount <= 1;
  const nextRole = ctx.body.role ?? row.role;
  const nextStatus = ctx.body.status === undefined ? row.status : (Number(ctx.body.status) === 0 ? 0 : 1);

  if (isSelf && (nextRole !== 'super' || nextStatus !== 1)) throw new HttpError(400, '不能停用或降级当前登录账号');
  if (isLastSuper && (nextRole !== 'super' || nextStatus !== 1)) throw new HttpError(400, '必须保留至少一个超级管理员');

  const permissions = nextRole === 'super'
    ? []
    : normalizePermissions(ctx.body.permissions !== undefined ? ctx.body.permissions : parsePermissions(row.permissions));
  const passwordHash = ctx.body.password ? hashPassword(String(ctx.body.password)) : row.password_hash;
  const now = new Date().toISOString();
  ctx.db.prepare('UPDATE admins SET display_name = ?, role = ?, permissions = ?, password_hash = ?, status = ?, created_at = created_at WHERE id = ?')
    .run(String(ctx.body.display_name ?? row.display_name), nextRole, JSON.stringify(permissions), passwordHash, nextStatus, id);
  if (ctx.body.password || nextStatus === 0) {
    ctx.db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(id);
  }
  return { ok: true };
}

async function deleteAdmin(req, res, ctx) {
  const current = requireAdmin(req, ctx.db);
  const id = Number(ctx.params.id);
  const row = ctx.db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, '管理员不存在');
  if (row.id === current.id) throw new HttpError(400, '不能删除当前登录账号');
  if (row.role === 'super') {
    const superCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM admins WHERE role = 'super' AND status = 1").get().c;
    if (superCount <= 1) throw new HttpError(400, '必须保留至少一个超级管理员');
  }
  ctx.db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(id);
  ctx.db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  return { ok: true };
}

export const PERMISSION_GROUPS = [
  ['records:view', '查对记录查看'],
  ['records:review', '查对记录审核'],
  ['users:manage', '用户管理'],
  ['personnel:manage', '人员管理'],
  ['medicines:manage', '药品管理'],
  ['products:manage', '物品管理'],
  ['orders:manage', '订单管理'],
  ['banners:manage', '轮播图管理'],
  ['settings:manage', '系统设置'],
  ['admins:manage', '权限管理']
];

export const adminRoutes = [
  ['post', '/api/admin/login', login],
  ['post', '/api/admin/logout', logout],
  ['get', '/api/admin/me', me],
  ['post', '/api/admin/password', changePassword],
  ['get', '/api/admin/dashboard', dashboard],
  ['get', '/api/admin/users', listUsers, 'users:manage'],
  ['get', '/api/admin/users/:id', getUser, 'users:manage'],
  ['patch', '/api/admin/users/:id', updateUser, 'users:manage'],
  ['get', '/api/admin/personnel/options', personnelOptions, 'records:view'],
  ['get', '/api/admin/personnel/departments', personnelDepartments, 'personnel:manage'],
  ['get', '/api/admin/personnel', listPersonnel, 'personnel:manage'],
  ['post', '/api/admin/personnel', createPersonnel, 'personnel:manage'],
  ['get', '/api/admin/personnel/:id', getPersonnel, 'personnel:manage'],
  ['put', '/api/admin/personnel/:id', updatePersonnel, 'personnel:manage'],
  ['delete', '/api/admin/personnel/:id', deletePersonnel, 'personnel:manage'],
  ['get', '/api/admin/medicines', listMedicines, 'medicines:manage'],
  ['post', '/api/admin/medicines', createMedicine, 'medicines:manage'],
  ['get', '/api/admin/medicines/:id', getMedicine, 'medicines:manage'],
  ['put', '/api/admin/medicines/:id', updateMedicine, 'medicines:manage'],
  ['delete', '/api/admin/medicines/:id', deleteMedicine, 'medicines:manage'],
  ['get', '/api/admin/products', listProducts, 'products:manage'],
  ['post', '/api/admin/products', createProduct, 'products:manage'],
  ['get', '/api/admin/products/:id', getProduct, 'products:manage'],
  ['put', '/api/admin/products/:id', updateProduct, 'products:manage'],
  ['delete', '/api/admin/products/:id', deleteProduct, 'products:manage'],
  ['get', '/api/admin/orders', listOrders, 'orders:manage'],
  ['get', '/api/admin/orders/:id', getOrder, 'orders:manage'],
  ['patch', '/api/admin/orders/:id/status', updateOrderStatus, 'orders:manage'],
  ['get', '/api/admin/records', listInspections, 'records:view'],
  ['get', '/api/admin/records/:id', getInspection, 'records:view'],
  ['patch', '/api/admin/records/:id', updateInspection, 'records:review'],
  ['delete', '/api/admin/records/:id', deleteInspection, 'records:review'],
  ['get', '/api/admin/banners', listBanners, 'banners:manage'],
  ['post', '/api/admin/banners', createBanner, 'banners:manage'],
  ['put', '/api/admin/banners/:id', updateBanner, 'banners:manage'],
  ['delete', '/api/admin/banners/:id', deleteBanner, 'banners:manage'],
  ['get', '/api/admin/settings', getAdminSettings, 'settings:manage'],
  ['put', '/api/admin/settings', putAdminSettings, 'settings:manage'],
  ['get', '/api/admin/admins', listAdmins, 'admins:manage'],
  ['post', '/api/admin/admins', createAdmin, 'admins:manage'],
  ['put', '/api/admin/admins/:id', updateAdmin, 'admins:manage'],
  ['delete', '/api/admin/admins/:id', deleteAdmin, 'admins:manage']
].map(([method, path, handler, perm]) => [method, path, withPerm(perm, handler)]);
