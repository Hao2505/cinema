// YouTube: tách videoId từ link, gọi Data API v3 videos.list (part=status,contentDetails,snippet) và áp luật bắt buộc
// (CLAUDE.md §2): cho nhúng, công khai, không giới hạn tuổi, xem được ở VN, giới hạn độ dài. Video KHÔNG BAO GIỜ đi qua
// server — server chỉ hỏi siêu dữ liệu. Key chỉ nằm trong URL gọi API, không bao giờ ghi log.

export interface VideoMeta {
  id: string;
  title: string;
  channel: string;
  /** giây; 0 với live */
  durationSec: number;
  live: boolean;
  upcoming: boolean;
  embeddable: boolean;
  privacy: string;
  ageRestricted: boolean;
  /** danh sách vùng được xem (null = không giới hạn) */
  regionAllowed: string[] | null;
  regionBlocked: string[];
  processed: boolean;
}

export type FetchResult =
  | { ok: true; meta: VideoMeta | null } // null = không tìm thấy (đã xoá / riêng tư)
  | { ok: false; code: 'quota' | 'network' | 'no_key' | 'bad_key' | 'api'; text: string };

export type OEmbedResult =
  | { ok: true; title: string; channel: string }
  | { ok: false; code: 'not_embeddable' | 'missing' | 'network' };

export interface YouTubeClient {
  /** hỏi YouTube thông tin 1 video (không cache) */
  fetchVideo(id: string): Promise<FetchResult>;
  /** oEmbed công khai (không cần key, không tốn quota): tên + kênh; 401/403 = chủ kênh chặn nhúng */
  fetchOEmbed(id: string): Promise<OEmbedResult>;
  readonly configured: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** videoId từ link YouTube bất kỳ (watch, youtu.be, shorts, live, embed, music, m.) hoặc id 11 ký tự; null nếu không phải */
export function parseVideoId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 500) return null;
  if (ID_RE.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'live', 'embed', 'v', 'e'].includes(parts[0] ?? '')) id = parts[1] ?? null;
    else if (url.searchParams.has('v')) id = url.searchParams.get('v');
  } else {
    return null;
  }
  return id && ID_RE.test(id) ? id : null;
}

/** "PT1H2M3S" / "P1DT2H" → giây; null nếu sai định dạng */
export function parseIsoDuration(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v.trim());
  if (!m || v.trim() === 'P' || v.trim() === 'PT') return null;
  const [, w, d, h, mi, s] = m;
  return Math.round((Number(w ?? 0) * 7 * 86400) + (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(mi ?? 0) * 60) + Number(s ?? 0));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strOf = (v: unknown, max = 300): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.toUpperCase()) : []);

/** item của videos.list → VideoMeta (phòng thủ: trường thiếu = giá trị an toàn nhất, tức là bị từ chối) */
export function metaFromItem(item: unknown): VideoMeta | null {
  if (!isRecord(item) || typeof item.id !== 'string' || !ID_RE.test(item.id)) return null;
  const status = isRecord(item.status) ? item.status : {};
  const details = isRecord(item.contentDetails) ? item.contentDetails : {};
  const snippet = isRecord(item.snippet) ? item.snippet : {};
  const rating = isRecord(details.contentRating) ? details.contentRating : {};
  const region = isRecord(details.regionRestriction) ? details.regionRestriction : null;
  const lbc = typeof snippet.liveBroadcastContent === 'string' ? snippet.liveBroadcastContent : 'none';
  const dur = parseIsoDuration(details.duration);
  return {
    id: item.id,
    title: strOf(snippet.title, 200) || 'Video không tên',
    channel: strOf(snippet.channelTitle, 100),
    durationSec: dur ?? 0,
    live: lbc === 'live',
    upcoming: lbc === 'upcoming',
    embeddable: status.embeddable === true,
    privacy: typeof status.privacyStatus === 'string' ? status.privacyStatus : 'unknown',
    ageRestricted: rating.ytRating === 'ytAgeRestricted',
    regionAllowed: region && Array.isArray(region.allowed) ? strList(region.allowed) : null,
    regionBlocked: region ? strList(region.blocked) : [],
    processed: typeof status.uploadStatus !== 'string' || status.uploadStatus === 'processed',
  };
}

export interface CheckRules {
  region: string;
  maxSeconds: number;
  allowLive: boolean;
}

export type CheckResult = { ok: true; meta: VideoMeta } | { ok: false; reason: string };

/** áp luật bắt buộc lên siêu dữ liệu; lý do từ chối viết cho người xem đọc */
export function checkMeta(meta: VideoMeta | null, rules: CheckRules): CheckResult {
  if (!meta) return { ok: false, reason: 'Không tìm thấy video — có thể đã bị xoá hoặc để riêng tư.' };
  if (meta.privacy !== 'public') {
    return { ok: false, reason: meta.privacy === 'unlisted' ? 'Video đang để "không công khai" — chỉ chiếu video công khai.' : 'Video không công khai.' };
  }
  if (!meta.embeddable) return { ok: false, reason: 'Chủ kênh không cho phép phát video này trên trang khác.' };
  if (!meta.processed) return { ok: false, reason: 'Video chưa xử lý xong trên YouTube.' };
  if (meta.ageRestricted) return { ok: false, reason: 'Video bị giới hạn độ tuổi trên YouTube.' };
  if ((meta.regionAllowed && !meta.regionAllowed.includes(rules.region)) || meta.regionBlocked.includes(rules.region)) {
    return { ok: false, reason: 'Video không xem được ở Việt Nam.' };
  }
  if (meta.upcoming) return { ok: false, reason: 'Buổi phát trực tiếp này chưa bắt đầu.' };
  if (meta.live) {
    if (!rules.allowLive) return { ok: false, reason: 'Rạp đang không nhận video phát trực tiếp.' };
    return { ok: true, meta };
  }
  if (!(meta.durationSec > 0)) return { ok: false, reason: 'Không đọc được độ dài video.' };
  if (meta.durationSec > rules.maxSeconds) {
    return { ok: false, reason: `Video dài ${fmtDuration(meta.durationSec)} — rạp chỉ nhận video tối đa ${fmtDuration(rules.maxSeconds)}.` };
  }
  return { ok: true, meta };
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h} giờ${m ? ` ${m} phút` : ''}`;
  if (m) return `${m} phút${r ? ` ${r} giây` : ''}`;
  return `${r} giây`;
}

/** client thật gọi googleapis.com (timeout 6 s); không bao giờ để key lọt ra lỗi / log */
export function createYouTubeClient(apiKey: string, fetchImpl: typeof fetch = fetch): YouTubeClient {
  return {
    configured: !!apiKey,
    async fetchOEmbed(id: string): Promise<OEmbedResult> {
      if (!ID_RE.test(id)) return { ok: false, code: 'missing' };
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6000);
      try {
        const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: 'application/json' } });
        if (res.status === 401 || res.status === 403) return { ok: false, code: 'not_embeddable' };
        if (res.status === 400 || res.status === 404) return { ok: false, code: 'missing' };
        if (!res.ok) return { ok: false, code: 'network' };
        const body: unknown = await res.json().catch(() => null);
        const title = isRecord(body) && typeof body.title === 'string' ? body.title.slice(0, 200) : '';
        const channel = isRecord(body) && typeof body.author_name === 'string' ? body.author_name.slice(0, 100) : '';
        return title ? { ok: true, title, channel } : { ok: false, code: 'network' };
      } catch {
        return { ok: false, code: 'network' };
      } finally {
        clearTimeout(timer);
      }
    },
    async fetchVideo(id: string): Promise<FetchResult> {
      if (!apiKey) return { ok: false, code: 'no_key', text: 'Rạp chưa cấu hình kiểm tra video (thiếu YT_API_KEY) — báo admin nhé.' };
      if (!ID_RE.test(id)) return { ok: true, meta: null };
      const url = `https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails,snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(apiKey)}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6000);
      try {
        const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: 'application/json' } });
        let body: unknown = null;
        try { body = await res.json(); } catch { body = null; }
        if (!res.ok) {
          const reason = errorReason(body);
          if (res.status === 403 && /quota|rateLimit|dailyLimit/i.test(reason)) {
            return { ok: false, code: 'quota', text: 'Hôm nay rạp đã dùng hết lượt kiểm tra video của YouTube — thử lại vào ngày mai nhé.' };
          }
          if (res.status === 400 || (res.status === 403 && /key|forbidden|accessNotConfigured|ipRefererBlocked/i.test(reason))) {
            console.error(`[youtube] API từ chối key (HTTP ${res.status}, ${reason || 'không rõ'}) — kiểm tra YT_API_KEY và hạn chế của key trên Google Cloud`);
            return { ok: false, code: 'bad_key', text: 'Rạp đang lỗi cấu hình kiểm tra video — báo admin nhé.' };
          }
          console.error(`[youtube] videos.list lỗi HTTP ${res.status} ${reason}`);
          return { ok: false, code: 'api', text: 'YouTube đang trục trặc, thử lại sau ít phút nhé.' };
        }
        const items = isRecord(body) && Array.isArray(body.items) ? body.items : [];
        const meta = items.length ? metaFromItem(items[0]) : null;
        return { ok: true, meta: meta && meta.id === id ? meta : null };
      } catch (e) {
        const msg = e instanceof Error ? e.name : 'lỗi';
        console.error(`[youtube] không gọi được videos.list (${msg})`);
        return { ok: false, code: 'network', text: 'Không kiểm tra được video lúc này, thử lại sau nhé.' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function errorReason(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.error)) return '';
  const err = body.error;
  const first = Array.isArray(err.errors) && isRecord(err.errors[0]) ? err.errors[0] : null;
  const reason = first && typeof first.reason === 'string' ? first.reason : '';
  const status = typeof err.status === 'string' ? err.status : '';
  return `${reason} ${status}`.trim().slice(0, 80);
}

/** bộ đệm kết quả (tiết kiệm quota 10.000 lượt/ngày): giữ 6 giờ, tối đa 2000 video */
export class VideoCache {
  private map = new Map<string, { at: number; meta: VideoMeta | null }>();
  constructor(private ttlMs = 6 * 3600_000, private max = 2000) {}
  get(id: string, now = Date.now()): { meta: VideoMeta | null } | undefined {
    const e = this.map.get(id);
    if (!e) return undefined;
    if (now - e.at > this.ttlMs) { this.map.delete(id); return undefined; }
    return { meta: e.meta };
  }
  set(id: string, meta: VideoMeta | null, now = Date.now()): void {
    this.map.delete(id);
    this.map.set(id, { at: now, meta });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  delete(id: string): void { this.map.delete(id); }
}
