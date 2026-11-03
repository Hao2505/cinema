// Tùy chọn của người xem — CHỈ trên máy này (localStorage 'vc.prefs'), không gửi lên server, không ảnh hưởng người khác.
// Làm tối xung quanh khi chiếu, tự làm mờ nút khi đang xem, ẩn chat / bong bóng / emoji / động tác / tên / người khác,
// ẩn riêng từng người (theo tên), đèn hiệu ứng, chất lượng hình. Bảng chỉnh: nút ⚙️ (main.js), thẻ người xem (usercard.js).
import { lsGet, lsSet } from './util.js';

const KEY = 'vc.prefs';

export const DEFAULT_PREFS = Object.freeze({
  dim: 'vua', // làm tối xung quanh khi đang chiếu: 'tat' | 'nhe' | 'vua' | 'dam'
  autoHide: true, // đang chiếu + không động chuột / chạm vài giây → mờ bớt các nút
  chat: true, // chat của người khác (khung chat + bong bóng + khung chat nổi)
  bubbles: true, // bong bóng chat trên đầu nhân vật
  feed: true, // khung chat nổi góc dưới trái (máy tính)
  emoji: true, // emoji thả cảm xúc bay lên đầu người khác
  actFx: true, // emoji bay theo động tác (🎵 ❤️ 😂)
  othersActs: true, // hoạt ảnh động tác của người khác (nhảy, vỗ tay…)
  names: 'auto', // tên trên đầu: 'all' | 'auto' (đông người thì bớt) | 'off' (chỉ tên mình)
  people: true, // thấy người khác (tắt = chỉ thấy mình, xem phim yên tĩnh)
  lights: true, // đèn sàn nhảy, chùm máy chiếu, hiệu ứng trời / đom đóm…
  quality: 'auto', // 'auto' | 'high' | 'low'
});

/** mức làm tối khi đang chiếu */
export const DIM_LEVELS = Object.freeze({ tat: 0, nhe: 0.22, vua: 0.38, dam: 0.55 });

const ENUMS = { dim: Object.keys(DIM_LEVELS), names: ['all', 'auto', 'off'], quality: ['auto', 'high', 'low'] };

function load() {
  const p = { ...DEFAULT_PREFS, hidden: {} };
  try {
    const raw = JSON.parse(lsGet(KEY, '') || '{}');
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(DEFAULT_PREFS)) {
        const v = raw[k];
        if (typeof DEFAULT_PREFS[k] === 'boolean' && typeof v === 'boolean') p[k] = v;
        else if (ENUMS[k] && ENUMS[k].includes(v)) p[k] = v;
      }
      if (raw.hidden && typeof raw.hidden === 'object') {
        for (const [key, f] of Object.entries(raw.hidden).slice(0, 300)) {
          if (!f || typeof f !== 'object' || typeof f.name !== 'string') continue;
          const e = { name: f.name.slice(0, 40), chat: !!f.chat, acts: !!f.acts, all: !!f.all };
          if (e.chat || e.acts || e.all) p.hidden[key.slice(0, 60)] = e;
        }
      }
    }
  } catch { /* hỏng thì dùng mặc định */ }
  return p;
}

export const prefs = load();
const listeners = new Set();

function save(key) {
  lsSet(KEY, JSON.stringify(prefs));
  for (const fn of listeners) { try { fn(key); } catch (e) { console.warn('[tùy chọn]', e); } }
}

/** nghe mọi lần đổi tùy chọn (key = tên tùy chọn, 'hidden' khi đổi theo người, '*' khi khôi phục mặc định) */
export function onPrefs(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setPref(key, value) {
  if (!(key in DEFAULT_PREFS) || prefs[key] === value) return;
  prefs[key] = value;
  save(key);
}

export function resetPrefs() {
  Object.assign(prefs, DEFAULT_PREFS, { hidden: {} });
  save('*');
}

// ---------------------------------------------------------------- ẩn theo người (khoá = tên, vì id đổi mỗi lần vào lại)
export const personKey = (name) => String(name || '').normalize('NFC').trim().toLowerCase();

/** { name, chat, acts, all } hoặc null */
export function personFlags(name) {
  return prefs.hidden[personKey(name)] || null;
}

/** flag: 'chat' (ẩn tin nhắn) · 'acts' (ẩn động tác + emoji) · 'all' (ẩn hẳn người này) */
export function setPersonFlag(name, flag, on) {
  const key = personKey(name);
  if (!key) return;
  const e = prefs.hidden[key] || { name: String(name).slice(0, 40), chat: false, acts: false, all: false };
  e[flag] = !!on;
  if (e.chat || e.acts || e.all) prefs.hidden[key] = e;
  else delete prefs.hidden[key];
  save('hidden');
}

export function unhidePerson(key) {
  if (!prefs.hidden[key]) return;
  delete prefs.hidden[key];
  save('hidden');
}

export const hiddenList = () => Object.entries(prefs.hidden).map(([key, e]) => ({ key, ...e }));

// ---------------------------------------------------------------- hỏi nhanh cho phần vẽ / chat (người mình luôn hiện)
/** thấy nhân vật này không */
export function showPerson(name, isMe) {
  if (isMe) return true;
  if (!prefs.people) return false;
  return !personFlags(name)?.all;
}

/** thấy chat (khung chat, khung nổi) của người này không */
export function showChatFrom(name, isMe) {
  if (isMe) return true;
  if (!prefs.chat) return false;
  const f = personFlags(name);
  return !(f && (f.chat || f.all));
}

/** thấy động tác (hoạt ảnh) của người này không */
export function showActsFrom(name, isMe) {
  if (isMe) return true;
  if (!prefs.othersActs) return false;
  const f = personFlags(name);
  return !(f && (f.acts || f.all));
}

/** thấy emoji cảm xúc người này thả không */
export function showEmojiFrom(name, isMe) {
  if (isMe) return true;
  if (!prefs.emoji) return false;
  const f = personFlags(name);
  return !(f && (f.acts || f.all));
}
