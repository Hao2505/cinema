// Cấu hình từ biến môi trường. src/server.ts nạp .env (dotenv) trước khi gọi loadConfig(); test thì không nạp .env
// mà truyền thẳng overrides. Biến có sẵn trong môi trường thắng .env. Không bao giờ in giá trị YT_API_KEY / ADMIN_TOKEN.
import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  /** gốc URL công khai cho thẻ chia sẻ (rỗng = suy từ request) */
  siteUrl: string;
  /** mã admin (rỗng = tắt hẳn quyền admin) */
  adminToken: string;
  ytApiKey: string;
  /** mã vùng phải xem được (regionRestriction) */
  ytRegion: string;
  /** dùng youtube-nocookie.com (chế độ bảo mật nâng cao) */
  ytNoCookie: boolean;
  maxVideoMinutes: number;
  adminMaxVideoMinutes: number;
  allowLive: boolean;
  liveMaxMinutes: number;
  maxQueuePerUser: number;
  maxQueue: number;
  skipVoteRatio: number;
  skipVoteMin: number;
  roomCapacity: number;
  maxRooms: number;
  /** số người báo cáo cùng một video đang chiếu thì tự gỡ */
  reportAutoskip: number;
  tickHz: number;
  persist: boolean;
  dataDir: string;
  contactEmail: string;
  /** tin header CF-Connecting-IP / X-Real-IP (đứng sau Cloudflare + nginx) */
  trustProxy: boolean;
  /** muối băm IP (rỗng = tự sinh, lưu data/ip-salt.txt) */
  ipSalt: string;
  /** số kết nối tối đa từ một IP (nhiều người chung wifi / 4G NAT) */
  maxConnPerIp: number;
  /** số lần vào rạp tối đa / phút / IP */
  joinsPerMinute: number;
  /** mỗi người thêm video: 2 lần liền, sau đó 1 lần / bấy nhiêu giây */
  queueAddSeconds: number;
  /** số link MỚI (chưa có trong bộ nhớ) một IP được nhờ YouTube kiểm tra mỗi phút — chống đốt quota */
  lookupsPerIpMinute: number;
  /** video mặc định (thường là kênh trực tiếp 24/7): phát khi phòng trống video quá defaultIdleSeconds; rỗng = tắt */
  defaultVideo: string;
  defaultIdleSeconds: number;
  // ---- phòng riêng (có mật khẩu, chủ phòng tạo, không hiện trong danh sách rạp — docs/07 §20)
  /**
   * số phòng riêng tối đa cả server. Đủ thì thu hồi phòng trống lâu nhất; không có phòng trống thì chia đều: người từ dải
   * mạng chưa có phòng nào được lấy phòng lâu không thao tác nhất của dải mạng đang giữ nhiều phòng nhất (≥ 2)
   */
  privateRoomsMax: number;
  /** số phòng riêng đang mở tối đa của một MẠNG (IPv4 /32, IPv6 /64) */
  privatePerNet: number;
  /**
   * số phòng riêng đang mở tối đa của một DẢI MẠNG (IPv4 /24, IPv6 /48) — một người thuê cả dải IPv6 (/56, /48 — nhà
   * mạng / tunnel cấp miễn phí) không chiếm được cả rạp bằng cách đổi sang /64 khác
   */
  privatePerSubnet: number;
  /** số lần tạo phòng riêng / giờ / mạng */
  privateCreatePerHour: number;
  /** số người tối đa chủ phòng chọn được */
  privateCapMax: number;
  /** độ dài video tối đa trong phòng riêng (phút) — coi như không giới hạn, chỉ chặn video dài vô lý */
  privateMaxVideoMinutes: number;
  /** mỗi người chờ tối đa bấy nhiêu video trong phòng riêng */
  privatePerUser: number;
  /** phòng riêng không còn ai bấy nhiêu giây thì tự đóng (đủ lâu để chủ phòng sang Zalo gửi link rồi quay lại) */
  privateEmptySeconds: number;
  /** không ai thao tác bấy nhiêu phút → tạm dừng video (live thì để chạy tới hết lượt) */
  privateIdlePauseMinutes: number;
  /** không ai thao tác bấy nhiêu phút → đóng phòng */
  privateIdleCloseMinutes: number;
}

function str(name: string, def = ''): string {
  const v = process.env[name];
  return v === undefined ? def : v.trim();
}
/** id video YouTube 11 ký tự; sai dạng / rỗng / "off" = tắt */
function videoId(v: string): string {
  return /^[A-Za-z0-9_-]{11}$/.test(v) ? v : '';
}

function int(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
}
function float(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function bool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return def;
  return /^(1|true|yes|on|bật)$/i.test(raw.trim());
}

function cleanSiteUrl(v: string): string {
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const cfg: Config = {
    port: int('PORT', 3300, 1, 65535),
    host: str('HOST', '127.0.0.1') || '127.0.0.1',
    siteUrl: cleanSiteUrl(str('SITE_URL')),
    adminToken: str('ADMIN_TOKEN'),
    ytApiKey: str('YT_API_KEY'),
    ytRegion: (str('YT_REGION', 'VN') || 'VN').toUpperCase().slice(0, 2),
    ytNoCookie: bool('YT_NOCOOKIE', true),
    maxVideoMinutes: int('MAX_VIDEO_MINUTES', 15, 1, 600),
    adminMaxVideoMinutes: int('ADMIN_MAX_VIDEO_MINUTES', 240, 1, 1440),
    allowLive: bool('ALLOW_LIVE', true),
    liveMaxMinutes: int('LIVE_MAX_MINUTES', 30, 1, 1440),
    maxQueuePerUser: int('MAX_QUEUE_PER_USER', 2, 1, 50),
    maxQueue: int('MAX_QUEUE', 50, 1, 500),
    skipVoteRatio: float('SKIP_VOTE_RATIO', 0.5, 0.05, 1),
    skipVoteMin: int('SKIP_VOTE_MIN', 2, 1, 100),
    roomCapacity: int('ROOM_CAPACITY', 60, 2, 200),
    maxRooms: int('MAX_ROOMS', 3, 1, 9), // số phòng tối đa MỖI rạp (bản chính + bản sao khi đầy)
    reportAutoskip: int('REPORT_AUTOSKIP', 3, 1, 100),
    tickHz: int('TICK_HZ', 30, 5, 30), // 30 Hz: người khác thấy mình đi gần như tức thì
    persist: bool('PERSIST', true),
    dataDir: resolve(str('DATA_DIR', 'data') || 'data'),
    contactEmail: str('CONTACT_EMAIL'),
    trustProxy: bool('TRUST_PROXY', true),
    ipSalt: str('IP_SALT'),
    maxConnPerIp: int('MAX_CONN_PER_IP', 12, 1, 10000),
    joinsPerMinute: int('JOINS_PER_MINUTE', 20, 1, 100000),
    queueAddSeconds: float('QUEUE_ADD_SECONDS', 8, 0.01, 3600),
    lookupsPerIpMinute: int('LOOKUPS_PER_IP_MINUTE', 6, 1, 100000),
    defaultVideo: videoId(str('DEFAULT_VIDEO', 'rFZHOHl-L8A')),
    defaultIdleSeconds: float('DEFAULT_IDLE_SECONDS', 30, 1, 3600),
    privateRoomsMax: int('PRIVATE_ROOMS_MAX', 400, 1, 10000),
    privatePerNet: int('PRIVATE_PER_NET', 3, 1, 1000),
    privatePerSubnet: int('PRIVATE_PER_SUBNET', 6, 1, 10000),
    privateCreatePerHour: int('PRIVATE_CREATE_PER_HOUR', 4, 1, 10000),
    privateCapMax: int('PRIVATE_CAP_MAX', 20, 2, 200),
    privateMaxVideoMinutes: int('PRIVATE_MAX_VIDEO_MINUTES', 720, 1, 1440),
    privatePerUser: int('PRIVATE_PER_USER', 10, 1, 50),
    privateEmptySeconds: float('PRIVATE_EMPTY_SECONDS', 600, 10, 86400),
    privateIdlePauseMinutes: float('PRIVATE_IDLE_PAUSE_MINUTES', 240, 1, 10080),
    privateIdleCloseMinutes: float('PRIVATE_IDLE_CLOSE_MINUTES', 480, 1, 10080),
    ...overrides,
  };
  if (cfg.adminToken && cfg.adminToken.length < 12) {
    console.warn('⚠️  ADMIN_TOKEN quá ngắn (< 12 ký tự) — tắt quyền admin. Tạo mã dài: openssl rand -hex 16');
    cfg.adminToken = '';
  }
  return cfg;
}
