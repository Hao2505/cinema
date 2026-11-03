// Tiện ích chung cho client (chép từ VibeCorp public/js/util.js, bỏ phần không dùng, thêm vài hàm cho rạp).
// AN TOÀN: mọi chuỗi từ server / người dùng chỉ được đưa vào DOM qua textContent / createTextNode.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  t = clamp(t, 0, 1);
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export const pad2 = (n) => String(n).padStart(2, '0');

/** giây → "3:07" / "1:02:03" */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

export function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** số giả ngẫu nhiên ổn định theo (x, y, seed) trong [0,1) */
export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1013, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[-0-9.,%\s/deg]+\)|[a-z]{3,24})$/i;
/** Chỉ nhận chuỗi màu CSS "lành" (không url(), không ký tự lạ) để gán vào style/canvas */
export function safeColor(c, fallback = '#9ca3af') {
  if (typeof c !== 'string') return fallback;
  const s = c.trim();
  return s.length <= 40 && COLOR_RE.test(s) ? s : fallback;
}

export const str = (v, max = 2000) => (typeof v === 'string' ? (v.length > max ? v.slice(0, max) + '…' : v) : v == null ? '' : String(v));
export const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const arr = (v) => (Array.isArray(v) ? v : []);

/** bỏ dấu tiếng Việt (để so khớp) */
export function noAccent(s) {
  return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/** chữ cái đầu của tên (hỗ trợ tiếng Việt) */
export function initial(name) {
  const s = str(name).trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  return Array.from(parts[parts.length - 1])[0].toUpperCase();
}

/**
 * Tạo phần tử DOM an toàn.
 * props: class, text, style{}, dataset{}, on*: handler, các thuộc tính khác -> setAttribute
 * children: Node | string | number | mảng; chuỗi luôn thành text node.
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'style') {
        for (const sk of Object.keys(v)) {
          if (v[sk] == null) continue;
          if (sk.startsWith('--')) node.style.setProperty(sk, String(v[sk]));
          else node.style[sk] = String(v[sk]);
        }
      } else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendKids(node, children);
  return node;
}

function appendKids(node, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendKids(node, c);
    else node.append(c instanceof Node ? c : String(c));
  }
}

/** Thay toàn bộ con của node */
export function setKids(node, ...children) {
  node.replaceChildren();
  appendKids(node, children);
}

export function setText(node, text) {
  const t = String(text ?? '');
  if (node && node.textContent !== t) node.textContent = t;
}

export const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
export const isNarrow = () => window.matchMedia('(max-width: 899px)').matches;
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* chế độ riêng tư: bỏ qua */ }
}
export function ssGet(key, fallback = null) {
  try { const v = sessionStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
export function ssSet(key, value) {
  try { if (value == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, String(value)); } catch { /* bỏ qua */ }
}

/** chuỗi hex ngẫu nhiên (khoá máy để chống spam / cấm) */
export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

let warnCount = 0;
export function warnOnce(...args) {
  if (warnCount++ < 20) console.warn('[rạp]', ...args);
}
