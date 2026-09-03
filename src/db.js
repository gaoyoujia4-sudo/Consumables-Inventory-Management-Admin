import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { hashPassword } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '管理员',
  role TEXT NOT NULL DEFAULT 'admin',
  permissions TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT UNIQUE,
  unionid TEXT DEFAULT '',
  nickname TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  cover TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  price REAL NOT NULL DEFAULT 0,
  original_price REAL,
  stock INTEGER NOT NULL DEFAULT 0,
  sales INTEGER NOT NULL DEFAULT 0,
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  category TEXT DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personnel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  department TEXT DEFAULT '',
  position TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  spec TEXT DEFAULT '',
  batch_no TEXT DEFAULT '',
  manufacturer TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT DEFAULT '盒',
  storage TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'normal',
  remark TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  image TEXT DEFAULT '',
  link_type TEXT DEFAULT 'none',
  link_value TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  product_id INTEGER,
  title TEXT NOT NULL,
  cover TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  contact_name TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  pay_time TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  checkers TEXT DEFAULT '',
  vehicle_no TEXT DEFAULT '',
  lock_no TEXT DEFAULT '',
  check_photo TEXT DEFAULT '',
  cargo_photo TEXT DEFAULT '',
  lock_photo TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted',
  review_remark TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_user ON inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_created ON inspections(created_at);
`;

function now() {
  return new Date().toISOString();
}

function daysAgo(days, hourOffset = 0) {
  const d = new Date(Date.now() - days * 86400000);
  d.setHours(d.getHours() - hourOffset);
  return d.toISOString();
}

export function openDb(dbFile = config.dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  const adminCols = db.prepare('PRAGMA table_info(admins)').all().map((c) => c.name);
  if (!adminCols.includes('role')) db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  if (!adminCols.includes('permissions')) db.exec("ALTER TABLE admins ADD COLUMN permissions TEXT NOT NULL DEFAULT ''");
  if (!adminCols.includes('status')) db.exec('ALTER TABLE admins ADD COLUMN status INTEGER NOT NULL DEFAULT 1');
  db.prepare("UPDATE admins SET role = 'super' WHERE username = 'admin' AND role = 'admin'").run();
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function saveSettings(db, values) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const [key, value] of Object.entries(values)) {
    stmt.run(key, String(value));
  }
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: row.avatar,
    phone: row.phone,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at
  };
}

function seed(db) {
  const defaultSettings = {
    site_name: '开封查对管理系统',
    wechat_appid: '',
    wechat_secret: '',
    upload_enabled: '1',
    max_photo_mb: '8'
  };
  const setStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) setStmt.run(key, value);

  const superAdmin = db.prepare("SELECT 1 AS ok FROM admins WHERE role = 'super'").get();
  if (!superAdmin) {
    db.prepare('INSERT INTO admins (username, password_hash, display_name, role, permissions, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run('admin', hashPassword('admin123'), '超级管理员', 'super', '', now());
  }
  if (!db.prepare("SELECT 1 AS ok FROM admins WHERE username = 'reviewer'").get()) {
    const permissions = JSON.stringify(['dashboard:view', 'records:view', 'records:review']);
    db.prepare('INSERT INTO admins (username, password_hash, display_name, role, permissions, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run('reviewer', hashPassword('reviewer123'), '记录审核员', 'admin', permissions, now());
  }

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const users = [
      ['oXk1pAbCdEfGh001', '山茶', '13800001234', daysAgo(18)],
      ['oXk1pAbCdEfGh002', '阿泽', '13800005678', daysAgo(15)],
      ['oXk1pAbCdEfGh003', '小林', '13900001234', daysAgo(12)],
      ['oXk1pAbCdEfGh004', 'Mia', '13700005678', daysAgo(8)],
      ['oXk1pAbCdEfGh005', '老周', '13600001234', daysAgo(3)]
    ];
    const insertUser = db.prepare('INSERT INTO users (openid, nickname, phone, status, created_at, last_login_at) VALUES (?, ?, ?, 1, ?, ?)');
    for (const [openid, nickname, phone, created] of users) {
      insertUser.run(openid, nickname, phone, created, daysAgo(1));
    }
  }

  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (productCount === 0) {
    const products = [
      ['便携急救包', '车载常备应急套装', '应急', 68, 45, 200, 132, '包含绷带、止血带、碘伏棉签等基础急救物资。', '适用于车辆随车携带，建议每季度检查一次有效期。'],
      ['医药周转箱', '药品分类收纳箱', '医药', 128, 99, 80, 57, '分区收纳，带温湿度记录卡位。', '加厚 ABS 材质，可上一次性密码锁。'],
      ['车载保温箱', '药品冷链转运箱', '医药', 268, 229, 40, 23, '支持冰排保冷，箱体带密封条。', '适配药品低温转运场景，箱门可挂一次性密码锁。'],
      ['急救毯', '保温反光急救毯', '应急', 19.9, 12.9, 500, 318, '聚酯薄膜材质，保温反光。', '应急保温，户外与车载均可使用。'],
      ['车载应急灯', '磁吸式应急照明灯', '车载', 59, 45, 150, 96, '磁吸安装，三档照明。', '支持 Type-C 充电，续航约 8 小时。'],
      ['一次性密码锁', '查对专用密封锁具', '医药', 2.5, 1.8, 2000, 1840, '每把锁具有唯一锁号，一次性使用。', '开封后锁体破坏，锁号用于核对记录。'],
      ['反光背心', '夜间安全警示背心', '车载', 25, 18, 300, 164, '高亮反光条，透气网布。', '随车应急使用，多种尺码。'],
      ['车载灭火器', '1kg 干粉灭火器', '车载', 88, 75, 60, 31, '车规级干粉灭火器，含固定支架。', '定期检查压力表，过期为无效状态。']
    ];
    const insertProduct = db.prepare(`
      INSERT INTO products (title, subtitle, cover, images, price, original_price, stock, sales, summary, content, category, status, sort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `);
    products.forEach((p, i) => {
      const cover = `/demo/product-${i + 1}.svg`;
      insertProduct.run(p[0], p[1], cover, JSON.stringify([cover]), p[3], p[4], p[5], p[6], p[7], p[8], p[2], now(), now());
    });
  }

  const personnelCount = db.prepare('SELECT COUNT(*) AS c FROM personnel').get().c;
  if (personnelCount === 0) {
    const insertPersonnel = db.prepare('INSERT INTO personnel (name, department, position, phone, status, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
    const personnel = [
      ['王晨', '药房', '主管药师', '13800001201'],
      ['李敏', '药房', '药师', '13800001202'],
      ['赵航', '车队', '驾驶员', '13800001203'],
      ['陈曦', '库房', '库管员', '13800001204'],
      ['孙磊', '调度', '调度员', '13800001205'],
      ['周雨', '药房', '药师', '13800001206'],
      ['吴凯', '车队', '安全员', '13800001207'],
      ['郑洁', '库房', '质量管理员', '13800001208']
    ];
    for (const p of personnel) {
      insertPersonnel.run(p[0], p[1], p[2], p[3], now(), now());
    }
  }

  const medicineCount = db.prepare('SELECT COUNT(*) AS c FROM medicines').get().c;
  if (medicineCount === 0) {
    const insertMedicine = db.prepare(`
      INSERT INTO medicines (name, spec, batch_no, manufacturer, expiry_date, quantity, unit, storage, status, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const medicines = [
      ['阿莫西林胶囊', '0.25g*24粒', 'B20260601', '华北制药', '2027-06-01', 120, '盒', '药箱 A-01', 'normal', '常温避光保存'],
      ['布洛芬缓释胶囊', '0.3g*20粒', 'B20260512', '中美史克', '2027-05-12', 80, '盒', '药箱 A-02', 'normal', ''],
      ['云南白药气雾剂', '85g+30g', 'B20260408', '云南白药', '2026-12-08', 36, '瓶', '药箱 B-01', 'expiring', '三个月内到期'],
      ['碘伏消毒液', '500ml', 'B20260703', '利尔康', '2028-07-03', 24, '瓶', '药箱 B-02', 'normal', ''],
      ['医用纱布绷带', '8cm*6m', 'B20260520', '稳健医疗', '2029-05-20', 60, '卷', '药箱 C-01', 'normal', ''],
      ['藿香正气水', '10ml*10支', 'B20260318', '太极集团', '2026-09-18', 45, '盒', '药箱 A-03', 'expiring', ''],
      ['复方感冒灵颗粒', '10g*9袋', 'B20260622', '华润三九', '2027-06-22', 70, '盒', '药箱 A-04', 'normal', ''],
      ['一次性医用口罩', '50只/盒', 'B20260710', '振德医疗', '2028-07-10', 200, '盒', '库房 D-01', 'normal', ''],
      ['75% 酒精消毒液', '500ml', 'B20250801', '利尔康', '2026-08-01', 15, '瓶', '库房 D-02', 'expired', '已过期待处理'],
      ['氯雷他定片', '10mg*6片', 'B20260615', '拜耳', '2028-06-15', 50, '盒', '药箱 A-05', 'normal', '']
    ];
    for (const m of medicines) {
      insertMedicine.run(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], now(), now());
    }
  }

  const bannerCount = db.prepare('SELECT COUNT(*) AS c FROM banners').get().c;
  if (bannerCount === 0) {
    const insertBanner = db.prepare('INSERT INTO banners (title, image, link_type, link_value, sort, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
    insertBanner.run('药品查对流程', '/demo/banner-1.svg', 'none', '', 1, now());
    insertBanner.run('一次性密码锁使用说明', '/demo/banner-2.svg', 'none', '', 2, now());
    insertBanner.run('随车物资盘点', '/demo/banner-3.svg', 'none', '', 3, now());
  }

  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  if (orderCount === 0) {
    const statuses = ['pending', 'paid', 'shipped', 'completed', 'cancelled'];
    const insertOrder = db.prepare(`
      INSERT INTO orders (order_no, user_id, product_id, title, cover, price, quantity, amount, status, contact_name, contact_phone, address, remark, pay_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= 12; i++) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(((i - 1) % 8) + 1);
      const status = statuses[i % statuses.length];
      const created = daysAgo(i + 1, i % 5);
      const payTime = status !== 'pending' && status !== 'cancelled' ? new Date(new Date(created).getTime() + 3600000).toISOString() : null;
      insertOrder.run(
        `MP${new Date(created).toISOString().slice(0, 10).replaceAll('-', '')}${String(1000 + i * 7)}`,
        ((i - 1) % 5) + 1,
        product.id,
        product.title,
        product.cover,
        product.price,
        (i % 3) + 1,
        product.price * ((i % 3) + 1),
        status,
        ['王晨', '李敏', '赵航', '陈曦', '孙磊'][(i - 1) % 5],
        `13${String(80000000 + i * 111111).slice(0, 9)}`,
        '配送点 A-102',
        i % 3 === 0 ? '请保持包装完整' : '',
        payTime,
        created,
        payTime || created
      );
    }
  }

  const inspectionCount = db.prepare('SELECT COUNT(*) AS c FROM inspections').get().c;
  if (inspectionCount === 0) {
    const insertInspection = db.prepare(`
      INSERT INTO inspections (record_no, user_id, checkers, vehicle_no, lock_no, check_photo, cargo_photo, lock_photo, remark, status, review_remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const records = [
      ['KC20260822001', 1, '王晨、李敏', '沪A·D12345', 'SL-88421', '/demo/check-1.svg', '/demo/cargo-1.svg', '/demo/lock-1.svg', '随车药品数量与台账一致', 'verified', '核对无误', daysAgo(6, 9)],
      ['KC20260823002', 2, '赵航、陈曦', '沪A·D22331', 'SL-79152', '/demo/check-2.svg', '/demo/cargo-2.svg', '/demo/lock-2.svg', '周转箱封条完好', 'submitted', '', daysAgo(5, 7)],
      ['KC20260825003', 3, '孙磊、周雨', '京B·F55678', 'SL-66007', '/demo/check-3.svg', '/demo/cargo-3.svg', '/demo/lock-3.svg', '保温箱温度记录正常', 'submitted', '', daysAgo(3, 3)],
      ['KC20260827004', 4, '王晨、孙磊', '沪A·D12345', 'SL-53219', '/demo/check-1.svg', '/demo/cargo-2.svg', '/demo/lock-3.svg', '本次开封用于月度盘点', 'verified', '照片清晰，核对通过', daysAgo(1, 5)]
    ];
    for (const r of records) {
      const created = r[11];
      insertInspection.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], created, created);
    }
  }
}
