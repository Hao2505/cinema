// Rạp Đỗ Xe — rạp ngoài trời kiểu Mỹ thập niên 50 về đêm: ngồi xe mui trần xem màn hình khổng lồ.
// Cùng sơ đồ HALL với mọi rạp (đi lại, ghế, va chạm y hệt) — chỉ khác cách vẽ:
//   doxe-band.js  — trời sao, đồi + đèn thành phố, tháp màn hình (viền trắng dày + giàn thép), biển neon DRIVE-IN, skyFx
//   doxe-floor.js — mặt nhựa đường (vạch ô đỗ, lối đi vạch vàng + mũi tên, sàn nhảy bàn cờ viền neon), rào lưới B40,
//                   cột đèn bãi xe, bục bê tông sọc vàng đen dưới tháp
//   doxe-car.js   — hàng ghế = hàng xe mui trần (mỗi cặp ghế một xe), hai lớp quanh người ngồi
//   doxe-props.js — chồng loa ngoài trời, quầy SNACK BAR, đèn sàn nhảy, thiêu thân quanh chao đèn (fx)
// Chùm máy chiếu + ánh màn hình dùng chung với Rạp Nhung Đỏ (render/hall.js).
import { drawBeam, drawHallLight } from '../hall.js';
import { renderBand, skyFx } from './doxe-band.js';
import { floorTexture, drawRoom } from './doxe-floor.js';
import { renderRow } from './doxe-car.js';
import { drawSpeaker, drawCounter, drawDanceLights, fx } from './doxe-props.js';

export default {
  id: 'doxe',
  void: '#05060c',
  floorTexture,
  renderBand,
  drawRoom,
  renderRow,
  props: () => [],
  drawSpeaker,
  drawCounter,
  drawDanceLights,
  drawBeam,
  drawHallLight,
  skyFx,
  fx,
};
