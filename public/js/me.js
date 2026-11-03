// Nhân vật của chính mình: đi NGAY trên máy (dự đoán phía client) bằng đúng hàm va chạm của server (shared/hall.js),
// gửi vị trí ≤ 15 lần / giây kèm giờ máy mình (để máy khác nội suy đều), server lệch thì kéo nhẹ về vị trí server.
// Dừng sát một ghế → tự trượt vào ghế và ngồi quay lên màn hình.
import {
  HOME, LIMITS, SPEED, actionById, isWalkable, moveWithCollision, nearestSeat, seatAt,
} from './shared/hall.js';
import { send } from './net.js';
import { spawnFx, store } from './store.js';

const SEND_MS = 1000 / LIMITS.sendHz;
const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };

export const me = {
  active: false,
  x: HOME.x, y: HOME.y, dir: 'up',
  yScale: 0.6, // px dọc / px ngang của một ô ở chỗ mình đứng (phối cảnh) — để chọn hướng mặt theo hướng nhìn thấy
  moving: false, phase: 0, moveAmt: 0,
  keys: new Set(),
  joy: null, // { x, y } độ lớn 0..1
  target: null, // { x, y, seat?: boolean, then?: actionId }
  act: null, // { id, def, start, fxAt, fxStarted }
  lastSend: 0, sentX: NaN, sentY: NaN, sentDir: '', sentMoving: false,
  smooth: null, // { dx, dy, t0 } kéo mượt khi server sửa
  stuckAt: 0, lastProgress: 0,
};

export function placeMe(x, y, dir = 'up') {
  me.x = x; me.y = y; me.dir = dir;
  me.target = null; me.act = null; me.moving = false; me.smooth = null;
  me.sentX = x; me.sentY = y; me.sentDir = dir; me.sentMoving = false;
}

/** vị trí để vẽ (đã cộng phần kéo mượt sau khi server sửa) */
export function myRenderPos(now) {
  const s = me.smooth;
  if (!s) return { x: me.x, y: me.y };
  const k = Math.min(1, (now - s.t0) / 180);
  if (k >= 1) { me.smooth = null; return { x: me.x, y: me.y }; }
  return { x: me.x + s.dx * (1 - k), y: me.y + s.dy * (1 - k) };
}

/** server sửa vị trí (đi quá nhanh / vào chỗ cấm) */
export function applyCorrection(x, y, now = performance.now()) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const dx = me.x - x, dy = me.y - y;
  if (Math.hypot(dx, dy) < 0.02) return;
  me.smooth = Math.hypot(dx, dy) < 2.5 ? { dx, dy, t0: now } : null;
  me.x = x; me.y = y;
  me.target = null;
  me.sentX = x; me.sentY = y;
}

function inputVector() {
  let ix = 0, iy = 0;
  const k = me.keys;
  if (k.has('left')) ix -= 1;
  if (k.has('right')) ix += 1;
  if (k.has('up')) iy -= 1;
  if (k.has('down')) iy += 1;
  if (ix || iy) {
    const m = Math.hypot(ix, iy);
    return { x: ix / m, y: iy / m, mag: 1 };
  }
  if (me.joy) {
    const m = Math.hypot(me.joy.x, me.joy.y);
    if (m > 0.14) return { x: me.joy.x / m, y: me.joy.y / m, mag: Math.min(1, Math.max(0.4, (m - 0.14) / 0.7)) };
  }
  return null;
}

const AXIS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEEP_COS = Math.cos((54 * Math.PI) / 180);

/**
 * Hướng mặt khi đi: theo hướng NHÌN THẤY trên màn hình (trục sâu bị phối cảnh nén lại — me.yScale = px dọc / px ngang
 * của một ô ở chỗ mình đứng, stage.js cập nhật mỗi khung). Gần đường chéo thì giữ hướng cũ cho khỏi nháy qua lại, NHƯNG
 * chỉ khi hướng cũ cùng phía chuyển động (lệch ≤ 54°) — không bao giờ giữ hướng ngược chiều (quay mặt ra mà đi lùi).
 */
export function dirOf(vx, vy, prev) {
  const sx = vx, sy = vy * (me.yScale || 0.6);
  const len = Math.hypot(sx, sy);
  if (!(len > 0)) return prev || 'down';
  const dom = Math.abs(sx) >= Math.abs(sy) ? (sx < 0 ? 'left' : 'right') : (sy < 0 ? 'up' : 'down');
  if (prev && prev !== dom && AXIS[prev]) {
    const [px, py] = AXIS[prev];
    if ((px * sx + py * sy) / len >= KEEP_COS) return prev;
  }
  return dom;
}

/** ghế trống gần (x, y) — bỏ ghế đang có người khác ngồi / đứng */
function freeSeatNear(x, y, maxD) {
  const s = nearestSeat(x, y, maxD);
  if (!s) return null;
  for (const a of store.players.values()) {
    if (a.isMe || a.goneAt) continue;
    if (Math.hypot(a.x - s.x, a.y - s.y) < 0.3) return null;
  }
  return s;
}

/** chạm / bấm sàn: đi tới đó (bấm trúng ghế = tới ngồi) */
export function walkTo(x, y) {
  if (!me.active) return;
  const seat = freeSeatNear(x, y, 0.5);
  if (seat) { me.target = { x: seat.x, y: seat.y, seat: true }; return; }
  if (!isWalkable(x, y)) return;
  me.target = { x, y };
  me.lastProgress = performance.now();
}

/** một bước mô phỏng (gọi mỗi khung vẽ) */
export function tickMe(dt, now) {
  if (!me.active) return;
  dt = Math.min(dt, 0.1);
  const iv = inputVector();
  let vx = 0, vy = 0;
  if (iv) {
    me.target = null;
    vx = iv.x * SPEED * iv.mag;
    vy = iv.y * SPEED * iv.mag;
  } else if (me.target) {
    const tx = me.target.x - me.x, ty = me.target.y - me.y;
    const d = Math.hypot(tx, ty);
    if (d < 0.04) {
      me.x = me.target.x; me.y = me.target.y;
      const t = me.target;
      me.target = null;
      if (t.seat) me.dir = 'up';
      if (t.then) startAction(t.then, now);
    } else {
      const sp = Math.min(SPEED, (d / dt) * 0.98);
      vx = (tx / d) * sp;
      vy = (ty / d) * sp;
    }
  }
  const before = { x: me.x, y: me.y };
  if (vx || vy) {
    const r = moveWithCollision(me.x, me.y, vx * dt, vy * dt);
    me.x = r.x; me.y = r.y;
    me.dir = dirOf(vx, vy, me.dir);
    const moved = Math.hypot(me.x - before.x, me.y - before.y);
    if (me.target) {
      if (moved > 0.002) me.lastProgress = now;
      else if (now - me.lastProgress > 450) me.target = null; // kẹt (vật cản): thôi
    }
  }
  const moved = Math.hypot(me.x - before.x, me.y - before.y);
  const wasMoving = me.moving;
  me.moving = moved > 0.0005;
  if (me.moving) me.phase += moved * 9.5;
  me.moveAmt += ((me.moving ? 1 : 0) - me.moveAmt) * 0.35;
  if (me.moving && me.act) me.act = null; // đi là thôi động tác (server + máy khác cũng tự thôi)
  // vừa dừng sát một ghế trống → trượt vào ngồi
  if (wasMoving && !me.moving && !iv && !me.target) {
    const s = freeSeatNear(me.x, me.y, 0.42);
    if (s && Math.hypot(s.x - me.x, s.y - me.y) > 0.01) me.target = { x: s.x, y: s.y, seat: true };
    else if (s) me.dir = 'up';
  }
  sendIfNeeded(now);
}

function sendIfNeeded(now) {
  const changed = Math.abs(me.x - me.sentX) > 0.004 || Math.abs(me.y - me.sentY) > 0.004 || me.dir !== me.sentDir;
  const stopNow = !me.moving && me.sentMoving;
  if (!changed && !stopNow) return;
  if (me.moving && now - me.lastSend < SEND_MS) return;
  if (!me.moving && !stopNow && now - me.lastSend < 60) return;
  const ok = send({ t: 'move', x: round2(me.x), y: round2(me.y), d: DIR_INDEX[me.dir] ?? 0, c: Math.round(now), m: me.moving ? 1 : 0 });
  if (!ok) return;
  me.lastSend = now;
  me.sentX = me.x; me.sentY = me.y; me.sentDir = me.dir; me.sentMoving = me.moving;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** đang ngồi ghế? (đứng yên đúng chỗ ngồi) */
export function mySeat() {
  return !me.moving && !me.target ? seatAt(me.x, me.y) : null;
}

function startAction(id, now) {
  const def = actionById(id);
  if (!def) return;
  me.act = { id: def.id, def, start: now, fxAt: 0, fxStarted: false };
  send({ t: 'act', a: def.id, c: Math.round(now) });
}

/** bấm động tác (phím 1–8 / vòng chọn). Bấm lại điệu đang lặp = thôi. */
export function doAction(id) {
  if (!me.active) return;
  const def = actionById(id);
  if (!def) return;
  const now = performance.now();
  if (me.act && me.act.id === def.id && def.dur === 0) {
    me.act = null;
    send({ t: 'act', a: '', c: Math.round(now) });
    return;
  }
  if (def.id === 'sit' && !mySeat()) {
    // ngồi xem: có ghế trống ngay cạnh thì vào ghế rồi ngồi, không thì ngồi bệt tại chỗ
    const s = freeSeatNear(me.x, me.y, 0.9);
    if (s) { me.target = { x: s.x, y: s.y, seat: true, then: 'sit' }; return; }
  }
  me.target = null;
  startAction(def.id, now);
}

/** emoji thả nhanh: hiện ngay trên máy mình, server phát cho người khác */
export function react(e) {
  if (!me.active) return;
  send({ t: 'emo', e });
  spawnFx(store.myId, e, performance.now(), { spread: 0.5, size: 1.15 });
}

/** các phím đang giữ (gọi từ input.js) */
export function setKey(dir, down) {
  if (down) me.keys.add(dir); else me.keys.delete(dir);
}
export function clearKeys() {
  me.keys.clear();
}
export function setJoy(v) {
  me.joy = v;
}
