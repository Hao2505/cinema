// Kết nối WebSocket: tự nối lại (backoff), ping đo giờ server, đăng nhập admin bằng mã trong link.
// Mã admin: mở trang kèm #admin=<mã> (hoặc ?admin=<mã>) MỘT lần → gửi POST /api/admin/login → server đặt cookie HttpOnly
// (JS không đọc được) → gỡ mã khỏi thanh địa chỉ. Mã không bao giờ được lưu ở localStorage, không hiện, không ghi log.
import { handleMessage, onPong, setConn, store } from './store.js';

let ws = null;
let attempt = 0;
let retryTimer = 0;
let pingTimer = 0;
let everOpened = false;
let stopped = false;
const pings = new Map(); // c -> lúc gửi

/** đọc #admin= / ?admin= trên URL, gỡ khỏi URL, đăng nhập (đặt cookie). Trả về Promise xong khi đã thử. */
export async function adminLoginFromUrl() {
  let token = null;
  try {
    const url = new URL(location.href);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hash.has('admin')) token = hash.get('admin');
    else if (url.searchParams.has('admin')) token = url.searchParams.get('admin');
    if (token === null) return false;
    url.searchParams.delete('admin');
    hash.delete('admin');
    const h = hash.toString();
    url.hash = h ? `#${h}` : '';
    history.replaceState(history.state, '', url.toString());
  } catch {
    return false;
  }
  token = (token || '').trim().slice(0, 200);
  if (!token) return false;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export function adminLogout() {
  fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin', keepalive: true })
    .catch(() => { /* bỏ qua */ })
    .finally(() => location.reload());
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const room = new URLSearchParams(location.search).get('phong');
  return `${proto}//${location.host}/ws${room && /^[0-9]{1,3}$/.test(room) ? `?room=${room}` : ''}`;
}

export function connect() {
  clearTimeout(retryTimer);
  if (stopped) return;
  setConn(everOpened ? 'closed' : 'connecting');
  let sock;
  try {
    sock = new WebSocket(wsUrl());
  } catch {
    scheduleRetry();
    return;
  }
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    attempt = 0;
    everOpened = true;
    setConn('open');
    clearInterval(pingTimer);
    let n = 0;
    ping();
    // đo giờ dày lúc đầu (lấy mẫu RTT tốt nhất), sau đó thưa
    pingTimer = setInterval(() => { n++; if (n < 8 || n % 5 === 0) ping(); }, 3000);
  };
  sock.onmessage = (ev) => {
    if (ws !== sock || typeof ev.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg && msg.t === 'pong') {
      const sent = pings.get(msg.c);
      pings.delete(msg.c);
      onPong(msg, sent);
      return;
    }
    handleMessage(msg);
  };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    ws = null;
    clearInterval(pingTimer);
    store.ready = false;
    setConn(everOpened ? 'closed' : 'connecting');
    if (ev.code === 4001) { stopped = true; return; } // bị mời ra: không tự vào lại
    if (ev.code === 4002) { stopped = true; store.emit('replaced'); return; } // nhân vật đã chuyển sang tab / máy khác
    scheduleRetry();
  };
  sock.onerror = () => { /* onclose sẽ xử lý */ };
}

function ping() {
  const c = Math.round(performance.now() * 1000) / 1000;
  pings.set(c, performance.now());
  if (pings.size > 20) pings.delete(pings.keys().next().value);
  send({ t: 'ping', c });
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = Math.min(12000, 700 * Math.pow(1.7, attempt)) * (0.8 + Math.random() * 0.4);
  attempt++;
  retryTimer = setTimeout(connect, delay);
}

export function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

export function isOpen() {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

// quay lại tab sau khi máy ngủ / có mạng lại: thử nối ngay
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !ws && !stopped) { attempt = 0; connect(); }
});
window.addEventListener('online', () => { if (!ws && !stopped) { attempt = 0; connect(); } });
