import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

export function parseMultipart(req, maxBytes = 16 * 1024 * 1024) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new HttpError(400, '缺少 multipart boundary');
  const boundary = `--${match[1] || match[2]}`;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new HttpError(413, '上传内容过大'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(parseMultipartBuffer(Buffer.concat(chunks), boundary));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export function parseMultipartBuffer(buffer, boundary) {
  const fields = {};
  const files = {};
  const boundaryBuffer = Buffer.from(boundary);
  let cursor = 0;

  while (true) {
    const start = buffer.indexOf(boundaryBuffer, cursor);
    if (start === -1) break;
    const headerStart = start + boundaryBuffer.length;
    let lineEnd = buffer.indexOf('\r\n', headerStart);
    if (lineEnd === -1) break;
    let headerEnd = buffer.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) break;

    const headersText = buffer.subarray(headerStart, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuffer, contentStart);
    if (nextBoundary === -1) break;
    const contentEnd = buffer.lastIndexOf('\r\n', nextBoundary);
    const content = buffer.subarray(contentStart, contentEnd === -1 ? nextBoundary : contentEnd);

    const nameMatch = headersText.match(/name="([^"]+)"/i);
    const filenameMatch = headersText.match(/filename="([^"]*)"/i);
    const mimeMatch = headersText.match(/Content-Type:\s*([^\r\n]+)/i);

    if (nameMatch) {
      const name = nameMatch[1];
      if (filenameMatch && filenameMatch[1]) {
        files[name] = {
          filename: filenameMatch[1],
          mime: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
          data: Buffer.from(content)
        };
      } else {
        fields[name] = content.toString('utf8');
      }
    }
    cursor = nextBoundary;
  }

  return { fields, files };
}

export async function saveUploadedFile(file, subdir = '') {
  const ext = EXT_BY_MIME[file.mime.toLowerCase()] || '.bin';
  const maxMb = 8;
  if (file.data.length === 0) throw new HttpError(400, '照片文件为空');
  if (file.data.length > maxMb * 1024 * 1024) throw new HttpError(413, `单张照片不能超过 ${maxMb}MB`);
  if (ext === '.bin') throw new HttpError(415, '仅支持 JPG/PNG/WebP/GIF 照片');

  const now = new Date();
  const folder = path.join(config.root, 'uploads', subdir, now.toISOString().slice(0, 10).replaceAll('-', '/'));
  fs.mkdirSync(folder, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const filePath = path.join(folder, name);
  await fs.promises.writeFile(filePath, file.data);
  return `/uploads/${subdir}${subdir ? '/' : ''}${now.toISOString().slice(0, 10).replaceAll('-', '/')}/${name}`;
}
