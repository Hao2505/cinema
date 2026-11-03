// Lõi rạp: nhiều phòng (đầy thì tự mở phòng kế), người xem điều khiển nhân vật, kiểm tra di chuyển (client tự đi trước,
// server sửa khi lệch), frame 15 Hz chỉ gồm người vừa đổi, động tác là SỰ KIỆN, chat / emoji, hàng chờ YouTube +
// "đồng hồ phòng" (videoId, lúc bắt đầu, dừng/chạy), bỏ phiếu bỏ qua, báo cáo, quyền admin, lưu trạng thái ra đĩa.
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LIMITS, PROTOCOL, REACTIONS, SPEED, actionById, clampToWalkable, isWalkable, moveWithCollision,
  normalizeLook, spawnPoint,
  DEFAULT_VENUE, PRIVATE_ROOM_RE, VENUES, isPrivateRoomId, parseRoomId, roomName, venueById,
} from '../public/js/shared/hall.js';
import type { ActionId, Look } from '../public/js/shared/hall.js';
import type { Config } from './config.js';
import {
  BanList, Bucket, WindowCounter, checkChat, checkName, cleanText, codeLength, nameKey, readJson, writeJsonAtomic,
} from './moderation.js';
import { VideoCache, checkMeta, fmtDuration, parseVideoId, type OEmbedResult } from './youtube.js';
import type { FetchResult, YouTubeClient } from './youtube.js';
import type {
  AdminOp, ChatInfo, ClientMsg, FrameEntry, NowInfo, PlayerInfo, PrivInfo, PublicSettings, QueueItemInfo, RoomInfo,
  RoomSnapshot, ServerMsg,
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
const OEMBED_TTL_MS = 30 * 60_000;
const YT_ERR_SKIP = new Set([2, 100, 101, 150]);

// ---------------------------------------------------------------- phòng riêng (docs/07 §20)
/** mật khẩu phòng: 4–40 ký tự sau khi chuẩn hoá NFC + bỏ khoảng trắng hai đầu (bàn phím VN gõ NFD, dán từ Zalo dính dấu cách) */
const PASS_MIN = 4;
const PASS_MAX = 40;
/** scrypt: ~16 MiB / lần, ~50 ms — chạy trên thread pool của libuv (chung với DNS, đọc file) nên giới hạn số lần cùng lúc */
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 } as const;
const SCRYPT_MAX_INFLIGHT = 2;
/** vé vào lại (rt): sống 30 ngày, mỗi máy (ck) một vé, phòng giữ tối đa cap × 5 vé */
const PRIV_TOKEN_TTL_MS = 30 * 24 * 3600_000;
const PRIV_KICKED_MAX = 200;
const PRIV_NAME_MAX = 30;
/** thử mật khẩu: 10 lần / 10 phút / mạng (mọi phòng), 20 lần / 10 phút / phòng */
const ATTEMPT_WINDOW_MS = 10 * 60_000;
const ATTEMPTS_PER_NET = 10;
const ATTEMPTS_PER_ROOM = 20;
/** chủ phòng đổi mật khẩu: tối đa 5 lần / 10 phút / phòng (mỗi lần một phép băm scrypt — không cho ai giữ chật máy băm) */
const PASS_CHANGES_PER_ROOM = 5;
/** thay đổi quan trọng của phòng riêng (đổi mật khẩu, mời ra) → lưu rooms.json trong ≤ 1 s, gộp nhiều thay đổi một lần ghi */
const SAVE_SOON_MS = 1000;
const PRIV_INPUT = new Set<ClientMsg['t']>(['move', 'chat', 'act', 'emo', 'q_add', 'vote', 'proom_op', 'back']);
const TXT_BUSY = 'Máy chủ đang bận, thử lại sau vài giây nhé.';
const TXT_BAD_PASS = 'Mật khẩu chưa đúng — xem lại tin nhắn bạn bè gửi nhé.';
const TXT_KICKED = 'Chủ phòng đã mời bạn ra khỏi phòng này.';
const TXT_NO_CK = 'Trình duyệt chưa có mã thiết bị — tải lại trang rồi thử lại nhé.';
const TXT_PASS_LEN = `Mật khẩu phòng cần ${PASS_MIN}–${PASS_MAX} ký tự.`;
const TXT_RATE = 'Sai nhiều lần quá — đợi 10 phút rồi thử lại nhé.';
const TXT_ADMIN_HERE = '🛡 Quản trị viên rạp đang xem phòng này.';

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const HEX_RE = (min: number, max: number): RegExp => new RegExp(`^[a-f0-9]{${min},${max}}$`);
const CK_RE = HEX_RE(16, 64);
const HEX64_RE = HEX_RE(64, 64);

/** kết quả cổng vào phòng riêng (privEntry) */
export type PrivVerdict = 'ok' | 'need' | 'gone' | 'kicked' | 'full';

/**
 * vé vào lại: chỉ giữ băm sha256 của vé (vé thật nằm ở localStorage vc.rt của máy đó), gắn với BĂM khoá máy (ckh) — file
 * rooms.json lọt ra ngoài cũng không có vé thật hay khoá máy thật để giả làm thành viên / chủ phòng
 */
export interface PrivToken { h: string; ckh: string; at: number }

/** trạng thái riêng của phòng riêng (lưu rooms.json khoá `priv` — trừ closed / pending) */
export interface PrivState {
  name: string;
  venue: string;
  cap: number;
  /** scrypt(mật khẩu, salt) — hex 64 / salt hex 32; không bao giờ lưu / log mật khẩu thật */
  passHash: string;
  salt: string;
  /** tăng mỗi lần đổi mật khẩu: phép kiểm đang chạy dở với mật khẩu cũ bị huỷ */
  passVer: number;
  /**
   * băm sha256 khoá máy của chủ phòng (chủ phòng vào lại không cần mật khẩu / vé — so bằng băm, không giữ khoá thật) +
   * mạng / dải mạng đã tạo phòng (băm có muối) để giới hạn số phòng
   */
  ownerCkH: string;
  ownerNet: string;
  ownerSubnet: string;
  createdAt: number;
  tokens: PrivToken[];
  /** băm khoá máy bị chủ phòng mời ra (không vào lại được kể cả có mật khẩu) */
  kickedCkH: string[];
  /** lần cuối có người trong phòng thao tác (lâu quá thì tạm dừng video rồi đóng phòng) */
  lastInput: number;
  closed: boolean;
  /** số lượt vào đang dở (đang kiểm mật khẩu cho người sẽ chuyển vào ngay) — giữ chỗ */
  pending: number;
}

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
  /** mạng (IPv4 /32, IPv6 /64) băm — khoá cho mọi giới hạn phòng riêng */
  net: string;
  /** dải mạng (IPv4 /24, IPv6 /48) băm — giới hạn thêm số phòng riêng đang mở (PRIVATE_PER_SUBNET) */
  subnet: string;
  /** đang băm mật khẩu phòng riêng cho kết nối này (mỗi kết nối tối đa một phép băm cùng lúc) */
  privBusy: boolean;
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
  /** mốc chuyển sang ẩn (điện thoại chuyển app / tắt màn hình: trang ẩn) — 0 = đang có mặt. Người khác không thấy nhân vật */
  away: number;
  token: string;
  ck: string;
  /** sha256(ck) — so với chủ phòng / vé / người bị mời ra / người thêm video (nơi lưu đĩa chỉ có băm) */
  ckh: string;
  /**
   * kết nối của nhân vật này là quản trị viên rạp (đặt lúc vào / nối lại, GIỮ khi mất mạng): ở phòng riêng của NGƯỜI KHÁC
   * (Room.inspects) không chiếm chỗ, không giữ phòng khỏi tự đóng, chủ phòng không mời ra được, cả phòng thấy 🛡. Trong phòng
   * do chính họ tạo thì là thành viên bình thường (chủ rạp xem phim riêng với người yêu không bị gắn 🛡)
   */
  admin: boolean;
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
  /** thao tác phòng riêng (dừng / phát tiếp / lệnh chủ phòng): dồn 3, hồi 1 / 2 s */
  opBucket: Bucket;
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
  /** sha256(khoá máy) người thêm — nhận lại quyền với video của mình sau khi vào lại / server khởi động lại ('' = không có) */
  byCkH: string;
  addedAt: number;
  /** chưa rõ độ dài (kiểm cơ bản bằng oEmbed — không có / không dùng được YT_API_KEY) */
  unk?: boolean;
  /**
   * chỉ qua kiểm cơ bản (oEmbed): GIỮ luôn (vid_dur chỉ bỏ `unk`) — video này theo giới hạn của rạp chung ở mọi phòng (cả
   * phòng riêng: 15 phút / admin 240, live LIVE_MAX_MINUTES); 12 giờ của phòng riêng chỉ dành cho video Data API kiểm đủ
   */
  basic?: boolean;
  /** giây chiếu tối đa cho lượt này (video `unk`; video biết độ dài đã bị chặn > giới hạn lúc thêm) */
  cap?: number;
  /** admin thêm: người thường không bỏ phiếu bỏ qua được, báo cáo không tự gỡ (admin vẫn được báo) */
  byAdmin?: boolean;
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

/**
 * một mục hàng chờ / video đang chiếu đọc từ rooms.json (null = sai dạng). Bản trước lưu khoá máy THẬT của người thêm
 * (`byCk`) → đổi sang băm `byCkH` ngay lúc nạp, không giữ khoá thật (lần lưu sau file không còn khoá thật nào)
 */
function readItem(raw: unknown): QueueItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Partial<QueueItem> & { byCk?: unknown };
  if (typeof x.v !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(x.v) || typeof x.qid !== 'number' || typeof x.title !== 'string'
    || typeof x.dur !== 'number') return null;
  const { byCk, ...rest } = x;
  const byCkH = typeof x.byCkH === 'string' && HEX64_RE.test(x.byCkH) ? x.byCkH
    : typeof byCk === 'string' && CK_RE.test(byCk) ? sha256hex(byCk) : '';
  return { ...rest, byCkH } as QueueItem;
}

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
  durReports = new Map<string, { d: number; live: boolean }>(); // máy báo độ dài thật của video `unk` đang chiếu
  chat: ChatInfo[] = [];
  emptySince: number;

  /** rạp (chủ đề vẽ) + số thứ tự bản sao (1 = bản chính, không bao giờ đóng). Phòng riêng: rạp chủ phòng chọn, n = 1 */
  readonly venue: string;
  readonly n: number;
  /** phòng riêng (có mật khẩu) — null = phòng chung. Phòng riêng vẫn nằm trong Hub.rooms (gỡ video, cấm… áp dụng như thường) */
  readonly priv: PrivState | null;
  /**
   * phòng riêng: kết nối admin (cid) đã được báo "🛡 …" cho cả phòng trong lần vào này — kết nối rời phòng (sang phòng
   * khác, mất kết nối) thì xoá, vào lại là báo lại; đứng xem rồi vào hẳn trên cùng kết nối chỉ báo một lần
   */
  readonly adminSeen = new Set<number>();
  /** phòng riêng: lần cuối báo chủ phòng "có người nhập sai mật khẩu nhiều lần" */
  rateNoticeAt = 0;

  /** từ lúc phòng hết video + hàng chờ trống (0 = đang có video) — quá DEFAULT_IDLE_SECONDS thì phát video mặc định */
  idleSince = 0;
  /** admin bỏ qua video mặc định → tạm không phát lại ở phòng này */
  fillerOffUntil = 0;

  constructor(readonly hub: Hub, readonly id: string, priv?: PrivState) {
    if (priv) {
      if (!PRIVATE_ROOM_RE.test(id) || !venueById(priv.venue)) throw new Error(`phòng riêng sai: ${id}`);
      this.priv = priv;
      this.venue = priv.venue;
      this.n = 1;
    } else {
      const r = parseRoomId(id);
      if (!r) throw new Error(`id phòng sai: ${id}`);
      this.priv = null;
      this.venue = r.venue.id;
      this.n = r.n;
    }
    this.emptySince = Date.now();
  }

  get name(): string { return this.priv ? this.priv.name : roomName(this.id); }

  /** sức chứa: phòng riêng do chủ phòng đặt, phòng chung theo ROOM_CAPACITY */
  capacity(): number { return this.priv ? this.priv.cap : this.hub.cfg.roomCapacity; }

  /**
   * số chỗ đang bị chiếm: phòng riêng tính MỌI thành viên (kể cả đang ẩn / mất mạng — vẫn giữ chỗ, quay lại không bị đẩy
   * thành quá số người) + lượt vào đang dở, KHÔNG tính quản trị viên rạp; phòng chung không tính người đang ẩn (như count)
   */
  occupancy(): number { return this.priv ? this.members() + this.priv.pending : this.count(); }

  /**
   * thành viên phòng riêng chiếm chỗ: mọi nhân vật (kể cả đang ẩn / mất mạng) trừ quản trị viên rạp — admin vào xử lý báo
   * cáo không làm bạn bè hết chỗ, không giữ phòng khỏi tự đóng khi mọi người đã về
   */
  members(): number {
    let n = 0;
    for (const p of this.players.values()) if (this.isMember(p)) n++;
    return n;
  }

  /**
   * nhân vật này chiếm một chỗ của phòng riêng: không phải quản trị viên rạp — hoặc là quản trị viên nhưng chính là CHỦ
   * PHÒNG (chủ rạp dùng phòng riêng của mình bằng trình duyệt có cookie admin: vẫn chiếm chỗ, vẫn giữ phòng khỏi tự đóng
   * lúc ngồi chờ bạn bè; dấu 🛡 vẫn hiện cho cả phòng). Client đếm giống vậy (store.memberCount: adm trừ chủ phòng)
   */
  isMember(p: Player): boolean {
    return !this.inspects(p);
  }

  /**
   * quản trị viên rạp đang ở phòng riêng của NGƯỜI KHÁC (vào thẳng không cần mật khẩu để xử lý báo cáo / vi phạm): không
   * chiếm chỗ, luôn ghi rõ 🛡 cho cả phòng. Chủ phòng là admin (chủ rạp dùng phòng riêng của mình) → không tính
   */
  inspects(p: Player): boolean {
    return p.admin && !!this.priv && p.ckh !== this.priv.ownerCkH;
  }

  /** số kết nối quản trị viên đang ĐỨNG XEM phòng này (không có nhân vật) */
  adminWatchers(): number {
    let n = 0;
    for (const c of this.spectators) if (c.admin && !c.player && !c.closed) n++;
    return n;
  }

  /** có quản trị viên rạp trong phòng: đang đứng xem, hoặc có nhân vật (kể cả đang ẩn / mất mạng — vẫn hiện trong danh sách) */
  adminPresent(): boolean {
    if (this.adminWatchers() > 0) return true;
    for (const p of this.players.values()) if (this.inspects(p)) return true;
    return false;
  }

  /** người đang ở trong phòng (tính cả người đang kết nối lại, không tính người đang ẩn) */
  count(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.away) n++;
    return n;
  }
  present(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conn && !p.away) n++;
    return n;
  }
  /** số mạng (IP băm) khác nhau đang có mặt */
  presentIps(): number {
    const s = new Set<string>();
    for (const p of this.players.values()) if (p.conn && !p.away) s.add(p.ipHash);
    return s.size;
  }

  info(): RoomInfo {
    return { id: this.id, name: this.name, venue: this.venue, now: this.now?.title ?? '', count: this.count(), cap: this.capacity() };
  }

  /** danh sách phòng công khai đổi (số người, video đang chiếu) — phòng riêng không có trong danh sách nên khỏi báo */
  listChanged(): void {
    if (!this.priv) this.hub.roomsChanged();
  }

  /**
   * phòng riêng: thông tin cho thành viên (chủ phòng có mặt không, ai đang ẩn / mất mạng) + quản trị viên đang có mặt là
   * TRẠNG THÁI (không chỉ một lời báo lúc vào): `adm` cho người vào hẳn, `admins` = số kết nối admin đang đứng xem
   */
  privInfo(): PrivInfo | null {
    const pv = this.priv;
    if (!pv) return null;
    let ownerId = 0;
    const members = [...this.players.values()].map((p) => {
      if (p.ckh === pv.ownerCkH) ownerId = p.id;
      // quản trị viên vào phòng người khác: ghi rõ cho cả phòng, không tính chỗ, chủ phòng không mời ra được
      return { id: p.id, name: p.name, away: p.away > 0, ghost: !p.conn, ...(this.inspects(p) ? { adm: true } : {}) };
    });
    const admins = this.adminWatchers();
    return { name: pv.name, cap: pv.cap, ownerId, members, ...(admins ? { admins } : {}) };
  }

  /** phòng riêng: báo cả phòng thông tin mới (người vào / ra / ẩn / mất mạng, đổi số người tối đa) */
  sendPriv(except?: Conn): void {
    const priv = this.privInfo();
    if (priv && !this.priv!.closed) this.broadcast({ t: 'priv', priv }, except);
  }

  /** giây chiếu tối đa một video (người thêm là admin hay không): phòng riêng coi như không giới hạn (PRIVATE_MAX_VIDEO_MINUTES) */
  maxSeconds(admin: boolean): number {
    const c = this.hub.cfg;
    if (this.priv) return Math.max(c.privateMaxVideoMinutes, admin ? c.adminMaxVideoMinutes : 0) * 60;
    return (admin ? c.adminMaxVideoMinutes : c.maxVideoMinutes) * 60;
  }

  /** số video chờ tối đa mỗi người (admin không giới hạn) */
  perUser(): number {
    return this.priv ? this.hub.cfg.privatePerUser : this.hub.cfg.maxQueuePerUser;
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
    return {
      qid: q.qid, v: q.v, title: q.title, ch: q.ch, dur: q.dur, live: q.live, by: q.by, byId: q.byId,
      ...(q.unk ? { unk: true } : {}), ...(q.byAdmin ? { adm: true } : {}),
    };
  }

  nowInfo(): NowInfo | null {
    const n = this.now;
    if (!n) return null;
    return { ...this.itemInfo(n), at: n.at, paused: n.paused, pos: n.pos, ends: n.ends, ...(n.filler ? { filler: true } : {}) };
  }

  snapshot(now: number): RoomSnapshot {
    const priv = this.privInfo();
    return {
      id: this.id,
      name: this.name,
      venue: this.venue,
      players: [...this.players.values()].filter((p) => !p.away).map((p) => this.playerInfo(p, now)),
      queue: this.queue.map((q) => this.itemInfo(q)),
      locked: this.locked,
      now: this.nowInfo(),
      votes: { n: this.votes.size, need: this.votesNeeded() },
      chat: this.chat.slice(-CHAT_SEND),
      ...(priv ? { priv } : {}),
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
    this.listChanged();
    this.sendPriv(p.conn ?? undefined); // người vừa vào nhận priv trong snapshot của welcome
    this.sendVotesIfNeedChanged();
  }

  removePlayer(p: Player): void {
    if (!this.players.delete(p.id)) return;
    this.broadcast({ t: 'pl', id: p.id });
    if (this.votes.delete(p.id)) this.votesChanged();
    else this.sendVotesIfNeedChanged();
    // phòng riêng "trống" = hết thành viên (quản trị viên còn lại không tính; Hub.privLifecycle cũng giữ mốc này mỗi nhịp)
    if (this.priv ? this.isMember(p) && this.members() === 0 : this.players.size === 0) this.emptySince = Date.now();
    this.listChanged();
    this.sendPriv();
  }

  private lastNeed = -1;
  sendVotesIfNeedChanged(): void {
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
  /**
   * thời gian chiếu một lượt (ms): live = LIVE_MAX_MINUTES (phòng riêng: giới hạn độ dài của phòng — xem chung live bao lâu
   * tuỳ cả phòng — nhưng chỉ với video Data API đã kiểm đủ; video chỉ qua kiểm cơ bản vẫn LIVE_MAX_MINUTES); chưa rõ độ
   * dài = giới hạn `cap`; còn lại = độ dài (≤ cap)
   */
  playMs(q: QueueItem): number {
    if (q.live) return this.priv && !q.basic ? this.maxSeconds(!!q.byAdmin) * 1000 : this.hub.cfg.liveMaxMinutes * 60_000;
    const cap = q.cap && q.cap > 0 ? q.cap : Infinity;
    if (q.unk) return (Number.isFinite(cap) ? cap : this.hub.cfg.maxVideoMinutes * 60) * 1000;
    return Math.min(q.dur, cap) * 1000;
  }

  /** chiếu bài kế (hoặc dừng nếu hết hàng chờ) */
  next(now: number): void {
    const item = this.queue.shift() ?? null;
    this.votes.clear();
    this.reports.clear();
    this.errReports.clear();
    this.durReports.clear();
    if (!item) {
      this.now = null;
    } else {
      const at = now + PRELOAD_MS;
      this.now = { ...item, at, paused: false, pos: 0, ends: at + this.playMs(item) + END_GRACE_MS };
    }
    this.sendNow();
    this.sendQueue();
    this.votesChanged();
    this.hub.dirty = true;
    this.listChanged(); // bảng chọn rạp hiện "đang chiếu gì"
  }

  /** phát video mặc định (kênh trực tiếp của rạp) — phát liên tục tới khi có người thêm video */
  playDefault(now: number): boolean {
    const m = this.hub.defaultVideoFor(now);
    if (!m || now < this.fillerOffUntil) return false;
    this.votes.clear();
    this.reports.clear();
    this.errReports.clear();
    this.durReports.clear();
    this.now = {
      qid: 0, v: m.v, title: m.title, ch: m.ch, dur: 0, live: true, by: 'Rạp', byId: 0, byCkH: '', addedAt: now,
      at: now + PRELOAD_MS, paused: false, pos: 0, ends: Number.MAX_SAFE_INTEGER, filler: true,
    };
    this.sendNow();
    this.votesChanged();
    this.listChanged();
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
    n.ends = n.at + this.playMs(n) + END_GRACE_MS;
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
    // trống video quá DEFAULT_IDLE_SECONDS → phát video mặc định (phòng riêng thì không: hai người đang chờ nhau mà tự
    // dưng phát một kênh lạ có tiếng)
    if (this.priv) {
      this.idleSince = 0;
    } else if (!this.now && !this.queue.length) {
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
  /** kết quả oEmbed (kiểm cơ bản khi không dùng được Data API): giữ 30 phút, tối đa 2000 */
  private oembedCache = new Map<string, { at: number; r: OEmbedResult }>();
  private noKeyWarned = false;
  private apiWindow = new WindowCounter(60_000, 120);
  private apiIpWindow: WindowCounter;
  private reportSeen = new Map<string, number>();
  private lastSweep = 0;
  private joinWindow: WindowCounter;
  /** phòng riêng: lần tạo / giờ / mạng; lần thử mật khẩu / 10 phút theo mạng và theo phòng; số phép băm đang chạy */
  private privCreateWindow: WindowCounter;
  private privNetAttempts = new WindowCounter(ATTEMPT_WINDOW_MS, ATTEMPTS_PER_NET);
  private privRoomAttempts = new WindowCounter(ATTEMPT_WINDOW_MS, ATTEMPTS_PER_ROOM);
  /** lần đổi mật khẩu / 10 phút / phòng */
  private privPassChanges = new WindowCounter(ATTEMPT_WINDOW_MS, PASS_CHANGES_PER_ROOM);
  private scryptInFlight = 0;
  private recentReports: ReportEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private saveSoonTimer: NodeJS.Timeout | null = null;
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
    this.privCreateWindow = new WindowCounter(3600_000, cfg.privateCreatePerHour);
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
      privMax: c.privateCapMax, privMaxMin: c.privateMaxVideoMinutes, privPerUser: c.privatePerUser,
      privEmptyMin: Math.ceil(c.privateEmptySeconds / 60),
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
    if (this.saveSoonTimer) clearTimeout(this.saveSoonTimer);
    if (this.roomsTimer) clearTimeout(this.roomsTimer);
    if (this.defaultTimer) clearInterval(this.defaultTimer);
    this.timer = this.saveTimer = this.saveSoonTimer = this.roomsTimer = this.defaultTimer = null;
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
      if (room.priv || room.n === 1 || room.players.size > 0 || now - room.emptySince < ROOM_IDLE_CLOSE_MS) continue;
      const main = this.rooms.get(room.venue);
      this.rooms.delete(room.id);
      for (const c of room.spectators) if (main && !c.player) { c.room = main; main.spectators.add(c); this.sendHello(c); }
      this.roomsChanged();
      this.dirty = true;
    }
    // phòng riêng hết hạn: đóng trong nhịp này, lưu MỘT lần cho cả nhịp (khởi động lại xong 10 phút, các phòng khôi phục
    // mà không ai vào lại hết hạn cùng lúc — mỗi phòng ghi rooms.json một lần là nghẽn đĩa vô ích)
    let closedAny = false;
    for (const room of [...this.rooms.values()]) {
      if (!room.priv || room.priv.closed) continue;
      try { if (this.privLifecycle(room, now)) closedAny = true; } catch (e) { console.error(`[room ${room.id}] vòng đời phòng riêng lỗi:`, e); }
    }
    if (closedAny) this.save();
  }

  /**
   * Vòng đời phòng riêng: không còn ai quá PRIVATE_EMPTY_SECONDS → đóng (không cần báo ai); lâu không ai thao tác →
   * tạm dừng video (live để chạy tới hết lượt) rồi tới PRIVATE_IDLE_CLOSE_MINUTES thì đóng — một socket treo không giữ
   * phòng mãi được. true = vừa đóng phòng (chưa lưu — tick lưu một lần)
   */
  private privLifecycle(room: Room, now: number): boolean {
    const pv = room.priv!;
    const c = this.cfg;
    // "trống" = không còn thành viên (quản trị viên ở lại một mình không giữ phòng — đóng phòng thì họ cũng về rạp chung).
    // Còn thành viên thì mốc trống luôn là bây giờ: hết thành viên bằng đường nào (rời, mất mạng, …) cũng đếm đúng từ đó
    if (room.members() > 0) room.emptySince = now;
    else if (now - room.emptySince >= c.privateEmptySeconds * 1000) {
      this.closePrivate(room, 'Phòng riêng đã đóng vì không còn ai trong phòng.', 'không còn ai', false);
      return true;
    }
    const idle = now - pv.lastInput;
    if (idle >= c.privateIdleCloseMinutes * 60_000) {
      this.closePrivate(room, 'Phòng riêng đã đóng vì lâu không ai thao tác.', 'lâu không ai thao tác', false);
      return true;
    }
    const n = room.now;
    if (idle >= c.privateIdlePauseMinutes * 60_000 && n && !n.paused && !n.live && !n.filler && room.pause(now)) {
      room.broadcast({ t: 'notice', kind: 'info', text: '⏸ Đã tạm dừng vì lâu không ai thao tác — bấm ▶ để xem tiếp.' });
    }
    return false;
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
      const all = [...this.rooms.values()];
      writeJsonAtomic(f, {
        savedAt: Date.now(), qid: this.qid, pid: this.pid,
        // video mặc định không lưu (khởi động lại thì tự phát lại sau DEFAULT_IDLE_SECONDS)
        rooms: all.filter((r) => !r.priv).map((r) => ({ id: r.id, queue: r.queue, now: r.now?.filler ? null : r.now, locked: r.locked })),
        // phòng riêng: khoá riêng (bản cũ không biết khoá này thì bỏ qua). Chỉ có BĂM: mật khẩu (scrypt), vé, khoá máy chủ
        // phòng / người có vé / người bị mời ra / người thêm video (sha256) — file lọt ra ngoài cũng không vào được phòng
        priv: all.filter((r) => r.priv && !r.priv.closed).map((r) => {
          const pv = r.priv!;
          return {
            id: r.id, venue: pv.venue, name: pv.name, cap: pv.cap, passHash: pv.passHash, salt: pv.salt, passVer: pv.passVer,
            ownerCkH: pv.ownerCkH, ownerNet: pv.ownerNet, ownerSubnet: pv.ownerSubnet, createdAt: pv.createdAt,
            tokens: pv.tokens.map((t) => ({ h: t.h, ckh: t.ckh, at: t.at })), kickedCkH: pv.kickedCkH,
            lastInput: pv.lastInput, queue: r.queue, now: r.now?.filler ? null : r.now, locked: r.locked,
          };
        }),
        blocked: [...this.blocked.values()],
      });
    } catch (e) {
      console.error('[data] Không lưu được rooms.json:', e instanceof Error ? e.message : e);
    }
  }

  /**
   * lưu SỚM (≤ 1 s) sau thay đổi phòng riêng cần chắc chắn có trên đĩa (đổi mật khẩu, mời ra): gộp mọi thay đổi trong
   * khoảng đó thành MỘT lần ghi — nhiều chủ phòng bấm liên tục cũng không bắt server ghi cả rooms.json mỗi lần
   */
  private saveSoon(): void {
    this.dirty = true;
    if (this.saveSoonTimer || !this.file('rooms.json')) return;
    this.saveSoonTimer = setTimeout(() => { this.saveSoonTimer = null; if (this.dirty) this.save(); }, SAVE_SOON_MS);
    this.saveSoonTimer.unref?.();
  }

  private load(): void {
    const f = this.file('rooms.json');
    if (!f) return;
    const raw = readJson(f);
    if (!raw || typeof raw !== 'object') return;
    const o = raw as { qid?: unknown; pid?: unknown; rooms?: unknown; priv?: unknown; blocked?: unknown };
    if (typeof o.qid === 'number' && Number.isFinite(o.qid)) this.qid = o.qid;
    // id người tiếp tục tăng sau khi khởi động lại (không trùng byId của video khôi phục)
    if (typeof o.pid === 'number' && Number.isFinite(o.pid)) this.pid = o.pid;
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
        room.queue = this.loadQueue(rr.queue);
        room.locked = rr.locked === true;
        room.now = this.loadNow(rr.now, Date.now());
        this.rooms.set(id, room);
      }
    }
    // phòng riêng: kiểm TỪNG trường (file có thể bị sửa tay / hỏng) — sai là bỏ cả phòng; tối đa PRIVATE_ROOMS_MAX phòng.
    // Khôi phục xong được hưởng trọn thời gian chờ (emptySince / lastInput = lúc khởi động) để mọi người kịp vào lại.
    let nPriv = 0;
    if (Array.isArray(o.priv)) {
      for (const e of o.priv) {
        if (nPriv >= this.cfg.privateRoomsMax) break;
        const room = this.loadPrivRoom(e);
        if (!room || this.rooms.has(room.id)) continue;
        this.rooms.set(room.id, room);
        nPriv++;
      }
    }
    const nQ = [...this.rooms.values()].reduce((s, r) => s + r.queue.length + (r.now ? 1 : 0), 0);
    if (nQ || nPriv) this.log(`💾 Khôi phục ${this.rooms.size - nPriv} phòng chung + ${nPriv} phòng riêng, ${nQ} video (đang chiếu + hàng chờ)`);
  }

  /** hàng chờ đọc từ rooms.json: đúng dạng (readItem), bỏ video đã bị gỡ, tối đa MAX_QUEUE */
  private loadQueue(raw: unknown): QueueItem[] {
    if (!Array.isArray(raw)) return [];
    const out: QueueItem[] = [];
    for (const x of raw) {
      const q = readItem(x);
      if (q && !this.blocked.has(q.v)) out.push(q);
    }
    return out.slice(0, this.cfg.maxQueue);
  }

  /** video đang chiếu đọc từ rooms.json: chỉ khôi phục nếu đang dừng hoặc chưa hết giờ (`at` là giờ tuyệt đối) */
  private loadNow(raw: unknown, now: number): NowPlaying | null {
    const q = readItem(raw);
    const np = raw as Partial<NowPlaying> | null;
    if (!q || !np || typeof np.at !== 'number' || typeof np.ends !== 'number' || this.blocked.has(q.v)) return null;
    if (!np.paused && now >= np.ends) return null;
    return { ...(q as NowPlaying), paused: np.paused === true, pos: Number(np.pos) || 0 };
  }

  /** một phòng riêng trong rooms.json → Room (null = sai dạng, bỏ) */
  private loadPrivRoom(e: unknown): Room | null {
    if (!e || typeof e !== 'object') return null;
    const r = e as Record<string, unknown>;
    const now = Date.now();
    const s = (v: unknown, re: RegExp): string | null => (typeof v === 'string' && re.test(v) ? v : null);
    const id = s(r.id, PRIVATE_ROOM_RE);
    const venue = typeof r.venue === 'string' && venueById(r.venue) ? r.venue : null;
    const name = cleanText(r.name, PRIV_NAME_MAX);
    const cap = typeof r.cap === 'number' && Number.isInteger(r.cap) && r.cap >= 2 ? Math.min(r.cap, this.cfg.privateCapMax) : 0;
    const passHash = s(r.passHash, HEX64_RE);
    const salt = s(r.salt, HEX_RE(32, 32));
    const ownerCkH = s(r.ownerCkH, HEX64_RE);
    if (!id || !venue || !name || !cap || !passHash || !salt || !ownerCkH) return null;
    const passVer = typeof r.passVer === 'number' && Number.isInteger(r.passVer) && r.passVer >= 0 ? r.passVer : 0;
    // vé: đúng dạng (băm vé + băm khoá máy), chưa hết hạn, mỗi máy một vé (giữ vé mới nhất), tối đa cap × 5
    const byCkh = new Map<string, PrivToken>();
    for (const t of Array.isArray(r.tokens) ? r.tokens : []) {
      const x = t as Partial<PrivToken> | null;
      if (!x || typeof x !== 'object' || typeof x.h !== 'string' || !HEX64_RE.test(x.h) || typeof x.ckh !== 'string'
        || !HEX64_RE.test(x.ckh) || typeof x.at !== 'number' || !(now - x.at < PRIV_TOKEN_TTL_MS)) continue;
      const old = byCkh.get(x.ckh);
      if (!old || old.at < x.at) byCkh.set(x.ckh, { h: x.h, ckh: x.ckh, at: x.at });
    }
    const tokens = [...byCkh.values()].sort((a, b) => a.at - b.at).slice(-cap * 5);
    const kickedCkH = (Array.isArray(r.kickedCkH) ? r.kickedCkH : [])
      .filter((k): k is string => typeof k === 'string' && HEX64_RE.test(k)).slice(-PRIV_KICKED_MAX);
    const room = new Room(this, id, {
      name, venue, cap, passHash, salt, passVer, ownerCkH,
      ownerNet: s(r.ownerNet, HEX_RE(8, 64)) ?? '',
      ownerSubnet: s(r.ownerSubnet, HEX_RE(8, 64)) ?? '',
      createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : now,
      tokens, kickedCkH, lastInput: now, closed: false, pending: 0,
    });
    room.queue = this.loadQueue(r.queue);
    room.locked = r.locked === true;
    room.now = this.loadNow(r.now, now);
    room.emptySince = now;
    return room;
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

  /** phòng CHUNG theo thứ tự rạp (VENUES) rồi số bản sao — phòng riêng không bao giờ có ở đây */
  private sortedRooms(): Room[] {
    const order = (r: Room): number => VENUES.findIndex((v) => v.id === r.venue) * 100 + r.n;
    return [...this.rooms.values()].filter((r) => !r.priv).sort((a, b) => order(a) - order(b));
  }

  roomList(): RoomInfo[] {
    return this.sortedRooms().map((r) => r.info());
  }

  /** phòng chung theo id; id phòng riêng (hoặc không có) → null. Mọi id client gửi lên đi qua đây hoặc privEntry */
  publicRoom(id: string | undefined): Room | null {
    if (!id || isPrivateRoomId(id)) return null;
    const r = this.rooms.get(id);
    return r && !r.priv ? r : null;
  }

  /**
   * Phòng CHUNG cho người sắp vào: `preferred` còn chỗ → nó; đầy → bản sao còn chỗ của cùng rạp, chưa có thì mở bản sao
   * mới (tối đa MAX_ROOMS bản mỗi rạp); hết cách → phòng còn chỗ bất kỳ (theo thứ tự rạp); đầy hết → null. Không bao giờ
   * trả phòng riêng (id phòng riêng phải qua privEntry).
   */
  pickRoom(preferred?: string): Room | null {
    const cap = this.cfg.roomCapacity;
    const pref = this.publicRoom(preferred);
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
  connect(sock: Sock, meta: { ipHash: string; net?: string; subnet?: string; admin: boolean; room?: string }): Conn | null {
    const n = this.ipConns.get(meta.ipHash) ?? 0;
    if (n >= this.cfg.maxConnPerIp || this.conns.size >= MAX_CONNS) return null;
    this.ipConns.set(meta.ipHash, n + 1);
    const net = meta.net || meta.ipHash;
    const c: Conn = {
      cid: ++this.cid, sock, ipHash: meta.ipHash, net, subnet: meta.subnet || net, privBusy: false, admin: meta.admin,
      room: null, player: null, bucket: new Bucket(120, 70), strikes: 0, closed: false, // gửi vị trí 30 lần / giây + ping + chat
    };
    this.conns.add(c);
    // link ?phong=<phòng riêng>: chỉ admin được đứng xem thẳng; người thường đứng xem phòng chung mặc định trong lúc
    // nhập mật khẩu (proom_need) — không ai nghe lén được phòng riêng
    let room: Room | null = null;
    let need: { room: string; exists: boolean } | null = null;
    if (meta.room && isPrivateRoomId(meta.room)) {
      const pr = this.rooms.get(meta.room) ?? null;
      const v = this.privEntry(c, pr, '');
      if (v === 'ok') room = pr;
      else need = { room: meta.room, exists: v !== 'gone' };
    } else if (meta.room) {
      // link ?phong=<id>: đúng phòng đó, bản sao đã đóng thì về phòng chính của rạp
      room = this.publicRoom(meta.room) ?? this.publicRoom(parseRoomId(meta.room)?.venue.id);
    }
    if (!room) room = (need ? null : this.pickRoom()) || this.rooms.get(DEFAULT_VENUE)!;
    this.setConnRoom(c, room);
    this.sendHello(c);
    if (need) this.send(c, { t: 'proom_need', ...need });
    this.announceAdmin(room, c);
    return c;
  }

  /**
   * phòng kết nối đang xem / đang ở: bỏ khỏi người đứng xem phòng cũ (leaveRoom), thêm vào phòng mới. Cùng phòng → không
   * đổi gì (đứng xem rồi vào hẳn trên cùng kết nối không phải "vào lại")
   */
  private setConnRoom(c: Conn, room: Room): void {
    const old = c.room;
    if (old && old !== room) this.leaveRoom(c, old);
    c.room = room;
    room.spectators.add(c);
  }

  /**
   * kết nối rời phòng `old` (sang phòng khác / mất kết nối). Admin rời phòng riêng: lần sau vào lại được báo lại (adminSeen)
   * và — `notify` — cả phòng nhận priv mới (bớt một quản trị viên đang xem). Gửi thừa một priv khi admin có nhân vật
   * vừa chuyển đi (removePlayer đã gửi) cũng không sao — quan trọng là không bao giờ thiếu.
   */
  private leaveRoom(c: Conn, old: Room, notify = true): void {
    old.spectators.delete(c);
    if (!old.priv || !c.admin) return;
    old.adminSeen.delete(c.cid);
    if (notify) old.sendPriv();
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
    const p = c.player;
    // admin có nhân vật: phòng nhận priv ở dưới (thành viên "mất mạng" / bị bỏ) — khỏi gửi hai lần
    if (c.room) this.leaveRoom(c, c.room, !(p && p.conn === c));
    if (p && p.conn === c) {
      p.conn = null;
      p.ghostSince = Date.now();
      p.m = 0;
      const room = c.room;
      // đang ẩn (người khác vốn không thấy) mà mất kết nối = đã đóng tab / tắt hẳn → bỏ luôn, không hiện "mất mạng"
      if (room && p.away) { room.removePlayer(p); return; }
      if (room && room.players.has(p.id)) {
        room.broadcast({ t: 'pu', p: room.playerInfo(p, Date.now()) });
        room.votes.delete(p.id);
        if (room.now) room.votesChanged(); // ít người hơn → số phiếu cần cũng giảm
        room.sendPriv(); // phòng riêng: thành viên này đang "mất mạng"
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
      case 'switch': return this.onSwitch(c, msg.room, msg.rt, now);
      case 'leave': return this.onLeave(c);
      case 'join': return this.onJoin(c, msg, now);
      case 'adm': return this.onAdmin(c, msg, now);
      // tạo phòng / nhập mật khẩu: đã vào rạp hay chưa đều được (luôn trả lời, kể cả khi lỗi)
      case 'proom_new': void this.onPrivNew(c, msg); return;
      case 'proom_auth': void this.onPrivAuth(c, msg); return;
      default: break;
    }
    const p = c.player;
    const room = c.room;
    if (!p || !room || p.conn !== c) return;
    // phòng riêng: thao tác thật của thành viên giữ phòng "còn người dùng" (đi lại, chat, động tác, thêm video…)
    if (room.priv && PRIV_INPUT.has(msg.t) && (msg.t !== 'move' || msg.m === 1)) room.priv.lastInput = now;
    if (msg.t === 'away') return this.onAway(room, p, now);
    if (p.away) this.onBack(room, p, now); // 'back' hoặc thao tác bất kỳ = đã quay lại
    switch (msg.t) {
      case 'back': return;
      case 'proom_op': void this.onPrivOp(p, msg, now); return;
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
      case 'vid_dur': return this.onVideoDuration(room, p, msg.v, msg.d, msg.live, now);
      default: return;
    }
  }

  private onSpec(c: Conn, id: string): void {
    if (c.player) return;
    let room: Room | null;
    if (isPrivateRoomId(id)) {
      // phòng riêng: chỉ admin đứng xem được (và cả phòng được báo); người thường phải nhập mật khẩu rồi vào hẳn
      const pr = this.rooms.get(id) ?? null;
      const v = this.privEntry(c, pr, '');
      if (v !== 'ok') { this.send(c, { t: 'proom_need', room: id, exists: v !== 'gone' }); return; }
      room = pr;
    } else {
      room = this.publicRoom(id);
    }
    if (!room || room === c.room) return;
    this.setConnRoom(c, room);
    this.sendHello(c);
    this.announceAdmin(room, c);
  }

  /**
   * Đang ở trong rạp mà chuyển sang rạp / phòng khác: không tải lại trang, giữ nguyên nhân vật (id, tên, ngoại hình,
   * token nối lại), xuất hiện ở lối đi cuối rạp mới → gửi welcome với ảnh chụp phòng mới. Rạp đầy / trùng tên → báo, ở yên.
   * Phòng riêng: qua privEntry (chủ phòng / vé rt của máy này / admin).
   */
  private onSwitch(c: Conn, roomId: string, rt: string | undefined, now: number): void {
    const p = c.player;
    const from = p ? this.roomOf(p) : null;
    if (!p || !from || from.id === roomId) return;
    this.moveTo(c, p, from, roomId, now, true, rt);
  }

  /** rời trang (đóng tab, chuyển trang): bỏ nhân vật ngay — người khác không thấy nhân vật "kẹt" lại chờ hết hạn */
  private onLeave(c: Conn): void {
    const p = c.player;
    if (!p) return;
    const room = this.roomOf(p);
    c.player = null;
    p.conn = null;
    if (room) room.removePlayer(p);
    // phòng riêng: hết nhân vật thì cũng hết quyền nghe phòng — kết nối (nếu còn mở) về đứng xem phòng chung
    if (room?.priv && c.room === room && !c.admin) this.spectatePublic(c, room);
  }

  /**
   * Điện thoại chuyển app / tắt màn hình (trang ẩn): nhân vật biến khỏi mắt người khác NGAY (giữ chỗ đứng, không tính vào số
   * người / phiếu); quay lại thì hiện lại đúng chỗ cũ. Đang ẩn mà mất kết nối (đóng tab, hệ điều hành ngắt) → bỏ luôn.
   */
  private onAway(room: Room, p: Player, now: number): void {
    if (p.away) return;
    p.away = now;
    p.m = 0;
    room.broadcast({ t: 'pl', id: p.id }, p.conn ?? undefined);
    if (room.votes.delete(p.id)) room.votesChanged();
    else room.sendVotesIfNeedChanged();
    room.listChanged();
    room.sendPriv(); // phòng riêng: vẫn là thành viên (giữ chỗ), chỉ đang ẩn
  }

  private onBack(room: Room, p: Player, now: number): void {
    if (!p.away) return;
    p.away = 0;
    room.broadcast({ t: 'pj', p: room.playerInfo(p, now) }, p.conn ?? undefined);
    room.sendVotesIfNeedChanged();
    room.listChanged();
    if (room.priv) room.priv.lastInput = now;
    room.sendPriv();
  }

  /** đã có người trùng tên (không phân biệt dấu / hoa thường) trong phòng `to` */
  private nameClash(to: Room, p: Player): boolean {
    for (const q of to.players.values()) if (q !== p && q.key === p.key) return true;
    return false;
  }

  /**
   * nhân vật sang được phòng `roomId` không: phòng chung (cùng rạp mà đầy thì sang bản sao) hoặc phòng riêng (qua
   * privEntry). { to } = được; { err } = lý do từ chối (CHƯA gửi — người gọi gửi đúng lúc: nối lại thì sau welcome);
   * null = không có gì để làm (đang ở đúng phòng đó / id sai)
   */
  private checkMove(c: Conn, p: Player, from: Room, roomId: string, now: number, limit: boolean, rt?: string): { to: Room } | { err: ServerMsg } | null {
    const warn = (text: string): { err: ServerMsg } => ({ err: { t: 'notice', kind: 'warn', text } });
    if (isPrivateRoomId(roomId)) {
      const to = this.rooms.get(roomId) ?? null;
      if (to && to === from) return null;
      const v = this.privEntry(c, to, p.ck, rt);
      if (v !== 'ok' || !to) return { err: this.privRefusal(roomId, v, to) };
      if (limit && !this.joinWindow.hit(c.ipHash, now)) return warn('Chuyển phòng nhanh quá, đợi một chút rồi thử lại nhé.');
      // trùng tên trong phòng riêng: proom_res kèm id phòng (client đang ở màn vào rạp báo ngay trên thẻ, không phải toast)
      if (this.nameClash(to, p)) {
        return { err: { t: 'proom_res', ok: false, code: 'name', room: roomId, text: `Tên "${p.name}" đang có người dùng trong ${to.name} — đổi tên rồi vào nhé.` } };
      }
      return { to };
    }
    const want = parseRoomId(roomId)?.venue.id;
    if (!want) return null;
    if (limit && !this.joinWindow.hit(c.ipHash, now)) return warn('Chuyển rạp nhanh quá, đợi một chút rồi thử lại nhé.');
    const to = this.pickRoom(roomId);
    if (!to || to.venue !== want) return warn(`${roomName(roomId)} đang đầy, thử rạp khác nhé.`);
    if (to === from) return null;
    if (this.nameClash(to, p)) return warn(`Tên "${p.name}" đang có người dùng trong ${to.name} — đổi tên rồi vào nhé.`);
    return { to };
  }

  /** đưa nhân vật sang phòng `roomId` (checkMove → transfer). false = không chuyển được (đã báo người xem) */
  private moveTo(c: Conn, p: Player, from: Room, roomId: string, now: number, limit: boolean, rt?: string): boolean {
    const m = this.checkMove(c, p, from, roomId, now, limit, rt);
    if (!m) return false;
    if ('err' in m) { this.send(c, m.err); return false; }
    this.transfer(c, p, from, m.to, now);
    return true;
  }

  /** chuyển hẳn nhân vật (đã kiểm quyền / chỗ / tên) sang phòng `to`: xuất hiện ở lối đi cuối rạp → welcome */
  private transfer(c: Conn, p: Player, from: Room, to: Room, now: number): void {
    from.removePlayer(p);
    if (c.room !== from) from.spectators.delete(c);
    const sp = spawnPoint();
    p.x = sp.x; p.y = sp.y; p.d = 1; p.m = 0; p.action = null;
    p.ct = 0; p.lastMoveAt = now; p.budget = 0; p.dirty = false;
    p.away = 0; // vừa thao tác (chuyển / vào lại) = đang có mặt — không để "ẩn" mà vẫn hiện trong phòng mới
    this.setConnRoom(c, to);
    to.addPlayer(p, now);
    if (to.priv) to.priv.lastInput = now;
    this.send(c, { t: 'welcome', you: p.id, token: p.token, room: to.id, snap: to.snapshot(now) });
    this.announceAdmin(to, c);
  }

  /** kết nối (không còn nhân vật trong phòng riêng `from`) về đứng xem phòng chính chung của cùng rạp → hello */
  private spectatePublic(c: Conn, from: Room): void {
    const main = this.rooms.get(from.venue) ?? this.rooms.get(DEFAULT_VENUE)!;
    if (c.room !== from) from.spectators.delete(c);
    this.setConnRoom(c, main);
    this.sendHello(c);
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
        p.admin = c.admin; // theo kết nối mới (giữ nguyên khi mất mạng)
        p.look = normalizeLook(msg.look);
        c.player = p;
        this.setConnRoom(c, room);
        // chọn phòng KHÁC phòng nhân vật cũ đang đứng (so id phòng, không so rạp — phòng riêng cùng rạp với phòng chung)
        // → chuyển luôn nếu vào được; không được (đầy, chưa có quyền phòng riêng, trùng tên…) thì nối lại tại chỗ rồi báo lý
        // do SAU welcome (client đang ở màn vào rạp nhận welcome này rồi chờ lý do tới ngay sau để báo trên thẻ)
        const target = msg.room && msg.room !== room.id ? msg.room : '';
        let refusal: ServerMsg | null = null;
        if (target) {
          const m = this.checkMove(c, p, room, target, now, false, msg.rt);
          if (m && 'to' in m) { this.transfer(c, p, room, m.to, now); return; }
          refusal = m?.err ?? null;
        }
        const wasAway = p.away > 0;
        p.away = 0;
        if (room.priv) room.priv.lastInput = now;
        this.send(c, { t: 'welcome', you: p.id, token: p.token, room: room.id, snap: room.snapshot(now) });
        room.broadcast({ t: wasAway ? 'pj' : 'pu', p: room.playerInfo(p, now) }, c);
        room.votesChanged();
        if (wasAway) room.listChanged();
        room.sendPriv(c);
        this.ensureTicket(room, p, c, now);
        this.announceAdmin(room, c);
        if (refusal) this.send(c, refusal);
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
    // phòng riêng: qua cổng privEntry TRƯỚC mọi pickRoom (id phòng riêng không bao giờ lọt vào pickRoom)
    const targetId = msg.room || c.room?.id || '';
    let room: Room | null;
    if (isPrivateRoomId(targetId)) {
      const pr = this.rooms.get(targetId) ?? null;
      const v = this.privEntry(c, pr, msg.ck, msg.rt);
      if (v === 'need') { fail('priv_need', 'Phòng riêng này cần mật khẩu.'); this.send(c, { t: 'proom_need', room: targetId, exists: true }); return; }
      if (v === 'gone') { fail('priv_gone', 'Phòng riêng này đã đóng (mọi người đã rời đi).'); this.send(c, { t: 'proom_need', room: targetId, exists: false }); return; }
      if (v === 'kicked') return fail('priv_kicked', TXT_KICKED);
      if (v === 'full') return fail('full', this.fullText(pr));
      room = pr;
    } else {
      room = this.pickRoom(targetId);
    }
    if (!room) return fail('full', 'Các phòng đều đã đầy, thử lại sau ít phút nhé.');
    const key = nameKey(nc.name);
    for (const p of room.players.values()) {
      if (p.key === key) return fail('name_taken', `Tên "${nc.name}" đang có người dùng trong ${room.name}, chọn tên khác nhé.`);
    }
    const sp = spawnPoint();
    const ck = msg.ck || randomBytes(8).toString('hex');
    const p: Player = {
      id: ++this.pid, name: nc.name, key, look: normalizeLook(msg.look), x: sp.x, y: sp.y, d: 1, m: 0,
      ct: 0, lastMoveAt: now, budget: 0, dirty: false, action: null, conn: c, ghostSince: 0, away: 0,
      token: randomBytes(16).toString('hex'), ck, ckh: sha256hex(ck), admin: c.admin, ipHash: c.ipHash, joinedAt: now, lastCorrAt: 0,
      chatBucket: new Bucket(3, 0.5, now), emoBucket: new Bucket(6, 2.5, now), actBucket: new Bucket(4, 2, now),
      lookBucket: new Bucket(3, 0.2, now), addBucket: new Bucket(2, 1 / this.cfg.queueAddSeconds, now), moveBucket: new Bucket(60, 40, now),
      lastChat: { text: '', at: 0 }, chatStrikes: [], reportBucket: new Bucket(3, 3 / 60, now),
      opBucket: new Bucket(3, 0.5, now),
    };
    c.player = p;
    this.setConnRoom(c, room);
    if (room.priv) room.priv.lastInput = now;
    room.addPlayer(p, now);
    this.adoptItems(p);
    this.send(c, { t: 'welcome', you: p.id, token: p.token, room: room.id, snap: room.snapshot(now) });
    this.announceAdmin(room, c);
  }

  /** video người này thêm trước đó (vd trước khi server khởi động lại, id cũ): nhận lại quyền theo khoá máy */
  private adoptItems(p: Player): void {
    for (const room of this.rooms.values()) {
      let changed = false;
      for (const q of room.queue) if (q.byCkH && q.byCkH === p.ckh && q.byId !== p.id) { q.byId = p.id; changed = true; }
      const nowChanged = !!room.now && !!room.now.byCkH && room.now.byCkH === p.ckh && room.now.byId !== p.id;
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

  /** oEmbed (kiểm cơ bản): có video + cho nhúng; nhớ 30 phút (lỗi mạng thì không nhớ) */
  private async lookupOEmbed(id: string): Promise<OEmbedResult> {
    const now = Date.now();
    const hit = this.oembedCache.get(id);
    if (hit && now - hit.at < OEMBED_TTL_MS) return hit.r;
    let r: OEmbedResult;
    try { r = await this.deps.youtube.fetchOEmbed(id); } catch { r = { ok: false, code: 'network' }; }
    if (r.ok || r.code !== 'network') {
      this.oembedCache.delete(id);
      this.oembedCache.set(id, { at: now, r });
      while (this.oembedCache.size > 2000) this.oembedCache.delete(this.oembedCache.keys().next().value as string);
    }
    return r;
  }

  private queueCountBy(room: Room, p: Player): number {
    return room.queue.filter((q) => q.byId === p.id || (q.byCkH && q.byCkH === p.ckh)).length;
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
    const perUser = room.perUser(); // phòng riêng nới hơn (PRIVATE_PER_USER)
    if (!admin && this.queueCountBy(room, p) >= perUser) {
      return res(false, `Mỗi người chỉ được chờ ${perUser} video — đợi video của bạn chiếu xong đã nhé.`);
    }
    if (room.queue.length >= this.cfg.maxQueue) return res(false, 'Hàng chờ đã đầy, đợi bớt rồi thêm nhé.');
    if (!admin && !p.addBucket.take(1, now)) return res(false, `Thêm chậm thôi — thử lại sau ${Math.ceil(p.addBucket.waitMs(now) / 1000)} giây.`);
    if (!this.cache.get(id) && !this.oembedCache.has(id)) {
      if (!admin && !this.apiIpWindow.hit(p.ipHash, now)) return res(false, 'Bạn kiểm tra nhiều link quá, thử lại sau 1 phút nhé.');
      if (!this.apiWindow.hit('all', now)) return res(false, 'Rạp đang kiểm tra nhiều video quá, thử lại sau 1 phút nhé.');
    }
    // phòng riêng: coi như không giới hạn độ dài (PRIVATE_MAX_VIDEO_MINUTES) — mọi luật khác (công khai, cho nhúng, 18+, VN)
    // giữ nguyên. CHỈ với video Data API kiểm đủ: video chỉ qua kiểm cơ bản theo giới hạn rạp chung ở mọi phòng (basicSec)
    const capSec = room.maxSeconds(admin);
    const basicSec = (admin ? this.cfg.adminMaxVideoMinutes : this.cfg.maxVideoMinutes) * 60;
    // 1) có YT_API_KEY: Data API kiểm đủ luật (công khai, cho nhúng, không 18+, xem được ở VN, độ dài).
    // 2) không có key / key hỏng / hết quota / API trục trặc → KIỂM CƠ BẢN bằng oEmbed (miễn phí, không cần key): có video
    //    + cho nhúng. Video 18+ / chặn VN thì chính trình phát YouTube từ chối lúc tới lượt (vid_err → tự chuyển bài);
    //    độ dài chưa rõ → chiếu tối đa basicSec (= giới hạn rạp chung, kể cả trong phòng riêng: oEmbed không biết video có
    //    công khai không — "không công khai" lọt qua được), máy người xem báo độ dài thật khi bắt đầu phát (onVideoDuration).
    let info: { title: string; ch: string; dur: number; live: boolean; unk: boolean };
    const r = this.deps.youtube.configured ? await this.lookup(id) : null;
    if (r && r.ok) {
      const check = checkMeta(r.meta, { region: this.cfg.ytRegion, maxSeconds: capSec, allowLive: this.cfg.allowLive });
      if (!check.ok) return res(false, check.reason);
      const m = check.meta;
      info = { title: m.title, ch: m.channel, dur: m.live ? 0 : m.durationSec, live: m.live, unk: false };
    } else {
      if (r && !r.ok && !this.noKeyWarned) {
        this.noKeyWarned = true;
        this.log(`⚠️  YouTube Data API không dùng được (${r.code}) — tạm kiểm video cơ bản bằng oEmbed`);
      }
      const o = await this.lookupOEmbed(id);
      if (!o.ok) {
        return res(false, o.code === 'not_embeddable' ? 'Video riêng tư hoặc chủ kênh không cho phát trên trang khác.'
          : o.code === 'missing' ? 'Không tìm thấy video — có thể đã bị xoá hoặc để riêng tư.' : 'Không kiểm tra được video lúc này, thử lại sau nhé.');
      }
      info = { title: o.title, ch: o.channel, dur: 0, live: false, unk: true };
    }
    // kiểm tra lại sau khi chờ mạng (người có thể đã rời phòng / hàng chờ đã đổi)
    if (p.conn !== c || !room.players.has(p.id)) return;
    if (room.now?.v === id || room.queue.some((q) => q.v === id)) return res(false, 'Video này vừa được người khác thêm rồi.');
    if (!admin && this.queueCountBy(room, p) >= perUser) return res(false, `Mỗi người chỉ được chờ ${perUser} video.`);
    if (room.queue.length >= this.cfg.maxQueue) return res(false, 'Hàng chờ đã đầy.');
    const item: QueueItem = {
      qid: ++this.qid, v: id, title: cleanText(info.title, 200) || 'Video không tên', ch: cleanText(info.ch, 100),
      dur: info.dur, live: info.live, by: p.name, byId: p.id, byCkH: p.ckh, addedAt: Date.now(),
      ...(info.unk ? { unk: true, basic: true, cap: basicSec } : {}),
      ...(admin ? { byAdmin: true } : {}),
    };
    room.queue.push(item);
    this.dirty = true;
    const pos = room.queue.length;
    res(true, room.now && !room.now.filler ? `Đã thêm "${item.title}" — thứ ${pos} trong hàng chờ.` : `Đã thêm "${item.title}" — chiếu ngay!`);
    if (!room.now) room.next(Date.now());
    else room.sendQueue();
    room.broadcast({ t: 'notice', kind: 'info', text: `${p.name} vừa thêm "${item.title}"${item.live ? ' (trực tiếp)' : item.unk ? '' : ` · ${fmtDuration(item.dur)}`}` }, c);
  }

  private onQueueDel(room: Room, p: Player, qid: number): void {
    const i = room.queue.findIndex((q) => q.qid === qid);
    if (i < 0) return;
    const q = room.queue[i];
    if (q.byId !== p.id && !(q.byCkH && q.byCkH === p.ckh) && !p.conn?.admin) return this.notice(p.conn!, 'Chỉ xoá được video do bạn thêm.', 'warn');
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
    const own = n.byId === p.id || (!!n.byCkH && n.byCkH === p.ckh);
    // video admin thêm: người thường không bỏ phiếu bỏ qua được (admin dùng bảng 🛠 hoặc tự bỏ qua bài mình)
    if (n.byAdmin && !own && !p.conn?.admin) {
      if (on && p.conn) this.notice(p.conn, 'Video do admin chọn — không bỏ phiếu bỏ qua được.', 'info');
      return;
    }
    // người thêm bài bỏ qua bài của chính mình: bỏ ngay
    if (on && own) {
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
    // phòng riêng: nhật ký không ghi video / người / ghi chú (chỉ có ở reports.jsonl + bảng admin) — nhật ký về phòng riêng
    // chỉ có mã + tên phòng lúc tạo / đổi mật khẩu / đóng
    if (isPrivateRoomId(e.room)) this.log(`🚩 Báo cáo trong một phòng riêng (${e.kind === 'video' ? 'video' : 'người xem'}) — ${e.reason}`);
    else this.log(`🚩 Báo cáo (${e.room}) ${e.kind}: ${e.what} — ${e.reason}${e.note ? ` · ${e.note}` : ''}`);
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
      // video admin thêm: không tự gỡ theo số báo cáo (admin đã được báo qua recordReport, tự quyết)
      if (distinct >= this.cfg.reportAutoskip && !n.byAdmin) {
        if (room.priv) {
          // phòng riêng: vài người quen nhau đủ số báo cáo dễ dàng → chỉ bỏ qua trong phòng + báo admin, KHÔNG gỡ khỏi cả rạp
          this.adminNote(`🚩 Phòng riêng ${room.id} (${room.name}): ${distinct} người báo cáo "${n.title}" (${n.v}) — đã bỏ qua trong phòng, chưa gỡ khỏi rạp`);
          room.broadcast({ t: 'notice', kind: 'warn', text: `Đã bỏ qua "${n.title}" vì nhiều người báo cáo.` });
        } else {
          this.blockVideo(n.v, n.title, `${distinct} người báo cáo: ${reason}`, room);
          room.broadcast({ t: 'notice', kind: 'warn', text: `Đã gỡ "${n.title}" vì nhiều người báo cáo.` });
        }
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
    // phòng riêng (có khi chỉ 1 người — 1 máy là đủ số): chỉ chuyển bài trong phòng, không đụng gì của cả rạp (embedFail
    // chặn thêm lại 24 h, tắt video mặc định, xoá bộ đệm) — một người không được làm hỏng video của mọi phòng. Cũng không
    // ghi nhật ký: nhật ký không bao giờ có video đang xem trong phòng riêng
    if (!room.priv) {
      if (code === 101 || code === 150) this.embedFail.set(v, now + EMBED_FAIL_MS);
      if (n.filler) this.defaultOffUntil = now + DEFAULT_OFF_MS; // video mặc định hỏng: tạm tắt, thử lại sau
      this.cache.delete(v);
      this.log(`⚠️  Video ${v} lỗi trình phát (mã ${code}) trên ${room.errReports.size} máy — chuyển bài`);
    }
    room.broadcast({
      t: 'notice', kind: 'warn',
      text: code === 101 || code === 150 ? `"${n.title}" không cho phát trên trang khác — chuyển bài.` : `"${n.title}" không phát được — chuyển bài.`,
    });
    room.next(now);
  }

  /**
   * Máy người xem báo độ dài thật của video `unk` đang chiếu (rạp kiểm cơ bản, chưa biết độ dài). Người thêm video báo là
   * nhận ngay (họ vốn bỏ qua được video của mình); người khác cần đủ số mạng (IP) khác nhau như báo lỗi trình phát, lấy
   * trung vị (một người nhiều tab không đủ, báo bừa không cắt / kéo dài được bài của người khác).
   */
  private onVideoDuration(room: Room, p: Player, v: string, d: number, live: boolean, now: number): void {
    const n = room.now;
    if (!n || n.v !== v || !n.unk || n.filler || now < n.at - PRELOAD_MS) return;
    if (!live && !(d >= 1 && d <= 86_400)) return;
    let pick: { d: number; live: boolean };
    if (p.id === n.byId || (!!n.byCkH && n.byCkH === p.ckh)) pick = { d, live };
    else {
      room.durReports.set(`ip:${p.ipHash}`, { d, live });
      const ips = room.presentIps();
      const need = Math.max(1, Math.min(ips, Math.max(2, Math.ceil(ips * 0.3))));
      const reps = [...room.durReports.values()];
      if (reps.length < need) return;
      if (reps.filter((x) => x.live).length * 2 > reps.length) pick = { d: 0, live: true };
      else {
        const ds = reps.filter((x) => !x.live).map((x) => x.d).sort((a, b) => a - b);
        pick = { d: ds[(ds.length - 1) >> 1], live: false };
      }
    }
    n.unk = false;
    if (pick.live) {
      if (!this.cfg.allowLive) {
        room.broadcast({ t: 'notice', kind: 'warn', text: `"${n.title}" là phát trực tiếp — rạp đang không nhận, chuyển bài.` });
        room.next(now);
        return;
      }
      n.live = true;
      n.dur = 0;
    } else {
      n.dur = Math.round(pick.d);
      if (n.cap && n.dur > n.cap + 2) {
        room.broadcast({ t: 'notice', kind: 'info', text: `"${n.title}" dài ${fmtDuration(n.dur)} — rạp chiếu tối đa ${fmtDuration(n.cap)} rồi chuyển bài.` });
      }
    }
    if (!n.paused) n.ends = n.at + room.playMs(n) + END_GRACE_MS;
    // phòng riêng: không ghi nhật ký (không bao giờ ghi video đang xem trong phòng riêng)
    if (!room.priv) this.log(`⏱️  ${room.id}: "${n.title}" ${n.live ? 'là phát trực tiếp' : `dài ${fmtDuration(n.dur)}`} (máy người xem báo)`);
    room.sendNow();
    this.dirty = true;
  }

  // ---------------------------------------------------------- phòng riêng (có mật khẩu — docs/07 §20)
  /**
   * CỔNG DUY NHẤT vào phòng riêng (connect, spec, join mới, nối lại, switch / moveTo): phòng không còn → 'gone'; admin
   * luôn 'ok' (không chiếm chỗ, không bị chặn — cả phòng được báo, xem announceAdmin); máy bị chủ phòng mời ra →
   * 'kicked'; có quyền = chủ phòng (khoá máy) hoặc vé rt còn hạn của ĐÚNG máy này; chưa có quyền → 'need'; đủ chỗ (tính cả
   * người đang ẩn / mất mạng / đang vào dở, không tính quản trị viên) mà không phải chủ phòng → 'full'. Đồng bộ: vé không
   * bao giờ phải băm scrypt hay tính lượt thử. Khoá máy chỉ so qua băm (server không lưu khoá thật của phòng riêng).
   */
  private privEntry(c: Conn, room: Room | null, ck: string, rt?: string, now = Date.now()): PrivVerdict {
    const pv = room?.priv;
    if (!room || !pv || pv.closed || this.rooms.get(room.id) !== room) return 'gone';
    if (c.admin) return 'ok';
    const ckh = ck ? sha256hex(ck) : '';
    if (ckh && pv.kickedCkH.includes(ckh)) return 'kicked';
    const owner = !!ckh && ckh === pv.ownerCkH;
    if (!owner && !(rt && ckh && this.tokenOk(pv, rt, ckh, now))) return 'need';
    if (!owner && room.occupancy() >= room.capacity()) return 'full';
    return 'ok';
  }

  private tokenOk(pv: PrivState, rt: string, ckh: string, now: number): boolean {
    const h = sha256hex(rt);
    return pv.tokens.some((t) => t.h === h && t.ckh === ckh && now - t.at < PRIV_TOKEN_TTL_MS);
  }

  /**
   * cấp vé vào lại mới cho máy `ck` (thay vé cũ của máy đó). Vé thật chỉ gửi cho máy đó — server chỉ giữ băm sha256 của
   * vé + của khoá máy. Quá cap × 5 vé: bỏ vé cũ nhất của người KHÔNG còn trong phòng trước (người đang trong phòng — kể cả
   * đang mất mạng — không bao giờ mất vé vì người lạ nhập đúng mật khẩu khi phòng đầy)
   */
  private issueToken(room: Room, ck: string, now: number): string {
    const pv = room.priv!;
    const rt = randomBytes(18).toString('base64url');
    const ckh = sha256hex(ck);
    pv.tokens = pv.tokens.filter((t) => t.ckh !== ckh && now - t.at < PRIV_TOKEN_TTL_MS);
    pv.tokens.push({ h: sha256hex(rt), ckh, at: now });
    const max = pv.cap * 5;
    if (pv.tokens.length > max) {
      // vé xếp cũ → mới: bỏ dần vé cũ nhất của người không còn trong phòng tới khi vừa đủ
      const keep = new Set([...room.players.values()].map((p) => p.ckh)).add(ckh);
      const drop = new Set<PrivToken>();
      for (const t of pv.tokens) {
        if (pv.tokens.length - drop.size <= max) break;
        if (!keep.has(t.ckh)) drop.add(t);
      }
      pv.tokens = pv.tokens.filter((t) => !drop.has(t));
      if (pv.tokens.length > max) pv.tokens.splice(0, pv.tokens.length - max);
    }
    this.dirty = true;
    return rt;
  }

  /**
   * thành viên (không phải chủ phòng / quản trị viên) nối lại vào phòng riêng mà không còn vé hợp lệ (hết hạn, …) → cấp vé
   * mới ngay (proom_rt): rớt mạng lâu hơn GHOST_MS vẫn vào lại được bằng vé, không bị đòi mật khẩu oan
   */
  private ensureTicket(room: Room, p: Player, c: Conn, now: number): void {
    const pv = room.priv;
    if (!pv || p.admin || p.ckh === pv.ownerCkH) return;
    if (pv.tokens.some((t) => t.ckh === p.ckh && now - t.at < PRIV_TOKEN_TTL_MS)) return;
    this.send(c, { t: 'proom_rt', room: room.id, rt: this.issueToken(room, p.ck, now) });
  }

  private fullText(room: Room | null): string {
    const n = room ? room.capacity() : 0;
    return `Phòng đã đủ ${n}/${n} người — nhờ chủ phòng tăng số người nhé.`;
  }

  /** lý do không vào được phòng riêng cho người đang ở trong rạp (switch, nối lại, vừa nhập đúng mật khẩu) */
  private privRefusal(roomId: string, v: PrivVerdict, room: Room | null): ServerMsg {
    if (v === 'kicked') return { t: 'proom_res', ok: false, code: 'kicked', text: TXT_KICKED, room: roomId };
    if (v === 'full') return { t: 'proom_res', ok: false, code: 'full', text: this.fullText(room), room: roomId };
    return { t: 'proom_need', room: roomId, exists: v !== 'gone' };
  }

  /**
   * Quản trị viên trong phòng riêng là TRẠNG THÁI, không chỉ một lời báo lúc vào — không bao giờ xem lén. Gọi mỗi khi
   * kết nối `c` vào phòng (đứng xem / vào hẳn / nối lại / chuyển vào), SAU hello / welcome:
   * - `c` là admin: đứng xem → cả phòng nhận priv (admins tăng); lần đầu vào phòng này của kết nối đó (rời đi rồi vào lại
   *   là lần mới — leaveRoom xoá adminSeen) → cả phòng được báo "🛡 …";
   * - người khác vào lúc đang có quản trị viên (đứng xem, hoặc có nhân vật kể cả đang ẩn / mất mạng) → chính người đó được
   *   báo (welcome của họ đã có priv.admins / members[].adm để giao diện hiện dấu 🛡 suốt lúc admin còn ở đó).
   */
  private announceAdmin(room: Room, c: Conn): void {
    if (!room.priv || room.priv.closed) return;
    const notice: ServerMsg = { t: 'notice', kind: 'info', text: TXT_ADMIN_HERE };
    // chủ phòng là admin vào phòng của chính mình: không phải "quản trị viên đang xem" — như người thường
    if (!c.admin || (c.player && c.player.ckh === room.priv.ownerCkH)) {
      if (room.adminPresent()) this.send(c, notice);
      return;
    }
    if (!c.player) room.sendPriv(c);
    if (room.adminSeen.has(c.cid)) return;
    room.adminSeen.add(c.cid);
    room.broadcast(notice);
  }

  /** mật khẩu phòng: NFC + bỏ khoảng trắng hai đầu (KHÔNG cleanText — giữ đúng ký tự người đặt), 4–40 ký tự; sai → null */
  private passOf(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const pass = raw.normalize('NFC').trim();
    const n = codeLength(pass);
    return n >= PASS_MIN && n <= PASS_MAX ? pass : null;
  }

  /** kết nối này đang có phép băm, hoặc cả server đã đủ SCRYPT_MAX_INFLIGHT phép đang chạy */
  private hashBusy(c: Conn): boolean {
    return c.privBusy || this.scryptInFlight >= SCRYPT_MAX_INFLIGHT;
  }

  /** scrypt BẤT ĐỒNG BỘ (không chặn vòng sự kiện / nhịp 30 Hz) — giữ cờ bận của kết nối + bộ đếm cả server tới khi xong */
  private async hashPass(c: Conn, pass: string, saltHex: string): Promise<Buffer> {
    c.privBusy = true;
    this.scryptInFlight++;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(pass, Buffer.from(saltHex, 'hex'), 32, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key)));
      });
    } finally {
      c.privBusy = false;
      this.scryptInFlight--;
    }
  }

  /** id phòng riêng: "p-" + 10 ký tự [a-z0-9], mỗi ký tự lấy bằng crypto.randomInt (không lệch; 36^10 — không đoán được) */
  private newPrivateId(): string {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (;;) {
      let id = 'p-';
      for (let i = 0; i < 10; i++) id += abc[randomInt(36)];
      if (!this.rooms.has(id)) return id;
    }
  }

  /**
   * Luật tạo phòng riêng — kiểm TRƯỚC khi băm và kiểm lại SAU khi băm (bấm đúp, hai tab): máy này đang có phòng còn thành
   * viên → 'owned' (phòng của máy này đã hết thành viên thì được thay bằng phòng mới); mạng này đã có PRIVATE_PER_NET phòng,
   * hoặc dải mạng này đã có PRIVATE_PER_SUBNET phòng → 'limit'; cả server đủ PRIVATE_ROOMS_MAX → thu hồi phòng hết thành
   * viên lâu nhất; không có thì CHIA ĐỀU: người từ dải mạng chưa có phòng nào được lấy phòng lâu không ai thao tác nhất của
   * dải mạng đang giữ nhiều phòng nhất (≥ 2) — một người muốn giữ cả rạp phải có ngần ấy dải mạng; không thì 'limit'.
   * commit = true (sau khi băm, sắp tạo thật): đóng phòng cũ của máy này / phòng bị thu hồi.
   */
  private privCreateCheck(c: Conn, ckh: string, commit: boolean): { code: string; text: string; room?: string } | null {
    const live = [...this.rooms.values()].filter((r) => r.priv && !r.priv.closed);
    const mine = live.find((r) => r.priv!.ownerCkH === ckh) ?? null;
    if (mine && mine.members() > 0) return { code: 'owned', room: mine.id, text: `Bạn đang có phòng 🔒 ${mine.name} — vào lại phòng đó nhé.` };
    const rest = live.filter((r) => r !== mine);
    const netLimit = { code: 'limit', text: 'Mạng bạn đang dùng đã có nhiều phòng riêng — thử lại sau ít phút nhé.' };
    if (rest.filter((r) => r.priv!.ownerNet === c.net).length >= this.cfg.privatePerNet) return netLimit;
    const bySubnet = new Map<string, Room[]>();
    for (const r of rest) {
      const k = r.priv!.ownerSubnet;
      const list = k ? bySubnet.get(k) : undefined;
      if (list) list.push(r);
      else if (k) bySubnet.set(k, [r]);
    }
    const mySubnet = bySubnet.get(c.subnet)?.length ?? 0;
    if (mySubnet >= this.cfg.privatePerSubnet) return netLimit;
    let reclaim: Room | null = null;
    let fair = false;
    if (rest.length >= this.cfg.privateRoomsMax) {
      for (const r of rest) if (r.members() === 0 && (!reclaim || r.emptySince < reclaim.emptySince)) reclaim = r;
      if (!reclaim && mySubnet === 0) {
        let top: Room[] = [];
        for (const rs of bySubnet.values()) if (rs.length > top.length) top = rs;
        if (top.length >= 2) for (const r of top) if (!reclaim || r.priv!.lastInput < reclaim.priv!.lastInput) reclaim = r;
        fair = !!reclaim;
      }
      if (!reclaim) return { code: 'limit', text: 'Rạp đang có nhiều phòng riêng quá — thử lại sau ít phút nhé.' };
    }
    if (commit) {
      if (mine) this.closePrivate(mine, 'Phòng riêng đã đóng (chủ phòng vừa tạo phòng mới).', 'chủ phòng tạo phòng mới');
      if (reclaim && fair) {
        this.closePrivate(reclaim, 'Rạp đang đủ số phòng riêng — phòng này đã đóng để nhường chỗ cho người khác.',
          'thu hồi chia đều — rạp đủ số phòng riêng, dải mạng của chủ phòng đang giữ nhiều phòng nhất');
      } else if (reclaim) {
        this.closePrivate(reclaim, 'Phòng riêng đã đóng vì bỏ trống.', 'thu hồi phòng trống — rạp đủ số phòng riêng');
      }
    }
    return null;
  }

  /** proom_new: tạo phòng riêng. Đã vào rạp → chủ phòng sang phòng mới luôn; chưa vào → client gửi join kèm rt */
  private async onPrivNew(c: Conn, msg: Extract<ClientMsg, { t: 'proom_new' }>): Promise<void> {
    const res = (code: string, text: string, room?: string): void => this.send(c, { t: 'proom_res', ok: false, code, text, ...(room ? { room } : {}) });
    try {
      const p0 = c.player && c.player.conn === c ? c.player : null;
      const pass = this.passOf(msg.pass);
      if (!pass) return res('invalid', TXT_PASS_LEN);
      const max = this.cfg.privateCapMax;
      if (!Number.isInteger(msg.cap) || msg.cap < 2 || msg.cap > max) return res('invalid', `Số người tối đa từ 2 đến ${max}.`);
      const venue = venueById(msg.venue);
      if (!venue) return res('invalid', 'Chọn rạp cho phòng nhé.');
      let name = p0?.name ?? '';
      if (!p0) {
        const nc = checkName(msg.name, LIMITS.nameMin, LIMITS.nameMax);
        if (!nc.ok) return res('invalid', nc.text);
        name = nc.name;
      }
      const ck = p0 ? p0.ck : msg.ck;
      if (!ck) return res('invalid', TXT_NO_CK);
      const ckh = sha256hex(ck);
      // mọi giới hạn kiểm ĐỒNG BỘ trước khi băm; lượt tạo phòng tính trước khi băm (không hoàn lại)
      const bad = this.privCreateCheck(c, ckh, false);
      if (bad) return res(bad.code, bad.text, bad.room);
      if (this.hashBusy(c)) return res('busy', TXT_BUSY);
      if (!this.privCreateWindow.hit(c.net)) return res('rate', 'Tạo phòng nhiều quá — đợi một lúc rồi thử lại nhé.');
      const salt = randomBytes(16).toString('hex');
      const hash = await this.hashPass(c, pass, salt);
      // sau khi chờ băm: kết nối còn mở? nhân vật vẫn như lúc bấm? giới hạn vẫn đạt?
      if (c.closed || !isOpen(c.sock)) return;
      const p = c.player && c.player.conn === c ? c.player : null;
      const from = p ? this.roomOf(p) : null;
      if (p !== p0 || (p && !from)) return res('invalid', 'Bạn vừa đổi phòng trong lúc tạo — thử lại nhé.');
      const again = this.privCreateCheck(c, ckh, true);
      if (again) return res(again.code, again.text, again.room);
      const now = Date.now();
      const id = this.newPrivateId();
      const title = Array.from(`Phòng của ${name}`).slice(0, PRIV_NAME_MAX).join('').trim();
      const room = new Room(this, id, {
        name: title, venue: venue.id, cap: msg.cap, passHash: hash.toString('hex'), salt, passVer: 1, ownerCkH: ckh,
        ownerNet: c.net, ownerSubnet: c.subnet, createdAt: now, tokens: [], kickedCkH: [], lastInput: now, closed: false, pending: 0,
      });
      this.rooms.set(id, room);
      const rt = this.issueToken(room, ck, now);
      this.log(`🔒 Phòng riêng mới ${id} (tối đa ${msg.cap} người) — ${title}`); // không bao giờ log mật khẩu / vé
      this.send(c, { t: 'proom_ok', room: id, rt, venue: venue.id, name: title, created: true });
      // đã vào rạp → chủ phòng sang phòng mới ngay (cùng nhịp); không được (gần như không thể) thì bỏ phòng vừa tạo
      if (p && from && !this.moveTo(c, p, from, id, now, false)) {
        room.priv!.closed = true;
        this.rooms.delete(id);
        res('busy', 'Không vào được phòng vừa tạo — thử lại nhé.');
      }
    } catch (e) {
      console.error('[priv] tạo phòng riêng lỗi:', e instanceof Error ? e.message : e);
      res('busy', TXT_BUSY);
    }
  }

  /** proom_auth: nhập mật khẩu → vé rt. Đã vào rạp → chuyển vào phòng luôn; chưa vào → client gửi join kèm rt */
  private async onPrivAuth(c: Conn, msg: Extract<ClientMsg, { t: 'proom_auth' }>): Promise<void> {
    const res = (code: string, text: string): void => this.send(c, { t: 'proom_res', ok: false, code, text, room: msg.room });
    const gone = (): void => this.send(c, { t: 'proom_need', room: msg.room, exists: false });
    try {
      const room = this.rooms.get(msg.room) ?? null;
      const pv = room?.priv;
      if (!room || !pv || pv.closed) return gone();
      const p0 = c.player && c.player.conn === c ? c.player : null;
      const ck = p0 ? p0.ck : msg.ck;
      if (!ck) return res('invalid', TXT_NO_CK);
      const ckh = sha256hex(ck);
      if (!c.admin && pv.kickedCkH.includes(ckh)) return res('kicked', TXT_KICKED);
      const pass = this.passOf(msg.pass);
      if (!pass) return res('bad_pass', TXT_BAD_PASS); // sai độ dài = chắc chắn sai: khỏi băm, khỏi tính lượt
      if (this.hashBusy(c)) return res('busy', TXT_BUSY);
      // tính MỌI lượt thử TRƯỚC khi băm, đúng cũng không hoàn lại: theo mạng (mọi phòng) rồi theo phòng
      const now = Date.now();
      if (!this.privNetAttempts.hit(c.net, now)) return res('rate', TXT_RATE);
      if (!this.privRoomAttempts.hit(room.id, now)) { this.warnOwner(room, now); return res('rate', TXT_RATE); }
      const passVer = pv.passVer;
      const want = Buffer.from(pv.passHash, 'hex');
      // người đang ở phòng khác sẽ được chuyển vào ngay nếu đúng → giữ một chỗ trong lúc băm (admin không chiếm chỗ)
      const reserve = !!p0 && !c.admin && this.roomOf(p0) !== room && room.occupancy() < room.capacity();
      if (reserve) pv.pending++;
      let good = false;
      try {
        const dk = await this.hashPass(c, pass, pv.salt);
        good = dk.length === want.length && timingSafeEqual(dk, want);
      } finally {
        if (reserve) pv.pending--;
      }
      // sau khi chờ băm: vẫn đúng phòng đó (chưa đóng), mật khẩu chưa đổi, kết nối còn mở, chưa bị mời ra
      if (c.closed || !isOpen(c.sock)) return;
      if (this.rooms.get(room.id) !== room || pv.closed) return gone();
      if (!c.admin && pv.kickedCkH.includes(ckh)) return res('kicked', TXT_KICKED);
      if (!good || pv.passVer !== passVer) return res('bad_pass', TXT_BAD_PASS);
      const t = Date.now();
      const rt = this.issueToken(room, ck, t);
      this.send(c, { t: 'proom_ok', room: room.id, rt, venue: room.venue, name: room.name });
      const p = c.player && c.player.conn === c ? c.player : null;
      const from = p ? this.roomOf(p) : null;
      if (p && from && from !== room && p.ck === ck) this.moveTo(c, p, from, room.id, t, false, rt); // đầy → proom_res 'full'
    } catch (e) {
      console.error('[priv] kiểm mật khẩu phòng riêng lỗi:', e instanceof Error ? e.message : e);
      res('busy', TXT_BUSY);
    }
  }

  /** lượt thử của một phòng vừa chạm giới hạn → báo chủ phòng (nếu đang có mặt), tối đa một lần / 10 phút */
  private warnOwner(room: Room, now: number): void {
    if (now - room.rateNoticeAt < ATTEMPT_WINDOW_MS) return;
    for (const p of room.players.values()) {
      if (p.ckh !== room.priv!.ownerCkH || !p.conn) continue;
      room.rateNoticeAt = now;
      this.notice(p.conn, 'Có người nhập sai mật khẩu phòng nhiều lần.', 'warn');
    }
  }

  /** proom_op: thao tác trong phòng riêng — CHỈ phòng người gửi đang đứng (không bao giờ tìm người ở phòng khác) */
  private async onPrivOp(p: Player, msg: Extract<ClientMsg, { t: 'proom_op' }>, now: number): Promise<void> {
    const c = p.conn!;
    const room = this.roomOf(p);
    const pv = room?.priv;
    const res = (ok: boolean, code: string, text: string): void => this.send(c, { t: 'proom_res', ok, code, text, ...(room ? { room: room.id } : {}) });
    try {
      if (!room || !pv || pv.closed) return;
      if (!p.opBucket.take(1, now)) return this.notice(c, 'Thao tác chậm lại chút nhé.', 'warn');
      pv.lastInput = now;
      // dừng / phát tiếp cho cả phòng: ai trong phòng cũng được — cả phòng thấy ai bấm (phá thì chủ phòng mời ra)
      if (msg.op === 'pause') {
        const n = room.now;
        if (n && !n.live && !n.filler && room.pause(now)) room.broadcast({ t: 'notice', kind: 'info', text: `⏸ ${p.name} đã dừng video cho cả phòng` });
        return;
      }
      if (msg.op === 'resume') {
        if (room.resume(now)) room.broadcast({ t: 'notice', kind: 'info', text: `▶ ${p.name} đã phát tiếp` });
        return;
      }
      const owner = p.ckh === pv.ownerCkH;
      if (!owner && !c.admin) return res(false, 'denied', 'Chỉ chủ phòng làm được việc này.');
      switch (msg.op) {
        case 'skip':
          if (!room.now) return;
          room.broadcast({ t: 'notice', kind: 'info', text: owner ? '⏭ Chủ phòng đã bỏ qua video.' : '⏭ Quản trị viên đã bỏ qua video.' });
          room.next(now);
          return;
        case 'remove': {
          const before = room.queue.length;
          room.queue = room.queue.filter((q) => q.qid !== msg.qid);
          if (room.queue.length !== before) { this.dirty = true; room.sendQueue(); }
          return;
        }
        case 'kick': {
          const t = msg.pid ? room.players.get(msg.pid) : undefined;
          if (!t || t === p || t.ckh === pv.ownerCkH || t.admin) return res(false, 'denied', 'Không mời người này ra được.');
          // chặn theo khoá máy (không theo IP — người chung wifi / 4G không bị vạ lây; chỉ giữ băm) + huỷ vé của máy đó
          if (!pv.kickedCkH.includes(t.ckh)) pv.kickedCkH.push(t.ckh);
          if (pv.kickedCkH.length > PRIV_KICKED_MAX) pv.kickedCkH.splice(0, pv.kickedCkH.length - PRIV_KICKED_MAX);
          pv.tokens = pv.tokens.filter((x) => x.ckh !== t.ckh);
          this.evictPrivate(room, t, 'Chủ phòng đã mời bạn ra khỏi phòng riêng.', now);
          this.saveSoon();
          return res(true, 'ok', `Đã mời ${t.name} ra. Họ vẫn biết mật khẩu — đổi mật khẩu nếu không muốn họ vào lại.`);
        }
        case 'pass': {
          const pass = this.passOf(msg.pass);
          if (!pass) return res(false, 'invalid', TXT_PASS_LEN);
          if (this.hashBusy(c)) return res(false, 'busy', TXT_BUSY);
          // mỗi lần đổi là một phép băm scrypt: tối đa PASS_CHANGES_PER_ROOM lần / 10 phút / phòng (tính trước khi băm)
          if (!this.privPassChanges.hit(room.id, now)) return res(false, 'rate', 'Đổi mật khẩu nhiều quá — đợi vài phút rồi thử lại nhé.');
          const passVer = pv.passVer;
          const salt = randomBytes(16).toString('hex');
          const hash = await this.hashPass(c, pass, salt);
          // sau khi băm: phòng còn đó, chưa ai đổi mật khẩu trước → đổi băm; vé của người KHÔNG còn trong phòng hết hiệu
          // lực; thành viên (kể cả đang ẩn / mất mạng — quay lại bằng vé cũ được) giữ vé; ai đang có mặt nhận vé mới
          if (this.rooms.get(room.id) !== room || pv.closed) return;
          if (pv.passVer !== passVer) return res(false, 'busy', 'Mật khẩu vừa được đổi — thử lại nhé.');
          pv.passHash = hash.toString('hex');
          pv.salt = salt;
          pv.passVer++;
          const inRoom = new Set([...room.players.values()].map((m) => m.ckh));
          pv.tokens = pv.tokens.filter((x) => inRoom.has(x.ckh));
          const t2 = Date.now();
          for (const m of room.players.values()) {
            if (m.conn && !m.conn.closed && !m.away) this.send(m.conn, { t: 'proom_rt', room: room.id, rt: this.issueToken(room, m.ck, t2) });
          }
          // mật khẩu mới: các lần đoán mật khẩu cũ không còn ý nghĩa — người có mật khẩu mới không bị khoá lây vì kẻ dò cũ
          this.privRoomAttempts.clear(room.id);
          room.rateNoticeAt = 0;
          this.saveSoon();
          this.log(`🔒 ${room.id} (${room.name}): chủ phòng đổi mật khẩu`);
          return res(true, 'ok', 'Đã đổi mật khẩu. Người đang trong phòng vẫn ở lại; ai vào sau cần mật khẩu mới.');
        }
        case 'cap': {
          const cap = msg.cap ?? 0;
          const max = this.cfg.privateCapMax;
          const n = room.members(); // quản trị viên không chiếm chỗ
          if (!Number.isInteger(cap) || cap < 2 || cap > max) return res(false, 'invalid', `Số người tối đa từ 2 đến ${max}.`);
          if (cap < n) return res(false, 'invalid', `Phòng đang có ${n} người — chọn số lớn hơn nhé.`);
          pv.cap = cap;
          this.dirty = true;
          room.sendPriv();
          return;
        }
        case 'close':
          this.closePrivate(room, 'Chủ phòng đã đóng phòng riêng.', owner ? 'chủ phòng đóng' : 'admin đóng');
          return;
        default:
          return;
      }
    } catch (e) {
      console.error('[priv] thao tác phòng riêng lỗi:', e instanceof Error ? e.message : e);
      res(false, 'busy', TXT_BUSY);
    }
  }

  /**
   * Đưa một thành viên ra khỏi phòng riêng (bị mời ra / phòng đóng) — luôn xong, không bao giờ để nhân vật dính vào phòng
   * đã xoá. Đang có mặt → sang phòng chung (phòng chính cùng rạp; đầy / trùng tên thì phòng chung khác còn chỗ). Không
   * được, hoặc đang ẩn / mất mạng → bỏ nhân vật; kết nối (nếu còn) về đứng xem phòng chính chung. Kết nối nhận proom_res
   * 'out' TRƯỚC (client đặt lại giao diện, xoá vé) rồi mới tới welcome / hello của phòng chung.
   */
  private evictPrivate(room: Room, p: Player, text: string, now = Date.now()): void {
    const conn = p.conn && !p.conn.closed && p.conn.player === p ? p.conn : null;
    if (conn) this.send(conn, { t: 'proom_res', ok: false, code: 'out', text, room: room.id });
    if (conn && !p.away) {
      const first = this.pickRoom(room.venue);
      for (const to of [first, ...this.sortedRooms().filter((r) => r.count() < r.capacity())]) {
        if (to && !this.nameClash(to, p)) { this.transfer(conn, p, room, to, now); return; }
      }
    }
    room.removePlayer(p);
    p.conn = null;
    if (conn) {
      conn.player = null;
      this.spectatePublic(conn, room);
    }
  }

  /**
   * Đóng phòng riêng: đánh dấu đóng (phép kiểm mật khẩu đang dở tự huỷ), đưa từng thành viên ra, người đứng xem (admin)
   * về phòng chính chung + báo, xoá khỏi Hub.rooms, lưu ngay — băm mật khẩu, vé, khoá máy bị mời ra mất theo phòng.
   * saveNow = false: người gọi tự lưu ngay trong cùng nhịp (Hub.tick gom nhiều phòng hết hạn thành một lần ghi).
   */
  private closePrivate(room: Room, text: string, why = '', saveNow = true): void {
    const pv = room.priv;
    if (!pv || pv.closed) return;
    pv.closed = true;
    const now = Date.now();
    for (const p of [...room.players.values()]) this.evictPrivate(room, p, text, now);
    for (const c of [...room.spectators]) {
      room.spectators.delete(c);
      if (c.room !== room || c.player) continue;
      this.spectatePublic(c, room);
      this.notice(c, text, 'info');
    }
    this.rooms.delete(room.id);
    this.dirty = true;
    if (saveNow) this.save();
    this.log(`🔒 Đóng phòng riêng ${room.id} — ${room.name}${why ? ` (${why})` : ''}`);
    this.adminNote(`🔒 Đã đóng phòng riêng "${room.name}" (${room.id})${why ? ` — ${why}` : ''}`);
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
    // lệnh admin trong phòng riêng là thao tác thật (như proom_op): không thì "lâu không ai thao tác" dừng lại video admin
    // vừa cho chiếu tiếp ngay nhịp sau
    if (room.priv && op.op !== 'state' && op.op !== 'close_room') room.priv.lastInput = now;
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
        // admin đang ở phòng riêng: nhật ký không ghi mã video (video đang xem trong phòng riêng không vào nhật ký — mã video
        // vẫn có trong danh sách bị gỡ ở bảng quản trị / rooms.json để bỏ chặn)
        this.log(room.priv ? '🚫 Admin gỡ một video khỏi cả rạp (từ trong một phòng riêng — xem bảng quản trị)' : `🚫 Admin gỡ video ${v}`);
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
      case 'close_room': {
        const pr = this.rooms.get(op.room);
        if (!pr?.priv || pr.priv.closed) { this.notice(c, 'Phòng riêng này không còn.', 'warn'); return this.sendAdminState(c); }
        const name = pr.name;
        this.closePrivate(pr, 'Quản trị viên đã đóng phòng riêng này.', 'admin đóng');
        return done(`Đã đóng phòng riêng "${name}".`);
      }
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
    // phòng riêng (mới thao tác trước): admin vào xem được (cả phòng được báo) / đóng được khi xử lý báo cáo, vi phạm
    const privRooms = [...this.rooms.values()].filter((r) => r.priv && !r.priv.closed)
      .sort((a, b) => b.priv!.lastInput - a.priv!.lastInput)
      .map((r) => ({
        id: r.id, name: r.name, venue: r.venue, count: r.members(), cap: r.priv!.cap, now: r.now?.title ?? '', v: r.now?.v ?? '',
        createdAt: r.priv!.createdAt, lastInput: r.priv!.lastInput,
      }));
    this.send(c, {
      t: 'adm', kind: 'state', room: room?.id ?? '', locked: room?.locked ?? false, players,
      bans: this.bans.list(now).map((b) => ({ id: b.id, name: b.name, until: b.until, at: b.at })),
      blocked: [...this.blocked.values()].slice(-50),
      reports: this.recentReports.slice(-40).reverse(),
      ytReady: this.deps.youtube.configured,
      privRooms,
    });
  }

  // ---------------------------------------------------------- số liệu cho /api/health
  /** rooms = phòng chung; priv = số phòng riêng đang mở; players / playing tính mọi phòng */
  stats(): { rooms: number; priv: number; viewers: number; players: number; playing: number } {
    let players = 0, playing = 0, priv = 0;
    for (const r of this.rooms.values()) {
      players += r.players.size;
      if (r.now) playing++;
      if (r.priv) priv++;
    }
    return { rooms: this.rooms.size - priv, priv, viewers: this.conns.size, players, playing };
  }
}
