// Thông báo nhỏ ở cuối khán phòng (không bao giờ nằm trên màn hình video). Chữ chỉ vào DOM qua textContent.
import { el } from '../util.js';

let host = null;
const recent = new Map(); // text -> lúc hiện (không hiện trùng liên tục)

export function initToasts(node) {
  host = node;
}

export function toast(text, kind = 'info', ms = 3800) {
  if (!host || !text) return;
  const now = performance.now();
  // chưa hiện lần nào → hiện ngay (so với mốc 0 thì mọi thông báo trong 2,5 s đầu sau khi tải trang bị nuốt mất —
  // vd vào phòng riêng bằng link rồi bị mời ra / tự rời ngay)
  const last = recent.get(text);
  if (last !== undefined && now - last < 2500) return;
  recent.set(text, now);
  if (recent.size > 30) recent.delete(recent.keys().next().value);
  const node = el('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status', text });
  host.append(node);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  }, ms);
}
