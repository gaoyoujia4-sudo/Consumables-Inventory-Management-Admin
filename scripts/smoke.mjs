const base = process.argv[2] || 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${res.status}: ${data.error || res.statusText}`);
  return data;
}

function pngBuffer() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  return Buffer.from(b64, 'base64');
}

const admin = await request('/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' })
});
console.log('admin login:', admin.admin.username);

const auth = { Authorization: `Bearer ${admin.token}` };
const dashboard = await request('/api/admin/dashboard', { headers: auth });
console.log('dashboard:', dashboard.totals.users, 'users,', dashboard.totals.inspections, 'inspections');

const users = await request('/api/admin/users?page=1&pageSize=5', { headers: auth });
console.log('users page:', users.total);

const products = await request('/api/admin/products?page=1&pageSize=5', { headers: auth });
console.log('products page:', products.total);

const records = await request('/api/admin/records?page=1&pageSize=5', { headers: auth });
console.log('records page:', records.total);

const wxLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'smoke-test-code-001', nickname: '烟雾测试员' })
});
console.log('mini login:', wxLogin.user.nickname, wxLogin.mock ? '(dev mode)' : '');

const userAuth = { Authorization: `Bearer ${wxLogin.token}` };
const home = await request('/api/v1/home');
console.log('home:', home.banners.length, 'banners,', home.hot_products.length, 'hot products');

const form = new FormData();
form.append('checkers', '王晨、李敏');
form.append('vehicle_no', '沪A·D99999');
form.append('lock_no', 'SL-TEST-01');
form.append('remark', '接口冒烟测试记录');
form.append('check_photo', new Blob([pngBuffer()], { type: 'image/png' }), 'check.png');
form.append('cargo_photo', new Blob([pngBuffer()], { type: 'image/png' }), 'cargo.png');
form.append('lock_photo', new Blob([pngBuffer()], { type: 'image/png' }), 'lock.png');
const created = await request('/api/v1/records', { method: 'POST', headers: userAuth, body: form });
console.log('inspection created:', created.record.record_no);

const myRecords = await request('/api/v1/records', { headers: userAuth });
console.log('my records:', myRecords.total);

const uploadForm = new FormData();
uploadForm.append('file', new Blob([pngBuffer()], { type: 'image/jpeg' }), 'photo.jpg');
const uploaded = await request('/api/v1/uploads', { method: 'POST', headers: userAuth, body: uploadForm });
console.log('upload:', uploaded.url);

const target = home.hot_products[0];
const order = await request('/api/v1/orders', {
  method: 'POST',
  headers: { ...userAuth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ product_id: target.id, quantity: 1, contact_name: '王晨', contact_phone: '13800009999' })
});
console.log('order created:', order.order.order_no, order.order.amount);

const paid = await request(`/api/v1/orders/${order.order.id}/pay`, { method: 'POST', headers: userAuth });
console.log('order paid:', paid.order.status);

console.log('SMOKE OK');
