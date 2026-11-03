// Trạng thái phía client + xử lý thông điệp server (ServerMsg trong src/types.ts) + nội suy người khác chống giật.
import { actionById } from './shared/hall.js';
import { clamp, num, str, arr, warnOnce } from './util.js';

const listeners = new Map();

export const store = {
  ready: false, // đã nhận hello
  conn: 'connecting', // 'connecting' | 'open' | 'closed'
  joined: false,
  myId: 0,
  token: '',
  admin: false,
  cfg: { maxVideoMin: 15, maxPerUser: 2, capacity: 60, liveMaxMin: 30, allowLive: true, skipRatio: 0.5, noCookie: true, ytReady: true },
  rooms: [],
  roomId: '1',
  roomName: 'Phòng 1',
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
};

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

// ---------------------------------------------------------------- nội suy người khác (bộ đệm chống giật)
// Người đi gửi vị trí kèm `c` = giờ máy họ (performance.now(), ms). Server gom 15 Hz rồi phát lại nguyên `c`.
// Mỗi người có một trục thời gian riêng: off = (giờ máy mình lúc nhận − c) nhỏ nhất từng thấy (= đường truyền nhanh nhất).
// Vẽ người đó tại thời điểm c* = now − buffer − off rồi nội suy giữa 2 mốc kẹp c*. Vì dùng giờ máy người đi, độ so le
// của CẢ hai chặng mạng (người đi → server → mình, qua Cloudflare) đều bị bộ đệm hấp thụ. Bộ đệm tự nới khi gói tới
// muộn, tự siết dần khi mạng êm (bài học VibeCorp: store.js §bộ đệm, docs/02 §10).
const NET_MIN = 90, NET_MAX = 450, NET_START = 140, NET_SLACK = 22;
const KF_MAX = 14;
const TELEPORT = 3.0; // nhảy xa hơn mức này giữa 2 mốc = dịch chuyển tức thời

store.net = { buffer: NET_START, minSlack: Infinity, win: 0, late: 0, frames: 0 };

function adaptBuffer(slack) {
  const n = store.net;
  n.frames++;
  if (slack < NET_SLACK) {
    n.buffer = Math.min(NET_MAX, n.buffer + (NET_SLACK - slack));
    n.late++;
  }
  n.minSlack = Math.min(n.minSlack, slack);
  if (++n.win >= 90) {
    if (n.minSlack > NET_SLACK + 45) n.buffer = Math.max(NET_MIN, n.buffer - (n.minSlack - NET_SLACK - 25) / 2);
    n.minSlack = Infinity;
    n.win = 0;
  }
}

function pushSample(a, ct, x, y, d, m, now) {
  const transit = now - ct;
  if (a.off === null || (a.lastCt && ct < a.lastCt - 2000)) {
    // mẫu đầu (hoặc máy người kia vừa tải lại trang → đồng hồ về 0): neo lại trục thời gian
    a.off = transit;
    a.kf = [];
  } else if (transit < a.off) {
    a.off = transit;
  } else {
    a.off += (transit - a.off) * 0.002; // theo kịp lệch đồng hồ rất chậm
  }
  adaptBuffer(store.net.buffer - (transit - a.off));
  const kf = a.kf;
  let last = kf.length ? kf[kf.length - 1] : null;
  if (last && ct <= last.t) return;
  if (!last) {
    kf.push({ t: ct - 70, x: a.x, y: a.y, d: a.dir, m: 0, jump: false });
    last = kf[0];
  } else if (ct - last.t > 300) {
    // đứng yên một lúc rồi mới đi: chèn mốc "vẫn ở chỗ cũ" ngay trước mẫu mới để không trôi chậm từ mốc cũ
    kf.push({ t: ct - 70, x: last.x, y: last.y, d: last.d, m: 0, jump: false });
    last = kf[kf.length - 1];
  }
  const jump = Math.hypot(x - last.x, y - last.y) > TELEPORT;
  kf.push({ t: ct, x, y, d, m, jump });
  if (kf.length > KF_MAX) kf.splice(0, kf.length - KF_MAX);
  a.lastCt = ct;
}

/** vị trí + hướng nội suy của người khác tại `now` (trục performance.now()) */
export function actorPos(a, now) {
  const kf = a.kf;
  if (!kf.length || a.off === null) return { x: a.x, y: a.y, d: a.dir, seg: false };
  const rt = now - store.net.buffer - a.off;
  const last = kf[kf.length - 1];
  if (rt >= last.t || kf.length === 1) return { x: last.x, y: last.y, d: last.d, seg: false };
  if (rt <= kf[0].t) return { x: kf[0].x, y: kf[0].y, d: kf[0].d, seg: false };
  let i = kf.length - 2;
  while (i > 0 && kf[i].t > rt) i--;
  const p = kf[i], q = kf[i + 1];
  if (q.jump) return { x: p.x, y: p.y, d: p.d, seg: false };
  const k = q.t > p.t ? clamp((rt - p.t) / (q.t - p.t), 0, 1) : 1;
  return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, d: q.d, seg: q.m === 1 };
}

/** mốc giờ máy mình (performance.now) ứng với giờ máy người kia `c` khi vẽ (đã tính bộ đệm) */
function localTimeOf(a, c, now) {
  if (a.off === null || !Number.isFinite(c) || c <= 0) return now;
  const t = c + a.off + store.net.buffer;
  return clamp(t, now - 4000, now + 1500);
}

// ---------------------------------------------------------------- người trong phòng
const DIRS = ['down', 'up', 'left', 'right'];

function newActor(p, now, bornAt = now) {
  const a = {
    id: p.id, name: str(p.name, 40), look: p.look || null, ghost: !!p.ghost,
    x: num(p.x, 16), y: num(p.y, 12), dir: DIRS[num(p.d, 0)] || 'down',
    kf: [], off: null, lastCt: 0,
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
  store.roomId = str(snap.id, 8) || '1';
  store.roomName = str(snap.name, 40) || `Phòng ${store.roomId}`;
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

function onHello(msg) {
  const now = performance.now();
  store.ready = true;
  // ước lượng giờ server ngay từ hello (ping/pong sẽ chỉnh chính xác hơn)
  if (store.clock.samples === 0 && Number.isFinite(msg.s)) store.clock.offset = msg.s - now;
  store.admin = !!msg.admin;
  if (msg.cfg && typeof msg.cfg === 'object') store.cfg = { ...store.cfg, ...msg.cfg };
  store.rooms = arr(msg.rooms);
  if (!store.joined) setSnapshot(msg.snap, now);
  store.emit('hello', msg);
  store.emit('rooms', store.rooms);
  if (!store.joined) emitAll();
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
        if (a && !a.isMe && typeof msg.e === 'string') {
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
