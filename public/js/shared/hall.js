// Dùng chung server (src/*.ts import thẳng file này) + trình duyệt: sơ đồ khán phòng, va chạm, ghế, động tác,
// ngoại hình hợp lệ, giới hạn. Thuần JS, không đụng DOM / Node — sửa ở đây là cả hai phía cùng đổi.
// Kiểu cho TypeScript: hall.d.ts (giữ khớp tay khi sửa).
//
// Toạ độ: đơn vị ô (tile). x: ngang (tường trái x<1, tường phải x>W-1). y: ĐỘ SÂU — 0 ở mép sân khấu, tăng dần về cuối
// rạp (phía người xem / camera). Vị trí người chơi = ĐIỂM CHÂN. Màn vẽ phối cảnh một điểm tụ (render/persp.js): y càng nhỏ
// (càng gần màn hình) thì vẽ càng nhỏ, càng cao trên màn.

export const PROTOCOL = 1;

// Rạp lớn: 60 người / phòng mà vẫn thoáng — 130 ghế (đầy phòng mới kín chưa nửa rạp), sàn nhảy 26 × 4,3 ô.
export const HALL = Object.freeze({
  W: 34, // bề ngang (trong lòng rạp: x 1 → 33)
  H: 16, // độ sâu: mép sân khấu (0) → tường cuối (16)
  stageLip: 0.75, // y < stageLip là sân khấu (không đi được)
  bounds: Object.freeze({ minX: 1.3, maxX: 32.7, minY: 1.0, maxY: 15.7 }),
  danceFloor: Object.freeze({ x: 4, y: 0.95, w: 26, h: 4.3 }),
  rows: Object.freeze([7.1, 8.8, 10.5, 12.2, 13.9]), // y chân người ngồi của từng hàng ghế (5 hàng × 26 ghế = 130 chỗ)
  blocks: Object.freeze([
    Object.freeze({ x0: 2, n: 8 }), // dãy trái: ghế ở x = 2.5 … 9.5
    Object.freeze({ x0: 12, n: 10 }), // dãy giữa: 12.5 … 21.5
    Object.freeze({ x0: 24, n: 8 }), // dãy phải: 24.5 … 31.5
  ]),
  // vật cản: loa hai bên mép sân khấu, quầy bar bắp nước sát tường phải cạnh sàn nhảy
  speakers: Object.freeze([
    Object.freeze({ x: 1.2, y: 0.4, w: 1.3, h: 1.1 }),
    Object.freeze({ x: 31.5, y: 0.4, w: 1.3, h: 1.1 }),
  ]),
  counter: Object.freeze({ x: 32.05, y: 2.0, w: 0.95, h: 2.7 }),
  exits: Object.freeze([5.4, 11.4]), // biển "LỐI RA" hai bên tường (độ sâu y) — chỉ để vẽ
});
/** chỗ đứng mặc định (giữa lối đi cuối rạp) */
export const HOME = Object.freeze({ x: HALL.W / 2, y: HALL.H - 0.7 });

const FOOT = 0.3; // bán kính bàn chân khi tính va chạm

function rectHit(r, x, y, padX = FOOT, padTop = 0.12, padBottom = FOOT * 0.6) {
  return x > r.x - padX && x < r.x + r.w + padX && y > r.y - padTop && y < r.y + r.h + padBottom;
}

/** đứng được ở (x, y) không (trong rạp, không chui vào loa / quầy) */
export function isWalkable(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const b = HALL.bounds;
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
  for (const s of HALL.speakers) if (rectHit(s, x, y)) return false;
  if (rectHit(HALL.counter, x, y, FOOT, FOOT * 0.6, FOOT * 0.6)) return false;
  return true;
}

/** điểm đứng được gần (x, y) nhất (dùng khi server sửa vị trí sai) */
export function clampToWalkable(x, y) {
  const b = HALL.bounds;
  let cx = Number.isFinite(x) ? Math.min(b.maxX, Math.max(b.minX, x)) : (b.minX + b.maxX) / 2;
  let cy = Number.isFinite(y) ? Math.min(b.maxY, Math.max(b.minY, y)) : b.maxY;
  if (isWalkable(cx, cy)) return { x: cx, y: cy };
  // thử đẩy ra theo vòng tròn nở dần
  for (let r = 0.1; r < 4; r += 0.1) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const nx = cx + Math.cos(a) * r, ny = cy + Math.sin(a) * r;
      if (isWalkable(nx, ny)) return { x: nx, y: ny };
    }
  }
  return { x: HOME.x, y: HOME.y };
}

/**
 * Đi (dx, dy) từ (x, y), trượt dọc tường / vật cản (tách trục), chia bước nhỏ để không xuyên vật mỏng.
 * Client dự đoán và server kiểm tra dùng chung hàm này.
 */
export function moveWithCollision(x, y, dx, dy) {
  const dist = Math.hypot(dx, dy);
  if (!(dist > 0)) return { x, y };
  const n = Math.max(1, Math.ceil(dist / 0.2));
  const sx = dx / n, sy = dy / n;
  for (let i = 0; i < n; i++) {
    const nx = x + sx;
    if (isWalkable(nx, y)) x = nx;
    const ny = y + sy;
    if (isWalkable(x, ny)) y = ny;
  }
  return { x, y };
}

/** tốc độ đi bộ (ô / giây) */
export const SPEED = 3.4;

// ---------------------------------------------------------------- ghế
/** mọi chỗ ngồi: { x, y } là điểm chân khi ngồi, row/col để vẽ */
export const SEATS = Object.freeze((() => {
  const out = [];
  HALL.rows.forEach((y, row) => {
    let col = 0;
    for (const b of HALL.blocks) {
      for (let i = 0; i < b.n; i++) out.push(Object.freeze({ x: b.x0 + i + 0.5, y, row, col: col++ }));
    }
  });
  return out;
})());

/** ghế gần (x, y) trong bán kính maxD (null nếu không có) */
export function nearestSeat(x, y, maxD = 0.5) {
  let best = null, bd = maxD;
  for (const s of SEATS) {
    if (Math.abs(s.y - y) > maxD || Math.abs(s.x - x) > maxD) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= bd) { bd = d; best = s; }
  }
  return best;
}

/** đang ngồi đúng ghế (chân trùng chỗ ngồi, sai số nhỏ) */
export function seatAt(x, y, eps = 0.14) {
  return nearestSeat(x, y, eps);
}

/** chỗ xuất hiện khi vào rạp: lối đi cuối rạp (sau hàng ghế cuối), ngẫu nhiên */
export function spawnPoint(rand = Math.random) {
  for (let i = 0; i < 30; i++) {
    const x = 5 + rand() * (HALL.W - 10), y = HALL.H - 1.2 + rand() * 0.7;
    if (isWalkable(x, y)) return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  }
  return { x: HOME.x, y: HOME.y };
}

// ---------------------------------------------------------------- rạp (mỗi rạp = một phòng: chủ đề vẽ + màn hình + hàng chờ riêng)
// Cùng sơ đồ HALL (đi lại, ghế, va chạm giống hệt) — chỉ khác cách vẽ (render/venues/*.js). Rạp đầy thì server mở bản
// sao "<rạp>-2", "<rạp>-3"… (tối đa MAX_ROOMS mỗi rạp), bỏ trống lâu thì đóng; bản chính không bao giờ đóng.
export const VENUES = Object.freeze([
  Object.freeze({ id: 'nhung', name: 'Rạp Nhung Đỏ', emoji: '🎭', desc: 'Trong nhà: ghế nhung đỏ, màn nhung, sàn nhảy LED' }),
  Object.freeze({ id: 'congvien', name: 'Rạp Công Viên', emoji: '🌳', desc: 'Ngoài trời: bãi cỏ, gối lười, đèn dây, đom đóm' }),
  Object.freeze({ id: 'doxe', name: 'Rạp Đỗ Xe', emoji: '🚗', desc: 'Kiểu Mỹ: ngồi xe mui trần xem màn hình khổng lồ' }),
  Object.freeze({ id: 'bien', name: 'Rạp Bãi Biển', emoji: '🏖️', desc: 'Ghế xếp trên cát, hàng dừa, đuốc tiki, trăng trên biển' }),
]);
export const DEFAULT_VENUE = 'nhung';
/** id phòng CHUNG: "<rạp>" (bản chính) hoặc "<rạp>-2" … "<rạp>-9" (bản sao khi rạp đầy). parseRoomId chỉ nhận loại này */
export const ROOM_ID_RE = /^[a-z]{3,10}(?:-[2-9])?$/;
/**
 * id PHÒNG RIÊNG (có mật khẩu, chủ phòng tạo): "p-" + 10 ký tự [a-z0-9] ngẫu nhiên (crypto, không đoán được). Rạp (khung
 * cảnh) của phòng riêng do chủ phòng chọn → lấy từ snapshot (`snap.venue`), KHÔNG suy ra từ id được.
 */
export const PRIVATE_ROOM_RE = /^p-[a-z0-9]{10}$/;
/** id phòng bất kỳ (chung hoặc riêng) — dùng khi kiểm id từ URL / thông điệp */
export const ANY_ROOM_ID_RE = /^(?:[a-z]{3,10}(?:-[2-9])?|p-[a-z0-9]{10})$/;
export function isPrivateRoomId(id) {
  return typeof id === 'string' && PRIVATE_ROOM_RE.test(id);
}

export function venueById(id) {
  return VENUES.find((v) => v.id === id) || null;
}

/** "bien-2" → { venue: <Rạp Bãi Biển>, n: 2 } · id sai / rạp không có → null */
export function parseRoomId(id) {
  if (typeof id !== 'string' || !ROOM_ID_RE.test(id)) return null;
  const [v, n] = id.split('-');
  const venue = venueById(v);
  return venue ? { venue, n: n ? Number(n) : 1 } : null;
}

/** tên hiển thị của phòng: "Rạp Bãi Biển", "Rạp Bãi Biển 2" */
export function roomName(id) {
  const r = parseRoomId(id);
  if (!r) return 'Rạp';
  return r.n > 1 ? `${r.venue.name} ${r.n}` : r.venue.name;
}

// ---------------------------------------------------------------- hướng
export const DIRS = Object.freeze(['down', 'up', 'left', 'right']);
export function dirIndex(d) {
  const i = DIRS.indexOf(d);
  return i < 0 ? 0 : i;
}

// ---------------------------------------------------------------- động tác (phím 1–8, vòng chọn phím E)
// dur = thời lượng ms (0 = lặp tới khi đi / chọn động tác khác). seat = làm được khi đang ngồi ghế.
export const ACTIONS = Object.freeze([
  Object.freeze({ id: 'wave', key: 1, label: 'Vẫy tay chào', emoji: '👋', dur: 2400, seat: true }),
  Object.freeze({ id: 'clap', key: 2, label: 'Vỗ tay', emoji: '👏', dur: 3000, seat: true }),
  Object.freeze({ id: 'hiphop', key: 3, label: 'Nhảy hip hop', emoji: '🕺', dur: 0, seat: false }),
  Object.freeze({ id: 'headbang', key: 4, label: 'Lắc đầu quẩy', emoji: '🤘', dur: 0, seat: true }),
  Object.freeze({ id: 'bounce', key: 5, label: 'Nhún nhảy', emoji: '🎶', dur: 0, seat: true }),
  Object.freeze({ id: 'sit', key: 6, label: 'Ngồi xem', emoji: '🍿', dur: 0, seat: true }),
  Object.freeze({ id: 'heart', key: 7, label: 'Thả tim', emoji: '❤️', dur: 2200, seat: true }),
  Object.freeze({ id: 'laugh', key: 8, label: 'Cười lăn', emoji: '🤣', dur: 3600, seat: false }),
]);
export const ACTION_IDS = Object.freeze(ACTIONS.map((a) => a.id));
export function actionById(id) {
  return ACTIONS.find((a) => a.id === id) || null;
}

/** emoji thả nhanh (bay lên từ đầu nhân vật) */
export const REACTIONS = Object.freeze(['❤️', '😂', '👏', '🔥', '😮', '😢', '🎉', '👍']);

// ---------------------------------------------------------------- ngoại hình (chỉ nhận giá trị trong bảng)
export const SKINS = Object.freeze(['#ffe0c4', '#f9cfa5', '#f1c7a0', '#e0ac7e', '#c68a5e', '#9a6440', '#6e452b']);
export const HAIR_COLORS = Object.freeze(['#1f1a17', '#3a2a1e', '#5a3820', '#8a5a2b', '#c48a45', '#e8c27a', '#d9d6d0', '#9b2c3f', '#3b5bdb', '#b048c0']);
export const HAIR_STYLES = Object.freeze([
  Object.freeze({ id: 'short', label: 'Ngắn' }),
  Object.freeze({ id: 'spiky', label: 'Dựng' }),
  Object.freeze({ id: 'curly', label: 'Xoăn' }),
  Object.freeze({ id: 'bob', label: 'Bob' }),
  Object.freeze({ id: 'long', label: 'Dài' }),
  Object.freeze({ id: 'bun', label: 'Búi' }),
  Object.freeze({ id: 'ponytail', label: 'Đuôi ngựa' }),
  Object.freeze({ id: 'bald', label: 'Trọc' }),
]);
export const SHIRTS = Object.freeze(['#ef4444', '#f97316', '#f5b014', '#84cc16', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f8fafc', '#9ca3af', '#1f2937']);
export const PANTS = Object.freeze(['#1f2937', '#475569', '#1e3a8a', '#3f6212', '#78350f', '#e7e5e4', '#7f1d1d']);
export const ACCESSORIES = Object.freeze([
  Object.freeze({ id: 'none', label: 'Không' }),
  Object.freeze({ id: 'glasses', label: 'Kính' }),
  Object.freeze({ id: 'headphones', label: 'Tai nghe' }),
  Object.freeze({ id: 'cap', label: 'Mũ lưỡi trai' }),
  Object.freeze({ id: 'bow', label: 'Nơ' }),
  Object.freeze({ id: 'tie', label: 'Cà vạt' }),
]);

/** dáng người: nam (vai rộng, mày đậm, có thể để râu) / nữ (lông mi, má hồng, môi hồng) */
export const BODIES = Object.freeze([
  Object.freeze({ id: 'nam', label: 'Nam' }),
  Object.freeze({ id: 'nu', label: 'Nữ' }),
]);
export const FACIALS = Object.freeze([
  Object.freeze({ id: 'none', label: 'Không' }),
  Object.freeze({ id: 'ria', label: 'Ria mép' }),
  Object.freeze({ id: 'rau', label: 'Râu quai nón' }),
]);
const FEMININE_HAIR = ['bob', 'long', 'bun', 'ponytail'];

const pick = (list, v, fallback) => (typeof v === 'string' && list.includes(v.toLowerCase()) ? v.toLowerCase() : fallback);
const pickId = (list, v, fallback) => (typeof v === 'string' && list.some((o) => o.id === v) ? v : fallback);

/** ngoại hình hợp lệ từ dữ liệu bất kỳ (giá trị lạ → mặc định) */
export function normalizeLook(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const hairStyle = pickId(HAIR_STYLES, o.hairStyle, 'short');
  // ngoại hình cũ (chưa có dáng): đoán theo kiểu tóc
  const body = pickId(BODIES, o.body, FEMININE_HAIR.includes(hairStyle) ? 'nu' : 'nam');
  return {
    body,
    skin: pick(SKINS, o.skin, SKINS[2]),
    hair: pick(HAIR_COLORS, o.hair, HAIR_COLORS[1]),
    hairStyle,
    shirt: pick(SHIRTS, o.shirt, SHIRTS[7]),
    pants: pick(PANTS, o.pants, PANTS[0]),
    accessory: pickId(ACCESSORIES, o.accessory, 'none'),
    facial: body === 'nam' ? pickId(FACIALS, o.facial, 'none') : 'none', // râu chỉ cho dáng nam
  };
}

export function randomLook(rand = Math.random) {
  const r = (list) => list[Math.floor(rand() * list.length) % list.length];
  const body = rand() < 0.5 ? 'nam' : 'nu';
  const hairStyle = body === 'nam'
    ? r(['short', 'short', 'spiky', 'spiky', 'curly', 'bald', 'bun', 'long'])
    : r(['bob', 'long', 'long', 'bun', 'ponytail', 'ponytail', 'curly', 'short']);
  const acc = body === 'nam' ? ['glasses', 'headphones', 'cap', 'tie'] : ['glasses', 'headphones', 'cap', 'bow', 'bow'];
  return {
    body,
    skin: r(SKINS),
    hair: r(HAIR_COLORS.slice(0, 7).concat(HAIR_COLORS)), // màu tóc tự nhiên hay gặp hơn
    hairStyle,
    shirt: r(SHIRTS),
    pants: r(PANTS),
    accessory: rand() < 0.45 ? 'none' : r(acc),
    facial: body === 'nam' && rand() < 0.3 ? r(['ria', 'rau']) : 'none',
  };
}

// ---------------------------------------------------------------- giới hạn chung
export const LIMITS = Object.freeze({
  nameMin: 2,
  nameMax: 20,
  chatMax: 140,
  sendHz: 30, // client gửi vị trí tối đa 30 lần / giây khi đang đi (server gom 30 Hz) — người khác thấy gần như tức thì
});
