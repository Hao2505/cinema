// YouTube Data API GIẢ cho test / QA: không ra Internet, không tốn quota. Trả siêu dữ liệu theo bảng dưới;
// id lạ (đúng dạng 11 ký tự) = video công khai, cho nhúng, dài 3 phút 20 giây.
import type { FetchResult, VideoMeta, YouTubeClient } from '../src/youtube.js';

const base = (id: string, title: string, durationSec: number, extra: Partial<VideoMeta> = {}): VideoMeta => ({
  id, title, channel: 'Kênh thử nghiệm', durationSec, live: false, upcoming: false, embeddable: true, privacy: 'public',
  ageRestricted: false, regionAllowed: null, regionBlocked: [], processed: true, ...extra,
});

export const FIXTURES: Record<string, VideoMeta | null> = {
  'aqz-KE-bpKQ': base('aqz-KE-bpKQ', 'Big Buck Bunny 60fps 4K — Official Blender Foundation Short Film', 635, { channel: 'Blender' }),
  'YE7VzlLtp-4': base('YE7VzlLtp-4', 'Big Buck Bunny', 597, { channel: 'Blender' }),
  'eRsGyueVLvQ': base('eRsGyueVLvQ', 'Sintel — Open Movie by Blender Foundation', 888, { channel: 'Blender' }),
  'jNQXAC9IVRw': base('jNQXAC9IVRw', 'Me at the zoo', 19, { channel: 'jawed' }),
  noEmbed0001: base('noEmbed0001', 'Video chặn nhúng', 120, { embeddable: false }),
  private0001: base('private0001', 'Video riêng tư', 120, { privacy: 'private' }),
  unlisted001: base('unlisted001', 'Video không công khai', 120, { privacy: 'unlisted' }),
  ageLimit001: base('ageLimit001', 'Video 18+', 120, { ageRestricted: true }),
  noVietnam01: base('noVietnam01', 'Video chặn VN', 120, { regionBlocked: ['VN'] }),
  onlyUS00001: base('onlyUS00001', 'Video chỉ ở Mỹ', 120, { regionAllowed: ['US'] }),
  tooLong0001: base('tooLong0001', 'Phim dài 2 tiếng', 7200),
  liveNow0001: base('liveNow0001', 'Đang phát trực tiếp', 0, { live: true }),
  upcoming001: base('upcoming001', 'Sắp phát trực tiếp', 0, { upcoming: true }),
  shortClip01: base('shortClip01', 'Clip 2 giây', 2),
  missing0001: null,
};

export function createFakeYouTube(opts: { delayMs?: number; fail?: FetchResult } = {}): YouTubeClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    configured: true,
    calls,
    async fetchVideo(id: string): Promise<FetchResult> {
      calls.push(id);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail) return opts.fail;
      if (id in FIXTURES) return { ok: true, meta: FIXTURES[id] };
      return { ok: true, meta: base(id, `Video thử nghiệm ${id}`, 200) };
    },
  };
}
