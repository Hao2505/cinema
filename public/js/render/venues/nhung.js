// Rạp Nhung Đỏ (trong nhà): dùng nguyên bộ vẽ ở render/hall.js — tường ốp gỗ, màn nhung + diềm, ghế nhung đỏ, sàn nhảy LED,
// loa cột, quầy BẮP NƯỚC.
import {
  floorTexture, drawRoom, renderRow, drawSpeaker, drawCounter, renderScreenBand, drawDanceLights, drawBeam, drawHallLight, C,
} from '../hall.js';

export default {
  id: 'nhung',
  void: C.void,
  floorTexture,
  renderBand: renderScreenBand,
  drawRoom,
  renderRow: (P, i, dpr) => [renderRow(P, i, dpr)],
  props: () => [],
  drawSpeaker,
  drawCounter,
  drawDanceLights,
  drawBeam,
  drawHallLight,
};
