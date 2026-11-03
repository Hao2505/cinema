// Kết nối WebSocket: tự nối lại (backoff), ping đo giờ server, đăng nhập admin bằng mã trong link.
// Mã admin: mở trang kèm #admin=<mã> (hoặc ?admin=<mã>) MỘT lần → gửi POST /api/admin/login → server đặt cookie HttpOnly
// (JS không đọc được) → gỡ mã khỏi thanh địa chỉ. Mã không bao giờ được lưu ở localStorage, không hiện, không ghi log.
import { handleMessage, onPong, setConn, store } from './store.js';
import { ANY_ROOM_ID_RE, isPrivateRoomId } from './shared/hall.js';

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

/**
 * id phòng trong link (`href`, mặc định trang đang mở): phòng riêng ở sau dấu # (`/#phong=p-…` — phần sau # không bao giờ
 * được trình duyệt gửi tới máy chủ, nhật ký, Referer hay YouTube); phòng chung giữ `?phong=<rạp>`. '' = không có
 */
export function linkRoom(href = location.href) {
  try {
    const u = new URL(href);
    return new URLSearchParams(u.hash.replace(/^#/, '')).get('phong') || u.searchParams.get('phong') || '';
  } catch {
    return '';
  }
}

/**
 * link phòng riêng kiểu cũ `/?phong=p-…` (trước 04/11/2026) → đổi ngay tại chỗ sang `/#phong=p-…` (không tải lại trang):
 * từ đây tải lại trang, Referer của các yêu cầu sau… không còn mang id phòng riêng. Giữ nguyên các tham số khác (#admin=…)
 */
export function privLinkToHash() {
  try {
    const url = new URL(location.href);
    const id = url.searchParams.get('phong') || '';
    if (!isPrivateRoomId(id)) return;
    url.searchParams.delete('phong');
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (!hash.get('phong')) hash.set('phong', id);
    history.replaceState(history.state, '', `${url.pathname}${url.search}#${hash}`);
  } catch { /* bỏ qua */ }
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // phòng trong link (#phong=p-… / ?phong=<rạp>): phòng chung hoặc phòng riêng. Phòng riêng: server cho đứng xem rạp chung
  // trong lúc chờ mật khẩu (proom_need) — người chưa có quyền không bao giờ xem lén được phòng riêng
  const room = linkRoom();
  return `${proto}//${location.host}/ws${room && ANY_ROOM_ID_RE.test(room) ? `?room=${room}` : ''}`;
}

// đóng tab / rời trang: báo server bỏ nhân vật NGAY (khỏi để lại nhân vật "kẹt" trong rạp chờ hết hạn).
// pagehide có persisted = trang vào bộ nhớ đệm (sẽ quay lại) → không báo.
window.addEventListener('pagehide', (e) => {
  if (e.persisted || !store.joined || !ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ t: 'leave' })); } catch { /* bỏ qua */ }
});

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
    store.helloSeq = 0; // socket mới: hello đầu tiên là chào khi nối (store.js phân biệt với hello "bị tách khỏi phòng")
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
