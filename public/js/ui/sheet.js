// Tấm dùng chung (ngoại hình, báo cáo, hướng dẫn, chọn phòng, quản trị). Máy tính: thẻ nổi bên phải (main.js nghe
// onSheetChange → rạp dời video sang trái); điện thoại: trượt từ dưới lên, mép trên = --sheet-top (dưới màn hình video)
// → không bao giờ che video.
import { setKids, setText } from '../util.js';

const $ = (id) => document.getElementById(id);
let onCloseFn = null;
let current = '';
const listeners = new Set();
const changed = () => { for (const fn of listeners) try { fn(); } catch { /* bỏ qua */ } };

/** báo mỗi lần tấm mở / đóng */
export function onSheetChange(fn) { listeners.add(fn); }

export function initSheet() {
  $('sheet-close').addEventListener('click', () => closeSheet());
  $('sheet').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } });
}

/** mở tấm với tiêu đề + nội dung (Node hoặc mảng Node); trả về body để cập nhật tiếp */
export function openSheet(id, title, content, onClose) {
  const prev = onCloseFn;
  onCloseFn = null;
  if (prev) try { prev(); } catch { /* bỏ qua */ }
  current = id;
  setText($('sheet-title'), title);
  setKids($('sheet-body'), content);
  const was = $('sheet').hidden;
  $('sheet').hidden = false;
  if (was) changed();
  onCloseFn = onClose || null;
  const first = $('sheet-body').querySelector('input, button, textarea, select');
  setTimeout(() => (first || $('sheet-close')).focus({ preventScroll: true }), 30);
  return $('sheet-body');
}

export function closeSheet() {
  if ($('sheet').hidden) return;
  $('sheet').hidden = true;
  current = '';
  changed();
  const fn = onCloseFn;
  onCloseFn = null;
  if (fn) try { fn(); } catch { /* bỏ qua */ }
}

export const sheetOpen = (id) => !$('sheet').hidden && (!id || current === id);
