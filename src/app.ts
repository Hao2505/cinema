// HTTP + WebSocket: file tĩnh trong public/ (phiên bản tài nguyên /v/<ver>/…, thẻ Open Graph), trang chính sách,
// /api/health, đăng nhập admin (POST /api/admin/login → cookie HttpOnly), WebSocket /ws nối vào Hub.
// Chép từ VibeCorp (../agent_office/src/server.ts) rồi chỉnh: dựng trong hàm createApp() để test chạy được nhiều bản.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { Config } from './config.js';
import { Hub, type Conn } from './hub.js';
import { WindowCounter, hashIp, loadOrCreateSalt } from './moderation.js';
import { MAX_MSG_BYTES, parseClientMsg, rawToString } from './protocol.js';
import type { YouTubeClient } from './youtube.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const PUBLIC_ROOT = (() => {
  try { return realpathSync(PUBLIC_DIR); } catch { return normalize(PUBLIC_DIR).replace(/[\\/]+$/, ''); }
})();
const HEARTBEAT_MS = 30_000;
const ADMIN_COOKIE = 'vc_admin';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** trang có tên đẹp → file html */
const PAGES: Record<string, string> = { '/': 'index.html', '/chinh-sach': 'chinh-sach.html' };

/** So chuỗi không lộ thời gian (băm trước để độ dài luôn bằng nhau) */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

function cookieValue(req: IncomingMessage, name: string): string {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
  }
  return '';
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error('body quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** request tới qua https? (trực tiếp, hoặc sau nginx: X-Forwarded-Proto, sau Cloudflare: CF-Visitor) */
function requestIsHttps(req: IncomingMessage): boolean {
  const xfp = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return xfp === 'https' || String(req.headers['cf-visitor'] ?? '').includes('"https"')
    || Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

const HOST_RE = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/;
const escAttr = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface AppDeps {
  youtube: YouTubeClient;
  /** thư mục dữ liệu (null = không ghi đĩa, dùng cho test) */
  dataDir: string | null;
  log?: (...a: unknown[]) => void;
}

export interface App {
  server: Server;
  hub: Hub;
  listen(port: number, host: string): Promise<number>;
  close(): Promise<void>;
}

export function createApp(cfg: Config, deps: AppDeps): App {
  const log = deps.log ?? ((...a: unknown[]) => console.log(...a));
  const salt = loadOrCreateSalt(deps.dataDir ?? cfg.dataDir, cfg.ipSalt, !!deps.dataDir && cfg.persist);
  const hub = new Hub(cfg, { youtube: deps.youtube, dataDir: deps.dataDir, log });
  const adminCookieValue = cfg.adminToken ? createHash('sha256').update(`${cfg.adminToken}:vibecinema-admin-v1`).digest('hex') : '';
  const loginWindow = new WindowCounter(10 * 60_000, 10);

  // ---------------------------------------------------------- phiên bản tài nguyên tĩnh
  /**
   * Phiên bản = băm (đường dẫn, kích thước, mtime) mọi file trong public/ lúc khởi động. Trang html trỏ js/css qua
   * /v/<phiên bản>/… (cache "mãi mãi"); deploy mới → URL mới → trình duyệt / Cloudflare không dùng bản cũ.
   */
  function computeAssetVersion(): string {
    const h = createHash('sha1');
    const walk = (dir: string, rel: string): void => {
      let names: string[] = [];
      try { names = readdirSync(dir).sort(); } catch { return; }
      for (const n of names) {
        if (n.startsWith('.')) continue;
        const p = join(dir, n);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p, `${rel}${n}/`);
        else h.update(`${rel}${n}|${st.size}|${Math.floor(st.mtimeMs)}\n`);
      }
    };
    walk(PUBLIC_ROOT, '');
    return h.digest('hex').slice(0, 12);
  }
  const ASSET_VERSION = existsSync(PUBLIC_ROOT) ? computeAssetVersion() : 'dev';
  const ASSET_PREFIX_RE = /^\/v\/([A-Za-z0-9]{4,40})(\/.*)$/;
  const OG_VERSION = (() => {
    try { return createHash('sha1').update(readFileSync(join(PUBLIC_ROOT, 'og-image.jpg'))).digest('hex').slice(0, 10); } catch { return '0'; }
  })();

  function siteOrigin(req: IncomingMessage): string {
    if (cfg.siteUrl) return cfg.siteUrl;
    const host = String(req.headers.host ?? '').trim().toLowerCase();
    return `${requestIsHttps(req) ? 'https' : 'http'}://${HOST_RE.test(host) ? host : `localhost:${cfg.port}`}`;
  }

  function safeHost(req: IncomingMessage): string {
    const host = String(req.headers.host ?? '').trim().toLowerCase();
    return HOST_RE.test(host) ? host : `localhost:${cfg.port}`;
  }

  /** CSP: chỉ cho chạy script của mình + YouTube IFrame API; khung nhúng chỉ YouTube */
  function securityHeaders(req: IncomingMessage): Record<string, string> {
    const host = safeHost(req);
    return {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' https://www.youtube.com https://s.ytimg.com",
        'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
        "img-src 'self' data: https://i.ytimg.com https://*.ytimg.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        `connect-src 'self' ws://${host} wss://${host}`,
        "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      // YouTube cần biết trang nhúng (Referer) mới phát được — đừng đổi thành no-referrer
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
  }

  const htmlCache = new Map<string, { mtime: number; html: string }>();
  function sendHtml(req: IncomingMessage, res: ServerResponse, file: string, mtimeMs: number): void {
    let e = htmlCache.get(file);
    if (!e || e.mtime !== mtimeMs) {
      const html = readFileSync(file, 'utf8').replace(/(href|src)="(?!https?:|data:|\/|%|#)([^"]+\.(?:css|js))"/g,
        (_m, attr: string, path: string) => `${attr}="/v/${ASSET_VERSION}/${path}"`).replaceAll('%OG_VERSION%', OG_VERSION);
      e = { mtime: mtimeMs, html };
      htmlCache.set(file, e);
    }
    const body = Buffer.from(e.html.replaceAll('%SITE_URL%', escAttr(siteOrigin(req)))
      .replaceAll('%CONTACT_EMAIL%', escAttr(cfg.contactEmail)), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(body.length), 'Cache-Control': 'no-cache',
      ...securityHeaders(req),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(body);
  }

  function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8', extra: Record<string, string> = {}): void {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(body);
  }

  function sendJson(res: ServerResponse, status: number, data: unknown): void {
    send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  /** File tĩnh trong public/ — chặn path traversal, dotfile, symlink ra ngoài */
  function handleStatic(req: IncomingMessage, res: ServerResponse, pathname: string, immutable = false): void {
    let rel: string;
    try { rel = decodeURIComponent(pathname); } catch { send(res, 400, 'Đường dẫn không hợp lệ'); return; }
    if (rel.includes('\0')) { send(res, 400, 'Đường dẫn không hợp lệ'); return; }
    if (PAGES[rel]) rel = `/${PAGES[rel]}`;
    if (rel.endsWith('/')) rel += 'index.html';
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    if (parts.some((p) => p === '..' || p.startsWith('.'))) { send(res, 404, 'Không tìm thấy'); return; }
    let file = join(PUBLIC_ROOT, ...parts);
    if (file !== PUBLIC_ROOT && !file.startsWith(PUBLIC_ROOT + sep)) { send(res, 403, 'Cấm truy cập'); return; }
    try {
      let st = statSync(file);
      if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); }
      const real = realpathSync(file);
      if (!real.startsWith(PUBLIC_ROOT + sep) || !st.isFile()) { send(res, 404, 'Không tìm thấy'); return; }
      // .d.ts (kiểu cho server) không cần phục vụ
      if (real.endsWith('.d.ts')) { send(res, 404, 'Không tìm thấy'); return; }
      if (extname(real) === '.html') { sendHtml(req, res, real, st.mtimeMs); return; }
      const cache = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
      const mtime = Math.floor(st.mtimeMs / 1000) * 1000;
      const ims = Date.parse(String(req.headers['if-modified-since'] ?? ''));
      if (!immutable && Number.isFinite(ims) && ims >= mtime) {
        res.writeHead(304, { 'Cache-Control': cache, 'Last-Modified': new Date(mtime).toUTCString() });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(st.size),
        'Cache-Control': cache,
        'Last-Modified': new Date(mtime).toUTCString(),
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(real);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch {
      send(res, 404, 'Không tìm thấy');
    }
  }

  // ---------------------------------------------------------- IP + admin
  /**
   * IP người xem. Production: nginx (realip, chỉ tin dải IP Cloudflare) ghi X-Real-IP = IP thật → tin X-Real-IP TRƯỚC;
   * ai gọi thẳng vào IP VPS kèm CF-Connecting-IP giả cũng không đổi được X-Real-IP. Không có nginx (máy dev) thì dùng
   * CF-Connecting-IP / X-Forwarded-For / IP kết nối.
   */
  function clientIp(req: IncomingMessage): string {
    if (cfg.trustProxy) {
      for (const h of ['x-real-ip', 'cf-connecting-ip']) {
        const v = req.headers[h];
        if (typeof v === 'string' && v.trim() && v.length < 100) return v.trim();
      }
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim().slice(0, 100);
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function isAdminReq(req: IncomingMessage): boolean {
    if (!adminCookieValue) return false;
    const v = cookieValue(req, ADMIN_COOKIE);
    return v.length === 64 && safeEqual(v, adminCookieValue);
  }

  /** Origin của WebSocket phải cùng trang (chặn trang khác mở WS bằng cookie admin của mình) */
  function originOk(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // client không phải trình duyệt (bot test, curl)
    try {
      const o = new URL(origin);
      if (cfg.siteUrl && o.origin === new URL(cfg.siteUrl).origin) return true;
      return o.host.toLowerCase() === String(req.headers.host ?? '').toLowerCase();
    } catch {
      return false;
    }
  }

  /** POST /api/admin/login {token} → cookie (băm của mã, không phải mã thật); POST /api/admin/logout → xoá */
  function handleAdmin(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    if (req.method !== 'POST') { send(res, 405, 'Phương thức không được hỗ trợ', 'text/plain; charset=utf-8', { Allow: 'POST' }); return; }
    const attrs = `Path=/; HttpOnly; SameSite=Strict${requestIsHttps(req) ? '; Secure' : ''}`;
    if (pathname === '/api/admin/logout') {
      res.writeHead(204, { 'Set-Cookie': `${ADMIN_COOKIE}=; ${attrs}; Max-Age=0`, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (!adminCookieValue) { send(res, 404, 'Not found'); return; }
    const type = String(req.headers['content-type'] ?? '');
    if (!type.startsWith('application/json')) { send(res, 415, 'Cần JSON'); return; }
    const ipHash = hashIp(clientIp(req), salt);
    if (!loginWindow.hit(ipHash)) { send(res, 429, 'Thử quá nhiều lần, đợi 10 phút'); return; }
    readBody(req, 2048).then((body) => {
      let token = '';
      try {
        const j: unknown = JSON.parse(body || '{}');
        if (j && typeof j === 'object' && typeof (j as { token?: unknown }).token === 'string') token = (j as { token: string }).token.trim().slice(0, 200);
      } catch { token = ''; }
      if (!token || !safeEqual(token, cfg.adminToken)) {
        log('[admin] Đăng nhập admin sai mã (không ghi mã ra log)');
        send(res, 403, 'Sai mã');
        return;
      }
      res.writeHead(204, { 'Set-Cookie': `${ADMIN_COOKIE}=${adminCookieValue}; ${attrs}; Max-Age=31536000`, 'Cache-Control': 'no-store' });
      res.end();
    }).catch(() => { if (!res.headersSent) send(res, 400, 'Body không hợp lệ'); });
  }

  // ---------------------------------------------------------- HTTP
  const server = createServer((req, res) => {
    try {
      let url: URL;
      try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { send(res, 400, 'URL không hợp lệ'); return; }
      const method = req.method ?? 'GET';
      if (url.pathname === '/api/admin/login' || url.pathname === '/api/admin/logout') { handleAdmin(req, res, url.pathname); return; }
      if (method !== 'GET' && method !== 'HEAD') {
        send(res, 405, 'Phương thức không được hỗ trợ', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
        return;
      }
      if (url.pathname === '/api/health') {
        sendJson(res, 200, { ok: true, ...hub.stats(), yt: deps.youtube.configured });
        return;
      }
      if (url.pathname.startsWith('/api/')) { send(res, 404, 'Not found'); return; }
      const vm = ASSET_PREFIX_RE.exec(url.pathname);
      if (vm) { handleStatic(req, res, vm[2], vm[1] === ASSET_VERSION); return; }
      handleStatic(req, res, url.pathname);
    } catch (e) {
      console.error('[http] Lỗi xử lý request:', e);
      if (!res.headersSent) send(res, 500, 'Lỗi máy chủ');
      else res.destroy();
    }
  });

  // ---------------------------------------------------------- WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES * 2, perMessageDeflate: false });
  const alive = new WeakMap<WebSocket, boolean>();
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { pathname = ''; }
    if (pathname !== '/ws' || !originOk(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ipHash = hashIp(clientIp(req), salt);
    let room = '';
    try { room = new URL(req.url ?? '/', 'http://localhost').searchParams.get('room') ?? ''; } catch { room = ''; }
    const conn: Conn | null = hub.connect(ws, { ipHash, admin: isAdminReq(req), room: /^[0-9]{1,3}$/.test(room) ? room : undefined });
    if (!conn) { ws.close(1013, 'quá nhiều kết nối'); return; }
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', () => { /* close sẽ dọn */ });
    ws.on('message', (data, isBinary) => {
      const text = rawToString(data, isBinary);
      if (text === null) return;
      const msg = parseClientMsg(text);
      if (!msg) return;
      try { hub.message(conn, msg); } catch (e) { console.error('[ws] xử lý tin nhắn lỗi:', e); }
    });
    ws.on('close', () => hub.disconnect(conn));
  });
  wss.on('error', (e) => console.error('[ws] Lỗi WebSocket server:', e.message));

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      try { ws.ping(); } catch { /* bỏ qua */ }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  hub.start();

  return {
    server,
    hub,
    listen(port: number, host: string): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const a = server.address();
          resolve(typeof a === 'object' && a ? a.port : port);
        });
      });
    },
    close(): Promise<void> {
      clearInterval(heartbeat);
      hub.stop();
      for (const ws of wss.clients) { try { ws.close(1001, 'server shutdown'); } catch { /* bỏ qua */ } }
      wss.close();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
        setTimeout(resolve, 1500).unref();
      });
    },
  };
}
