// Trạng thái phía client + xử lý thông điệp server (ServerMsg trong src/types.ts) + nội suy người khác chống giật.
import { ANY_ROOM_ID_RE, DEFAULT_VENUE, SPEED, actionById, isPrivateRoomId, parseRoomId, roomName, venueById } from './shared/hall.js';
import { showEmojiFrom } from './prefs.js';
import { clamp, num, str, arr, lsGet, lsSet, warnOnce } from './util.js';

const listeners = new Map();

export const store = {
  ready: false, // đã nhận hello
  conn: 'connecting', // 'connecting' | 'open' | 'closed'
  joined: false,
  myId: 0,
  token: '',
  admin: false,
  cfg: {
    maxVideoMin: 30, maxPerUser: 2, capacity: 60, liveMaxMin: 30, allowLive: true, skipRatio: 0.5, noCookie: true, ytReady: true,
    privMax: 20, privMaxMin: 720, privPerUser: 10, privEmptyMin: 3,
  },
  rooms: [],
  roomId: DEFAULT_VENUE,
  roomName: roomName(DEFAULT_VENUE),
  venue: DEFAULT_VENUE, // chủ đề vẽ của phòng đang xem (render/venues) — phòng riêng: rạp chủ phòng chọn (snap.venue)
  /** PrivInfo của phòng riêng đang xem ({ name, cap, ownerId, members[], admins }) — null = phòng chung */
  priv: null,
  /** phòng riêng gần nhất đã ở trong (để bỏ vé vào lại khi bị đưa ra mà thông điệp không ghi phòng) */
  lastPrivRoom: '',
  /** số hello đã nhận trên socket hiện tại (net.js đặt về 0 khi mở socket mới) */
  helloSeq: 0,
  players: new Map(), // id -> actor
  queue: [],
  locked: false,
  now: null, // NowInfo
  votes: { n: 0, need: 1, mine: false },
  chat: [], // ChatInfo, cũ trước
  bubbles: [], // { key, pid, name, text, color, t0, dur }
  fx: [], // emoji bay: { e, pid, x, y (ô, lúc sinh), t0, dur, dx, size }
  /** giờ server ≈ performance.now() + clock.offset */
  clock: { offset: 0, rtt: Infinity, samples: 0 },

  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  emit(type, payload) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { warnOnce('listener lỗi', type, e); }
    }
  },
  serverNow() {
    return performance.now() + this.clock.offset;
  },
  me() {
    return this.joined ? this.players.get(this.myId) || null : null;
  },
  name(id) {
    return this.players.get(id)?.name || '';
  },
  /** số người đang có mặt (không tính người đang kết nối lại) */
  present() {
    let n = 0;
    for (const a of this.players.values()) if (!a.ghost && !a.goneAt) n++;
    return n;
  },
  /** đang ở trong (đã vào) một phòng riêng */
  inPrivate() {
    return this.joined && isPrivateRoomId(this.roomId);
  },
  /** mình là chủ phòng riêng đang ở (server báo id nhân vật của chủ phòng trong priv.ownerId) */
  isOwner() {
    return this.inPrivate() && !!this.priv && this.myId > 0 && this.priv.ownerId === this.myId;
  },
  /**
   * phòng riêng: số thành viên tính chỗ — quản trị viên rạp vào phòng (adm) không chiếm chỗ của ai, trừ khi chính họ là chủ
   * phòng (chủ rạp dùng phòng của mình — server đếm y như vậy: Room.isMember)
   */
  memberCount() {
    const p = this.priv;
    return p ? p.members.filter((m) => !m.adm || m.id === p.ownerId).length : 0;
  },
  /** phòng riêng: quản trị viên rạp đang xem phòng (đứng xem — priv.admins — hoặc có nhân vật trong phòng) */
  adminWatching() {
    return !!this.priv && (this.priv.admins > 0 || this.priv.members.some((m) => m.adm));
  },
};

// ---------------------------------------------------------------- vé vào lại phòng riêng (localStorage vc.rt)
// Nhập đúng mật khẩu (hoặc tạo phòng) → server cấp "vé" rt cho thiết bị này: mở lại link / rớt mạng vào lại không phải nhập
// lại mật khẩu. Giữ tối đa 10 phòng (bỏ phòng cũ nhất). Server chỉ lưu mã băm của vé; vé mất hiệu lực khi đổi mật khẩu.
const RT_KEY = 'vc.rt';
const RT_MAX = 10;
const RT_RE = /^[A-Za-z0-9_-]{16,64}$/;

function rtMap() {
  let o = null;
  try { o = JSON.parse(lsGet(RT_KEY, '{}')); } catch { o = null; }
  const out = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) if (isPrivateRoomId(k) && typeof v === 'string' && RT_RE.test(v)) out[k] = v;
  }
  return out;
}
function rtWrite(m) {
  const keys = Object.keys(m);
  if (!keys.length) { try { localStorage.removeItem(RT_KEY); } catch { /* bỏ qua */ } return; }
  lsSet(RT_KEY, JSON.stringify(m));
}
/** vé vào lại phòng `room` ('' = không có) */
export function rtFor(room) {
  return isPrivateRoomId(room) ? rtMap()[room] || '' : '';
}
export function saveRt(room, rt) {
  if (!isPrivateRoomId(room) || typeof rt !== 'string' || !RT_RE.test(rt)) return;
  const m = rtMap();
  delete m[room]; // ghi lại ở cuối = mới nhất
  m[room] = rt;
  const keys = Object.keys(m);
  for (let i = 0; i < keys.length - RT_MAX; i++) delete m[keys[i]];
  rtWrite(m);
}
export function dropRt(room) {
  const m = rtMap();
  if (!(room in m)) return;
  delete m[room];
  rtWrite(m);
}

/** PrivInfo từ server → bản đọc phòng thủ */
function normPriv(p) {
  if (!p || typeof p !== 'object') return null;
  const members = arr(p.members).filter((m) => m && Number.isInteger(m.id)).slice(0, 100)
    .map((m) => ({ id: m.id, name: str(m.name, 40), away: !!m.away, ghost: !!m.ghost, adm: !!m.adm }));
  return {
    name: str(p.name, 40), cap: Math.max(0, Math.round(num(p.cap, 0))), ownerId: Number.isInteger(p.ownerId) ? p.ownerId : 0, members,
    // số kết nối quản trị viên rạp đang đứng xem phòng (không có nhân vật) — hiện dấu 🛡 thường trực
    admins: Math.max(0, Math.round(num(p.admins, 0))),
  };
}

// ---------------------------------------------------------------- đồng bộ giờ server (ping/pong kiểu NTP)
export function onPong(msg, sentAt) {
  const now = performance.now();
  const c = num(msg.c, NaN), s = num(msg.s, NaN);
  if (!Number.isFinite(c) || !Number.isFinite(s)) return;
  const rtt = now - (Number.isFinite(sentAt) ? sentAt : c);
  if (!(rtt >= 0) || rtt > 10_000) return;
  const offset = s - (c + rtt / 2);
  const k = store.clock;
  // giữ mẫu RTT thấp nhất (chính xác nhất); mẫu tệ hơn nhiều thì chỉ nhích nhẹ (theo kịp lệch đồng hồ)
  if (rtt <= k.rtt * 1.2 || k.samples < 3) {
    k.offset = k.samples === 0 ? offset : k.offset + (offset - k.offset) * (rtt <= k.rtt ? 0.8 : 0.3);
    k.rtt = Math.min(k.rtt, rtt);
  } else {
    k.offset += (offset - k.offset) * 0.02;
    k.rtt = k.rtt * 1.02; // nới dần để mạng đổi (wifi → 4G) vẫn cập nhật được
  }
  k.samples++;
}

// ---------------------------------------------------------------- người khác: PHÁT LẠI ĐỀU theo đồng hồ người gửi
// Mỗi gói vị trí mang c = giờ máy người gửi lúc đó. Máy mình xếp gói theo c rồi PHÁT LẠI đúng đường, đúng tốc độ người kia
// đã đi (cần analog điện thoại đẩy nhẹ → đi chậm cũng đúng chậm), trễ sau họ một khoảng ĐỆM:
//   - gói tới dồn cục / lệch nhịp → không ảnh hưởng (vị trí đặt theo giờ người gửi, không theo lúc gói tới);
//   - mạng khựng ngắn hơn đệm → không ai thấy; dài hơn → hình đứng chờ ở điểm cuối đã biết rồi đi tiếp ĐÚNG tốc độ —
//     không bao giờ nhảy, không chạy nhanh đuổi theo (bản cũ "đi theo vệt" tăng tốc tới 2,2× / chậm 0,55× → lúc nhanh lúc
//     chậm; bản cũ hơn "bộ đệm thời gian cố định" thì đứng rồi nhảy);
//   - đệm tự chỉnh từng người = khoảng trống dài nhất gần đây giữa 2 lần nhận gói lúc người kia đang đi + 40 ms (mạng êm
//     ~110–150 ms; từng khựng thì dài ra tới 1,6 s, êm lâu thì co lại dần). Đổi đệm chỉ lúc nhân vật đứng yên (dời mốc giờ
//     lúc đứng yên không ai thấy) hoặc đi nhanh / chậm tối đa 4 % (mắt không phân biệt được).
// Đo 2026-11-03 từ VN: qua Cloudflare (PoP Tokyo) RTT ~440 ms + khựng tới 0,4–1,4 s; đi thẳng VPS RTT 8 ms, không khựng.
const BUF_MIN = 110, BUF_MAX = 1600, BUF_START = 180, BUF_MARGIN = 40; // ms
const GAP_DECAY = 0.04; // 1/s — đệm co dần khi mạng êm (~17 s co một nửa)
const GAP_IGNORE = 4000; // ms — trống lâu hơn = người kia ẩn tab / rớt mạng hẳn, không phải mạng khựng
const RATE_MAX = 0.04, RATE_T = 2500; // ±4 % tốc độ, đạt mức tối đa khi đệm lệch 100 ms
const SNAP = 5; // ô — xa hơn mức đi bộ được → dịch chuyển tức thời (vào rạp, server kéo về…)
const Q_MAX = 240; // gói giữ tối đa / người (~8 s)

store.net = { buffer: BUF_START, dry: 0, frames: 0, catchup: 0, holdMs: 0 };

/** mỗi khung: số liệu tổng (đệm trung bình) cho QA / gỡ lỗi */
export function tickNet() {
  let sum = 0, n = 0;
  for (const a of store.players.values()) {
    if (a.isMe || a.pc === null) continue;
    sum += a.buf; n++;
  }
  store.net.buffer = n ? sum / n : BUF_START;
}

const same = (p, r) => Math.abs(p.x - r.x) < 1e-4 && Math.abs(p.y - r.y) < 1e-4;

/** chỉ số gói cuối cùng có c ≤ t (0 nếu t trước gói đầu) */
function segAt(q, t) {
  let i = 0;
  while (i + 1 < q.length && q[i + 1].c <= t) i++;
  return i;
}

function pushSample(a, c, x, y, d, m, now) {
  if (a.lastCt && c <= a.lastCt) return; // gói cũ / trùng (tới lệch thứ tự)
  const q = a.q;
  const last = q.length ? q[q.length - 1] : null;
  // khoảng trống giữa 2 lần nhận gói trong lúc người kia đang đi = mạng vừa khựng chừng đó → đệm phải dài hơn
  if (last && last.m && a.lastArr) {
    const gap = now - a.lastArr;
    if (gap < GAP_IGNORE && gap > a.gap) a.gap = gap;
  }
  a.lastArr = now;
  a.lastCt = c;
  store.net.frames++;
  const px = last ? last.x : a.rx, py = last ? last.y : a.ry;
  const dist = Math.hypot(x - px, y - py);
  const dc = last ? c - last.c : Infinity;
  if (dist > SNAP && dist > (SPEED * 1.4 * Math.min(dc, 60_000)) / 1000 + 0.5) {
    // dịch chuyển (vào rạp, server kéo về…): hiện ngay chỗ mới
    a.q = [{ c, x, y, d, m }];
    a.pc = c; a.rx = x; a.ry = y; a.rdir = d;
    return;
  }
  if (!last || !last.m || dc >= GAP_IGNORE) {
    // người kia đứng yên ở chỗ cũ tới ngay trước gói này (vừa bắt đầu đi) — không kéo dài bước đầu ra cả quãng đứng
    const lead = Math.max(16, (dist / SPEED) * 1000);
    const cs = last ? Math.max(last.c + 1, c - lead) : c - lead;
    if (cs < c) q.push({ c: cs, x: px, y: py, d: last ? last.d : a.rdir, m: 0 });
  }
  q.push({ c, x, y, d, m });
  if (a.pc === null) a.pc = c - a.buf; // gói đầu tiên: bắt đầu phát sau một khoảng đệm
  if (q.length > Q_MAX) {
    const drop = q.length - Q_MAX;
    q.splice(0, drop);
    if (a.pc < q[0].c) a.pc = q[0].c;
  }
}

/** vị trí + hướng của người khác để vẽ tại `now` — gọi mỗi khung một lần mỗi người */
export function actorPos(a, now) {
  const dt = a.posAt ? Math.min(250, Math.max(0, now - a.posAt)) : 0;
  a.posAt = now;
  const q = a.q;
  if (!q.length || a.pc === null) return { x: a.rx, y: a.ry, d: a.rdir, seg: false };
  // đệm mong muốn: khoảng trống dài nhất gần đây (co dần) + chút dư
  a.gap *= Math.exp((-GAP_DECAY * dt) / 1000);
  a.buf = clamp(a.gap + BUF_MARGIN, BUF_MIN, BUF_MAX);
  const newest = q[q.length - 1];
  const i = segAt(q, a.pc);
  if (i > 0) q.splice(0, i); // bỏ gói đã phát qua (q[0] = đầu đoạn đang phát)
  // đoạn có dời chỗ đầu tiên từ chỗ đang phát trở đi (j = chỉ số đầu đoạn đó, -1 nếu không còn)
  let j = 0;
  while (j + 1 < q.length && same(q[j], q[j + 1])) j++;
  if (j + 1 >= q.length) j = -1;
  if (j === 0 && a.pc >= q[0].c) {
    // ĐANG ĐI: tiến đều theo giờ thật; lệch đệm thì nhanh / chậm tối đa 4 %
    const ahead = newest.c - a.pc;
    a.aheadF = a.aheadF === null ? ahead : a.aheadF + (ahead - a.aheadF) * Math.min(1, dt / 400);
    let rate = 1 + clamp((a.aheadF - a.buf) / RATE_T, -RATE_MAX, RATE_MAX);
    if (a.aheadF > a.buf + 1500) rate = 1.2; // tụt quá xa (hiếm): đuổi rõ hơn chút
    if (rate > 1.02) store.net.catchup++;
    a.pc += dt * rate;
    if (a.pc >= newest.c && newest.m) {
      // hết gói mà người kia vẫn đang đi = mạng đang khựng lâu hơn đệm → đứng chờ ở điểm cuối (không đoán, không nhảy)
      if (!a.dryNow) { a.dryNow = true; store.net.dry++; }
      store.net.holdMs += Math.max(0, a.pc - newest.c);
      a.pc = newest.c;
    } else a.dryNow = false;
  } else if (j > 0 || (j === 0 && a.pc < q[0].c)) {
    // ĐỨNG YÊN, sắp đi tiếp: dời mốc phát về đúng "gói mới nhất − đệm" (hình đứng yên nên không ai thấy)
    const end = q[j].c;
    a.pc = Math.min(Math.max(a.pc, newest.c - a.buf), end);
    a.aheadF = null;
    a.dryNow = false;
  } else if (!newest.m) {
    // người kia đã dừng hẳn: đứng yên, đồng hồ phát vẫn chạy theo giờ thật (động tác hiện đúng lúc)
    a.pc += dt;
    a.aheadF = null;
    a.dryNow = false;
  } else {
    // đứng một chỗ nhưng tin mới nhất bảo "đang đi" (xoay mặt tại chỗ / đang chờ gói): đi tới gói cuối rồi chờ
    a.pc = Math.min(a.pc + dt, newest.c);
  }
  // nội suy vị trí tại pc
  const k = segAt(q, a.pc);
  const p0 = q[k], p1 = q[k + 1];
  let seg = false;
  if (!p1 || a.pc <= p0.c) {
    a.rx = p0.x; a.ry = p0.y; a.rdir = p0.d;
  } else {
    const f = clamp((a.pc - p0.c) / Math.max(1, p1.c - p0.c), 0, 1);
    a.rx = p0.x + (p1.x - p0.x) * f;
    a.ry = p0.y + (p1.y - p0.y) * f;
    seg = !same(p0, p1);
    a.rdir = seg ? p1.d : p0.d;
  }
  return { x: a.rx, y: a.ry, d: a.rdir, seg };
}

/** mốc giờ máy mình (performance.now) ứng với giờ máy người kia `c` khi vẽ — cùng nhịp với phát lại vị trí */
function localTimeOf(a, c, now) {
  if (a.pc === null || !Number.isFinite(c) || c <= 0) return now;
  return clamp(now + (c - a.pc), now - 4000, now + BUF_MAX + 400);
}

// ---------------------------------------------------------------- người trong phòng
const DIRS = ['down', 'up', 'left', 'right'];

function newActor(p, now, bornAt = now) {
  const a = {
    id: p.id, name: str(p.name, 40), look: p.look || null, ghost: !!p.ghost,
    x: num(p.x, 16), y: num(p.y, 12), dir: DIRS[num(p.d, 0)] || 'down',
    // phát lại (actorPos): vị trí / hướng đang vẽ, hàng gói theo giờ người gửi, mốc đang phát (giờ người gửi), đệm (ms),
    // khoảng trống dài nhất gần đây, lúc nhận gói trước, phần đã nhận mà chưa phát (lọc mượt), đang đứng chờ gói
    rx: num(p.x, 16), ry: num(p.y, 12), rdir: DIRS[num(p.d, 0)] || 'down',
    q: [], pc: null, buf: store.net.buffer || BUF_START, gap: 0, lastArr: 0, lastCt: 0, aheadF: null, dryNow: false, posAt: 0,
    moving: false, moveAmt: 0, phase: 0, seed: (Math.random() * 1000) | 0,
    act: null, bornAt, goneAt: 0, isMe: false,
    emoAt: 0, emo: '', fxAt: 0,
  };
  setAction(a, p.a, now - num(p.ae, 0));
  return a;
}

/** gán động tác (start = mốc performance.now lúc động tác bắt đầu trên màn hình) */
export function setAction(a, id, start) {
  const def = typeof id === 'string' ? actionById(id) : null;
  if (!def) { a.act = null; return; }
  a.act = { id: def.id, def, start, fxAt: 0, fxStarted: false };
}

function updateFrom(a, p) {
  a.name = str(p.name, 40) || a.name;
  if (p.look) a.look = p.look;
  a.ghost = !!p.ghost;
}

function setPlayers(list, now) {
  const next = new Map();
  for (const p of arr(list)) {
    if (!p || !Number.isInteger(p.id)) continue;
    const a = newActor(p, now, now - 1000); // có sẵn từ trước: không hiện dần (động tác vẫn tính theo giờ thật)
    if (p.id === store.myId) a.isMe = true;
    next.set(p.id, a);
  }
  store.players = next;
}

function setSnapshot(snap, now) {
  if (!snap || typeof snap !== 'object') return;
  const id = str(snap.id, 16);
  store.roomId = ANY_ROOM_ID_RE.test(id) ? id : DEFAULT_VENUE;
  const priv = isPrivateRoomId(store.roomId);
  store.priv = priv ? normPriv(snap.priv) : null;
  if (priv) store.lastPrivRoom = store.roomId;
  store.roomName = str(snap.name, 40) || store.priv?.name || roomName(store.roomId);
  // rạp (khung cảnh): phòng riêng do chủ phòng chọn → chỉ biết qua snap.venue (id phòng riêng không chứa tên rạp)
  const venue = venueById(str(snap.venue, 16))?.id || parseRoomId(store.roomId)?.venue.id || DEFAULT_VENUE;
  if (venue !== store.venue) { store.venue = venue; store.emit('venue', venue); }
  setPlayers(snap.players, now);
  store.queue = arr(snap.queue).filter((q) => q && typeof q.v === 'string');
  store.locked = !!snap.locked;
  store.now = snap.now && typeof snap.now === 'object' ? snap.now : null;
  store.votes = { n: num(snap.votes?.n, 0), need: num(snap.votes?.need, 1), mine: false };
  store.chat = arr(snap.chat).filter((m) => m && typeof m.text === 'string').slice(-60);
  store.bubbles = [];
  store.fx = [];
}

export function bubbleDuration(text) {
  return clamp(2200 + 60 * String(text || '').length, 2800, 8000);
}

// ---------------------------------------------------------------- thông điệp
function onFrame(msg) {
  const now = performance.now();
  for (const e of arr(msg.p)) {
    if (!Array.isArray(e) || e.length < 6) continue;
    const [id, x, y, d, c, m] = e;
    if (!Number.isInteger(id) || id === store.myId || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(c)) continue;
    const a = store.players.get(id);
    if (!a || a.goneAt) continue;
    pushSample(a, c, x, y, DIRS[d] || 'down', m ? 1 : 0, now);
  }
}

function onChat(m) {
  if (!m || typeof m.text !== 'string') return;
  const now = performance.now();
  store.chat.push(m);
  if (store.chat.length > 80) store.chat.splice(0, store.chat.length - 80);
  const a = store.players.get(m.pid);
  const dur = bubbleDuration(m.text);
  store.bubbles = store.bubbles.filter((b) => b.pid !== m.pid && now - b.t0 < b.dur + 300);
  store.bubbles.push({ key: `c${m.mid}`, pid: m.pid, name: str(m.name || a?.name, 40), text: str(m.text, 300), t0: now, dur });
  if (store.bubbles.length > 12) store.bubbles.shift();
  store.emit('chat', m);
}

/** emoji bay lên từ đầu một người */
export function spawnFx(pid, e, now = performance.now(), opts = {}) {
  if (store.fx.length > 140) store.fx.splice(0, store.fx.length - 140);
  store.fx.push({
    pid, e, t0: now + (opts.delay || 0), dur: opts.dur || 2200 + Math.random() * 600,
    dx: (Math.random() * 2 - 1) * (opts.spread ?? 0.7), size: opts.size || 1, x: null, y: null,
  });
}

let lastHelloSnap = null; // ảnh chụp phòng đang đứng xem trong hello gần nhất

function onHello(msg) {
  const now = performance.now();
  // hello thứ hai trên CÙNG một socket trong lúc đang ở trong rạp = server đã tách nhân vật khỏi phòng (bị đưa ra khỏi
  // phòng riêng mà không phòng chung nào nhận được) → kết nối chỉ còn đứng xem. (Rớt mạng nối lại là socket MỚI.)
  const detached = store.joined && store.helloSeq > 0;
  store.helloSeq++;
  if (detached) store.joined = false;
  store.ready = true;
  // ước lượng giờ server ngay từ hello (ping/pong sẽ chỉnh chính xác hơn)
  if (store.clock.samples === 0 && Number.isFinite(msg.s)) store.clock.offset = msg.s - now;
  store.admin = !!msg.admin;
  if (msg.cfg && typeof msg.cfg === 'object') store.cfg = { ...store.cfg, ...msg.cfg };
  store.rooms = arr(msg.rooms);
  lastHelloSnap = msg.snap && typeof msg.snap === 'object' ? msg.snap : null;
  if (!store.joined) setSnapshot(msg.snap, now);
  // báo TRƯỚC 'hello' để main.js thôi ý định vào lại (không tự gửi join vào phòng vừa bị đưa ra)
  if (detached) store.emit('detached');
  store.emit('hello', msg);
  store.emit('rooms', store.rooms);
  if (!store.joined) emitAll();
}

/**
 * thôi ở trong rạp mà socket vẫn sống (vào lại sau rớt mạng bị từ chối): hiện lại phòng kết nối đang đứng xem — ảnh chụp
 * trong hello gần nhất (server gửi kèm mọi thay đổi của phòng đó từ lúc ấy) — thay cho phòng cũ đang đứng hình
 */
export function backToSpectate() {
  store.joined = false;
  if (!lastHelloSnap) return;
  setSnapshot(lastHelloSnap, performance.now());
  emitAll();
}

function onWelcome(msg) {
  const now = performance.now();
  store.joined = true;
  store.myId = num(msg.you, 0);
  store.token = str(msg.token, 64);
  setSnapshot(msg.snap, now);
  const me = store.players.get(store.myId);
  if (me) me.isMe = true;
  store.emit('welcome', msg);
  emitAll();
}

function emitAll() {
  store.emit('priv', store.priv);
  store.emit('players', store.players);
  store.emit('queue', store.queue);
  store.emit('now', store.now);
  store.emit('votes', store.votes);
  store.emit('chatReset', store.chat);
}

/** điểm vào duy nhất cho mọi ServerMsg */
export function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  const now = performance.now();
  try {
    switch (msg.t) {
      case 'hello': onHello(msg); break;
      case 'welcome': onWelcome(msg); break;
      case 'join_err': store.emit('joinError', { code: str(msg.code, 20), text: str(msg.text, 300) }); break;
      case 'f': if (store.ready) onFrame(msg); break;
      case 'pj': {
        const p = msg.p;
        if (!p || !Number.isInteger(p.id) || p.id === store.myId) break;
        const a = newActor(p, now);
        store.players.set(p.id, a);
        store.emit('players', store.players);
        break;
      }
      case 'pl': {
        const a = store.players.get(msg.id);
        if (a && !a.isMe) { a.goneAt = now; store.emit('players', store.players); }
        break;
      }
      case 'pu': {
        const p = msg.p;
        const a = p && store.players.get(p.id);
        if (a) { updateFrom(a, p); store.emit('players', store.players); }
        break;
      }
      case 'act': {
        const a = store.players.get(msg.id);
        if (!a || a.isMe) break;
        if (!msg.a) a.act = null;
        else setAction(a, msg.a, localTimeOf(a, num(msg.c, 0), now));
        break;
      }
      case 'chat': onChat(msg.m); break;
      case 'chat_clear': store.chat = []; store.bubbles = []; store.emit('chatReset', store.chat); break;
      case 'emo': {
        const a = store.players.get(msg.id);
        if (a && !a.isMe && typeof msg.e === 'string' && showEmojiFrom(a.name, false)) {
          spawnFx(a.id, msg.e, now, { spread: 0.5, size: 1.15 });
          a.emo = msg.e; a.emoAt = now;
        }
        break;
      }
      case 'queue':
        store.queue = arr(msg.q).filter((q) => q && typeof q.v === 'string');
        store.locked = !!msg.locked;
        store.emit('queue', store.queue);
        break;
      case 'now': {
        const prevV = store.now?.qid;
        store.now = msg.n && typeof msg.n === 'object' ? msg.n : null;
        if (store.now?.qid !== prevV) store.votes = { ...store.votes, mine: false };
        store.emit('now', store.now);
        break;
      }
      case 'votes': store.votes = { n: num(msg.n, 0), need: num(msg.need, 1), mine: !!msg.mine }; store.emit('votes', store.votes); break;
      case 'q_res': store.emit('queueResult', { ok: !!msg.ok, text: str(msg.text, 300) }); break;
      case 'corr': store.emit('correct', { x: num(msg.x, NaN), y: num(msg.y, NaN) }); break;
      case 'notice': store.emit('notice', { text: str(msg.text, 300), kind: str(msg.kind, 8) || 'info' }); break;
      case 'rooms': store.rooms = arr(msg.rooms); store.emit('rooms', store.rooms); break;
      case 'kicked': store.emit('kicked', { text: str(msg.text, 200) }); break;
      // ---- phòng riêng
      case 'priv':
        // thành viên vào / ra / ẩn, chủ phòng có mặt, số người tối đa đổi — chỉ áp cho phòng riêng đang ở
        if (!isPrivateRoomId(store.roomId) || !msg.priv) break;
        store.priv = normPriv(msg.priv);
        if (store.priv?.name) store.roomName = store.priv.name;
        store.emit('priv', store.priv);
        break;
      case 'proom_need': {
        const room = str(msg.room, 16);
        if (!isPrivateRoomId(room)) break;
        if (msg.exists === false) dropRt(room); // phòng đã đóng: vé vô dụng
        store.emit('proomNeed', { room, exists: msg.exists !== false });
        break;
      }
      case 'proom_ok': {
        const room = str(msg.room, 16);
        if (!isPrivateRoomId(room)) break;
        saveRt(room, str(msg.rt, 80));
        store.emit('proomOk', { room, venue: venueById(str(msg.venue, 16))?.id || '', name: str(msg.name, 40), created: !!msg.created });
        break;
      }
      case 'proom_res': {
        const room = str(msg.room, 16);
        store.emit('proomRes', { ok: !!msg.ok, text: str(msg.text, 300), code: str(msg.code, 20), room: isPrivateRoomId(room) ? room : '' });
        break;
      }
      case 'proom_rt': {
        // mật khẩu vừa đổi: vé mới cho người đang ở trong phòng (vé cũ hết hiệu lực)
        const room = str(msg.room, 16);
        if (isPrivateRoomId(room)) saveRt(room, str(msg.rt, 80));
        break;
      }
      case 'adm': if (store.admin) store.emit('admin', msg); break;
      default: break;
    }
  } catch (e) {
    warnOnce('lỗi xử lý thông điệp', msg.t, e);
  }
}

export function setConn(state) {
  if (store.conn === state) return;
  store.conn = state;
  store.emit('conn', state);
}
