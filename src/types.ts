// Hợp đồng dữ liệu server ↔ client (WebSocket JSON). Nguồn sự thật cho docs/02-giao-thuc.md.
// Client (public/js/store.js) đọc phòng thủ: trường lạ / thiếu thì bỏ qua.
import type { ActionId, Look } from '../public/js/shared/hall.js';

export type { ActionId, Look };

/** một người trong phòng (bản công khai) */
export interface PlayerInfo {
  id: number;
  name: string;
  look: Look;
  x: number;
  y: number;
  /** hướng: 0 xuống · 1 lên · 2 trái · 3 phải */
  d: number;
  /** động tác đang làm ('' = không) */
  a: ActionId | '';
  /** động tác đã chạy bao lâu (ms) lúc gửi */
  ae: number;
  /** mất kết nối, đang chờ quay lại */
  ghost: boolean;
}

/** một dòng trong frame: [id, x, y, d, ct (giờ máy người đi, ms), m (1 = đang đi)] */
export type FrameEntry = [number, number, number, number, number, 0 | 1];

export interface QueueItemInfo {
  qid: number;
  v: string;
  title: string;
  ch: string;
  /** giây (0 = live, hoặc chưa rõ khi `unk`) */
  dur: number;
  live: boolean;
  by: string;
  byId: number;
  /**
   * chưa rõ độ dài: rạp không có / không dùng được YT_API_KEY nên chỉ kiểm cơ bản bằng oEmbed lúc thêm; chiếu tối đa
   * `maxVideoMin` phút, máy người xem báo độ dài thật (`vid_dur`) khi bắt đầu phát rồi server tự chỉnh giờ hết bài
   */
  unk?: boolean;
}

export interface NowInfo extends QueueItemInfo {
  /** giờ server (ms) ứng với giây 0 của video */
  at: number;
  paused: boolean;
  /** vị trí đang dừng (giây) khi paused */
  pos: number;
  /** giờ server (ms) dự kiến hết bài */
  ends: number;
  /** video mặc định của rạp (phát khi hàng chờ trống, có video mới là nhường ngay, không bỏ phiếu bỏ qua) */
  filler?: boolean;
}

export interface ChatInfo {
  mid: number;
  pid: number;
  name: string;
  text: string;
  at: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  /** rạp (chủ đề vẽ): VENUES trong shared/hall.js */
  venue: string;
  /** tên video đang chiếu ('' = màn hình trống) — cho bảng chọn rạp */
  now: string;
  count: number;
  cap: number;
}

export interface RoomSnapshot {
  id: string;
  name: string;
  venue: string;
  players: PlayerInfo[];
  queue: QueueItemInfo[];
  locked: boolean;
  now: NowInfo | null;
  votes: { n: number; need: number };
  chat: ChatInfo[];
}

export interface PublicSettings {
  maxVideoMin: number;
  maxPerUser: number;
  capacity: number;
  liveMaxMin: number;
  allowLive: boolean;
  skipRatio: number;
  noCookie: boolean;
  ytReady: boolean;
  /** giây trống video trước khi rạp tự phát kênh mặc định (0 = tắt) */
  defaultIdleSec: number;
}

export type ServerMsg =
  | { t: 'hello'; v: number; s: number; rooms: RoomInfo[]; room: string; snap: RoomSnapshot; admin: boolean; cfg: PublicSettings }
  | { t: 'welcome'; you: number; token: string; room: string; snap: RoomSnapshot }
  | { t: 'join_err'; code: string; text: string }
  | { t: 'f'; p: FrameEntry[] }
  | { t: 'pj'; p: PlayerInfo }
  | { t: 'pl'; id: number }
  | { t: 'pu'; p: PlayerInfo }
  | { t: 'act'; id: number; a: ActionId | ''; c: number }
  | { t: 'chat'; m: ChatInfo }
  | { t: 'chat_clear' }
  | { t: 'emo'; id: number; e: string }
  | { t: 'queue'; q: QueueItemInfo[]; locked: boolean }
  | { t: 'now'; n: NowInfo | null; s: number }
  | { t: 'votes'; n: number; need: number; mine: boolean }
  | { t: 'q_res'; ok: boolean; text: string }
  | { t: 'pong'; c: number; s: number }
  | { t: 'corr'; x: number; y: number }
  | { t: 'notice'; text: string; kind: 'info' | 'ok' | 'warn' | 'err' }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'kicked'; text: string }
  | { t: 'adm'; [k: string]: unknown };

export type AdminOp =
  | { op: 'skip' }
  | { op: 'pause' }
  | { op: 'resume' }
  | { op: 'remove'; qid: number }
  | { op: 'top'; qid: number }
  | { op: 'lock'; on: boolean }
  | { op: 'mute'; pid: number; minutes: number }
  | { op: 'unmute'; pid: number }
  | { op: 'kick'; pid: number }
  | { op: 'ban'; pid: number; hours: number }
  | { op: 'unban'; id: string }
  | { op: 'block'; v: string }
  | { op: 'unblock'; v: string }
  | { op: 'clear_chat' }
  | { op: 'state' };

export type ClientMsg =
  | { t: 'ping'; c: number }
  | { t: 'spec'; room: string }
  /** đang ở trong rạp: chuyển sang phòng / rạp khác, giữ nguyên nhân vật, không tải lại trang → welcome mới */
  | { t: 'switch'; room: string }
  /** đóng tab / rời trang: bỏ nhân vật ngay (khỏi để lại nhân vật "kẹt" chờ hết hạn) */
  | { t: 'leave' }
  | { t: 'join'; name: string; look: unknown; room: string; token: string; ck: string }
  | { t: 'move'; x: number; y: number; d: number; c: number; m: 0 | 1 }
  | { t: 'act'; a: ActionId | ''; c: number }
  | { t: 'chat'; text: string }
  | { t: 'emo'; e: string }
  | { t: 'look'; look: unknown }
  | { t: 'q_add'; url: string }
  | { t: 'q_del'; qid: number }
  | { t: 'vote'; on: boolean }
  | { t: 'report'; kind: 'video' | 'user'; target: string; reason: string; note: string }
  | { t: 'vid_err'; v: string; code: number }
  /** độ dài thật của video `unk` đang chiếu (giây) đo bằng trình phát; live = độ dài tăng dần theo thời gian */
  | { t: 'vid_dur'; v: string; d: number; live: boolean }
  | ({ t: 'adm' } & AdminOp);
