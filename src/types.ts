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
  /** admin thêm: người thường không bỏ phiếu bỏ qua được */
  adm?: boolean;
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

/** thành viên phòng riêng (kể cả người đang ẩn / mất mạng) — chỉ gửi cho người trong phòng đó */
export interface PrivMember {
  id: number;
  name: string;
  /** điện thoại đang ẩn trang (không hiện nhân vật nhưng vẫn là thành viên, vẫn tính chỗ) */
  away: boolean;
  /** mất kết nối, đang chờ quay lại */
  ghost: boolean;
  /**
   * quản trị viên rạp (vào phòng khi xử lý báo cáo — cả phòng đã được báo "🛡 …"): KHÔNG chiếm chỗ (không tính vào số
   * người / số chỗ, không giữ phòng khỏi tự đóng) — trừ khi chính là chủ phòng (id = ownerId: chủ rạp dùng phòng riêng
   * của mình); chủ phòng không mời ra được, nên giao diện ghi rõ người này thay vì hiện nút "Mời ra" bấm vào chỉ bị từ chối
   */
  adm?: boolean;
}

/** thông tin phòng riêng (có mật khẩu, chủ phòng tạo, không hiện trong danh sách rạp) */
export interface PrivInfo {
  name: string;
  /** số người tối đa (chủ phòng đặt) */
  cap: number;
  /** id nhân vật của chủ phòng đang ở trong phòng (0 = chủ phòng không có mặt) */
  ownerId: number;
  /** thành viên (kể cả quản trị viên vào hẳn — `adm`; số người / số chỗ chỉ tính người không có `adm`) */
  members: PrivMember[];
  /**
   * số kết nối quản trị viên rạp đang ĐỨNG XEM phòng này (không có nhân vật; vắng = 0). Quản trị viên có mặt là trạng thái:
   * giao diện hiện dấu 🛡 suốt lúc `admins > 0` hoặc có thành viên `adm`
   */
  admins?: number;
}

export interface RoomSnapshot {
  /** id phòng: chung "<rạp>" / "<rạp>-2…9" hoặc riêng "p-xxxxxxxxxx" */
  id: string;
  name: string;
  /** khung cảnh (VENUES) — với phòng riêng là rạp chủ phòng chọn, không suy ra từ id */
  venue: string;
  players: PlayerInfo[];
  queue: QueueItemInfo[];
  locked: boolean;
  now: NowInfo | null;
  votes: { n: number; need: number };
  chat: ChatInfo[];
  /** chỉ có với phòng riêng */
  priv?: PrivInfo;
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
  /** phòng riêng: số người tối đa chủ phòng chọn được (≥ 2) */
  privMax: number;
  /** phòng riêng: độ dài video tối đa (phút) — coi như không giới hạn */
  privMaxMin: number;
  /** phòng riêng: mỗi người chờ tối đa bấy nhiêu video */
  privPerUser: number;
  /** phòng riêng: không còn ai bấy nhiêu phút thì tự đóng */
  privEmptyMin: number;
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
  /**
   * phòng riêng cần mật khẩu: sau hello khi link mở ?room=p-… (kết nối đứng xem phòng chung mặc định trong lúc chờ), hoặc
   * khi join / switch vào phòng riêng mà chưa có quyền. exists=false: phòng không còn (đã đóng)
   */
  | { t: 'proom_need'; room: string; exists: boolean }
  /** mật khẩu đúng / vừa tạo phòng: rt = vé vào lại cho thiết bị này (client giữ trong localStorage vc.rt) */
  | { t: 'proom_ok'; room: string; rt: string; venue: string; name: string; created?: boolean }
  /**
   * kết quả thao tác phòng riêng (chủ yếu là lỗi). code: 'bad_pass' | 'rate' | 'busy' | 'gone' | 'full' | 'kicked' |
   * 'limit' | 'owned' (thiết bị này đang có phòng — room = id phòng đó) | 'invalid' | 'denied' | 'name' (trong phòng đã có
   * người trùng tên — room = phòng muốn vào) | 'out' (bị đưa ra khỏi phòng, kết nối đã về đứng xem phòng chung) | 'ok'
   */
  | { t: 'proom_res'; ok: boolean; text: string; code?: string; room?: string }
  /** thông tin phòng riêng đổi (số người tối đa, thành viên vào / ra / ẩn, chủ phòng có mặt) — gửi cho cả phòng */
  | { t: 'priv'; priv: PrivInfo }
  /** mật khẩu phòng vừa đổi: vé mới cho người đang ở trong phòng (vé cũ hết hiệu lực) */
  | { t: 'proom_rt'; room: string; rt: string }
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
  /** đóng một phòng riêng (mọi người trong phòng về phòng chung) */
  | { op: 'close_room'; room: string }
  | { op: 'state' };

export type ClientMsg =
  | { t: 'ping'; c: number }
  /** đứng xem một phòng (chưa vào). Phòng riêng: chỉ admin (người thường phải vào hẳn — không ai xem lén được) */
  | { t: 'spec'; room: string }
  /** đang ở trong rạp: chuyển sang phòng / rạp khác, giữ nguyên nhân vật, không tải lại trang → welcome mới. rt = vé phòng riêng */
  | { t: 'switch'; room: string; rt?: string }
  /** đóng tab / rời trang: bỏ nhân vật ngay (khỏi để lại nhân vật "kẹt" chờ hết hạn) */
  | { t: 'leave' }
  /** điện thoại: trang ẩn (chuyển app / tắt màn hình) → người khác không thấy nhân vật; hiện lại đúng chỗ khi 'back' */
  | { t: 'away' }
  | { t: 'back' }
  /** rt = vé phòng riêng (khi room là phòng riêng) */
  | { t: 'join'; name: string; look: unknown; room: string; token: string; ck: string; rt?: string }
  /** tạo phòng riêng — đã vào rạp hay chưa đều được (name = tên sẽ dùng → "Phòng của <tên>"); thành công → proom_ok created */
  | { t: 'proom_new'; pass: string; cap: number; venue: string; name: string; ck: string }
  /** nhập mật khẩu phòng riêng → proom_ok (đang có nhân vật thì chuyển vào luôn; chưa có thì client gửi join kèm rt) */
  | { t: 'proom_auth'; room: string; pass: string; ck: string }
  /** thao tác trong phòng riêng: pause / resume = mọi thành viên; skip / remove / kick / pass / cap / close = chủ phòng (hoặc admin) */
  | { t: 'proom_op'; op: 'pause' | 'resume' | 'skip' | 'remove' | 'kick' | 'pass' | 'cap' | 'close'; qid?: number; pid?: number; pass?: string; cap?: number }
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
