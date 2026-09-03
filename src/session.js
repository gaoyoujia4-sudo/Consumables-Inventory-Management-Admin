import { HttpError, parseCookies } from './http.js';

export function parsePermissions(value) {
  try {
    const arr = JSON.parse(value || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function can(admin, perm) {
  return admin.role === 'super' || (Array.isArray(admin.permissions) && admin.permissions.includes(perm));
}

export function adminTokenFrom(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return parseCookies(req).admin_token || '';
}

export function requireAdmin(req, db) {
  const token = adminTokenFrom(req);
  if (!token) throw new HttpError(401, '请先登录');
  const row = db.prepare(`
    SELECT a.id, a.username, a.display_name, a.role, a.permissions, a.status, a.created_at
    FROM admin_sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, new Date().toISOString());
  if (!row) throw new HttpError(401, '登录已过期，请重新登录');
  if (Number(row.status) !== 1) throw new HttpError(403, '账号已被禁用');
  return { ...row, permissions: parsePermissions(row.permissions) };
}

export function requireUser(req, db) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, '请先登录');
  const row = db.prepare(`
    SELECT u.*
    FROM user_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND t.expires_at > ?
  `).get(token, new Date().toISOString());
  if (!row) throw new HttpError(401, '登录已过期，请重新登录');
  if (Number(row.status) !== 1) throw new HttpError(403, '账号已被禁用');
  return row;
}

export function pagination(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
