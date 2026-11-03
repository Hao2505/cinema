// Lõi rạp: nhiều phòng (đầy thì tự mở phòng kế), người xem điều khiển nhân vật, kiểm tra di chuyển (client tự đi trước,
// server sửa khi lệch), frame 15 Hz chỉ gồm người vừa đổi, động tác là SỰ KIỆN, chat / emoji, hàng chờ YouTube +
// "đồng hồ phòng" (videoId, lúc bắt đầu, dừng/chạy), bỏ phiếu bỏ qua, báo cáo, quyền admin, lưu trạng thái ra đĩa.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LIMITS, PROTOCOL, REACTIONS, SPEED, actionById, clampToWalkable, isWalkable, moveWithCollision,
  normalizeLook, spawnPoint,
  DEFAULT_VENUE, VENUES, parseRoomId, roomName,
} from '../public/js/shared/hall.js';
import type { ActionId, Look } from '../public/js/shared/hall.js';
import type { Config } from './config.js';
import {
  BanList, Bucket, WindowCounter, checkChat, checkName, cleanText, nameKey, readJson, writeJsonAtomic,
} from './moderation.js';
import { VideoCache, checkMeta, fmtDuration, parseVideoId } from './youtube.js';
import type { FetchResult, YouTubeClient } from './youtube.js';
import type {
  AdminOp, ChatInfo, ClientMsg, FrameEntry, NowInfo, PlayerInfo, PublicSettings, QueueItemInfo, RoomInfo, RoomSnapshot,
  ServerMsg,
} from './types.js';

// ---------------------------------------------------------------- hằng số
const GHOST_MS = 15_000; // mất kết nối: giữ nhân vật chờ quay lại
const PRELOAD_MS = 2000; // bài mới: cho mọi máy 2 s tải trình phát rồi mới tính giây 0
const END_GRACE_MS = 1500;
const CHAT_KEEP = 50;
const CHAT_SEND = 30;
const KICK_BLOCK_MS = 2 * 60_000;
const ROOM_IDLE_CLOSE_MS = 10 * 60_000;
/** video mặc định lỗi trình phát → tạm tắt; admin bỏ qua → phòng đó tạm không phát lại */
const DEFAULT_OFF_MS = 30 * 60_000;
const FILLER_SKIP_MS = 10 * 60_000;
/** kiểm lại video mặc định (còn cho nhúng? đổi tên?) mỗi 6 giờ */
const DEFAULT_REFRESH_MS = 6 * 3600_000;
const SAVE_EVERY_MS = 30_000;
const MAX_CONNS = 1500;
const BUDGET_CAP = SPEED * 2.0; // ô: được "dồn" tối đa 2 s đi bộ (4G / Cloudflare có lúc khựng >1 s rồi ùa tới cả loạt)
const BUDGET_RATE = SPEED * 1.3; // ô / giây: chấp nhận nhanh hơn 30 % (lệch đồng hồ, khung hình)
const EMBED_FAIL_MS = 24 * 3600_000;
const YT_ERR_SKIP = new Set([2, 100, 101, 150]);

export interface Sock {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  readonly bufferedAmount: number;
}

export interface Conn {
  cid: number;
  sock: Sock;
  ipHash: string;
  admin: boolean;
  room: Room | null;
  player: Player | null;
  bucket: Bucket;
  strikes: number;
  closed: boolean;
}

export interface Player {
  id: number;
  name: string;
  key: string; // nameKey
  look: Look;
  x: number;
  y: number;
  d: number;
  m: 0 | 1;
  ct: number;
  lastMoveAt: number;
  budget: number;
  dirty: boolean;
  action: { a: ActionId; ct: number; at: number } | null;
  conn: Conn | null;
  ghostSince: number;
  token: string;
  ck: string;
  ipHash: string;
  joinedAt: number;
  lastCorrAt: number;
  chatBucket: Bucket;
  emoBucket: Bucket;
  actBucket: Bucket;
  lookBucket: Bucket;
  addBucket: Bucket;
  moveBucket: Bucket;
  lastChat: { text: string; at: number };
  chatStrikes: number[];
  reportBucket: Bucket;
}

interface QueueItem {
  qid: number;
  v: string;
  title: string;
  ch: string;
  dur: number;
  live: boolean;
  by: string;
  byId: number;
  byCk: string;
  addedAt: number;
}

interface NowPlaying extends QueueItem {
  at: number;
  paused: boolean;
  pos: number;
  ends: number;
  /** video mặc định (kênh trực tiếp) — không phải ai thêm, nhường ngay khi hàng chờ có video */
  filler?: boolean;
}

interface BlockedVideo { v: string; title: string; at: number; reason: string }
interface ReportEntry { at: number; room: string; kind: 'video' | 'user'; what: string; reason: string; note: string; by: string }

const REPORT_REASONS: Record<string, string> = {
  copyright: 'Vi phạm bản quyền',
  inappropriate: 'Nội dung không phù hợp',
  spam: 'Spam / quảng cáo',
  harass: 'Quấy rối / chửi bới',
  other: 'Khác',
};

const r2 = (v: number): number => Math.round(v * 100) / 100;
/** vị trí trong khung 'f': 3 chữ số lẻ — 2 chữ số làm tốc độ người khác thấy rung tới ±9 % mỗi bước 33 ms */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const isOpen = (s: Sock): boolean => s.readyState === 1;

export interface HubDeps {
  youtube: YouTubeClient;
  /** null = không ghi đĩa (test) */
  dataDir: string | null;
  log?: (...a: unknown[]) => void;
}

// ================================================================= Room
export class Room {
  readonly players = new Map<number, Player>();
  readonly spectators = new Set<Conn>();
  queue: QueueItem[] = [];
  locked = false;
  now: NowPlaying | null = null;
  votes = new Set<number>();
  reports = new Set<string>(); // người đã báo cáo video đang chiếu
  errReports = new Set<string>(); // máy báo trình phát lỗi với video đang chiếu
  chat: ChatInfo[] = [];
  emptySince: number;

  /** rạp (chủ đề vẽ) + số thứ tự bản sao (1 = bản chính, không bao giờ đóng) */
  readonly venue: string;
  readonly n: number;

  /** từ lúc phòng hết video + hàng chờ trống (0 = đang có video) — quá DEFAULT_IDLE_SECONDS thì phát video mặc định */
  idleSince = 0;
  /** admin bỏ qua video mặc định → tạm không phát lại ở phòng này */
  fillerOffUntil = 0;

  constructor(readonly hub: Hub, readonly id: string) {
    const r = parseRoomId(id);
    if (!r) throw new Error(`id phòng sai: ${id}`);
    this.venue = r.venue.id;
    this.n = r.n;
    this.emptySince = Date.now();
  }

  get name(): string { return roomName(this.id); }

  /** người đang ở trong phòng (tính cả người đang kết nối lại) */
  count(): number { return this.players.size; }
  present(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conn) n++;
    return n;
  }
  /** số mạng (IP băm) khác nhau đang có mặt */
  presentIps(): number {
    const s = new Set<string>();
    for (const p of this.players.values()) if (p.conn) s.add(p.ipHash);
    return s.size;
  }

  info(): RoomInfo {
    return { id: this.id, name: this.name, venue: this.venue, now: this.now?.title ?? '', count: this.count(), cap: this.hub.cfg.roomCapacity };
  }

  // ---------------------------------------------------------- gửi
  broadcast(msg: ServerMsg, except?: Conn): void {
    let data: string;
    try { data = JSON.stringify(msg); } catch { return; }
    for (const p of this.players.values()) if (p.conn && p.conn !== except) this.hub.sendRaw(p.conn, data);
    for (const c of this.spectators) if (c !== except && !c.player) this.hub.sendRaw(c, data);
  }

  playerInfo(p: Player, now: number): PlayerInfo {
    let a: ActionId | '' = '';
    let ae = 0;
    if (p.action) {
      const def = actionById(p.action.a);
      ae = Math.max(0, now - p.action.at);
      if (def && (def.dur === 0 || ae < def.dur)) a = p.action.a;
      else p.action = null;
    }
    return { id: p.id, name: p.name, look: p.look, x: r2(p.x), y: r2(p.y), d: p.d, a, ae: a ? ae : 0, ghost: !p.conn };
  }

  itemInfo(q: QueueItem): QueueItemInfo {
    return { qid: q.qid, v: q.v, title: q.title, ch: q.ch, dur: q.dur, live: q.live, by: q.by, byId: q.byId };
  }

  nowInfo(): NowInfo | null {
    const n = this.now;
    if (!n) return null;
    return { ...this.itemInfo(n), at: n.at, paused: n.paused, pos: n.pos, ends: n.ends, ...(n.filler ? { filler: true } : {}) };
  }

  snapshot(now: number): RoomSnapshot {
    return {
      id: this.id,
      name: this.name,
      venue: this.venue,
      players: [...this.players.values()].map((p) => this.playerInfo(p, now)),
      queue: this.queue.map((q) => this.itemInfo(q)),
      locked: this.locked,
      now: this.nowInfo(),
      votes: { n: this.votes.size, need: this.votesNeeded() },
      chat: this.chat.slice(-CHAT_SEND),
    };
  }

  sendQueue(): void {
    this.broadcast({ t: 'queue', q: this.queue.map((q) => this.itemInfo(q)), locked: this.locked });
  }

  sendNow(): void {
    this.broadcast({ t: 'now', n: this.nowInfo(), s: Date.now() });
  }

  sendVotes(): void {
    const need = this.votesNeeded();
    const n = this.votes.size;
    for (const p of this.players.values()) if (p.conn) this.hub.send(p.conn, { t: 'votes', n, need, mine: this.votes.has(p.id) });
    for (const c of this.spectators) if (!c.player) this.hub.send(c, { t: 'votes', n, need, mine: false });
  }

  // ---------------------------------------------------------- người
  addPlayer(p: Player, now: number): void {
    this.players.set(p.id, p);
    this.broadcast({ t: 'pj', p: this.playerInfo(p, now) }, p.conn ?? undefined);
    this.hub.roomsChanged();
    this.sendVotesIfNeedChanged();
  }

  removePlayer(p: Player): void {
    if (!this.players.delete(p.id)) return;
    this.broadcast({ t: 'pl', id: p.id });
    if (this.votes.delete(p.id)) this.votesChanged();
    else this.sendVotesIfNeedChanged();
    if (this.players.size === 0) this.emptySince = Date.now();
    this.hub.roomsChanged();
  }

  private lastNeed = -1;
  private sendVotesIfNeedChanged(): void {
    if (this.now && this.votesNeeded() !== this.lastNeed) this.votesChanged();
  }

  // ---------------------------------------------------------- bỏ phiếu bỏ qua
  votesNeeded(): number {
    const present = Math.max(1, this.present());
    if (present <= 1) return 1;
    const c = this.hub.cfg;
    return Math.min(present, Math.max(c.skipVoteMin, Math.ceil(present * c.skipVoteRatio)));
  }

  votesChanged(): void {
    this.lastNeed = this.votesNeeded();
    if (this.now && this.votes.size >= this.lastNeed) {
      this.broadcast({ t: 'notice', kind: 'info', text: `Đủ ${this.votes.size} phiếu — bỏ qua "${this.now.title}".` });
      this.next(Date.now());
      return;
    }
    this.sendVotes();
  }

  // ---------------------------------------------------------- video
  /** chiếu bài kế (hoặc dừng nếu hết hàng chờ) */
  next(now: number): void {
    const item = this.queue.shift() ?? null;
    this.votes.clear();
    this.reports.clear();
    this.errReports.clear();
    if (!item) {
      this.now = null;
    } else {
      const at = now + PRELOAD_MS;
      const durMs = item.live ? this.hub.cfg.liveMaxMinutes * 60_000 : item.dur * 1000;
      this.now = { ...item, at, paused: false, pos: 0, ends: at + durMs + END_GRACE_MS };
    }
    this.sendNow();
    this.sendQueue();
    this.votesChanged();
    this.hub.dirty = true;
    this.hub.roomsChanged(); // bảng chọn rạp hiện "đang chiếu gì"
  }

  /** phát video mặc định (kênh trực tiếp của rạp) — phát liên tục tới khi có người thêm video */
  playDefault(now: number): boolean {
    const m = this.hub.defaultVideoFor(now);
    if (!m || now < this.fillerOffUntil) return false;
    this.votes.clear();
    this.reports.clear();
    this.errReports.clear();
    this.now = {
      qid: 0, v: m.v, title: m.title, ch: m.ch, dur: 0, live: true, by: 'Rạp', byId: 0, byCk: '', addedAt: now,
      at: now + PRELOAD_MS, paused: false, pos: 0, ends: Number.MAX_SAFE_INTEGER, filler: true,
    };
    this.sendNow();
    this.votesChanged();
    this.hub.roomsChanged();
    return true;
  }

  pause(now: number): boolean {
    const n = this.now;
    if (!n || n.paused || n.live) return false;
    n.pos = Math.max(0, (now - n.at) / 1000);
    n.paused = true;
    this.sendNow();
    this.hub.dirty = true;
    return true;
  }

  resume(now: number): boolean {
    const n = this.now;
    if (!n || !n.paused) return false;
    n.at = now - n.pos * 1000;
    n.ends = n.at + n.dur * 1000 + END_GRACE_MS;
    n.paused = false;
    this.sendNow();
    this.hub.dirty = true;
    return true;
  }

  // ---------------------------------------------------------- nhịp
  tick(now: number): void {
    // hết bài → bài kế; đang phát video mặc định mà có người thêm video → nhường ngay
    if (this.now && !this.now.paused && now >= this.now.ends) this.next(now);
    else if (!this.now && this.queue.length) this.next(now);
    else if (this.now?.filler && this.queue.length) this.next(now);
    // trống video quá DEFAULT_IDLE_SECONDS → phát video mặc định
    if (!this.now && !this.queue.length) {
      if (!this.idleSince) this.idleSince = now;
      else if (now - this.idleSince >= this.hub.cfg.defaultIdleSeconds * 1000 && this.playDefault(now)) this.idleSince = 0;
    } else {
      this.idleSince = 0;
    }
    // người mất kết nối quá lâu
    for (const p of this.players.values()) {
      if (!p.conn && now - p.ghostSince > GHOST_MS) this.removePlayer(p);
    }
    // frame: chỉ người vừa đổi
    const entries: FrameEntry[] = [];
    for (const p of this.players.values()) {
      if (!p.dirty) continue;
      p.dirty = false;
      entries.push([p.id, r3(p.x), r3(p.y), p.d, p.ct, p.m]);
    }
    if (entries.length) this.broadcast({ t: 'f', p: entries });
  }
}

// ================================================================= Hub
export class Hub {
  readonly rooms = new Map<string, Room>();
  readonly conns = new Set<Conn>();
  readonly bans: BanList;
  private cid = 0;
  private pid = 0;
  private qid = 0;
  private mid = 0;
  private ipConns = new Map<string, number>();
  private mutes = new Map<string, number>();
  private kicks = new Map<string, number>();
  private blocked = new Map<string, BlockedVideo>();
  private embedFail = new Map<string, number>();
  private cache = new VideoCache();
  private inflight = new Map<string, Promise<FetchResult>>();
  private apiWindow = new WindowCounter(60_000, 120);
  private apiIpWindow: WindowCounter;
  private reportSeen = new Map<string, number>();
  private lastSweep = 0;
  private joinWindow: WindowCounter;
  private recentReports: ReportEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private roomsTimer: NodeJS.Timeout | null = null;
  private defaultTimer: NodeJS.Timeout | null = null;
  /** video mặc định đã kiểm (tên + kênh); null = tắt / chưa kiểm / không phát được */
  private defaultMeta: { v: string; title: string; ch: string } | null = null;
  private defaultOffUntil = 0;
  dirty = false;
  private log: (...a: unknown[]) => void;

  constructor(readonly cfg: Config, private deps: HubDeps) {
    this.log = deps.log ?? ((...a) => console.log(...a));
    this.bans = new BanList(deps.dataDir ? join(deps.dataDir, 'bans.json') : null);
    this.joinWindow = new WindowCounter(60_000, cfg.joinsPerMinute);
    this.apiIpWindow = new WindowCounter(60_000, cfg.lookupsPerIpMinute);
    this.load();
    // mỗi rạp luôn có một phòng chính
    for (const v of VENUES) if (!this.rooms.has(v.id)) this.rooms.set(v.id, new Room(this, v.id));
  }

  settings(): PublicSettings {
    const c = this.cfg;
    return {
      maxVideoMin: c.maxVideoMinutes, maxPerUser: c.maxQueuePerUser, capacity: c.roomCapacity, liveMaxMin: c.liveMaxMinutes,
      allowLive: c.allowLive, skipRatio: c.skipVoteRatio, noCookie: c.ytNoCookie, ytReady: this.deps.youtube.configured,
      defaultIdleSec: c.defaultVideo ? c.defaultIdleSeconds : 0,
    };
  }

  // ---------------------------------------------------------- vòng đời
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), Math.round(1000 / this.cfg.tickHz));
    this.timer.unref?.();
    if (this.cfg.defaultVideo) {
      void this.refreshDefault();
      this.defaultTimer = setInterval(() => void this.refreshDefault(), DEFAULT_REFRESH_MS);
      this.defaultTimer.unref?.();
    }
    if (this.deps.dataDir && this.cfg.persist) {
      this.saveTimer = setInterval(() => { if (this.dirty) this.save(); }, SAVE_EVERY_MS);
      this.saveTimer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.roomsTimer) clearTimeout(this.roomsTimer);
    if (this.defaultTimer) clearInterval(this.defaultTimer);
    this.timer = this.saveTimer = this.roomsTimer = this.defaultTimer = null;
    this.save();
  }

  // ---------------------------------------------------------- video mặc định (kênh trực tiếp phát khi phòng trống)
  /**
   * Kiểm video mặc định: oEmbed (không cần key) lấy tên + kênh, 401/403 = chặn nhúng → tắt. Có YT_API_KEY thì kiểm thêm
   * đủ luật như video người xem thêm (công khai, không giới hạn tuổi, xem được ở VN) — trừ giới hạn độ dài (kênh 24/7).
   * Mạng lỗi lúc khởi động: vẫn phát với tên tạm (trình phát báo lỗi thì tự tắt 30 phút).
   */
  private async refreshDefault(): Promise<void> {
    const v = this.cfg.defaultVideo;
    if (!v) return;
    const o = await this.deps.youtube.fetchOEmbed(v);
    if (!o.ok && o.code !== 'network') {
      this.defaultMeta = null;
      this.log(`⚠️  Video mặc định ${v} không phát được (${o.code === 'not_embeddable' ? 'chủ kênh chặn nhúng' : 'không tìm thấy'}) — tắt phát mặc định`);
      return;
    }
    let meta = o.ok ? { v, title: o.title, ch: o.channel } : (this.defaultMeta ?? { v, title: 'Kênh trực tiếp của rạp', ch: '' });
    if (this.deps.youtube.configured) {
      const r = await this.deps.youtube.fetchVideo(v);
      if (r.ok) {
        const chk = checkMeta(r.meta, { region: this.cfg.ytRegion, maxSeconds: Number.MAX_SAFE_INTEGER, allowLive: true });
        if (!chk.ok) {
          this.defaultMeta = null;
          this.log(`⚠️  Video mặc định ${v} không đạt luật rạp (${chk.reason}) — tắt phát mặc định`);
          return;
        }
        meta = { v, title: chk.meta.title || meta.title, ch: chk.meta.channel || meta.ch };
      }
    }
    if (!this.defaultMeta) this.log(`📺 Video mặc định: "${meta.title}" (${v}) — phát khi phòng trống video quá ${this.cfg.defaultIdleSeconds} giây`);
    this.defaultMeta = meta;
  }

  /** video mặc định dùng được lúc này (chưa bị gỡ / chặn, không đang tạm tắt) */
  defaultVideoFor(now: number): { v: string; title: string; ch: string } | null {
    const m = this.defaultMeta;
    if (!m || now < this.defaultOffUntil || this.blocked.has(m.v) || (this.embedFail.get(m.v) ?? 0) > now) return null;
    return m;
  }

  tick(now = Date.now()): void {
    if (now - this.lastSweep > 60_000) {
      this.lastSweep = now;
      for (const m of [this.mutes, this.kicks, this.embedFail, this.reportSeen]) {
        for (const [k, until] of m) if (until <= now) m.delete(k);
      }
    }
    for (const room of this.rooms.values()) {
      try { room.tick(now); } catch (e) { console.error(`[room ${room.id}] tick lỗi:`, e); }
    }
    // đóng bản sao bỏ trống lâu (phòng chính của mỗi rạp luôn mở); người đang đứng xem chuyển về phòng chính
    for (const room of this.rooms.values()) {
      if (room.n === 1 || room.players.size > 0 || now - room.emptySince < ROOM_IDLE_CLOSE_MS) continue;
      const main = this.rooms.get(room.venue);
      this.rooms.delete(room.id);
      for (const c of room.spectators) if (main && !c.player) { c.room = main; main.spectators.add(c); this.sendHello(c); }
      this.roomsChanged();
      this.dirty = true;
    }
  }

  // ---------------------------------------------------------- lưu / nạp (hàng chờ + video đang chiếu + video bị gỡ)
  private file(name: string): string | null {
    return this.deps.dataDir && this.cfg.persist ? join(this.deps.dataDir, name) : null;
  }

  save(): void {
    const f = this.file('rooms.json');
    if (!f) return;
    this.dirty = false;
    try {
      writeJsonAtomic(f, {
        savedAt: Date.now(), qid: this.qid, pid: this.pid,
        // video mặc định không lưu (khởi động lại thì tự phát lại sau DEFAULT_IDLE_SECONDS)
        rooms: [...this.rooms.values()].map((r) => ({ id: r.id, queue: r.queue, now: r.now?.filler ? null : r.now, locked: r.locked })),
        blocked: [...this.blocked.values()],
      });
    } catch (e) {
      console.error('[data] Không lưu được rooms.json:', e instanceof Error ? e.message : e);
    }
  }

  private load(): void {
    const f = this.file('rooms.json');
    if (!f) return;
    const raw = readJson(f);
    if (!raw || typeof raw !== 'object') return;
    const o = raw as { qid?: unknown; pid?: unknown; rooms?: unknown; blocked?: unknown };
    if (typeof o.qid === 'number' && Number.isFinite(o.qid)) this.qid = o.qid;
    // id người tiếp tục tăng sau khi khởi động lại (không trùng byId của video khôi phục)
    if (typeof o.pid === 'number' && Number.isFinite(o.pid)) this.pid = o.pid;
    const okItem = (q: unknown): q is QueueItem => !!q && typeof q === 'object' && typeof (q as QueueItem).v === 'string'
      && /^[A-Za-z0-9_-]{11}$/.test((q as QueueItem).v) && typeof (q as QueueItem).qid === 'number' && typeof (q as QueueItem).title === 'string'
      && typeof (q as QueueItem).dur === 'number';
    if (Array.isArray(o.blocked)) {
      for (const b of o.blocked) if (b && typeof b === 'object' && typeof (b as BlockedVideo).v === 'string') this.blocked.set((b as BlockedVideo).v, b as BlockedVideo);
    }
    if (Array.isArray(o.rooms)) {
      for (const r of o.rooms) {
        if (!r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string') continue;
        const raw = (r as { id: string }).id;
        // dữ liệu bản cũ (phòng đánh số): "1" → rạp mặc định, các phòng số khác bỏ
        const pr = parseRoomId(raw === '1' ? DEFAULT_VENUE : raw);
        if (!pr || pr.n > this.cfg.maxRooms) continue;
        const id = pr.n > 1 ? `${pr.venue.id}-${pr.n}` : pr.venue.id;
        if (this.rooms.has(id)) continue;
        const room = new Room(this, id);
        const rr = r as { queue?: unknown; now?: unknown; locked?: unknown };
        room.queue = Array.isArray(rr.queue) ? rr.queue.filter(okItem).filter((q) => !this.blocked.has(q.v)).slice(0, this.cfg.maxQueue) : [];
        room.locked = rr.locked === true;
        const n = rr.now;
        if (okItem(n) && typeof (n as NowPlaying).at === 'number' && typeof (n as NowPlaying).ends === 'number' && !this.blocked.has(n.v)) {
          const np = n as NowPlaying;
          if (np.paused || Date.now() < np.ends) room.now = { ...np, paused: np.paused === true, pos: Number(np.pos) || 0 };
        }
        this.rooms.set(id, room);
      }
    }
    const nQ = [...this.rooms.values()].reduce((s, r) => s + r.queue.length + (r.now ? 1 : 0), 0);
    if (nQ) this.log(`💾 Khôi phục ${this.rooms.size} phòng, ${nQ} video (đang chiếu + hàng chờ)`);
  }

  // ---------------------------------------------------------- gửi
  sendRaw(c: Conn, data: string): void {
    if (c.closed || !isOpen(c.sock) || c.sock.bufferedAmount > 1_000_000) return;
    try { c.sock.send(data); } catch { /* socket hỏng: close sẽ dọn */ }
  }

  send(c: Conn, msg: ServerMsg): void {
    let data: string;
    try { data = JSON.stringify(msg); } catch { return; }
    this.sendRaw(c, data);
  }

  notice(c: Conn, text: string, kind: 'info' | 'ok' | 'warn' | 'err' = 'info'): void {
    this.send(c, { t: 'notice', text, kind });
  }

  private admins(): Conn[] {
    return [...this.conns].filter((c) => c.admin && !c.closed);
  }

  private adminNote(text: string): void {
    for (const c of this.admins()) this.send(c, { t: 'adm', kind: 'note', text });
  }

  roomsChanged(): void {
    if (this.roomsTimer) return;
    this.roomsTimer = setTimeout(() => {
      this.roomsTimer = null;
      const rooms = this.roomList();
      let data: string;
      try { data = JSON.stringify({ t: 'rooms', rooms }); } catch { return; }
      for (const c of this.conns) this.sendRaw(c, data);
    }, 800);
    this.roomsTimer.unref?.();
  }

  /** phòng theo thứ tự rạp (VENUES) rồi số bản sao */
  private sortedRooms(): Room[] {
    const order = (r: Room): number => VENUES.findIndex((v) => v.id === r.venue) * 100 + r.n;
    return [...this.rooms.values()].sort((a, b) => order(a) - order(b));
  }

  roomList(): RoomInfo[] {
    return this.sortedRooms().map((r) => r.info());
  }

  /**
   * Phòng cho người sắp vào: `preferred` còn chỗ → nó; đầy → bản sao còn chỗ của cùng rạp, chưa có thì mở bản sao mới
   * (tối đa MAX_ROOMS bản mỗi rạp); hết cách → phòng còn chỗ bất kỳ (theo thứ tự rạp); đầy hết → null.
   */
  pickRoom(preferred?: string): Room | null {
    const cap = this.cfg.roomCapacity;
    const pref = preferred ? this.rooms.get(preferred) : undefined;
    if (pref && pref.count() < cap) return pref;
    const sorted = this.sortedRooms();
    const venue = parseRoomId(preferred ?? '')?.venue.id;
    // không chọn rạp → rạp ĐÔNG NHẤT còn chỗ (ít người thì mọi người gặp nhau, không bị rải mỗi người một rạp)
    if (!venue) {
      const open = sorted.filter((r) => r.count() < cap);
      open.sort((a, b) => b.present() - a.present());
      return open[0] ?? null;
    }
    if (venue) {
      for (const r of sorted) if (r.venue === venue && r.count() < cap) return r;
      for (let n = 2; n <= this.cfg.maxRooms; n++) {
        const id = `${venue}-${n}`;
        if (this.rooms.has(id)) continue;
        const room = new Room(this, id);
        this.rooms.set(id, room);
        this.roomsChanged();
        return room;
      }
    }
    for (const r of sorted) if (r.count() < cap) return r;
    return null;
  }

  // ---------------------------------------------------------- kết nối
  /** null = từ chối (quá nhiều kết nối) */
  connect(sock: Sock, meta: { ipHash: string; admin: boolean; room?: string }): Conn | null {
    const n = this.ipConns.get(meta.ipHash) ?? 0;
    if (n >= this.cfg.maxConnPerIp || this.conns.size >= MAX_CONNS) return null;
    this.ipConns.set(meta.ipHash, n + 1);
    const c: Conn = {
      cid: ++this.cid, sock, ipHash: meta.ipHash, admin: meta.admin, room: null, player: null,
      bucket: new Bucket(120, 70), strikes: 0, closed: false, // gửi vị trí 30 lần / giây + ping + chat
    };
    this.conns.add(c);
    // link ?phong=<id>: đúng phòng đó, bản sao đã đóng thì về phòng chính của rạp
    const asked = meta.room ? this.rooms.get(meta.room) ?? this.rooms.get(parseRoomId(meta.room)?.venue.id ?? '') : undefined;
    const room = asked || this.pickRoom() || this.rooms.get(DEFAULT_VENUE)!;
    c.room = room;
    room.spectators.add(c);
    this.sendHello(c);
    return c;
  }

  private sendHello(c: Conn): void {
    const room = c.room!;
    this.send(c, {
      t: 'hello', v: PROTOCOL, s: Date.now(), rooms: this.roomList(), room: room.id, snap: room.snapshot(Date.now()),
      admin: c.admin, cfg: this.settings(),
    });
  }

  disconnect(c: Conn): void {
    if (c.closed) return;
    c.closed = true;
    this.conns.delete(c);
    const n = (this.ipConns.get(c.ipHash) ?? 1) - 1;
    if (n <= 0) this.ipConns.delete(c.ipHash); else this.ipConns.set(c.ipHash, n);
    c.room?.spectators.delete(c);
    const p = c.player;
    if (p && p.conn === c) {
      p.conn = null;
      p.ghostSince = Date.now();
      p.m = 0;
      const room = c.room;
      if (room && room.players.has(p.id)) {
        room.broadcast({ t: 'pu', p: room.playerInfo(p, Date.now()) });
        room.votes.delete(p.id);
        if (room.now) room.votesChanged(); // ít người hơn → số phiếu cần cũng giảm
      }
    }
  }

  // ---------------------------------------------------------- thông điệp
  message(c: Conn, msg: ClientMsg): void {
    const now = Date.now();
    if (!c.bucket.take(1, now)) {
      if (++c.strikes > 200) { c.sock.close(1008, 'quá nhiều tin nhắn'); }
      return;
    }
    switch (msg.t) {
      case 'ping': this.send(c, { t: 'pong', c: msg.c, s: Date.now() }); return;
      case 'spec': return this.onSpec(c, msg.room);
      case 'switch': return this.onSwitch(c, msg.room, now);
      case 'leave': return this.onLeave(c);
      case 'join': return this.onJoin(c, msg, now);
      case 'adm': return this.onAdmin(c, msg, now);
      default: break;
    }
    const p = c.player;
    const room = c.room;
    if (!p || !room || p.conn !== c) return;
    switch (msg.t) {
      case 'move': return this.onMove(p, msg, now);
      case 'act': return this.onAct(room, p, msg.a, msg.c, now);
      case 'chat': return this.onChat(room, p, msg.text, now);
      case 'emo': return this.onEmo(room, p, msg.e, now);
      case 'look': return this.onLook(room, p, msg.look, now);
      case 'q_add': void this.onQueueAdd(room, p, msg.url); return;
      case 'q_del': return this.onQueueDel(room, p, msg.qid);
      case 'vote': return this.onVote(room, p, msg.on);
      case 'report': return this.onReport(room, p, msg);
      case 'vid_err': return this.onVideoError(room, p, msg.v, msg.code, now);
      default: return;
    }
  }

  private onSpec(c: Conn, id: string): void {
    if (c.player) return;
    const room = this.rooms.get(id);
    if (!room || room === c.room) return;
    c.room?.spectators.delete(c);
    c.room = room;
    room.spectators.add(c);
    this.sendHello(c);
  }

  /**
   * Đang ở trong rạp mà chuyển sang rạp / phòng khác: không tải lại trang, giữ nguyên nhân vật (id, tên, ngoại hình,
   * token nối lại), xuất hiện ở lối đi cuối rạp mới → gửi welcome với ảnh chụp phòng mới. Rạp đầy / trùng tên → báo, ở yên.
   */
  private onSwitch(c: Conn, roomId: string, now: number): void {
    const p = c.player;
    const from = p ? this.roomOf(p) : null;
    if (!p || !from || from.id === roomId) return;
    this.moveTo(c, p, from, roomId, now, true);
  }

  /** rời trang (đóng tab, chuyển trang): bỏ nhân vật ngay — người khác không thấy nhân vật "kẹt" lại chờ hết hạn */
  private onLeave(c: Conn): void {
    const p = c.player;
    if (!p) return;
    const room = this.roomOf(p);
    c.player = null;
    p.conn = null;
    if (room) room.removePlayer(p);
  }

  /** đưa nhân vật sang phòng `roomId` (cùng rạp mà đầy thì sang bản sao). false = không chuyển được (đã báo người xem) */
  private moveTo(c: Conn, p: Player, from: Room, roomId: string, now: number, limit: boolean): boolean {
    const want = parseRoomId(roomId)?.venue.id;
    if (!want) return false;
    if (limit && !this.joinWindow.hit(c.ipHash, now)) { this.notice(c, 'Chuyển rạp nhanh quá, đợi một chút rồi thử lại nhé.', 'warn'); return false; }
    const to = this.pickRoom(roomId);
    if (!to || to.venue !== want) { this.notice(c, `${roomName(roomId)} đang đầy, thử rạp khác nhé.`, 'warn'); return false; }
    if (to === from) return false;
    for (const q of to.players.values()) {
      if (q.key === p.key) { this.notice(c, `Tên "${p.name}" đang có người dùng trong ${to.name} — đổi tên rồi vào nhé.`, 'warn'); return false; }
    }
    from.removePlayer(p);
    from.spectators.delete(c);
    const sp = spawnPoint();
    p.x = sp.x; p.y = sp.y; p.d = 1; p.m = 0; p.action = null;
    p.ct = 0; p.lastMoveAt = now; p.budget = 0; p.dirty = false;
    c.room = to;
    to.spectators.add(c);
    to.addPlayer(p, now);
    this.send(c, { t: 'welcome', you: p.id, token: p.token, room: to.id, snap: to.snapshot(now) });
    return true;
  }

  /** tắt tiếng theo MÁY (không theo IP: ở VN nhiều người dùng chung IP qua 4G / wifi) */
  private isMuted(p: Player, now = Date.now()): number {
    const until = this.mutes.get(`ck:${p.ck}`) ?? 0;
    return until > now ? until : 0;
  }

  private muteText(until: number, now = Date.now()): string {
    if (until >= Number.MAX_SAFE_INTEGER / 2) return 'Bạn đang bị tắt tiếng.';
    const min = Math.max(1, Math.ceil((until - now) / 60_000));
    return `Bạn đang bị tắt tiếng (còn ${min} phút).`;
  }

  /** nhân vật cũ của người đang vào lại: theo token (rớt mạng, F5 cùng tab) trước, rồi theo khoá máy (đóng tab mở lại…) */
  private findReturning(token: string, ck: string): { room: Room; p: Player } | null {
    let byCk: { room: Room; p: Player } | null = null;
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (token && p.token === token && p.ck === ck) return { room, p };
        if (ck && p.ck === ck && !byCk) byCk = { room, p };
      }
    }
    return byCk;
  }

  /** bỏ hẳn một nhân vật (đổi tên khi vào lại…): socket cũ còn treo thì đóng */
  private dropPlayer(room: Room, p: Player, reason: string): void {
    room.removePlayer(p);
    const old = p.conn;
    p.conn = null;
    if (old) {
      old.player = null;
      this.send(old, { t: 'notice', kind: 'warn', text: reason });
      setTimeout(() => { try { old.sock.close(4002, 'replaced'); } catch { /* bỏ qua */ } }, 50).unref?.();
    }
  }

  private onJoin(c: Conn, msg: Extract<ClientMsg, { t: 'join' }>, now: number): void {
    if (c.player) return;
    // vào lại: nhận lại ĐÚNG nhân vật cũ (dù đang "mất mạng" hay socket cũ còn treo) thay vì báo trùng tên — theo token
    // của tab, hoặc theo khoá máy khi tab mới không còn token. Cố ý đổi sang tên khác thì bỏ nhân vật cũ, vào mới.
    const back = this.findReturning(msg.token, msg.ck);
    if (back) {
      const { room, p } = back;
      const nc = checkName(msg.name, LIMITS.nameMin, LIMITS.nameMax);
      if (nc.ok && nameKey(nc.name) !== p.key) {
        this.dropPlayer(room, p, 'Bạn vừa vào rạp bằng tên khác ở tab / máy khác.');
      } else {
        // socket cũ còn treo (đổi wifi ↔ 4G, server chưa kịp biết) hoặc tab nhân bản: socket mới thay chỗ, socket cũ bị đóng
        const old = p.conn;
        if (old && old !== c) {
          old.player = null;
          this.send(old, { t: 'notice', kind: 'warn', text: 'Bạn vừa vào rạp ở tab / máy khác.' });
          setTimeout(() => { try { old.sock.close(4002, 'replaced'); } catch { /* bỏ qua */ } }, 50).unref?.();
        }
        // trang vừa tải lại → giờ máy (performance.now) về gần 0: bỏ mốc cũ để gói di chuyển mới không bị coi là gói cũ
        p.ct = 0;
        p.lastMoveAt = now;
        p.budget = 0;
        p.conn = c;
        p.look = normalizeLook(msg.look);
        c.player = p;
        c.room?.spectators.delete(c);
        c.room = room;
        room.spectators.add(c);
        // chọn rạp khác rạp nhân vật cũ đang đứng → chuyển luôn sang rạp đó (đầy thì ở lại rạp cũ)
        const want = parseRoomId(msg.room)?.venue.id;
        if (want && want !== room.venue && this.moveTo(c, p, room, msg.room, now, false)) return;
        this.send(c, { t: 'welcome', you: p.id, token: p.token, room: room.id, snap: room.snapshot(now) });
        room.broadcast({ t: 'pu', p: room.playerInfo(p, now) }, c);
        room.votesChanged();
        return;
      }
    }
    const fail = (code: string, text: string): void => this.send(c, { t: 'join_err', code, text });
    const ban = this.bans.find(c.ipHash, msg.ck, now);
    if (ban) return fail('banned', ban.until ? `Bạn bị cấm vào rạp tới ${new Date(ban.until).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.` : 'Bạn bị cấm vào rạp.');
    const kicked = msg.ck ? this.kicks.get(`ck:${msg.ck}`) ?? 0 : 0;
    if (kicked > now) return fail('kicked', `Bạn vừa bị mời ra khỏi rạp — quay lại sau ${Math.ceil((kicked - now) / 1000)} giây nhé.`);
    if (!this.joinWindow.hit(c.ipHash, now)) return fail('rate', 'Vào ra nhanh quá, đợi một chút rồi thử lại nhé.');
    const nc = checkName(msg.name, LIMITS.nameMin, LIMITS.nameMax);
    if (!nc.ok) return fail('name', nc.text);
    const room = this.pickRoom(msg.room || c.room?.id);
    if (!room) return fail('full', 'Các phòng đều đã đầy, thử lại sau ít phút nhé.');
    const key = nameKey(nc.name);
    for (const p of room.players.values()) {
      if (p.key === key) return fail('name_taken', `Tên "${nc.name}" đang có người dùng trong ${room.name}, chọn tên khác nhé.`);
    }
    const sp = spawnPoint();
    const p: Player = {
      id: ++this.pid, name: nc.name, key, look: normalizeLook(msg.look), x: sp.x, y: sp.y, d: 1, m: 0,
      ct: 0, lastMoveAt: now, budget: 0, dirty: false, action: null, conn: c, ghostSince: 0,
      token: randomBytes(16).toString('hex'), ck: msg.ck || randomBytes(8).toString('hex'), ipHash: c.ipHash, joinedAt: now, lastCorrAt: 0,
      chatBucket: new Bucket(3, 0.5, now), emoBucket: new Bucket(6, 2.5, now), actBucket: new Bucket(4, 2, now),
      lookBucket: new Bucket(3, 0.2, now), addBucket: new Bucket(2, 1 / this.cfg.queueAddSeconds, now), moveBucket: new Bucket(60, 40, now),
      lastChat: { text: '', at: 0 }, chatStrikes: [], reportBucket: new Bucket(3, 3 / 60, now),
    };
    c.player = p;
    c.room?.spectators.delete(c);
    c.room = room;
    room.spectators.add(c);
    room.addPlayer(p, now);
    this.adoptItems(p);
    this.send(c, { t: 'welcome', you: p.id, token: p.token, room: room.id, snap: room.snapshot(now) });
  }

  /** video người này thêm trước đó (vd trước khi server khởi động lại, id cũ): nhận lại quyền theo khoá máy */
  private adoptItems(p: Player): void {
    for (const room of this.rooms.values()) {
      let changed = false;
      for (const q of room.queue) if (q.byCk && q.byCk === p.ck && q.byId !== p.id) { q.byId = p.id; changed = true; }
      const nowChanged = !!room.now && room.now.byCk === p.ck && room.now.byId !== p.id;
      if (nowChanged) room.now!.byId = p.id;
      // phát cho người khác ở lượt sau (người vừa vào nhận bản đúng trong welcome)
      if (changed || nowChanged) setTimeout(() => { if (changed) room.sendQueue(); if (nowChanged) room.sendNow(); }, 0);
    }
  }

  // ---------------------------------------------------------- di chuyển (client tự đi, server kiểm tra + sửa nhẹ)
  private onMove(p: Player, msg: Extract<ClientMsg, { t: 'move' }>, now: number): void {
    if (!p.moveBucket.take(1, now)) return;
    if (p.ct && msg.c <= p.ct) return; // gói cũ / trùng
    const elapsed = Math.max(0, now - p.lastMoveAt);
    p.budget = Math.min(BUDGET_CAP, p.budget + (BUDGET_RATE * elapsed) / 1000);
    let tx = msg.x, ty = msg.y;
    let corrected = false;
    const dist = Math.hypot(tx - p.x, ty - p.y);
    if (dist > p.budget + 0.03) {
      const k = dist > 0 ? p.budget / dist : 0;
      tx = p.x + (tx - p.x) * k;
      ty = p.y + (ty - p.y) * k;
      corrected = true;
    }
    if (!isWalkable(tx, ty)) {
      const r = moveWithCollision(p.x, p.y, tx - p.x, ty - p.y);
      tx = r.x; ty = r.y;
      if (!isWalkable(tx, ty)) { const w = clampToWalkable(tx, ty); tx = w.x; ty = w.y; }
      corrected = true;
    }
    p.budget = Math.max(0, p.budget - Math.hypot(tx - p.x, ty - p.y));
    // giờ máy người đi: tăng đều, không nhanh hơn giờ thật quá 1 s (để máy khác nội suy đúng nhịp)
    let ct = msg.c;
    if (p.ct && ct - p.ct > elapsed + 1000) ct = p.ct + Math.max(1, elapsed);
    p.x = tx; p.y = ty; p.d = msg.d; p.m = msg.m;
    p.ct = ct;
    p.lastMoveAt = now;
    p.dirty = true;
    if (msg.m === 1 && p.action) p.action = null; // đi là thôi động tác
    if (corrected && now - p.lastCorrAt > 150 && p.conn) {
      p.lastCorrAt = now;
      this.send(p.conn, { t: 'corr', x: r2(tx), y: r2(ty) });
    }
  }

  private onAct(room: Room, p: Player, a: ActionId | '', c: number, now: number): void {
    if (!p.actBucket.take(1, now)) return;
    if (a === '') {
      if (!p.action) return;
      p.action = null;
    } else {
      p.action = { a, ct: c || p.ct, at: now };
    }
    room.broadcast({ t: 'act', id: p.id, a, c: c || p.ct });
  }

  private onChat(room: Room, p: Player, raw: string, now: number): void {
    const c = p.conn!;
    const muted = this.isMuted(p, now);
    if (muted) return this.notice(c, this.muteText(muted, now), 'warn');
    const res = checkChat(raw, LIMITS.chatMax);
    if (!res.ok) { if (res.text) this.notice(c, res.text, 'warn'); return; }
    if (res.text === p.lastChat.text && now - p.lastChat.at < 20_000) return this.notice(c, 'Đừng gửi lặp lại nhé.', 'warn');
    if (!p.chatBucket.take(1, now) || now - p.lastChat.at < 600) {
      p.chatStrikes = p.chatStrikes.filter((t) => now - t < 30_000);
      p.chatStrikes.push(now);
      if (p.chatStrikes.length >= 5) {
        const until = now + 2 * 60_000;
        this.mutes.set(`ck:${p.ck}`, until);
        p.chatStrikes = [];
        return this.notice(c, 'Bạn chat dồn dập quá nên bị tắt tiếng 2 phút.', 'warn');
      }
      return this.notice(c, 'Chậm lại chút nhé, gửi nhanh quá.', 'warn');
    }
    p.lastChat = { text: res.text, at: now };
    const m: ChatInfo = { mid: ++this.mid, pid: p.id, name: p.name, text: res.text, at: now };
    room.chat.push(m);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    room.broadcast({ t: 'chat', m });
  }

  private onEmo(room: Room, p: Player, e: string, now: number): void {
    if (!REACTIONS.includes(e) || this.isMuted(p, now) || !p.emoBucket.take(1, now)) return;
    room.broadcast({ t: 'emo', id: p.id, e });
  }

  private onLook(room: Room, p: Player, raw: unknown, now: number): void {
    if (!p.lookBucket.take(1, now)) return this.notice(p.conn!, 'Đổi ngoại hình chậm lại chút nhé.', 'warn');
    p.look = normalizeLook(raw);
    room.broadcast({ t: 'pu', p: room.playerInfo(p, now) });
  }

  // ---------------------------------------------------------- hàng chờ
  private lookup(id: string): Promise<FetchResult> {
    const hit = this.cache.get(id);
    if (hit) return Promise.resolve({ ok: true, meta: hit.meta });
    let pr = this.inflight.get(id);
    if (!pr) {
      pr = this.deps.youtube.fetchVideo(id)
        .then((r) => { if (r.ok) this.cache.set(id, r.meta); return r; })
        .catch((): FetchResult => ({ ok: false, code: 'network', text: 'Không kiểm tra được video lúc này, thử lại sau nhé.' }))
        .finally(() => this.inflight.delete(id));
      this.inflight.set(id, pr);
    }
    return pr;
  }

  private queueCountBy(room: Room, p: Player): number {
    return room.queue.filter((q) => q.byId === p.id || (q.byCk && q.byCk === p.ck)).length;
  }

  private async onQueueAdd(room: Room, p: Player, url: string): Promise<void> {
    const c = p.conn!;
    const res = (ok: boolean, text: string): void => this.send(c, { t: 'q_res', ok, text });
    const admin = c.admin;
    const now = Date.now();
    const muted = this.isMuted(p, now);
    if (muted) return res(false, this.muteText(muted, now));
    if (room.locked && !admin) return res(false, 'Hàng chờ đang được khoá — chỉ admin thêm được video.');
    const id = parseVideoId(url);
    if (!id) return res(false, 'Đây không phải link video YouTube (dạng youtube.com/watch?v=… hoặc youtu.be/…).');
    if (this.blocked.has(id)) return res(false, 'Video này đã bị gỡ khỏi rạp.');
    const failUntil = this.embedFail.get(id) ?? 0;
    if (failUntil > now) return res(false, 'Video này không phát được trên rạp (chủ kênh chặn phát ở trang khác).');
    if (room.now?.v === id || room.queue.some((q) => q.v === id)) return res(false, 'Video này đã có trong hàng chờ rồi.');
    if (!admin && this.queueCountBy(room, p) >= this.cfg.maxQueuePerUser) {
      return res(false, `Mỗi người chỉ được chờ ${this.cfg.maxQueuePerUser} video — đợi video của bạn chiếu xong đã nhé.`);
    }
    if (room.queue.length >= this.cfg.maxQueue) return res(false, 'Hàng chờ đã đầy, đợi bớt rồi thêm nhé.');
    if (!admin && !p.addBucket.take(1, now)) return res(false, `Thêm chậm thôi — thử lại sau ${Math.ceil(p.addBucket.waitMs(now) / 1000)} giây.`);
    if (!this.cache.get(id)) {
      if (!admin && !this.apiIpWindow.hit(p.ipHash, now)) return res(false, 'Bạn kiểm tra nhiều link quá, thử lại sau 1 phút nhé.');
      if (!this.apiWindow.hit('all', now)) return res(false, 'Rạp đang kiểm tra nhiều video quá, thử lại sau 1 phút nhé.');
    }
    const r = await this.lookup(id);
    if (!r.ok) return res(false, r.text);
    const check = checkMeta(r.meta, {
      region: this.cfg.ytRegion,
      maxSeconds: (admin ? this.cfg.adminMaxVideoMinutes : this.cfg.maxVideoMinutes) * 60,
      allowLive: this.cfg.allowLive,
    });
    if (!check.ok) return res(false, check.reason);
    // kiểm tra lại sau khi chờ mạng (người có thể đã rời phòng / hàng chờ đã đổi)
    if (p.conn !== c || !room.players.has(p.id)) return;
    if (room.now?.v === id || room.queue.some((q) => q.v === id)) return res(false, 'Video này vừa được người khác thêm rồi.');
    if (!admin && this.queueCountBy(room, p) >= this.cfg.maxQueuePerUser) return res(false, `Mỗi người chỉ được chờ ${this.cfg.maxQueuePerUser} video.`);
    if (room.queue.length >= this.cfg.maxQueue) return res(false, 'Hàng chờ đã đầy.');
    const meta = check.meta;
    const item: QueueItem = {
      qid: ++this.qid, v: id, title: cleanText(meta.title, 200) || 'Video không tên', ch: cleanText(meta.channel, 100),
      dur: meta.live ? 0 : meta.durationSec, live: meta.live, by: p.name, byId: p.id, byCk: p.ck, addedAt: Date.now(),
    };
    room.queue.push(item);
    this.dirty = true;
    const pos = room.queue.length;
    res(true, room.now && !room.now.filler ? `Đã thêm "${item.title}" — thứ ${pos} trong hàng chờ.` : `Đã thêm "${item.title}" — chiếu ngay!`);
    if (!room.now) room.next(Date.now());
    else room.sendQueue();
    room.broadcast({ t: 'notice', kind: 'info', text: `${p.name} vừa thêm "${item.title}"${item.live ? ' (trực tiếp)' : ` · ${fmtDuration(item.dur)}`}` }, c);
  }

  private onQueueDel(room: Room, p: Player, qid: number): void {
    const i = room.queue.findIndex((q) => q.qid === qid);
    if (i < 0) return;
    const q = room.queue[i];
    if (q.byId !== p.id && !(q.byCk && q.byCk === p.ck) && !p.conn?.admin) return this.notice(p.conn!, 'Chỉ xoá được video do bạn thêm.', 'warn');
    room.queue.splice(i, 1);
    this.dirty = true;
    room.sendQueue();
  }

  private onVote(room: Room, p: Player, on: boolean): void {
    const n = room.now;
    if (!n) return;
    if (n.filler) {
      if (on && p.conn) this.notice(p.conn, 'Đây là kênh mặc định của rạp, tự nhường khi có video — dán link YouTube để chiếu video của bạn nhé.', 'info');
      return;
    }
    // người thêm bài bỏ qua bài của chính mình: bỏ ngay
    if (on && (n.byId === p.id || (n.byCk && n.byCk === p.ck))) {
      room.broadcast({ t: 'notice', kind: 'info', text: `${p.name} bỏ qua video của mình.` });
      room.next(Date.now());
      return;
    }
    const had = room.votes.has(p.id);
    if (on === had) return;
    if (on) room.votes.add(p.id); else room.votes.delete(p.id);
    room.votesChanged();
  }

  // ---------------------------------------------------------- báo cáo + lỗi trình phát
  private recordReport(e: ReportEntry): void {
    this.recentReports.push(e);
    if (this.recentReports.length > 100) this.recentReports.shift();
    const f = this.file('reports.jsonl');
    if (f) {
      try { mkdirSync(this.deps.dataDir!, { recursive: true }); } catch { /* appendFile sẽ báo lỗi */ }
      appendFile(f, `${JSON.stringify(e)}\n`, { mode: 0o600 }).catch((err: unknown) => {
        console.error('[data] Không ghi được reports.jsonl:', err instanceof Error ? err.message : err);
      });
    }
    this.log(`🚩 Báo cáo (${e.room}) ${e.kind}: ${e.what} — ${e.reason}${e.note ? ` · ${e.note}` : ''}`);
    this.adminNote(`🚩 ${e.by} báo cáo ${e.kind === 'video' ? 'video' : 'người xem'} "${e.what}" — ${e.reason}`);
  }

  private onReport(room: Room, p: Player, msg: Extract<ClientMsg, { t: 'report' }>): void {
    const c = p.conn!;
    const now = Date.now();
    const seenKey = `${p.ck}|${msg.kind}|${msg.kind === 'video' ? room.now?.v ?? '' : msg.target}`;
    if ((this.reportSeen.get(seenKey) ?? 0) > now) return this.notice(c, 'Bạn đã báo cáo rồi, cảm ơn nhé.', 'info');
    if (!p.reportBucket.take(1, now)) return this.notice(c, 'Bạn báo cáo nhiều quá, đợi một chút nhé.', 'warn');
    this.reportSeen.set(seenKey, now + 10 * 60_000);
    const reason = REPORT_REASONS[msg.reason] ?? REPORT_REASONS.other;
    const note = cleanText(msg.note, 300);
    if (msg.kind === 'video') {
      const n = room.now;
      if (!n || (msg.target && msg.target !== n.v)) return this.notice(c, 'Video đó đã chiếu xong rồi.', 'info');
      const key = `ck:${p.ck}`;
      if (room.reports.has(key)) return this.notice(c, 'Bạn đã báo cáo video này rồi, cảm ơn nhé.', 'info');
      room.reports.add(key);
      room.reports.add(`ip:${p.ipHash}`);
      this.recordReport({ at: Date.now(), room: room.id, kind: 'video', what: `${n.title} (${n.v})`, reason, note, by: p.name });
      this.notice(c, 'Đã gửi báo cáo cho admin. Cảm ơn bạn!', 'ok');
      // đếm người khác nhau theo IP (một người mở nhiều tab / xoá bộ nhớ trình duyệt không tự gỡ được video)
      const distinct = [...room.reports].filter((k) => k.startsWith('ip:')).length;
      if (distinct >= this.cfg.reportAutoskip) {
        this.blockVideo(n.v, n.title, `${distinct} người báo cáo: ${reason}`, room);
        room.broadcast({ t: 'notice', kind: 'warn', text: `Đã gỡ "${n.title}" vì nhiều người báo cáo.` });
        room.next(Date.now());
      }
      return;
    }
    const pid = Number(msg.target);
    const target = Number.isInteger(pid) ? room.players.get(pid) : undefined;
    if (!target || target === p) return;
    this.recordReport({ at: Date.now(), room: room.id, kind: 'user', what: target.name, reason, note, by: p.name });
    this.notice(c, `Đã báo cáo ${target.name} cho admin. Cảm ơn bạn!`, 'ok');
  }

  private blockVideo(v: string, title: string, reason: string, except?: Room): void {
    this.blocked.set(v, { v, title, at: Date.now(), reason });
    for (const room of this.rooms.values()) {
      const before = room.queue.length;
      room.queue = room.queue.filter((q) => q.v !== v);
      if (room.queue.length !== before) room.sendQueue();
      if (room !== except && room.now?.v === v) {
        room.broadcast({ t: 'notice', kind: 'warn', text: `Đã gỡ "${room.now.title}" khỏi rạp.` });
        room.next(Date.now());
      }
    }
    this.dirty = true;
    this.save();
  }

  /** trình phát báo lỗi (100 không có / 101, 150 chủ kênh chặn nhúng): đủ số máy báo thì sang bài kế */
  private onVideoError(room: Room, p: Player, v: string, code: number, now: number): void {
    const n = room.now;
    if (!n || n.v !== v || !YT_ERR_SKIP.has(code) || now < n.at - PRELOAD_MS) return;
    room.errReports.add(`ip:${p.ipHash}`);
    // cần đủ số mạng (IP) khác nhau cùng báo lỗi: ≥ 30 % và ≥ 2 (ít người thì tất cả) — một người nhiều tab không đủ
    const ips = room.presentIps();
    const need = Math.max(1, Math.min(ips, Math.max(2, Math.ceil(ips * 0.3))));
    if (room.errReports.size < need) return;
    if (code === 101 || code === 150) this.embedFail.set(v, now + EMBED_FAIL_MS);
    if (n.filler) this.defaultOffUntil = now + DEFAULT_OFF_MS; // video mặc định hỏng: tạm tắt, thử lại sau
    this.cache.delete(v);
    this.log(`⚠️  Video ${v} lỗi trình phát (mã ${code}) trên ${room.errReports.size} máy — chuyển bài`);
    room.broadcast({
      t: 'notice', kind: 'warn',
      text: code === 101 || code === 150 ? `"${n.title}" không cho phát trên trang khác — chuyển bài.` : `"${n.title}" không phát được — chuyển bài.`,
    });
    room.next(now);
  }

  // ---------------------------------------------------------- admin
  private findPlayer(room: Room | null, pid: number): Player | null {
    if (room?.players.has(pid)) return room.players.get(pid)!;
    for (const r of this.rooms.values()) if (r.players.has(pid)) return r.players.get(pid)!;
    return null;
  }

  private roomOf(p: Player): Room | null {
    for (const r of this.rooms.values()) if (r.players.get(p.id) === p) return r;
    return null;
  }

  private onAdmin(c: Conn, op: AdminOp, now: number): void {
    if (!c.admin) return; // người thường: như không tồn tại
    const room = c.room;
    if (!room) return;
    const done = (text: string): void => { this.notice(c, text, 'ok'); this.sendAdminState(c); };
    switch (op.op) {
      case 'state': return this.sendAdminState(c);
      case 'skip':
        if (!room.now) return;
        room.broadcast({ t: 'notice', kind: 'info', text: `Admin đã bỏ qua "${room.now.title}".` });
        if (room.now.filler) room.fillerOffUntil = now + FILLER_SKIP_MS; // tạm không phát lại video mặc định ở phòng này
        room.next(now);
        return done('Đã bỏ qua video.');
      case 'pause': if (room.pause(now)) done('Đã tạm dừng phòng.'); return;
      case 'resume': if (room.resume(now)) done('Đã chiếu tiếp.'); return;
      case 'remove': {
        const before = room.queue.length;
        room.queue = room.queue.filter((q) => q.qid !== op.qid);
        if (room.queue.length !== before) { this.dirty = true; room.sendQueue(); }
        return;
      }
      case 'top': {
        const i = room.queue.findIndex((q) => q.qid === op.qid);
        if (i > 0) { const [q] = room.queue.splice(i, 1); room.queue.unshift(q); this.dirty = true; room.sendQueue(); }
        return;
      }
      case 'lock':
        room.locked = op.on;
        this.dirty = true;
        room.sendQueue();
        room.broadcast({ t: 'notice', kind: 'info', text: op.on ? 'Admin đã khoá hàng chờ.' : 'Hàng chờ đã mở lại — mọi người thêm video được rồi.' });
        return done(op.on ? 'Đã khoá hàng chờ.' : 'Đã mở hàng chờ.');
      case 'mute': {
        const p = this.findPlayer(room, op.pid);
        if (!p) return;
        const until = op.minutes === 0 ? Number.MAX_SAFE_INTEGER : now + op.minutes * 60_000;
        this.mutes.set(`ck:${p.ck}`, until);
        if (p.conn) this.notice(p.conn, op.minutes ? `Admin đã tắt tiếng bạn ${op.minutes} phút.` : 'Admin đã tắt tiếng bạn.', 'warn');
        return done(`Đã tắt tiếng ${p.name}.`);
      }
      case 'unmute': {
        const p = this.findPlayer(room, op.pid);
        if (!p) return;
        this.mutes.delete(`ck:${p.ck}`);
        if (p.conn) this.notice(p.conn, 'Bạn đã được bật tiếng lại.', 'ok');
        return done(`Đã bật tiếng ${p.name}.`);
      }
      case 'kick': {
        const p = this.findPlayer(room, op.pid);
        if (!p || p.conn === c) return;
        this.kicks.set(`ck:${p.ck}`, now + KICK_BLOCK_MS); // theo máy, không theo IP (người chung mạng không bị vạ lây)
        this.ejectPlayer(p, 'Bạn đã bị admin mời ra khỏi rạp.');
        return done(`Đã mời ${p.name} ra khỏi rạp.`);
      }
      case 'ban': {
        const p = this.findPlayer(room, op.pid);
        if (!p || p.conn === c) return;
        this.bans.add({ ipHash: p.ipHash, ck: p.ck, name: p.name, until: op.hours ? now + op.hours * 3600_000 : 0, reason: 'admin' }, now);
        this.ejectPlayer(p, 'Bạn đã bị cấm vào rạp.');
        return done(`Đã cấm ${p.name}${op.hours ? ` ${op.hours} giờ` : ' vĩnh viễn'}.`);
      }
      case 'unban':
        if (this.bans.remove(op.id)) done('Đã bỏ cấm.');
        return;
      case 'block': {
        const n = room.now;
        const v = op.v || n?.v;
        if (!v) return;
        const title = n?.v === v ? n.title : room.queue.find((q) => q.v === v)?.title ?? v;
        this.log(`🚫 Admin gỡ video ${v}`);
        this.blockVideo(v, title, 'admin gỡ');
        return done(`Đã gỡ hẳn "${title}" — không ai thêm lại được (bỏ chặn trong bảng quản trị).`);
      }
      case 'unblock':
        if (this.blocked.delete(op.v)) { this.dirty = true; this.save(); done('Đã bỏ chặn video.'); }
        this.embedFail.delete(op.v);
        return;
      case 'clear_chat':
        room.chat = [];
        room.broadcast({ t: 'chat_clear' });
        return done('Đã xoá khung chat.');
      default:
        return;
    }
  }

  private ejectPlayer(p: Player, text: string): void {
    const room = this.roomOf(p);
    const conn = p.conn;
    p.conn = null;
    room?.removePlayer(p);
    if (conn) {
      conn.player = null;
      this.send(conn, { t: 'kicked', text });
      setTimeout(() => { try { conn.sock.close(4001, 'kicked'); } catch { /* bỏ qua */ } }, 50).unref?.();
    }
  }

  private sendAdminState(c: Conn): void {
    const now = Date.now();
    const room = c.room;
    const players = room ? [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, joinedAt: p.joinedAt, ghost: !p.conn, muted: this.isMuted(p, now), me: p.conn === c,
    })) : [];
    this.send(c, {
      t: 'adm', kind: 'state', room: room?.id ?? '', locked: room?.locked ?? false, players,
      bans: this.bans.list(now).map((b) => ({ id: b.id, name: b.name, until: b.until, at: b.at })),
      blocked: [...this.blocked.values()].slice(-50),
      reports: this.recentReports.slice(-40).reverse(),
      ytReady: this.deps.youtube.configured,
    });
  }

  // ---------------------------------------------------------- số liệu cho /api/health
  stats(): { rooms: number; viewers: number; players: number; playing: number } {
    let players = 0, playing = 0;
    for (const r of this.rooms.values()) { players += r.players.size; if (r.now) playing++; }
    return { rooms: this.rooms.size, viewers: this.conns.size, players, playing };
  }
}
