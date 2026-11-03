// Kiểm duyệt: tên, chat (lọc bậy, chặn link, chống lặp), giới hạn tốc độ, danh sách cấm (lưu đĩa).
// Mọi chuỗi người dùng vẫn chỉ vào DOM qua textContent ở client — ở đây chỉ lọc nội dung.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------- chuẩn hoá
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufe00-\ufe0e]/g;

/** bỏ ký tự điều khiển / vô hình, gộp khoảng trắng, NFC */
export function cleanText(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  // xuống dòng / tab → khoảng trắng TRƯỚC khi bỏ ký tự điều khiển (không thì "a\nb" dính thành "ab")
  let t = s.normalize('NFC').replace(/[\t\n\r\f\v]+/g, ' ').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
  // chữ lặp quá nhiều ("aaaaaaaaaa") → tối đa 6
  t = t.replace(/(.)\1{6,}/gu, '$1$1$1$1$1$1');
  const cps = Array.from(t);
  return cps.length > max ? cps.slice(0, max).join('').trim() : t;
}

export const codeLength = (s: string): number => Array.from(s).length;

/** chữ thường, bỏ dấu tiếng Việt, đ→d (để so khớp) */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/** đổi leetspeak thường gặp về chữ (chỉ dùng khi dò từ bậy) */
function deLeet(s: string): string {
  return s.replace(/[0@4$5!1|3]/g, (c) => ({ '0': 'o', '@': 'a', '4': 'a', $: 's', '5': 's', '!': 'i', '1': 'i', '|': 'i', '3': 'e' } as Record<string, string>)[c] ?? c);
}

// ---------------------------------------------------------------- từ bậy
// Hai loại: (1) so khớp nguyên từ CÒN DẤU (những từ bỏ dấu sẽ trùng từ thường: "lồn"/"lon", "cặc"/"các", "buồi"/"buổi",
// "đéo"/"đeo", "đụ"/"du"); (2) so khớp nguyên từ ĐÃ BỎ DẤU cho viết tắt không lẫn được với từ thường.
const BAD_EXACT = [
  'lồn', 'lìn', 'cặc', 'cặk', 'buồi', 'đéo', 'đếch', 'địt', 'đụ', 'đĩ', 'đjt', 'đm', 'đmm', 'đcm', 'đkm', 'đmcs', 'đờ mờ',
  'vãi lồn', 'vãi cặc', 'mẹ mày', 'má mày', 'con mẹ mày', 'thằng chó', 'con đĩ', 'súc vật', 'óc lợn', 'chó đẻ',
];
const BAD_FOLDED = [
  'dm', 'dmm', 'dcm', 'dkm', 'dmcs', 'dit', 'djt', 'dit me', 'dit cu', 'vcl', 'vkl', 'vcc', 'vl', 'vleu', 'vler', 'cmm', 'clm',
  'cc', 'loz', 'lozz', 'cak', 'buoi', 'fuck', 'fck', 'fuk', 'fucking', 'motherfucker', 'shit', 'bitch', 'cunt', 'nigger', 'nigga',
  'faggot', 'retard', 'porn', 'sex', 'xxx',
];
// "buoi" đã bỏ dấu trùng "buổi" → chỉ bắt khi viết không dấu VÀ đứng cạnh từ bậy khác? Đơn giản hơn: bỏ khỏi danh sách folded.
const FOLDED_SET = new Set(BAD_FOLDED.filter((w) => w !== 'buoi'));

let extraExact: string[] = [];
/** thêm từ cấm từ cấu hình (BLOCK_WORDS=từ1,từ2 — so khớp nguyên từ, còn dấu) */
export function setExtraBadWords(list: string[]): void {
  extraExact = list.map((w) => w.normalize('NFC').toLowerCase().trim()).filter((w) => w.length >= 2);
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

function phraseHits(text: string, phrase: string): boolean {
  if (!phrase.includes(' ')) return false;
  return (` ${text} `).includes(` ${phrase} `);
}

/** có từ bậy không */
export function hasProfanity(input: string): boolean {
  return maskProfanity(input) !== input;
}

/** thay từ bậy bằng *** (giữ nguyên phần còn lại) */
export function maskProfanity(input: string): string {
  if (!input) return input;
  const lowerJoined = input.toLowerCase().split(WORD_SPLIT).filter(Boolean).join(' ');
  const exact = [...BAD_EXACT, ...extraExact];
  const badPhrases = exact.filter((p) => p.includes(' ') && phraseHits(lowerJoined, p));
  const foldedJoined = deLeet(fold(lowerJoined));
  const badFoldedPhrases = [...FOLDED_SET].filter((p) => p.includes(' ') && phraseHits(foldedJoined, p));
  // từng từ
  const out = input.replace(/[\p{L}\p{N}@$!|]+/gu, (word) => {
    const lw = word.toLowerCase();
    if (exact.includes(lw)) return '***';
    const fw = deLeet(fold(lw));
    if (FOLDED_SET.has(fw)) return '***';
    // từ dính liền kiểu "đmmmm", "vcllll", "fuckkkk"
    const squeezed = fw.replace(/(.)\1+/g, '$1');
    if (squeezed.length >= 2 && (FOLDED_SET.has(squeezed) || ['dm', 'vcl', 'vkl', 'fuck', 'dcm', 'dkm'].includes(squeezed))) return '***';
    return word;
  });
  if (!badPhrases.length && !badFoldedPhrases.length) return out;
  // cụm từ (vd "mẹ mày"): che từng từ thuộc cụm
  let res = out;
  for (const p of [...badPhrases, ...badFoldedPhrases]) {
    for (const w of p.split(' ')) {
      res = res.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(w)})(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_m, pre: string) => `${pre}***`);
    }
  }
  return res;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- link
const TLD = 'com|net|org|vn|io|me|tv|xyz|info|biz|co|ly|gg|link|site|online|top|club|shop|app|dev|ru|cn|pro|live|fun|win|bet|vip|cc|ws|tk|ml|ga|cf|gq|to|in|us|uk|asia|store|tech|space|website|click|lol|page|blog|news';
const LINK_RE = new RegExp(String.raw`(?:https?:\/\/|www\.|\b[a-z0-9-]{2,}\s?(?:\.|\(\.\)|\[\.\]|\s(?:chấm|cham|dot)\s)\s?(?:${TLD})\b|\b(?:bit\.ly|t\.me|zalo\.me|fb\.me|tinyurl)\b)`, 'iu');
const YT_RE = /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i;

export function hasLink(s: string): boolean {
  return LINK_RE.test(s) || LINK_RE.test(fold(s));
}
export function isYouTubeLink(s: string): boolean {
  return YT_RE.test(s);
}

// ---------------------------------------------------------------- tên
// tên dành riêng: so sau khi bỏ dấu, bỏ khoảng trắng / ký hiệu / chữ số ("Admin 123" = "admin")
const RESERVED_EXACT = ['mod', 'bot', 'rap', 'system', 'server', 'youtube', 'google', 'moderator', 'sysadmin'];
const RESERVED_AFFIX = ['admin', 'quantri', 'qtv', 'hethong', 'vibecinema', 'vibecorp', 'chuduan', 'rapphim'];

export type NameCheck = { ok: true; name: string } | { ok: false; text: string };

export function checkName(raw: unknown, min: number, max: number): NameCheck {
  const name = cleanText(raw, max + 5);
  if (codeLength(name) < min) return { ok: false, text: `Tên cần ít nhất ${min} ký tự.` };
  if (codeLength(name) > max) return { ok: false, text: `Tên tối đa ${max} ký tự.` };
  if (!/^[\p{L}\p{M}\p{N} ._'-]+$/u.test(name)) return { ok: false, text: 'Tên chỉ gồm chữ, số, khoảng trắng và . _ - \'' };
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, text: 'Tên cần có chữ hoặc số.' };
  if (hasLink(name)) return { ok: false, text: 'Tên không được chứa link.' };
  if (hasProfanity(name)) return { ok: false, text: 'Tên chưa phù hợp, chọn tên khác nhé.' };
  const key = fold(unconfuse(name)).replace(/[^a-z]/g, '');
  if (RESERVED_EXACT.includes(key) || RESERVED_AFFIX.some((r) => key.startsWith(r) || key.endsWith(r))) {
    return { ok: false, text: 'Tên này dành cho rạp, chọn tên khác nhé.' };
  }
  return { ok: true, name };
}

/** khoá so trùng tên trong phòng (không phân biệt hoa thường / dấu / khoảng trắng); tên không có chữ Latin
 *  (李明, Иван…) dùng chính chữ đó để khỏi trùng nhau oan */
export function nameKey(name: string): string {
  const k = fold(unconfuse(name)).replace(/[^a-z0-9]/g, '');
  return k || name.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// chữ trông giống Latin (Kirin / Hy Lạp…) → Latin, để "аdmin" (а Kirin) không lọt qua tên dành riêng
const CONFUSABLE: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ӏ': 'l', 'ԁ': 'd', 'һ': 'h',
  'ѕ': 's', 'ԛ': 'q', 'ԝ': 'w', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b', 'α': 'a', 'ο': 'o', 'ν': 'v', 'ι': 'i',
  'κ': 'k', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ı': 'i', 'ɑ': 'a', 'ɡ': 'g', '０': '0', 'ａ': 'a', 'ｄ': 'd', 'ｍ': 'm', 'ｉ': 'i', 'ｎ': 'n',
};
function unconfuse(s: string): string {
  return Array.from(s.normalize('NFKC').toLowerCase(), (ch) => CONFUSABLE[ch] ?? ch).join('');
}

// ---------------------------------------------------------------- chat
export type ChatCheck = { ok: true; text: string } | { ok: false; text: string };

export function checkChat(raw: unknown, max: number): ChatCheck {
  const text = cleanText(raw, max);
  if (!text) return { ok: false, text: '' };
  if (hasLink(text)) {
    return { ok: false, text: isYouTubeLink(text) ? 'Muốn chiếu video thì dán link vào ô "Thêm video" ở Hàng chờ nhé.' : 'Không gửi link trong chat nhé.' };
  }
  return { ok: true, text: maskProfanity(text) };
}

// ---------------------------------------------------------------- giới hạn tốc độ
/** thùng token: `capacity` lượt, hồi `perSec` lượt / giây */
export class Bucket {
  private tokens: number;
  private at: number;
  constructor(private capacity: number, private perSec: number, now = Date.now()) {
    this.tokens = capacity;
    this.at = now;
  }
  take(n = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.at) / 1000) * this.perSec);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
  /** ms nữa thì đủ 1 lượt */
  waitMs(now = Date.now()): number {
    const t = Math.min(this.capacity, this.tokens + ((now - this.at) / 1000) * this.perSec);
    return t >= 1 ? 0 : Math.ceil(((1 - t) / this.perSec) * 1000);
  }
}

/** đếm theo khoá (IP băm…) trong cửa sổ trượt — để chặn mở quá nhiều kết nối / vào phòng dồn dập */
export class WindowCounter {
  private hits = new Map<string, number[]>();
  constructor(private windowMs: number, private max: number) {}
  hit(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) { this.hits.set(key, list); return false; }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }
  /** quên mọi lượt của một khoá (vd phòng riêng vừa đổi mật khẩu: các lần đoán mật khẩu cũ không còn ý nghĩa) */
  clear(key: string): void {
    this.hits.delete(key);
  }
  private prune(now: number): void {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

// ---------------------------------------------------------------- băm IP (không lưu IP thô)
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 20);
}

/** muối băm IP ổn định qua các lần khởi động (để lệnh cấm theo IP còn hiệu lực): data/ip-salt.txt */
export function loadOrCreateSalt(dataDir: string, configured: string, persist: boolean): string {
  if (configured) return configured;
  if (!persist) return randomBytes(16).toString('hex');
  const file = join(dataDir, 'ip-salt.txt');
  try {
    if (existsSync(file)) {
      const s = readFileSync(file, 'utf8').trim();
      if (/^[a-f0-9]{32,}$/.test(s)) return s;
    }
    mkdirSync(dataDir, { recursive: true });
    const s = randomBytes(24).toString('hex');
    writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch {
    return randomBytes(16).toString('hex');
  }
}

// ---------------------------------------------------------------- danh sách cấm (lưu data/bans.json)
export interface Ban {
  id: string;
  ipHash: string;
  ck: string;
  name: string;
  /** ms epoch; 0 = vĩnh viễn */
  until: number;
  reason: string;
  at: number;
}

export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}

export function readJson(file: string): unknown {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch (e) {
    console.error(`[data] Không đọc được ${file}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

const IP_BAN_MS = 24 * 3600_000;

export class BanList {
  private bans: Ban[] = [];
  constructor(private file: string | null) {
    if (!file) return;
    const raw = readJson(file);
    if (Array.isArray(raw)) {
      this.bans = raw.filter((b): b is Ban => !!b && typeof b === 'object' && typeof (b as Ban).id === 'string'
        && typeof (b as Ban).ipHash === 'string' && typeof (b as Ban).until === 'number');
    }
  }
  private save(): void {
    if (!this.file) return;
    try { writeJsonAtomic(this.file, this.bans); } catch (e) { console.error('[data] Không lưu được bans.json:', e instanceof Error ? e.message : e); }
  }
  private prune(now: number): void {
    const before = this.bans.length;
    this.bans = this.bans.filter((b) => b.until === 0 || b.until > now);
    if (this.bans.length !== before) this.save();
  }
  /**
   * Lệnh cấm khớp máy (ck) thì cấm tới hết hạn; khớp IP thì chỉ tính trong 24 giờ đầu — nhiều người dùng chung một IP
   * (4G, wifi quán), cấm IP lâu dài sẽ chặn oan người khác.
   */
  find(ipHash: string, ck: string, now = Date.now()): Ban | null {
    this.prune(now);
    return this.bans.find((b) => (ck && b.ck && b.ck === ck) || (ipHash && b.ipHash === ipHash && now - b.at < IP_BAN_MS)) ?? null;
  }
  add(b: Omit<Ban, 'id' | 'at'>, now = Date.now()): Ban {
    const ban: Ban = { ...b, id: randomBytes(6).toString('hex'), at: now };
    this.bans.push(ban);
    this.save();
    return ban;
  }
  remove(id: string): boolean {
    const before = this.bans.length;
    this.bans = this.bans.filter((b) => b.id !== id);
    if (this.bans.length === before) return false;
    this.save();
    return true;
  }
  list(now = Date.now()): Ban[] {
    this.prune(now);
    return [...this.bans];
  }
}
