// Điều khiển: WASD / phím mũi tên để đi, E mở vòng động tác, 1–8 làm động tác, Enter để chat, Esc đóng.
// Đang gõ chat / điền ô nhập thì không bắt phím. Điện thoại: cần điều khiển ảo (kéo) + chạm sàn để đi tới.
import { ACTIONS } from './shared/hall.js';
import { clearKeys, doAction, me, setJoy, setKey } from './me.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const MOVE_KEYS = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

function typingTarget(t) {
  if (!t || !(t instanceof Element)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** hooks: { wheel, closeAll(): boolean (đã đóng gì đó), blocked(): boolean (đang mở màn vào rạp / tấm trượt) } */
export function initInput(hooks) {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (hooks.wheel.open) { hooks.wheel.close(); e.preventDefault(); return; }
      if (hooks.closeAll()) e.preventDefault();
      return;
    }
    if (typingTarget(e.target) || hooks.blocked() || !me.active) return;
    const dir = MOVE_KEYS[e.code] || MOVE_KEYS[e.key];
    if (dir) {
      // trong vòng động tác, phím mũi tên để chọn nút (wheel.js tự xử lý)
      if (hooks.wheel.open && e.key.startsWith('Arrow')) return;
      setKey(dir, true);
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      if (!e.repeat) hooks.wheel.toggle();
      return;
    }
    const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (m) {
      e.preventDefault();
      if (e.repeat) return;
      const a = ACTIONS[Number(m[1]) - 1];
      if (a) doAction(a.id);
      hooks.wheel.close();
      return;
    }
    if (e.key === 'Enter') {
      const input = $('chat-input');
      if (!input.disabled) { e.preventDefault(); input.focus(); }
    }
  });
  window.addEventListener('keyup', (e) => {
    const dir = MOVE_KEYS[e.code] || MOVE_KEYS[e.key];
    if (dir) setKey(dir, false);
  });
  // mất focus (bấm sang khung YouTube, đổi tab): nhả hết phím để nhân vật không tự đi mãi
  window.addEventListener('blur', () => {
    clearKeys();
    // lỡ bấm vào khung video: cú bấm vẫn tới YouTube (link, nút quảng cáo vẫn chạy), nhưng trả bàn phím về trang ngay
    // để WASD / E / 1–8 tiếp tục điều khiển nhân vật (không bao giờ "kẹt" trong khung YouTube)
    setTimeout(() => {
      const a = document.activeElement;
      // đang xem riêng video toàn màn hình thì để yên; cả rạp toàn màn hình (nút ⛶ góc trên) thì vẫn trả phím
      const fs = document.fullscreenElement;
      if (!a || a.tagName !== 'IFRAME' || (fs && fs !== document.documentElement)) return;
      const hall = $('hall');
      if (hall) hall.focus({ preventScroll: true });
      if (document.activeElement && document.activeElement.tagName === 'IFRAME' && me.active) $('focus-hint').hidden = false;
    }, 150);
  });
  window.addEventListener('focus', () => { $('focus-hint').hidden = true; });
  $('hall').addEventListener('pointerdown', () => {
    $('focus-hint').hidden = true;
    if (document.activeElement && document.activeElement !== document.body && !typingTarget(document.activeElement)) document.activeElement.blur?.();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });

  // ---------------------------------------------------------------- cần điều khiển ảo
  const joy = $('joystick');
  const knob = joy.querySelector('.joy-knob');
  let jp = null;
  const R = 44;
  function update(e) {
    const r = joy.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    setJoy({ x: clamp(dx / R, -1, 1), y: clamp(dy / R, -1, 1) });
  }
  joy.addEventListener('pointerdown', (e) => {
    jp = e.pointerId;
    try { joy.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
    joy.classList.add('active');
    me.target = null;
    update(e);
    e.preventDefault();
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === jp) update(e); });
  const end = (e) => {
    if (e.pointerId !== jp) return;
    jp = null;
    joy.classList.remove('active');
    knob.style.transform = '';
    setJoy(null);
  };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
}
