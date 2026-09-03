import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './src/config.js';
import { openDb } from './src/db.js';
import { createRouter, sendJson, sendError, readJson, HttpError } from './src/http.js';
import { parseMultipart } from './src/upload.js';
import { adminRoutes } from './src/admin-api.js';
import { miniRoutes } from './src/miniapp-api.js';

const db = openDb(config.dbFile);
const router = createRouter();

for (const [method, routePath, handler] of [...adminRoutes, ...miniRoutes]) {
  router[method](routePath, handler);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

function serveStatic(req, res, pathname) {
  const publicRoot = path.resolve(config.root, 'public');
  const uploadsRoot = path.resolve(config.root, 'uploads');
  let rel = '';
  let root = publicRoot;

  if (pathname === '/' || pathname === '/admin' || pathname === '/admin/') {
    rel = 'admin/index.html';
  } else if (pathname.startsWith('/admin/') || pathname.startsWith('/vendor/') || pathname.startsWith('/demo/')) {
    rel = pathname.slice(1);
  } else if (pathname.startsWith('/uploads/')) {
    rel = pathname.slice('/uploads/'.length);
    root = uploadsRoot;
  } else {
    return false;
  }

  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    sendJson(res, 403, { error: '禁止访问' });
    return true;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    sendJson(res, 404, { error: '文件不存在' });
    return true;
  }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-store' : 'public, max-age=3600'
  });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (serveStatic(req, res, pathname)) return;
    }

    const match = router.match(req.method, pathname);
    if (!match) throw new HttpError(404, '接口不存在');

    let body = {};
    let multipart = null;
    const contentType = req.headers['content-type'] || '';
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      if (contentType.startsWith('multipart/form-data')) {
        multipart = await parseMultipart(req);
        body = multipart.fields;
      } else {
        body = await readJson(req);
      }
    }

    const result = await match.handler(req, res, {
      db,
      params: match.params,
      body,
      multipart,
      req
    });
    if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}

const server = http.createServer(handle);
server.listen(config.port, config.host, () => {
  console.log(`小程序后台已启动: http://localhost:${config.port}`);
  console.log(`管理后台: http://localhost:${config.port}/admin`);
  console.log(`默认账号: admin / admin123`);
});
