import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const config = {
  root,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'app.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  adminTokenTtlDays: Number(process.env.ADMIN_TOKEN_DAYS || 7),
  userTokenTtlDays: Number(process.env.USER_TOKEN_DAYS || 30),
  wechatAppid: process.env.WX_APPID || '',
  wechatSecret: process.env.WX_SECRET || ''
};
