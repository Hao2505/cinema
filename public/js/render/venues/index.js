// Chủ đề vẽ của từng rạp (VENUES trong shared/hall.js). Mọi rạp chung sơ đồ HALL — chủ đề chỉ đổi cách vẽ.
// Rạp Nhung Đỏ nạp sẵn; rạp khác nạp khi cần (import động — trang nhẹ hơn; file một rạp lỗi thì rạp đó tạm vẽ như Rạp
// Nhung Đỏ, các rạp khác vẫn chạy).
//
// Giao diện một chủ đề (render/stage.js gọi):
//   id, void (màu nền canvas)
//   floorTexture(scale)                 → { canvas, x0, x1, z0, z1, scale } sàn nhìn từ trên (vẽ một lần, trải theo phối cảnh)
//   renderBand(L, dpr)                  → { canvas, h } dải phía trên (trời / tường cuối + khung màn hình), px CSS, cache theo
//                                         bố cục. Ô màn hình L.screen phải để trống / tô đen (iframe YouTube nằm đè lên)
//   drawRoom(ctx, P, tex, L, dpr, step) → sàn + hai bên + bục trước màn hình (cache theo camera). Thứ gì cao vẽ đè lên dải
//                                         trên phải cắt bỏ khung video (xem render/hall.js drawRoom: clip 'evenodd')
//   renderRow(P, i, dpr)                → [sprite…] hàng ghế i: { kind:'row', key, z, canvas, x0, y0, w, h, xcam, s };
//                                         key = z + 0.32 (trước mặt người ngồi) hoặc z − 0.3 (lớp phía sau người ngồi)
//   props()                             → vật trang trí sắp theo độ sâu cùng người: [{ key, x, z, draw(ctx, P, now) }]
//   drawSpeaker(ctx, P, sp, now), drawCounter(ctx, P, c, now) — hai loại vật cản có sẵn trong HALL
//   drawDanceLights(ctx, P, dancers, now), drawBeam(ctx, L, now, motes), drawHallLight(ctx, P, L, playing)
//   skyFx?(ctx, L, now)                 → hiệu ứng mỗi khung trên dải trên (sao lấp lánh…) — stage đã cắt bỏ khung video
//   fx?(ctx, P, L, now)                 → hiệu ứng mỗi khung trên khán phòng (đom đóm…)
import { DEFAULT_VENUE } from '../../shared/hall.js';
import nhung from './nhung.js';

const THEMES = new Map([[nhung.id, nhung]]);
const LOADERS = {
  congvien: () => import('./congvien.js'),
  doxe: () => import('./doxe.js'),
  bien: () => import('./bien.js'),
};
const pending = new Map();

/** tải sẵn mọi rạp lúc máy rảnh → chuyển rạp không phải chờ mạng */
export function prefetchThemes() {
  for (const id of Object.keys(LOADERS)) loadTheme(id);
}

/** chủ đề đã nạp (null nếu chưa nạp) */
export function themeOf(id) {
  return THEMES.get(id) || null;
}

export const defaultTheme = nhung;

/** nạp chủ đề của rạp (Promise luôn thành công: lỗi → Rạp Nhung Đỏ) */
export function loadTheme(id) {
  if (THEMES.has(id)) return Promise.resolve(THEMES.get(id));
  const load = LOADERS[id];
  if (!load) return Promise.resolve(THEMES.get(DEFAULT_VENUE));
  if (!pending.has(id)) {
    pending.set(id, load()
      .then((m) => { THEMES.set(id, m.default); return m.default; })
      .catch((e) => { console.warn(`[rạp] không nạp được khung cảnh "${id}"`, e); pending.delete(id); return nhung; }));
  }
  return pending.get(id);
}
