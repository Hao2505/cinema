// Hoạt ảnh 8 động tác: hàm thuần (id, t = ms kể từ lúc bắt đầu, view, seated) → tham số `anim` cho drawCharacter.
// Server chỉ báo "A bắt đầu điệu X lúc T"; mọi máy tự tính tư thế ở 60 fps từ t nên ai cũng thấy cùng một nhịp.
// Quy ước góc tay (character.js): 0 = buông thẳng; dương = xoay về phía -x màn hình. Nhìn nghiêng vẽ cho hướng trái
// (-x là phía trước), hướng phải lật gương.
import { clamp, easeInOut } from '../util.js';

const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;

/** độ "vào / ra" của động tác một lần: 0 → 1 trong inMs đầu, 1 → 0 trong outMs cuối */
function envelope(t, dur, inMs = 220, outMs = 260) {
  if (t < 0) return 0;
  if (t < inMs) return easeInOut(t / inMs);
  if (dur && t > dur - outMs) return easeInOut(clamp((dur - t) / outMs, 0, 1));
  return 1;
}

/**
 * Tư thế cho động tác. Trả về { anim, pose?, hold?, dir? } hoặc null (không có động tác).
 * view: 'down' | 'up' | 'left' (nghiêng, đã quy về hướng trái); seated: đang ngồi ghế.
 */
export function actionPose(id, t, view, seated, dir = 'down') {
  const side = view === 'left';
  switch (id) {
    case 'wave': {
      const e = envelope(t, 2400);
      const w = Math.sin((t / 1000) * TAU * 3.0) * 0.36;
      if (side) return { anim: { arms: { near: { a: lerp(0.06, 2.5 + w, e), len: 10.2 } }, mood: 'happy', headTilt: w * 0.08 * e } };
      return {
        anim: {
          arms: { l: { a: 0.14 }, r: { a: lerp(-0.12, -2.5 + w, e), len: 10.2 } },
          mood: 'happy', headTilt: -0.06 * e, bx: 0.4 * e,
        },
      };
    }
    case 'clap': {
      const e = envelope(t, 3000, 200, 240);
      const osc = (1 + Math.sin((t / 1000) * TAU * 2.6)) / 2;
      if (side) {
        return { anim: { arms: { near: { a: lerp(0.06, 1.3 + osc * 0.16, e), len: 9.4 }, far: { a: lerp(0, 1.2 - osc * 0.12, e), len: 9.0 } }, mood: 'happy' } };
      }
      return {
        anim: {
          arms: { l: { a: lerp(0.12, -(0.5 + osc * 0.46), e), len: 9.4 }, r: { a: lerp(-0.12, 0.5 + osc * 0.46, e), len: 9.4 } },
          front: true, mood: 'happy', bob: -osc * 0.4 * e,
        },
      };
    }
    case 'hiphop': {
      const b = t / 560; // ~107 nhịp / phút
      const k = Math.sin(b * Math.PI);
      const bounce = -Math.abs(Math.sin(b * Math.PI)) * 2.6;
      const step = Math.sin(b * Math.PI);
      if (side) {
        return {
          pose: 'stand',
          anim: {
            bob: bounce, stride: step * 0.36, lean: k * 0.05, headTilt: Math.sin(b * Math.PI + 0.6) * 0.1,
            arms: { near: { a: 0.5 + 1.7 * (0.5 + 0.5 * k), len: 9.8 }, far: { a: 0.5 + 1.7 * (0.5 - 0.5 * k), len: 9.4 } },
            mood: 'happy',
          },
        };
      }
      return {
        pose: 'stand',
        anim: {
          bob: bounce, bx: k * 2.2, lean: k * 0.07, headTilt: Math.sin(b * Math.PI + 0.6) * 0.1,
          legL: Math.max(0, step) * 2.4, legR: Math.max(0, -step) * 2.4,
          arms: { l: { a: 0.6 + 1.6 * (0.5 - 0.5 * k), len: 9.8 }, r: { a: -(0.6 + 1.6 * (0.5 + 0.5 * k)), len: 9.8 } },
          mood: 'happy',
        },
      };
    }
    case 'headbang': {
      const n = (t / 460) * TAU;
      const nod = (1 - Math.cos(n)) / 2; // 0..1
      const pump = Math.sin(n) * 0.26;
      if (side) {
        return {
          anim: {
            headDY: nod * 2.2, headTilt: -nod * 0.22, bob: nod * 0.9, squat: seated ? 0 : 0.15,
            arms: { near: { a: 2.75 + pump, len: 9.2 } }, eyes: 'closed', mouth: true, mood: 'happy',
          },
        };
      }
      return {
        anim: {
          headDY: nod * 3.0, headTilt: Math.sin(n / 2) * 0.12, bob: nod * 0.9, squat: seated ? 0 : 0.15,
          arms: { l: { a: 0.28 + Math.sin(n) * 0.1 }, r: { a: -2.75 + pump, len: 9.2 } },
          eyes: 'closed', mouth: true, mood: 'happy',
        },
      };
    }
    case 'bounce': {
      const n = (t / 520) * TAU;
      const dip = (1 - Math.cos(n)) / 2;
      const sw = Math.sin(n);
      const base = seated ? { bob: dip * 1.6 } : { squat: dip * 0.9, bob: -Math.max(0, Math.cos(n)) * 0.7 };
      if (side) {
        return { anim: { ...base, headTilt: Math.sin(n / 2) * 0.1, arms: { near: { a: 0.6 + sw * 0.5, len: 9.2 }, far: { a: 0.6 - sw * 0.5, len: 9.0 } }, mood: 'happy' } };
      }
      return {
        anim: {
          ...base, bx: Math.sin(n / 2) * 1.0, headTilt: Math.sin(n / 2) * 0.12,
          arms: { l: { a: 0.55 + sw * 0.35, len: 9.0 }, r: { a: -0.55 + sw * 0.35, len: 9.0 } }, mood: 'happy',
        },
      };
    }
    case 'sit': {
      // ngồi xem + bắp rang: thỉnh thoảng bốc ăn
      const cyc = t % 3400;
      const eat = cyc > 2500 && cyc < 3150 ? Math.sin(((cyc - 2500) / 650) * Math.PI) : 0;
      const pose = seated ? 'sit' : 'floor';
      if (view === 'up') return { pose, hold: 'popcorn', dir: 'up', anim: null };
      if (side) return { pose, hold: 'popcorn', anim: { arms: { near: { a: 1.05, len: 8.6, hold: 'popcorn' } } } };
      return {
        pose, hold: 'popcorn',
        anim: { arms: { l: { a: lerp(-0.62, -1.45, eat), len: lerp(8.4, 7.6, eat) }, r: { a: 0.72, len: 8.4, hold: 'popcorn' } }, mouth: eat > 0.4 },
      };
    }
    case 'heart': {
      const e = envelope(t, 2200, 260, 280);
      const beat = 1 + Math.sin(t / 110) * 0.12;
      if (side) return { anim: { arms: { near: { a: lerp(0.06, 1.75, e), len: 8.8 }, far: { a: lerp(0, 1.65, e), len: 8.6 } }, heart: e * beat, mood: 'happy' } };
      return {
        anim: { arms: { l: { a: lerp(0.12, -1.18, e), len: 8.6 }, r: { a: lerp(-0.12, 1.18, e), len: 8.6 } }, heart: e * beat, front: true, mood: 'happy' },
      };
    }
    case 'laugh': {
      // cười lăn: ngã nghiêng ra sàn, lắc + đạp chân, rồi đứng dậy
      const shake = Math.sin(t / 62) * 0.07;
      const kick = Math.sin(t / 105);
      const belly = { l: { a: -0.95, len: 8.2 }, r: { a: 0.95, len: 8.2 } };
      if (seated) {
        const e = envelope(t, 3600, 200, 300);
        return { anim: { arms: side ? { near: { a: 1.0, len: 8 } } : belly, front: true, bob: Math.abs(Math.sin(t / 80)) * 1.2 * e, headTilt: shake * 2 * e, mouth: true, eyes: 'closed', mood: 'happy' } };
      }
      const fall = dir === 'left' ? -1 : 1;
      let k;
      if (t < 380) k = easeInOut(t / 380);
      else if (t < 3000) k = 1;
      else k = 1 - easeInOut(clamp((t - 3000) / 600, 0, 1));
      const lying = k > 0.5 && t >= 380 && t < 3000;
      return {
        pose: 'stand',
        anim: {
          lean: fall * (k * 1.36 + (lying ? shake : 0)), pivot: -9, liftY: k * 4.2,
          legL: lying ? Math.max(0, kick) * 3.2 : 0, legR: lying ? Math.max(0, -kick) * 3.2 : 0,
          arms: side ? { near: { a: 1.0, len: 8 } } : belly, front: true,
          mouth: true, eyes: 'closed', mood: 'happy',
        },
      };
    }
    default:
      return null;
  }
}

/** emoji bay lên khi bắt đầu động tác (và nhịp lặp lại với điệu nhảy) */
export const ACTION_FX = {
  wave: { start: ['👋'] },
  clap: { start: ['👏'], every: 900, pool: ['👏'] },
  hiphop: { start: ['🕺'], every: 1500, pool: ['🎵', '🎶', '🔥'] },
  headbang: { start: ['🤘'], every: 1300, pool: ['🤘', '🎸', '🔥'] },
  bounce: { start: ['🎶'], every: 1600, pool: ['🎵', '🎶'] },
  sit: { start: ['🍿'] },
  heart: { start: ['❤️'], every: 260, pool: ['❤️', '💖', '💕', '💗'], until: 1900 },
  laugh: { start: ['🤣'], every: 700, pool: ['😂', '🤣'], until: 3000 },
};
