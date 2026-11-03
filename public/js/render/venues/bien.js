// Rạp Bãi Biển — rạp chiếu ngoài trời trên bãi cát, đêm trăng rằm. Cùng sơ đồ HALL với mọi rạp, chỉ khác cách vẽ.
// (1) Dải trên (px CSS, cache theo bố cục): trời sao, trăng tròn cạnh màn hình (+ mây), biển + vệt trăng, đảo nhỏ có
//     hải đăng, đèn thuyền câu mực ở chân trời, bờ cát, hàng dừa xa; màn hình căng trên giàn tre (hai cột, xà, chỗ buộc
//     dây, dây néo, dây bóng đèn), viền khung tre quanh video.
// (2) Phòng (cache theo camera): cát đêm (gợn gió, vỏ sò, sao biển, dấu chân, bóng ghế), sàn gỗ nhảy ván dọc viền đèn
//     dây, bục gỗ dưới màn hình có cọc + hũ đèn, hàng rào cọc gỗ dây thừng dọc hai bên; ngoài hàng rào: dừa + đuốc tiki.
//     Vật ở NGOÀI hàng rào (x < 1 / x > 33) luôn nằm sau người & ghế: chỗ nào chúng chồng lên nhau trên màn hình thì vật
//     ngoài rìa ở xa camera hơn (phép chiếu một điểm tụ) → vẽ thẳng vào lớp phòng (cache), không cần sắp độ sâu, và không
//     bị cắt ở mép dưới video như lớp người.
// (3) Sắp theo độ sâu: ghế xếp gỗ vải sọc (một lớp vẽ sau người ngồi: lưng ghế che thân dưới, cao theo góc nhìn),
//     đuốc hai góc trước sàn gỗ, loa thùng gỗ khung tre mái lá, quầy NƯỚC DỪA mái lá.
// (4) Mỗi khung (rẻ): lửa đuốc lập loè + tàn lửa bay, sao lấp lánh, vệt trăng lăn tăn, sóng vỗ bờ, hải đăng nháy, quầng
//     ấm dưới chân người nhảy + đốm đèn quét, chùm máy chiếu, ánh màn hình hắt xuống.
import { HALL, SEATS } from '../../shared/hall.js';
import { hash2, clamp, lerp } from '../../util.js';
import { FONT, fillRR, rrPath, makeCanvas, vGrad, softShadow } from '../draw.js';
import { box, poly, drawFloor, projection } from '../persp.js';
import { ZW, STAGE_H } from '../hall.js';
import {
  ART, drawPalm, drawTorchBody, drawFlame, glowSprite, poolSprite, stampGlow, bambooV, bambooH, lashing, ropeLine, shadeRgb,
  drawSurfboard, drawSandcastle, drawLifebuoy,
} from './bien-art.js';

const W = HALL.W, H = HALL.H;
const XL = 1, XR = W - 1; // hàng rào hai bên

const C = {
  void: '#594f41', // = cát ngoài hàng rào (phần sàn ngoài texture, nếu có, liền màu)
  sand: '#655a4a',
  sandOut: '#594f41',
  deckGap: '#20160e',
  deckEdge: '#3a291b',
  wood: '#8a6844', woodLo: '#563e27', woodHi: '#b38c5c',
  post: '#57412d', postTop: '#7b5d41', postSide: '#3a2b1d',
};

// vải ghế xếp: cặp sọc (tối bớt cho hợp đêm khi vẽ)
const FABRIC = [
  ['#c2414b', '#e6dcc4'], ['#2f72ad', '#e0e6ec'], ['#d6a63a', '#2d8f88'], ['#e2793a', '#f1e2c4'],
  ['#3f9560', '#e8e0ca'], ['#d26a90', '#f2e4ea'], ['#26a4a1', '#f2dfb2'], ['#5b5fb3', '#e9e1cf'],
];
const TOWELS = [['#f2c14e', '#e2553f'], ['#58c4dd', '#ffffff'], ['#f08cb0', '#ffffff'], ['#7bd389', '#2d6a4f'], ['#ff9f43', '#1e3a5f']];

// ngoài hàng rào (vẽ vào lớp phòng): dừa (x, z, cao, ngả ngọn, seed) + đuốc
const PALMS = [
  { x: -0.75, z: -0.55, h: 5.3, lean: -1.5, seed: 3 },
  { x: -2.3, z: 3.0, h: 4.5, lean: 0.7, seed: 8 },
  { x: -1.6, z: 8.8, h: 4.9, lean: 1.1, seed: 13 },
  { x: -2.6, z: 14.2, h: 4.6, lean: 0.8, seed: 21 },
  { x: 34.75, z: -0.45, h: 5.0, lean: 1.45, seed: 5 },
  { x: 36.1, z: 5.4, h: 4.7, lean: -0.8, seed: 34 },
  { x: 35.4, z: 11.2, h: 5.0, lean: -1.1, seed: 55 },
].sort((a, b) => a.z - b.z);
const TORCHES = [
  ...[1.5, 4.9, 8.3, 11.7, 15.1].map((z, i) => ({ x: 0.32, z, seed: i * 1.7 + 0.3 })),
  ...[1.2, 6.4, 9.8, 13.2].map((z, i) => ({ x: 33.68, z, seed: i * 2.3 + 1.1 })),
];
const SURFBOARDS = [
  { x: -0.55, z: 6.0, lean: -0.1, col: '#2a8f8c', stripe: '#f2e6c8' },
  { x: -0.2, z: 6.35, lean: 0.07, col: '#d9674f', stripe: '#f6d36b' },
];
const CASTLE = { x: 34.3, z: 8.1 };
const BUOY = { x: XR, z: 7.0 }; // phao treo trên cọc rào phải
// đuốc hai góc trước sàn gỗ (trong rạp → sắp độ sâu cùng người)
const DECK_TORCHES = [{ x: 3.55, z: 5.55, seed: 7.7 }, { x: 30.45, z: 5.55, seed: 9.1 }];
const TORCH_H = 1.3; // cán đuốc (ô); ngọn lửa bắt đầu cao TORCH_H + 0.26
const FLAME_BASE = TORCH_H + 0.26;

// trạng thái chia sẻ giữa các lớp: phép chiếu / bố cục mà lớp phòng vừa dùng, khung bao dừa (để hiệu ứng trời né)
const cur = { P: null, L: null, palmBoxes: [] };
let BG = null; // hình học dải trên của bố cục hiện tại

const dprOf = (ctx) => ctx.getTransform().a || 1;
const inDeck = (x, z, m = 0) => {
  const d = HALL.danceFloor;
  return x > d.x - m && x < d.x + d.w + m && z > d.y - m && z < d.y + d.h + m;
};

// ================================================================ (2a) cát: texture nhìn từ trên xuống
const TEX = { x0: -12, x1: W + 12, z0: -0.3, z1: H + 7 }; // rộng: máy ngang / màn nhỏ vẫn phủ kín hai mép
const TRAILS = [
  [[17.2, 23], [16.6, 15.6], [11.3, 12.6], [10.9, 7.6], [9.4, 5.9]],
  [[27.5, 23], [24.3, 15], [23.1, 10.4], [23.3, 6.6], [25.2, 5.8]],
  [[6.5, 23], [3.8, 16.2], [1.6, 11], [1.7, 6.3], [2.6, 3.4]],
  [[-3.2, 22], [-1.4, 12.5], [-2.2, 7.0], [-0.6, 1.8]],
  [[37.5, 21], [35.0, 14.5], [34.3, 8.0], [36.4, 2.5]],
];

function floorTexture(scale = 48) {
  const TW = TEX.x1 - TEX.x0, TH = TEX.z1 - TEX.z0;
  const cv = makeCanvas(TW * scale, TH * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, -TEX.x0 * scale, -TEX.z0 * scale);
  ctx.fillStyle = C.sand;
  ctx.fillRect(TEX.x0, TEX.z0, TW, TH);
  // ngoài hàng rào: cát đụn tối hơn, chuyển mềm qua mép
  for (const side of [-1, 1]) {
    const xe = side < 0 ? XL : XR;
    const g = ctx.createLinearGradient(xe, 0, xe + side * 1.4, 0);
    g.addColorStop(0, C.sand);
    g.addColorStop(1, C.sandOut);
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(xe, xe + side * 1.4), TEX.z0, 1.4, TH);
    ctx.fillStyle = C.sandOut;
    if (side < 0) ctx.fillRect(TEX.x0, TEX.z0, XL - 1.4 - TEX.x0, TH);
    else ctx.fillRect(XR + 1.4, TEX.z0, TEX.x1 - XR - 1.4, TH);
  }
  // mảng loang lớn sáng / tối
  for (let i = 0; i < 120; i++) {
    const x = TEX.x0 + hash2(i, 1, 41) * TW, z = TEX.z0 + hash2(i, 2, 41) * TH;
    const r = 0.7 + hash2(i, 3, 41) * 2.6;
    const lt = hash2(i, 4, 41) > 0.45;
    const g = ctx.createRadialGradient(x, z, 0, x, z, r);
    g.addColorStop(0, lt ? 'rgba(255,236,205,0.05)' : 'rgba(16,10,5,0.08)');
    g.addColorStop(1, lt ? 'rgba(255,236,205,0)' : 'rgba(16,10,5,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, z - r, r * 2, r * 2);
  }
  // gợn cát (gió): từng cụm đường lượn sóng song song
  ctx.lineCap = 'round';
  for (let i = 0; i < 80; i++) {
    const cx = TEX.x0 + hash2(i, 11, 43) * TW, cz = TEX.z0 + hash2(i, 12, 43) * TH;
    if (inDeck(cx, cz, 1.2)) continue;
    const n = 3 + Math.floor(hash2(i, 13, 43) * 4);
    const len = 1.4 + hash2(i, 14, 43) * 3.2;
    const ph = hash2(i, 15, 43) * 6.28;
    for (let k = 0; k < n; k++) {
      const z = cz + k * 0.32;
      const l = len * (1 - (Math.abs(k - (n - 1) / 2) / n) * 0.9);
      sandRipple(ctx, cx - l / 2, cx + l / 2, z, ph + k * 0.8);
    }
  }
  // dấu chân
  for (const tr of TRAILS) footprints(ctx, tr);
  // bóng dừa (trăng sau màn hình → bóng đổ về phía người xem) + vũng sáng ấm quanh đuốc
  for (const pm of PALMS) {
    ctx.save();
    ctx.translate(pm.x + pm.lean * 0.25, pm.z + 1.4);
    ctx.scale(0.55, 1.7);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(12,8,4,0.26)');
    g.addColorStop(1, 'rgba(12,8,4,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    blob(ctx, pm.x, pm.z + 0.05, 0.42, 0.3, 'rgba(10,6,3,0.35)');
  }
  for (const t of TORCHES.concat(DECK_TORCHES)) {
    const g = ctx.createRadialGradient(t.x, t.z, 0, t.x, t.z, 2.1);
    g.addColorStop(0, 'rgba(255,165,80,0.26)');
    g.addColorStop(0.45, 'rgba(255,150,70,0.1)');
    g.addColorStop(1, 'rgba(255,150,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(t.x - 2.1, t.z - 2.1, 4.2, 4.2);
    blob(ctx, t.x, t.z + 0.08, 0.12, 0.08, 'rgba(10,6,3,0.4)');
  }
  // vỏ sò, sao biển, sỏi (né sàn gỗ)
  for (let i = 0; i < 150; i++) {
    const x = TEX.x0 + hash2(i, 21, 47) * TW, z = TEX.z0 + 0.3 + hash2(i, 22, 47) * (TH - 0.3);
    if (inDeck(x, z, 0.15)) continue;
    const kind = hash2(i, 23, 47);
    if (kind < 0.42) shell(ctx, x, z, 0.07 + hash2(i, 24, 47) * 0.05, hash2(i, 25, 47) * 6.28, i);
    else if (kind < 0.47) starfish(ctx, x, z, 0.13 + hash2(i, 26, 47) * 0.06, hash2(i, 27, 47) * 6.28);
    else blob(ctx, x, z, 0.025 + hash2(i, 28, 47) * 0.04, 0.02 + hash2(i, 29, 47) * 0.03, `rgba(${hash2(i, 30, 47) > 0.5 ? '35,30,26' : '120,110,96'},0.55)`);
  }
  // bóng ghế xếp (ánh màn hình / trăng phía trước → bóng đổ ra sau lưng ghế)
  for (const s of SEATS) {
    ctx.save();
    ctx.translate(s.x, s.y + 0.22);
    ctx.scale(1, 0.78);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.56);
    g.addColorStop(0, 'rgba(12,8,4,0.36)');
    g.addColorStop(0.65, 'rgba(12,8,4,0.2)');
    g.addColorStop(1, 'rgba(12,8,4,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.6, -0.6, 1.2, 1.2);
    ctx.restore();
  }
  // bóng loa + quầy bar
  for (const sp of HALL.speakers) softRect(ctx, sp.x - 0.05, sp.y + 0.1, sp.w + 0.1, sp.h + 0.35, 0.3);
  const cb = HALL.counter;
  softRect(ctx, cb.x - 0.35, cb.y - 0.1, cb.w + 0.5, cb.h + 0.6, 0.32);
  // đèn vỏ sò dọc lối đi giữa các dãy ghế
  const b = HALL.blocks;
  for (const [a0, a1] of [[b[0].x0 + b[0].n, b[1].x0], [b[1].x0 + b[1].n, b[2].x0]]) {
    for (const rz of HALL.rows) for (const lx of [a0 + 0.16, a1 - 0.16]) lampDot(ctx, lx, rz + 0.55, 0.05);
  }
  drawDeckTex(ctx);
  // bóng bục sân khấu đổ xuống mép cát
  ctx.fillStyle = vGrad(ctx, 0, 0.7, [[0, 'rgba(8,5,2,0.5)'], [1, 'rgba(8,5,2,0)']]);
  ctx.fillRect(XL - 0.3, 0, XR - XL + 0.6, 0.7);
  grain(ctx, cv);
  return { canvas: cv, ...TEX, scale };
}

function blob(ctx, x, z, rx, rz, fill) {
  ctx.beginPath();
  ctx.ellipse(x, z, rx, rz, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function softRect(ctx, x, z, w, h, a) {
  softShadow(ctx, x, z, w, h, 0.2, 0.14, `rgba(10,6,3,${a})`);
}

function sandRipple(ctx, x0, x1, z, ph) {
  const path = (dz) => {
    ctx.beginPath();
    for (let x = x0; x <= x1 + 0.001; x += 0.14) {
      const y = z + dz + Math.sin(x * 1.5 + ph) * 0.06 + Math.sin(x * 3.7 + ph * 2) * 0.02;
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  };
  path(0.03);
  ctx.strokeStyle = 'rgba(22,15,8,0.19)';
  ctx.lineWidth = 0.11;
  ctx.stroke();
  path(-0.06);
  ctx.strokeStyle = 'rgba(255,238,212,0.09)';
  ctx.lineWidth = 0.07;
  ctx.stroke();
}

function footprints(ctx, pts) {
  let side = 1, carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const d = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / d, uz = (bz - az) / d;
    let t = carry;
    for (; t < d; t += 0.36) {
      const x = ax + ux * t - uz * 0.08 * side, z = az + uz * t + ux * 0.08 * side;
      side = -side;
      if (inDeck(x, z, 0.1)) continue;
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(Math.atan2(uz, ux));
      blob(ctx, 0.03, 0, 0.07, 0.04, 'rgba(20,13,7,0.22)');
      blob(ctx, -0.07, 0, 0.035, 0.03, 'rgba(20,13,7,0.2)');
      blob(ctx, 0.04, -0.012, 0.05, 0.022, 'rgba(255,236,206,0.05)');
      ctx.restore();
    }
    carry = t - d;
  }
}

function shell(ctx, x, z, r, rot, i) {
  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, r * 0.35);
  ctx.arc(0, r * 0.35, r, Math.PI * 1.08, Math.PI * 1.92);
  ctx.closePath();
  const tint = hash2(i, 31, 47);
  ctx.fillStyle = tint < 0.33 ? 'rgba(228,206,196,0.7)' : tint < 0.66 ? 'rgba(232,222,200,0.7)' : 'rgba(214,178,160,0.65)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,70,60,0.35)';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  for (let k = -2; k <= 2; k++) {
    const a = -Math.PI / 2 + k * 0.32;
    ctx.moveTo(0, r * 0.3);
    ctx.lineTo(Math.cos(a) * r * 0.9, r * 0.35 + Math.sin(a) * r * 0.9);
  }
  ctx.stroke();
  ctx.restore();
}

function starfish(ctx, x, z, r, rot) {
  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 ? r * 0.42 : r;
    if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(190,104,64,0.8)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,200,150,0.35)';
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function lampDot(ctx, x, z, r) {
  const g = ctx.createRadialGradient(x, z, 0, x, z, r * 6);
  g.addColorStop(0, 'rgba(255,196,120,0.5)');
  g.addColorStop(0.4, 'rgba(255,180,100,0.16)');
  g.addColorStop(1, 'rgba(255,180,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 6, z - r * 6, r * 12, r * 12);
  blob(ctx, x, z, r, r * 0.8, '#ffdca0');
}

/** sàn gỗ nhảy: ván dọc theo chiều sâu (chụm về màn hình), khung viền, dây đèn quanh mép */
function drawDeckTex(ctx) {
  const d = HALL.danceFloor;
  const x0 = d.x, x1 = d.x + d.w, z0 = d.y, z1 = d.y + d.h;
  // bóng mép trước: sàn kê cao hơn cát
  ctx.fillStyle = 'rgba(10,6,3,0.42)';
  ctx.fillRect(x0 - 0.05, z1 + 0.1, d.w + 0.2, 0.18);
  ctx.fillStyle = C.deckEdge;
  ctx.fillRect(x0 - 0.14, z0 - 0.12, d.w + 0.28, d.h + 0.26);
  const pw = 0.34;
  let i = 0;
  for (let x = x0; x < x1 - 0.01; x += pw, i++) {
    const w = Math.min(pw, x1 - x);
    const jz = z0 + 0.7 + hash2(i, 1, 63) * (d.h - 1.4);
    for (const [a, b, k] of [[z0, jz, 0], [jz, z1, 1]]) {
      const t = hash2(i, k + 2, 63);
      ctx.fillStyle = `rgb(${Math.round(100 + t * 26)},${Math.round(72 + t * 19)},${Math.round(50 + t * 14)})`;
      ctx.fillRect(x, a, w - 0.04, b - a - 0.035);
      ctx.fillStyle = 'rgba(30,18,8,0.14)';
      for (let gk = 0; gk < 2; gk++) ctx.fillRect(x + 0.06 + hash2(i, k * 3 + gk, 64) * (w - 0.16), a + 0.1, 0.02, b - a - 0.25);
      ctx.fillStyle = 'rgba(255,225,180,0.07)';
      ctx.fillRect(x, a, 0.04, b - a - 0.035);
    }
    ctx.fillStyle = C.deckGap;
    ctx.fillRect(x + w - 0.04, z0, 0.04, d.h);
    ctx.fillStyle = 'rgba(220,210,190,0.35)';
    for (const nz of [z0 + 0.12, jz - 0.12, jz + 0.08, z1 - 0.14]) ctx.fillRect(x + w * 0.5 - 0.02, nz, 0.04, 0.04);
  }
  // nẹp viền + mép trước sáng
  ctx.fillStyle = '#4a3423';
  ctx.fillRect(x0 - 0.14, z1, d.w + 0.28, 0.14);
  ctx.fillStyle = 'rgba(255,220,170,0.16)';
  ctx.fillRect(x0 - 0.14, z1, d.w + 0.28, 0.035);
  // ánh màn hình hắt xuống phần sàn gần màn
  ctx.fillStyle = vGrad(ctx, z0, z1, [[0, 'rgba(170,190,255,0.10)'], [1, 'rgba(170,190,255,0)']]);
  ctx.fillRect(x0, z0, d.w, d.h);
  // dây đèn quanh sàn
  const pts = [];
  const step = 0.62;
  const ex0 = x0 - 0.07, ex1 = x1 + 0.07, ez0 = z0 - 0.06, ez1 = z1 + 0.07;
  for (let x = ex0; x <= ex1; x += step) { pts.push([x, ez0]); pts.push([x, ez1]); }
  for (let z = ez0 + step; z < ez1 - step * 0.5; z += step) { pts.push([ex0, z]); pts.push([ex1, z]); }
  ctx.strokeStyle = 'rgba(25,18,12,0.8)';
  ctx.lineWidth = 0.04;
  ctx.strokeRect(ex0, ez0, ex1 - ex0, ez1 - ez0);
  for (const [x, z] of pts) {
    const g = ctx.createRadialGradient(x, z, 0, x, z, 0.26);
    g.addColorStop(0, 'rgba(255,200,125,0.5)');
    g.addColorStop(1, 'rgba(255,200,125,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 0.26, z - 0.26, 0.52, 0.52);
    blob(ctx, x, z, 0.055, 0.055, '#ffe7b6');
  }
}

/** hạt cát: nhiễu nhẹ từng điểm ảnh (một lần) */
function grain(ctx, cv) {
  let img;
  try { img = ctx.getImageData(0, 0, cv.width, cv.height); } catch { return; }
  const px = img.data;
  let seed = 0x2f6b1d;
  for (let i = 0; i < px.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = ((seed >>> 24) - 128) * 0.075;
    px[i] += n; px[i + 1] += n; px[i + 2] += n * 0.85;
  }
  ctx.putImageData(img, 0, 0);
}

// ================================================================ (1) dải trên: trời, trăng, biển, bờ, giàn tre
function bandGeom(L) {
  const sc = L.screen, fr = L.frame, sw = L.sw, AW = L.availW;
  const yPF = L.vb + 0.3 * sw; // mép xa của bục (mặt trên chạm tường màn hình)
  const pw = clamp(sw * 0.3, 3, 11), gap = clamp(sw * 0.13, 1.5, 6);
  const poleL = sc.x - fr - gap - pw, poleR = sc.x + sc.w + fr + gap;
  const beamH = clamp(sw * 0.24, 3, 9);
  const beamY = sc.y - fr - 1.5 - beamH;
  const poleTop = beamY - clamp(sw * 0.42, 4, 14);
  const yH = Math.round(sc.y + sc.h * 0.5); // chân trời
  const ySh = Math.round(lerp(yH, yPF, 0.6)); // mép nước
  const left = { x0: 0, x1: Math.max(0, poleL - 3) };
  const right = { x0: Math.min(AW, poleR + pw + 3), x1: AW };
  const lw = left.x1 - left.x0, rw = right.x1 - right.x0;
  const mp = rw >= 46 ? right : lw >= 46 ? left : null;
  let moon = null;
  if (mp) {
    const w = mp.x1 - mp.x0;
    const r = clamp(Math.min(w * 0.24, sc.h * 0.085, 44), 9, 44);
    const y = clamp(sc.y + sc.h * 0.2, 50 + r, Math.max(50 + r, yH - r * 2.4));
    moon = { x: mp.x0 + w * (mp === right ? 0.56 : 0.44), y, r, side: mp === right ? 1 : -1 };
  }
  return {
    L, sc, fr, sw, AW, yPF, pw, gap, poleL, poleR, beamH, beamY, poleTop, yH, ySh, left, right, moon,
    stars: [], twinkles: [], boxes: [], ropes: [], gaps: [], light: null,
  };
}

function renderBand(L, dpr) {
  const bandH = Math.ceil(L.Yf + 2);
  const cv = makeCanvas(L.w * dpr, bandH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const G = bandGeom(L);
  drawSky(ctx, G);
  drawStars(ctx, G);
  if (G.moon) drawMoon(ctx, G.moon);
  drawClouds(ctx, G);
  drawSea(ctx, G);
  drawIsland(ctx, G);
  drawBoats(ctx, G);
  drawBeach(ctx, G, bandH);
  drawBasketBoats(ctx, G);
  drawFarPalms(ctx, G);
  drawRig(ctx, G);
  const sc = L.screen;
  ctx.fillStyle = '#000';
  ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
  pickTwinkles(G);
  BG = G;
  return { canvas: cv, h: bandH };
}

function drawSky(ctx, G) {
  const { L, yH } = G;
  ctx.fillStyle = vGrad(ctx, 0, yH, [[0, '#040817'], [0.45, '#0a1431'], [0.82, '#15254a'], [1, '#22365d']]);
  ctx.fillRect(0, 0, L.w, yH + 1);
  // dải ngân hà rất mờ, chéo trời
  ctx.save();
  ctx.translate(L.w * 0.5, yH * 0.35);
  ctx.rotate(-0.32);
  const mw = Math.max(40, yH * 0.35);
  const g = ctx.createLinearGradient(0, -mw, 0, mw);
  g.addColorStop(0, 'rgba(120,140,200,0)');
  g.addColorStop(0.5, 'rgba(130,150,210,0.06)');
  g.addColorStop(1, 'rgba(120,140,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-L.w, -mw, L.w * 2, mw * 2);
  ctx.restore();
  if (G.moon) {
    const m = G.moon;
    const R = m.r * 6.5;
    const gl = ctx.createRadialGradient(m.x, m.y, m.r * 0.9, m.x, m.y, R);
    gl.addColorStop(0, 'rgba(215,228,255,0.34)');
    gl.addColorStop(0.22, 'rgba(170,192,245,0.13)');
    gl.addColorStop(1, 'rgba(160,185,240,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(m.x - R, m.y - R, R * 2, R * 2);
  }
}

function drawStars(ctx, G) {
  const { L, yH, moon } = G;
  const n = Math.round(clamp((L.w * yH) / 1900, 30, 480));
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 3, 17) * L.w, y = Math.pow(hash2(i, 5, 17), 1.3) * (yH - 10);
    if (moon && Math.hypot(x - moon.x, y - moon.y) < moon.r * 2.6) continue;
    const r = hash2(i, 7, 17);
    const sz = r > 0.97 ? 1.9 : r > 0.84 ? 1.35 : 0.9;
    const a = (0.3 + hash2(i, 9, 17) * 0.6) * (1 - (y / yH) * 0.45);
    ctx.globalAlpha = a;
    ctx.fillStyle = r > 0.92 ? '#fff1d2' : '#dde7ff';
    ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    if (sz > 1.5) {
      ctx.globalAlpha = a * 0.35;
      ctx.fillRect(x - sz * 1.6, y - 0.4, sz * 3.2, 0.8);
      ctx.fillRect(x - 0.4, y - sz * 1.6, 0.8, sz * 3.2);
    }
    G.stars.push({ x, y, sz });
  }
  ctx.restore();
}

function drawMoon(ctx, m) {
  const { x, y, r } = m;
  ctx.save();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.32, r * 0.1, x, y, r);
  g.addColorStop(0, '#fffef6');
  g.addColorStop(0.75, '#f8f3de');
  g.addColorStop(1, '#e6dfc2');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = 'rgba(170,166,140,0.2)';
  for (const [dx, dy, rx, ry, a] of [[-0.26, -0.12, 0.3, 0.2, 0.4], [0.22, 0.2, 0.24, 0.17, -0.3], [0.06, -0.4, 0.15, 0.1, 0.2], [-0.34, 0.33, 0.13, 0.1, 0], [0.42, -0.12, 0.1, 0.15, 0.5], [-0.02, 0.05, 0.12, 0.09, 0]]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(160,155,130,0.22)';
  ctx.lineWidth = Math.max(0.6, r * 0.03);
  for (const [dx, dy, rr] of [[0.3, -0.42, 0.07], [-0.45, 0.02, 0.06], [0.12, 0.5, 0.08], [0.55, 0.25, 0.05]]) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // tối nhẹ mép dưới phải (khối cầu)
  const sh = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.6, x - r * 0.2, y - r * 0.2, r * 1.5);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(70,70,95,0.22)');
  ctx.fillStyle = sh;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** mây mỏng trôi ngang: cụm elip lệch nhau, đuôi kéo sợi, mép trên được trăng viền sáng */
function cloud(ctx, G, cx, cy, w, h, seed) {
  const blobs = [];
  const n = 8 + Math.floor(hash2(seed, 1, 3) * 4);
  for (let i = 0; i < n; i++) {
    const t = 0.08 + hash2(seed, i, 4) * 0.84;
    const hump = Math.sin(t * Math.PI);
    blobs.push([
      cx + (t - 0.5) * w,
      cy - hump * h * (0.15 + hash2(seed, i, 5) * 0.35),
      w * (0.05 + hash2(seed, i, 6) * 0.07) * (0.6 + hump * 0.8),
      h * (0.22 + hump * 0.4) * (0.7 + hash2(seed, i, 8) * 0.5),
    ]);
  }
  // sợi mây kéo dài hai đầu
  blobs.push([cx - w * 0.36, cy + h * 0.12, w * 0.2, h * 0.13], [cx + w * 0.34, cy + h * 0.08, w * 0.22, h * 0.11]);
  const shape = (dy, k) => {
    ctx.beginPath();
    for (const [x, y, rx, ry] of blobs) { ctx.moveTo(x + rx * k, y + dy); ctx.ellipse(x, y + dy, rx * k, ry * k, 0, 0, Math.PI * 2); }
  };
  shape(-Math.max(1, h * 0.2), 1);
  ctx.fillStyle = 'rgba(165,185,228,0.2)';
  ctx.fill();
  shape(0, 1);
  ctx.fillStyle = 'rgba(20,32,64,0.55)';
  ctx.fill();
  shape(h * 0.12, 0.7);
  ctx.fillStyle = 'rgba(8,14,32,0.22)';
  ctx.fill();
  G.boxes.push({ x0: cx - w * 0.6, y0: cy - h * 1.1, x1: cx + w * 0.6, y1: cy + h * 0.8 });
}

function drawClouds(ctx, G) {
  const { left, right, moon, yH } = G;
  for (const [p, side] of [[left, -1], [right, 1]]) {
    const w = p.x1 - p.x0;
    if (w < 60) continue;
    const top = 58, bot = yH - 30;
    if (bot - top < 30) continue;
    if (moon && moon.side === side) {
      cloud(ctx, G, moon.x - moon.r * 0.5, moon.y + moon.r * 1.2, Math.min(w * 0.8, moon.r * 5.2), moon.r * 0.3, 11);
      cloud(ctx, G, p.x0 + w * 0.32, lerp(top, bot, 0.78), w * 0.55, Math.max(6, G.sw * 0.3), 23);
    } else {
      cloud(ctx, G, p.x0 + w * 0.55, lerp(top, bot, 0.3), w * 0.6, Math.max(6, G.sw * 0.32), 37);
      cloud(ctx, G, p.x0 + w * 0.3, lerp(top, bot, 0.72), w * 0.45, Math.max(5, G.sw * 0.24), 41);
    }
  }
}

function drawSea(ctx, G) {
  const { L, yH, ySh, moon } = G;
  ctx.fillStyle = vGrad(ctx, yH, ySh, [[0, '#1b3057'], [0.1, '#132648'], [0.6, '#0d1b38'], [1, '#0a162f']]);
  ctx.fillRect(0, yH, L.w, ySh - yH + 1);
  ctx.fillStyle = 'rgba(175,200,245,0.3)';
  ctx.fillRect(0, yH, L.w, 1);
  // sóng lăn tăn: gạch ngang ngắn, thưa dần & dài dần về phía bờ
  ctx.save();
  let i = 0;
  for (let y = yH + 2.5; y < ySh - 1; i++) {
    const k = (y - yH) / Math.max(1, ySh - yH);
    const n = Math.round((L.w / 90) * (1.2 - k * 0.5));
    for (let j = 0; j < n; j++) {
      const x = hash2(i, j, 51) * L.w;
      const len = 3 + hash2(j, i, 52) * (6 + k * 26);
      ctx.fillStyle = `rgba(150,182,232,${(0.07 + k * 0.12).toFixed(3)})`;
      ctx.fillRect(x, y, len, k > 0.5 ? 1.2 : 1);
    }
    y += 2 + k * 6 + hash2(i, 9, 53) * 1.5;
  }
  // vệt trăng trên mặt biển
  if (moon) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yH + 1, L.w, ySh - yH);
    ctx.clip();
    ctx.translate(moon.x, yH);
    ctx.scale(1, Math.max(0.5, (ySh - yH) / (moon.r * 1.6)));
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, moon.r * 1.6);
    cg.addColorStop(0, 'rgba(255,244,210,0.22)');
    cg.addColorStop(0.5, 'rgba(255,244,210,0.07)');
    cg.addColorStop(1, 'rgba(255,244,210,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(-moon.r * 1.6, 0, moon.r * 3.2, moon.r * 1.6);
    ctx.restore();
    let r = 0;
    for (let y = yH + 1.5; y < ySh - 1; r++) {
      const k = (y - yH) / Math.max(1, ySh - yH);
      const half = moon.r * (0.35 + k * 1.75);
      const m = 2 + Math.round(k * 3);
      for (let j = 0; j < m; j++) {
        const off = (hash2(r, j, 55) - 0.5) * 2;
        const x = moon.x + off * half;
        const len = 2 + hash2(j, r, 56) * (3 + k * 12) * (1 - Math.abs(off) * 0.5);
        ctx.fillStyle = `rgba(255,246,214,${((0.55 - k * 0.3) * (1 - Math.abs(off) * 0.7)).toFixed(3)})`;
        ctx.fillRect(x - len / 2, y, len, 1);
      }
      y += 1.6 + k * 3.2;
    }
  }
  ctx.restore();
}

function drawIsland(ctx, G) {
  const { yH, sw, moon } = G;
  const p = moon && moon.side < 0 ? G.right : G.left;
  const w = p.x1 - p.x0;
  if (w < 80) return;
  const hgt = clamp(sw * 1.25, 7, 42);
  const x0 = p.x0 + w * (p === G.left ? 0.04 : 0.36), x1 = x0 + w * 0.6;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, yH + 0.5);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.12, yH - hgt * 0.5, x0 + (x1 - x0) * 0.26, yH - hgt * 0.72);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.36, yH - hgt * 1.0, x0 + (x1 - x0) * 0.46, yH - hgt * 0.62);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.56, yH - hgt * 0.36, x0 + (x1 - x0) * 0.66, yH - hgt * 0.48);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.8, yH - hgt * 0.62, x0 + (x1 - x0) * 0.9, yH - hgt * 0.22);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.96, yH - hgt * 0.05, x1, yH + 0.5);
  ctx.closePath();
  ctx.fillStyle = '#0d1730';
  ctx.fill();
  ctx.strokeStyle = 'rgba(130,155,210,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // hải đăng trên mỏm đảo
  const lx = x0 + (x1 - x0) * 0.66, ly = yH - hgt * 0.48;
  const th = Math.max(5, hgt * 0.42), tw = Math.max(1.6, th * 0.22);
  ctx.fillStyle = '#c9ccd6';
  ctx.beginPath();
  ctx.moveTo(lx - tw / 2, ly + 1); ctx.lineTo(lx - tw * 0.35, ly - th); ctx.lineTo(lx + tw * 0.35, ly - th); ctx.lineTo(lx + tw / 2, ly + 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#b8434a';
  ctx.fillRect(lx - tw * 0.42, ly - th * 0.55, tw * 0.84, th * 0.18);
  ctx.fillStyle = '#2a2f3d';
  ctx.fillRect(lx - tw * 0.45, ly - th - tw * 0.55, tw * 0.9, tw * 0.55);
  G.light = { x: lx, y: ly - th - tw * 0.3, r: Math.max(5, hgt * 0.5) };
  // vài ánh đèn làng chài dưới chân đảo
  ctx.fillStyle = 'rgba(255,205,130,0.85)';
  for (let k = 0; k < 4; k++) ctx.fillRect(x0 + (x1 - x0) * (0.14 + k * 0.09 + hash2(k, 2, 57) * 0.03), yH - 1.5 - hash2(k, 3, 57) * hgt * 0.15, 1.2, 1.2);
  ctx.restore();
}

function drawBoats(ctx, G) {
  const { yH, left, right, sw } = G;
  const spots = [];
  const lw = left.x1 - left.x0, rw = right.x1 - right.x0;
  if (lw > 60) spots.push(left.x0 + lw * 0.84);
  if (rw > 60) { spots.push(right.x0 + rw * 0.16); spots.push(right.x0 + rw * 0.9); }
  if (rw > 200) spots.push(right.x0 + rw * 0.36);
  const glow = glowSprite('225,235,255');
  ctx.save();
  spots.forEach((x, i) => {
    const y = yH + 2 + hash2(i, 1, 59) * 3;
    const hs = clamp(sw * 0.3, 3, 9);
    ctx.fillStyle = '#070c1a';
    ctx.beginPath();
    ctx.moveTo(x - hs, y); ctx.lineTo(x + hs, y); ctx.lineTo(x + hs * 0.7, y + hs * 0.35); ctx.lineTo(x - hs * 0.7, y + hs * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 0.4, y - hs * 0.9, 0.8, hs * 0.9);
    ctx.globalCompositeOperation = 'lighter';
    stampGlow(ctx, glow, x, y - hs * 0.8, hs * 1.6, hs * 1.6, 0.55);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f4f8ff';
    ctx.fillRect(x - 1, y - hs * 0.8 - 1, 2, 2);
    ctx.fillStyle = 'rgba(230,238,255,0.35)';
    for (let k = 1; k < 5; k++) ctx.fillRect(x - 1.5 + (k % 2), y + hs * 0.35 + k * 2.2, 3 - (k % 2), 1);
  });
  ctx.restore();
}

function drawBeach(ctx, G, bandH) {
  const { L, ySh, yPF, moon, sw } = G;
  ctx.fillStyle = vGrad(ctx, ySh, bandH, [[0, '#20283a'], [0.06, '#2b3039'], [0.22, '#3b3833'], [0.6, '#48423a'], [1, C.sandOut]]);
  ctx.fillRect(0, ySh, L.w, bandH - ySh);
  // cát ướt phản chiếu trăng
  if (moon) {
    const g = ctx.createLinearGradient(0, ySh, 0, ySh + (yPF - ySh) * 0.3);
    g.addColorStop(0, 'rgba(255,244,210,0.18)');
    g.addColorStop(1, 'rgba(255,244,210,0)');
    ctx.fillStyle = g;
    ctx.fillRect(moon.x - moon.r * 1.8, ySh, moon.r * 3.6, (yPF - ySh) * 0.3);
  }
  // viền bọt sóng
  ctx.save();
  ctx.lineCap = 'round';
  for (const [dy, a, lw] of [[0, 0.5, 1.4], [Math.max(2, (yPF - ySh) * 0.07), 0.16, 1]]) {
    ctx.beginPath();
    for (let x = 0; x <= L.w; x += 6) {
      const y = ySh + dy + Math.sin(x * 0.045) * 1.2 + Math.sin(x * 0.13 + 1) * 0.6;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(225,236,250,${a})`;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
  // lấm tấm cát, đá, cỏ biển trên phần cát khô
  const n = Math.round(L.w / 7);
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 1, 61) * L.w, k = hash2(i, 2, 61);
    const y = lerp(ySh + 4, bandH - 1, k);
    ctx.fillStyle = hash2(i, 3, 61) > 0.5 ? 'rgba(20,16,12,0.35)' : 'rgba(170,160,140,0.18)';
    ctx.fillRect(x, y, 1 + k, 1);
  }
  const rocks = Math.round(L.w / 260);
  for (let i = 0; i < rocks; i++) {
    const x = hash2(i, 5, 61) * L.w, y = ySh + 2 + hash2(i, 6, 61) * 4;
    const r = clamp(sw * (0.18 + hash2(i, 7, 61) * 0.2), 2, 8);
    ctx.fillStyle = '#151820';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.4, r * 0.7, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,185,230,0.2)';
    ctx.fillRect(x - r * 0.7, y - r * 0.62, r * 0.9, 1);
  }
}

/** thúng chai kéo lên bờ cát (xa, vẽ một lần trên dải trên) */
function drawBasketBoats(ctx, G) {
  const { left, right, ySh, yPF, sw } = G;
  const r = clamp(sw * 0.62, 7, 24);
  for (const [p, k, seed] of [[left, 0.38, 1], [right, 0.42, 2]]) {
    const w = p.x1 - p.x0;
    if (w < 120) continue;
    const x = p.x0 + w * k, y = lerp(ySh, yPF, 0.42);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + r * 0.25, y + r * 0.12, r * 1.15, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,10,8,0.35)';
    ctx.fill();
    // thân thúng (nửa dưới elip) + vành tre
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.3, r, r * 0.62, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = vGrad(ctx, y - r * 0.3, y + r * 0.32, [[0, '#5a4c38'], [1, '#2c251c']]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(190,175,135,0.3)';
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.beginPath();
    for (let i = -4; i <= 4; i++) { ctx.moveTo(x + i * r * 0.24 - r * 0.2, y - r * 0.3); ctx.lineTo(x + i * r * 0.24 + r * 0.2, y + r * 0.4); }
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.3, r, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#16120e';
    ctx.fill();
    ctx.strokeStyle = '#a8946c';
    ctx.lineWidth = Math.max(0.8, r * 0.1);
    ctx.stroke();
    // mái chèo dựng nghiêng
    ctx.strokeStyle = '#7a6244';
    ctx.lineWidth = Math.max(0.8, r * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const dir = seed === 1 ? 1 : -1;
    ctx.moveTo(x + dir * r * 0.5, y - r * 0.32);
    ctx.lineTo(x + dir * r * 1.05, y - r * 1.25);
    ctx.stroke();
    ctx.restore();
    G.gaps.push([x - r * 1.2, x + r * 1.2]);
  }
}

function drawFarPalms(ctx, G) {
  const { left, right, ySh, yPF, sw, moon } = G;
  const specs = [];
  const big = clamp(sw * 4.6, 36, 170);
  for (const [p, side] of [[left, -1], [right, 1]]) {
    const w = p.x1 - p.x0;
    if (w < 70) continue;
    const outer = side < 0 ? p.x0 + w * 0.2 : p.x1 - w * 0.2;
    specs.push({ x: outer, y: lerp(ySh, yPF, 0.55), h: big, lean: side * big * 0.2, seed: side < 0 ? 61 : 62, far: 0.45 });
    if (w > 190) {
      const inner = side < 0 ? p.x0 + w * 0.56 : p.x1 - w * 0.6;
      specs.push({ x: inner, y: lerp(ySh, yPF, 0.25), h: big * 0.72, lean: -side * big * 0.16, seed: side < 0 ? 63 : 64, far: 0.6 });
    }
  }
  specs.sort((a, b) => a.y - b.y);
  for (const s of specs) {
    const rimSide = moon ? Math.sign(moon.x - s.x) : 0;
    const bb = drawPalm(ctx, s.x, s.y, s.h, s.lean, s.seed, { far: s.far, rimSide });
    G.boxes.push(bb);
    G.gaps.push([s.x - s.h * 0.08 + Math.min(0, s.lean * 0.1), s.x + s.h * 0.08 + Math.max(0, s.lean * 0.1)]);
  }
}

/** giàn tre căng màn hình: dây néo, hai cột, xà ngang, chỗ buộc, dây bóng đèn, viền khung tre quanh video */
function drawRig(ctx, G) {
  const { sc, fr, pw, poleL, poleR, beamY, beamH, poleTop, yPF, sw, ySh } = G;
  const bot = yPF + 2;
  const lwRope = clamp(sw * 0.042, 0.7, 1.7);
  // dây néo từ đỉnh cột xuống cọc trên cát (vẽ trước cột)
  const stakeY = lerp(ySh, yPF, 0.42);
  for (const [px, dir] of [[poleL + pw / 2, -1], [poleR + pw / 2, 1]]) {
    for (const [span, k] of [[Math.min(sc.h * 0.3, 150), 1], [Math.min(sc.h * 0.17, 85), 0.7]]) {
      const ax = px, ay = poleTop + pw * 0.9 + (1 - k) * sc.h * 0.25;
      const bx = px + dir * span, by = stakeY + (1 - k) * 6;
      ropeLine(ctx, ax, ay, bx, by, Math.hypot(bx - ax, by - ay) * 0.025, lwRope);
      G.ropes.push([ax, ay, bx, by]);
      ctx.fillStyle = ART.trunkLo;
      ctx.fillRect(bx - lwRope, by - lwRope * 3, lwRope * 2, lwRope * 4);
    }
  }
  // dây buộc mép khung màn hình vào cột
  for (const k of [0.08, 0.5, 0.92]) {
    const y = sc.y + sc.h * k;
    for (const [x0, x1] of [[poleL + pw * 0.5, sc.x - fr + 1], [sc.x + sc.w + fr - 1, poleR + pw * 0.5]]) {
      ctx.fillStyle = ART.ropeLo;
      ctx.fillRect(x0, y - lwRope, x1 - x0, lwRope * 2);
      ctx.fillStyle = ART.rope;
      ctx.fillRect(x0, y - lwRope * 0.6, x1 - x0, lwRope);
    }
  }
  // hai cột tre
  const seg = clamp(sw * 1.5, 10, 64);
  for (const x of [poleL, poleR]) {
    bambooV(ctx, x, poleTop, bot, pw, seg);
    // đầu cột: mặt cắt ống tre
    ctx.fillStyle = ART.bambooNode;
    ctx.beginPath();
    ctx.ellipse(x + pw / 2, poleTop, pw / 2, Math.max(1, pw * 0.22), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2116';
    ctx.beginPath();
    ctx.ellipse(x + pw / 2, poleTop, pw * 0.32, Math.max(0.6, pw * 0.13), 0, 0, Math.PI * 2);
    ctx.fill();
    // chỗ buộc dây khung
    for (const k of [0.08, 0.5, 0.92]) lashing(ctx, x - 1, sc.y + sc.h * k - pw * 0.5, pw + 2, pw);
  }
  // xà ngang trên + chỗ buộc vào cột
  bambooH(ctx, poleL - pw * 0.9, poleR + pw * 1.9, beamY, beamH, clamp(sw * 1.8, 12, 80));
  lashing(ctx, poleL - 1.5, beamY - 1.5, pw + 3, beamH + 3);
  lashing(ctx, poleR - 1.5, beamY - 1.5, pw + 3, beamH + 3);
  // dây bóng đèn võng giữa hai đầu cột (luôn ở trên xà)
  const ax = poleL + pw / 2, bx = poleR + pw / 2, ay = poleTop + Math.max(1.5, pw * 0.35);
  const sag = Math.max(0, Math.min(beamY - 3 - ay, (bx - ax) * 0.03));
  ctx.save();
  ctx.strokeStyle = 'rgba(28,22,16,0.95)';
  ctx.lineWidth = Math.max(0.8, sw * 0.03);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo((ax + bx) / 2, ay + sag * 2, bx, ay);
  ctx.stroke();
  const gap = clamp(sw * 1.05, 13, 40);
  const nb = Math.max(2, Math.round((bx - ax) / gap));
  const br = clamp(sw * 0.075, 1.2, 3);
  const glowW = glowSprite('255,205,130');
  for (let i = 1; i < nb; i++) {
    const t = i / nb;
    const x = lerp(ax, bx, t), y = ay + 4 * sag * t * (1 - t) + br * 1.3;
    ctx.globalCompositeOperation = 'lighter';
    stampGlow(ctx, glowW, x, y, br * 4.2, br * 4.2, 0.5);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#2b2219';
    ctx.fillRect(x - br * 0.45, y - br * 1.5, br * 0.9, br * 0.7);
    ctx.fillStyle = i % 5 === 2 ? '#ffc56b' : '#fff0c8';
    ctx.beginPath();
    ctx.ellipse(x, y, br * 0.75, br, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // viền khung tre quanh video (nằm trọn trong L.frame)
  const seg2 = clamp(sw * 1.7, 14, 72);
  bambooH(ctx, sc.x - fr, sc.x + sc.w + fr, sc.y - fr, fr, seg2);
  bambooH(ctx, sc.x - fr, sc.x + sc.w + fr, sc.y + sc.h, fr, seg2);
  bambooV(ctx, sc.x - fr, sc.y - fr, sc.y + sc.h + fr, fr, seg2);
  bambooV(ctx, sc.x + sc.w, sc.y - fr, sc.y + sc.h + fr, fr, seg2);
  ctx.fillStyle = 'rgba(20,14,8,0.6)';
  ctx.fillRect(sc.x - 1, sc.y - 1, sc.w + 2, 1);
  ctx.fillRect(sc.x - 1, sc.y + sc.h, sc.w + 2, 1);
  ctx.fillRect(sc.x - 1, sc.y, 1, sc.h);
  ctx.fillRect(sc.x + sc.w, sc.y, 1, sc.h);
  // dây treo màn hình lên xà
  const nt = Math.max(2, Math.round(sc.w / 110));
  for (let i = 0; i <= nt; i++) {
    const x = sc.x - fr * 0.5 + ((sc.w + fr) * i) / nt;
    ctx.fillStyle = ART.ropeLo;
    ctx.fillRect(x - lwRope, beamY + beamH * 0.3, lwRope * 2, sc.y - fr + fr * 0.6 - beamY - beamH * 0.3);
    ctx.fillStyle = ART.rope;
    ctx.fillRect(x - lwRope * 0.5, beamY + beamH * 0.3, lwRope, sc.y - fr + fr * 0.6 - beamY - beamH * 0.3);
  }
}

/** chọn các ngôi sao lấp lánh: chỉ ở hai bên màn hình, né mây / dừa / dây */
function pickTwinkles(G) {
  const out = [];
  const x0 = G.poleL - 6, x1 = G.poleR + G.pw + 6;
  for (const st of G.stars) {
    if (out.length >= 34) break;
    if (st.x > x0 && st.x < x1) continue;
    if (st.y < 48 || st.y > G.yH - 8 || st.x > G.AW - 2) continue;
    if (hitBox(G.boxes, st.x, st.y, 3) || nearRope(G.ropes, st.x, st.y, 4)) continue;
    if (hash2(Math.round(st.x), Math.round(st.y), 3) > 0.45) continue;
    out.push({ x: st.x, y: st.y, sz: Math.max(1.1, st.sz), ph: hash2(Math.round(st.x), 7, 5) * 6.28, sp: 650 + hash2(Math.round(st.y), 9, 5) * 1300 });
  }
  G.twinkles = out;
}

function hitBox(boxes, x, y, m = 0) {
  for (const b of boxes) if (x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m) return true;
  return false;
}

function nearRope(ropes, x, y, d) {
  for (const [ax, ay, bx, by] of ropes) {
    const vx = bx - ax, vy = by - ay;
    const t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < d + 2) return true;
  }
  return false;
}

// ================================================================ (2b) phòng: cát + ngoài rào + bục + hàng rào (theo camera)
function drawRoom(ctx, P, tex, L, dpr, step = 2) {
  cur.P = P;
  cur.L = L;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFloor(ctx, P, tex, dpr, P.Yf, L.h, step);
  ctx.restore();
  const sc = L.screen, fr = L.frame;
  // vật cao ngoài hàng rào (được đè lên trời / biển), bục, hàng rào: KHÔNG BAO GIỜ đè khung video
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, L.w, L.h);
  ctx.rect(sc.x - fr, sc.y - fr, sc.w + fr * 2, sc.h + fr * 2);
  ctx.clip('evenodd');
  drawOutside(ctx, P, L, dpr);
  drawPlatform(ctx, P, L);
  drawFence(ctx, P, L);
  ctx.restore();
  // phần nhô lên trên mép dưới video của loa / quầy (lớp người bị cắt ở L.vb) — vẽ y hệt vào lớp phòng
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, L.w, L.vb + 1);
  ctx.rect(sc.x - fr, sc.y - fr, sc.w + fr * 2, sc.h + fr * 2);
  ctx.clip('evenodd');
  for (const sp of HALL.speakers) drawSpeaker(ctx, P, sp, 0);
  drawCounter(ctx, P, HALL.counter, 0);
  ctx.restore();
}

const spriteCache = new Map();
function cacheGet(key, make) {
  let sp = spriteCache.get(key);
  if (!sp) {
    if (spriteCache.size > 80) spriteCache.clear();
    sp = make();
    spriteCache.set(key, sp);
  }
  return sp;
}

function palmSprite(pm, s, dpr) {
  const q = Math.round(s * dpr * 2) / 2;
  return cacheGet(`palm|${pm.seed}|${q}|${dpr}`, () => {
    const hp = pm.h * s, lean = pm.lean * s;
    const pad = hp * 0.72;
    const x0 = Math.min(0, lean) - pad, x1 = Math.max(0, lean) + pad, y0 = -hp * 1.42, y1 = hp * 0.04;
    const cv = makeCanvas((x1 - x0) * dpr, (y1 - y0) * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    const bb = drawPalm(c, 0, 0, hp, lean, pm.seed, { rimSide: pm.x < W / 2 ? 1 : -1, warmSide: pm.x < W / 2 ? 1 : -1 });
    return { cv, ox: -x0, oy: -y0, w: x1 - x0, h: y1 - y0, bb };
  });
}

/** đuốc (cán + giỏ + lửa nhỏ tĩnh): sprite theo cỡ; fx, fy = chân ngọn lửa so với chân đuốc */
function torchSprite(s, dpr) {
  const q = Math.round(s * dpr * 2) / 2;
  return cacheGet(`torch|${q}|${dpr}`, () => {
    const x0 = -0.4 * s, x1 = 0.4 * s, y0 = -(FLAME_BASE + 0.5) * s, y1 = 0.12 * s;
    const cv = makeCanvas((x1 - x0) * dpr, (y1 - y0) * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    c.beginPath();
    c.ellipse(0, 0, 0.13 * s, 0.05 * s, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(30,22,14,0.5)';
    c.fill();
    const f = drawTorchBody(c, 0, 0, s, TORCH_H);
    drawFlame(c, f.x, f.y, s, 0, 0, 0.7);
    return { cv, ox: -x0, oy: -y0, w: x1 - x0, h: y1 - y0, fx: f.x, fy: f.y };
  });
}

function grassTuft(ctx, x, y, s, seed) {
  const n = 5 + Math.floor(hash2(seed, 1, 81) * 3);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const h = s * (0.22 + hash2(seed, i, 82) * 0.26);
    const bx = x + t * s * 0.22;
    ctx.moveTo(bx, y);
    ctx.quadraticCurveTo(bx + t * s * 0.1, y - h * 0.6, bx + t * s * 0.42 + (hash2(seed, i, 83) - 0.5) * s * 0.12, y - h);
  }
  ctx.strokeStyle = hash2(seed, 2, 81) > 0.5 ? '#2f3d29' : '#3c4a2e';
  ctx.lineWidth = Math.max(0.7, s * 0.025);
  ctx.stroke();
}

const GRASS = (() => {
  const out = [];
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side < 0 ? -4.2 + hash2(i, 1, 85) * 4.9 : XR + 0.3 + hash2(i, 1, 85) * 4.9;
    const z = -0.9 + hash2(i, 2, 85) * 19;
    out.push({ x, z, seed: i });
  }
  return out.sort((a, b) => a.z - b.z);
})();

function drawOutside(ctx, P, L, dpr) {
  const boxes = [];
  for (const g of GRASS) {
    const p = P.pt(g.x, g.z);
    if (p.x < -20 || p.x > L.w + 20) continue;
    grassTuft(ctx, p.x, p.y, p.s, g.seed);
  }
  for (const pm of PALMS) {
    const p = P.pt(pm.x, pm.z);
    const sp = palmSprite(pm, p.s, dpr);
    const x0 = p.x - sp.ox, y0 = p.y - sp.oy;
    if (x0 > L.w || x0 + sp.w < 0) continue;
    ctx.drawImage(sp.cv, x0, y0, sp.w, sp.h);
    boxes.push({ x0: p.x + sp.bb.x0, y0: p.y + sp.bb.y0, x1: p.x + sp.bb.x1, y1: p.y + sp.bb.y1 });
  }
  cur.palmBoxes = boxes;
  for (const b of SURFBOARDS) {
    const p = P.pt(b.x, b.z);
    if (p.x < -40 || p.x > L.w + 40) continue;
    drawSurfboard(ctx, p.x, p.y, p.s, b.lean, b.col, b.stripe);
  }
  const sc2 = P.pt(CASTLE.x, CASTLE.z);
  if (sc2.x > -40 && sc2.x < L.w + 40) drawSandcastle(ctx, sc2.x, sc2.y, sc2.s);
  const glow = glowSprite('255,150,60');
  for (const t of TORCHES) {
    const p = P.pt(t.x, t.z);
    if (p.x < -30 || p.x > L.w + 30) continue;
    const sp = torchSprite(p.s, dpr);
    ctx.drawImage(sp.cv, p.x - sp.ox, p.y - sp.oy, sp.w, sp.h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    stampGlow(ctx, glow, p.x, p.y + sp.fy - p.s * 0.15, p.s * 0.8, p.s * 0.8, 0.18);
    ctx.restore();
  }
}

/** bục gỗ dưới màn hình: ván ngang, mép trước có cọc gỗ, cát dồn chân bục, hũ đèn trên mép */
function drawPlatform(ctx, P, L) {
  const f0 = P.pt(XL, ZW, STAGE_H), f1 = P.pt(XR, ZW, STAGE_H);
  const n0 = P.pt(XL, 0, STAGE_H), n1 = P.pt(XR, 0, STAGE_H);
  poly(ctx, [f0, f1, n1, n0], vGrad(ctx, f0.y, n0.y, [[0, '#2f2218'], [1, '#5c4430']]));
  ctx.lineWidth = 1;
  for (let z = ZW + 0.3; z < -0.05; z += 0.3) {
    const a = P.pt(XL, z, STAGE_H), b = P.pt(XR, z, STAGE_H);
    ctx.strokeStyle = 'rgba(12,8,4,0.55)';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,225,180,0.07)';
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 1); ctx.lineTo(b.x, b.y + 1); ctx.stroke();
  }
  // mối nối ván so le
  ctx.strokeStyle = 'rgba(12,8,4,0.45)';
  let k = 0;
  for (let z = ZW; z < -0.05; z += 0.3, k++) {
    for (let x = XL + 1.5 + (k % 3) * 1.1; x < XR; x += 3.3) {
      const a = P.pt(x, z, STAGE_H), b = P.pt(x, z + 0.3, STAGE_H);
      if (b.x < -10 || b.x > L.w + 10) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  // mặt trước
  const b0 = P.pt(XL, 0, 0), b1 = P.pt(XR, 0, 0);
  poly(ctx, [n0, n1, b1, b0], vGrad(ctx, n0.y, b0.y, [[0, '#6e5038'], [0.14, '#4c3726'], [1, '#261a10']]));
  for (const hk of [0.5, 0.25]) {
    const a = P.pt(XL, 0, STAGE_H * hk + 0.02), b = P.pt(XR, 0, STAGE_H * hk + 0.02);
    ctx.strokeStyle = 'rgba(10,6,3,0.5)';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,226,180,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(n0.x, n0.y); ctx.lineTo(n1.x, n1.y); ctx.stroke();
  // cọc gỗ tròn
  for (let x = XL + 0.25; x < XR; x += 2.6) {
    const t = P.pt(x, 0.05, STAGE_H + 0.06), bt = P.pt(x, 0.05, -0.02);
    if (t.x < -20 || t.x > L.w + 20) continue;
    const w = t.s * 0.2;
    ctx.fillStyle = hGradX(ctx, t.x - w / 2, w, ['#3b2a1b', '#7a5a3d', '#4e3826', '#2a1d12']);
    ctx.fillRect(t.x - w / 2, t.y, w, bt.y - t.y);
    ctx.fillStyle = '#8a6a4a';
    ctx.beginPath();
    ctx.ellipse(t.x, t.y, w / 2, Math.max(1, w * 0.22), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // cát dồn chân bục (mép lượn)
  ctx.beginPath();
  for (let x = XL - 0.3; x <= XR + 0.3; x += 0.25) {
    const p = P.pt(x, 0.02, 0.07 + 0.05 * Math.sin(x * 1.7) + 0.03 * Math.sin(x * 4.1));
    if (x === XL - 0.3) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  const e1 = P.pt(XR + 0.3, 0.25, 0), e0 = P.pt(XL - 0.3, 0.25, 0);
  ctx.lineTo(e1.x, e1.y);
  ctx.lineTo(e0.x, e0.y);
  ctx.closePath();
  ctx.fillStyle = vGrad(ctx, n0.y, e0.y, [[0, '#5d5447'], [1, '#4a4237']]);
  ctx.fill();
  // hũ đèn trên mép bục
  const glow = glowSprite('255,180,90');
  for (let x = XL + 1.6; x < XR - 0.5; x += 4) {
    const p = P.pt(x, -0.16, STAGE_H);
    if (p.x < -30 || p.x > L.w + 30) continue;
    const jw = p.s * 0.16, jh = p.s * 0.22;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    stampGlow(ctx, glow, p.x, p.y - jh * 0.5, p.s * 0.9, p.s * 0.75, 0.42);
    ctx.restore();
    fillRR(ctx, p.x - jw / 2, p.y - jh, jw, jh, jw * 0.3, 'rgba(255,196,110,0.9)');
    fillRR(ctx, p.x - jw * 0.22, p.y - jh * 0.7, jw * 0.44, jh * 0.45, jw * 0.2, '#fff2c4');
    ctx.fillStyle = '#3a2c1e';
    ctx.fillRect(p.x - jw * 0.55, p.y - jh - Math.max(1, jh * 0.14), jw * 1.1, Math.max(1, jh * 0.16));
  }
}

function hGradX(ctx, x, w, cols) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c));
  return g;
}

/** hàng rào cọc gỗ + hai sợi dây thừng dọc x = 1 và x = 33 */
function drawFence(ctx, P, L) {
  const posts = [];
  for (let z = 0.4; z < H + 5; z += 2.2) posts.push(z);
  ctx.save();
  ctx.lineCap = 'round';
  for (const x of [XL, XR]) {
    for (let i = 0; i < posts.length; i++) {
      const z = posts[i];
      const p = P.pt(x, z);
      if (p.x < -60 || p.x > L.w + 60) continue;
      box(ctx, P, x - 0.07, x + 0.07, z - 0.07, z + 0.07, 0.74, { top: C.postTop, front: C.post, left: C.postSide, right: C.postSide });
      if (x === BUOY.x && Math.abs(z - BUOY.z) < 0.01) {
        const b = P.pt(x, z + 0.1, 0.5);
        drawLifebuoy(ctx, b.x, b.y, b.s * 0.2);
      }
      if (i + 1 < posts.length) {
        const z2 = posts[i + 1];
        for (const h of [0.6, 0.32]) {
          const a = P.pt(x, z + 0.07, h), b = P.pt(x, z2 - 0.07, h), m = P.pt(x, (z + z2) / 2, h - 0.2);
          const lw = Math.max(0.8, p.s * 0.035);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(2 * m.x - (a.x + b.x) / 2, 2 * m.y - (a.y + b.y) / 2, b.x, b.y);
          ctx.strokeStyle = ART.ropeLo;
          ctx.lineWidth = lw * 1.5;
          ctx.stroke();
          ctx.strokeStyle = ART.rope;
          ctx.lineWidth = lw * 0.8;
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

// ================================================================ (3) hàng ghế xếp
// Chỉ một lớp / hàng (khoá z + 0.32, vẽ sau người ngồi): lưng ghế che thân dưới người ngồi. Mặt ngồi + chân trước nằm
// gần trọn sau lưng ghế nên bỏ lớp sau (đo trên điện thoại: thêm 5 sprite rộng cả rạp tốn ~3 ms tô điểm ảnh / khung).
function renderRow(P, rowIndex, dpr) {
  const z = HALL.rows[rowIndex];
  const seats = SEATS.filter((s) => s.row === rowIndex);
  // lưng ghế che tới ~vai người ngồi ở mọi góc nhìn: góc nhìn càng dốc (điện thoại) lưng ngả ra sau càng "lùn" → nâng
  // lưng lên cho mép trên trên màn hình luôn ở ~0,78 chiều cao người (cs = tỉ lệ nhân vật của bố cục)
  const cs = cur.L?.cs ?? 0.85;
  const ht = clamp(0.78 * cs + 0.3 * (P.k / P.s(z + 0.3)), 0.62, 1.25);
  const xs0 = Math.min(...seats.map((s) => s.x)) - 0.5, xs1 = Math.max(...seats.map((s) => s.x)) + 0.5;
  const lw = Math.max(1.1, P.s(z + 0.3) * 0.062);
  const bx0 = Math.floor(Math.min(P.pt(xs0, z + 0.55).x, P.pt(xs0, z + 0.3).x)) - 3;
  const bx1 = Math.ceil(Math.max(P.pt(xs1, z + 0.55).x, P.pt(xs1, z + 0.3).x)) + 3;
  const by0 = Math.floor(P.pt(0, z + 0.3, ht + 0.12).y - lw) - 3, by1 = Math.ceil(P.pt(0, z + 0.5).y + lw) + 3;
  const w = Math.max(1, bx1 - bx0), h = Math.max(1, by1 - by0);
  const cv = makeCanvas(w * dpr, h * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, -bx0 * dpr, -by0 * dpr);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const order = [...seats].sort((a, b) => Math.abs(b.x - P.xcam) - Math.abs(a.x - P.xcam));
  for (const s of order) {
    const pal = FABRIC[Math.floor(hash2(s.col, s.row, 77) * FABRIC.length)].map((col) => shadeRgb(col, -0.2));
    chairFront(c, P, s, pal, ht);
  }
  return [{ kind: 'row', key: z + 0.32, z, canvas: cv, x0: bx0, y0: by0, w, h, xcam: P.xcam, s: P.s(z + 0.2) }];
}

function seg(ctx, a, b, lw, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** sọc vải trên tứ giác a-b (cạnh dưới) / d-c (cạnh trên), n sọc dọc */
function stripes(ctx, a, b, c, d, n, pal) {
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    ctx.beginPath();
    ctx.moveTo(lerp(a.x, b.x, t0), lerp(a.y, b.y, t0));
    ctx.lineTo(lerp(a.x, b.x, t1) + 0.3, lerp(a.y, b.y, t1));
    ctx.lineTo(lerp(d.x, c.x, t1) + 0.3, lerp(d.y, c.y, t1));
    ctx.lineTo(lerp(d.x, c.x, t0), lerp(d.y, c.y, t0));
    ctx.closePath();
    ctx.fillStyle = pal[k % 2];
    ctx.fill();
  }
}

/** ghế xếp (vẽ sau người ngồi): chân, lưng ghế vải sọc ngả ra sau (che thân dưới người ngồi), xà trên, khăn vắt */
function chairFront(ctx, P, st, pal, ht) {
  const x = st.x, z = st.y;
  const zb = z + 0.05, hb = 0.12, zt = z + 0.3, zg = z + 0.5;
  const s = P.s(zt);
  const lw = Math.max(1.1, s * 0.062);
  for (const lx of [x - 0.39, x + 0.39]) {
    const g = P.pt(lx, zg, 0), t = P.pt(lx, zt, ht + 0.08);
    seg(ctx, g, t, lw, C.woodLo);
    seg(ctx, { x: g.x - lw * 0.18, y: g.y }, { x: t.x - lw * 0.18, y: t.y }, lw * 0.45, C.wood);
  }
  seg(ctx, P.pt(x - 0.39, zg - 0.04, 0.16), P.pt(x + 0.39, zg - 0.04, 0.16), lw * 0.75, C.woodLo);
  const BL = P.pt(x - 0.35, zb, hb), BR = P.pt(x + 0.35, zb, hb), TR = P.pt(x + 0.35, zt, ht), TL = P.pt(x - 0.35, zt, ht);
  stripes(ctx, BL, BR, TR, TL, 5, pal);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(BL.x, BL.y); ctx.lineTo(BR.x, BR.y); ctx.lineTo(TR.x, TR.y); ctx.lineTo(TL.x, TL.y);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = vGrad(ctx, TL.y, BL.y, [[0, 'rgba(255,248,230,0.16)'], [0.3, 'rgba(255,248,230,0)'], [0.75, 'rgba(10,6,4,0.18)'], [1, 'rgba(10,6,4,0.42)']]);
  ctx.fillRect(TL.x - 2, TL.y - 2, TR.x - TL.x + 4, BL.y - TL.y + 4);
  ctx.restore();
  poly(ctx, [BL, BR, TR, TL], null, 'rgba(22,13,7,0.55)', 0.8);
  const A = P.pt(x - 0.44, zt, ht + 0.035), B = P.pt(x + 0.44, zt, ht + 0.035);
  seg(ctx, A, B, lw * 1.2, C.woodLo);
  seg(ctx, { x: A.x, y: A.y - lw * 0.25 }, { x: B.x, y: B.y - lw * 0.25 }, lw * 0.55, C.woodHi);
  // khăn tắm vắt lưng ghế (ngẫu nhiên, cố định theo ghế)
  if (hash2(st.col, st.row, 91) < 0.1) {
    const tc = TOWELS[Math.floor(hash2(st.col, st.row, 92) * TOWELS.length)];
    const ox = x + (hash2(st.col, st.row, 93) - 0.5) * 0.24, tw = 0.16;
    const t0 = P.pt(ox - tw, zt + 0.02, ht + 0.075), t1 = P.pt(ox + tw, zt + 0.02, ht + 0.075);
    const b0 = P.pt(ox - tw * 1.04, zt + 0.07, ht - 0.4), b1 = P.pt(ox + tw * 1.04, zt + 0.07, ht - 0.4);
    const at = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
    const base = shadeRgb(tc[0], -0.18), band = shadeRgb(tc[1], -0.15);
    poly(ctx, [t0, t1, b1, b0], base);
    poly(ctx, [at(t0, b0, 0.62), at(t1, b1, 0.62), at(t1, b1, 0.72), at(t0, b0, 0.72)], band);
    poly(ctx, [at(t0, b0, 0.8), at(t1, b1, 0.8), at(t1, b1, 0.86), at(t0, b0, 0.86)], band);
    // nếp gấp vắt qua xà + bóng đổ
    poly(ctx, [t0, t1, at(t1, b1, 0.12), at(t0, b0, 0.12)], 'rgba(255,255,255,0.16)');
    ctx.fillStyle = vGrad(ctx, t0.y, b0.y, [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(0,0,0,0.06)'], [1, 'rgba(0,0,0,0.3)']]);
    poly(ctx, [t0, t1, b1, b0], ctx.fillStyle);
    // tua rua mép dưới
    ctx.strokeStyle = band;
    ctx.lineWidth = Math.max(0.5, s * 0.012);
    ctx.beginPath();
    for (let k = 0; k <= 5; k++) {
      const p = at(b0, b1, k / 5);
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + s * 0.05);
    }
    ctx.stroke();
  }
}

// ================================================================ (3b) vật cản: loa tre, quầy NƯỚC DỪA
const objCache = new Map();
/** sprite vật 3D theo phép chiếu (lượng tử camera 0,25 ô; lệch nhỏ thì dịch ngang) */
function objSprite(id, P, dpr, bx, paint) {
  const xq = Math.round(P.xcam * 4) / 4;
  const key = `${P.Xc}|${P.Yf}|${P.Yn}|${P.s0}|${P.s1}|${xq}|${dpr}`;
  let e = objCache.get(id);
  if (!e || e.key !== key) {
    const Pq = xq === P.xcam ? P : projection({ Xc: P.Xc, Yf: P.Yf, Yn: P.Yn, s0: P.s0, s1: P.s1, H: P.H, xcam: xq });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [bx.x0, bx.x1]) for (const z of [bx.z0, bx.z1]) for (const h of [0, bx.h]) {
      const p = Pq.pt(x, z, h);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    x0 = Math.floor(x0) - 4; y0 = Math.floor(y0) - 4; x1 = Math.ceil(x1) + 4; y1 = Math.ceil(y1) + 4;
    const cv = makeCanvas((x1 - x0) * dpr, (y1 - y0) * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    paint(c, Pq);
    e = { key, cv, x0, y0, w: x1 - x0, h: y1 - y0, xq, zm: (bx.z0 + bx.z1) / 2 };
    objCache.set(id, e);
  }
  return e;
}

function drawObj(ctx, P, e) {
  ctx.drawImage(e.cv, e.x0 + (e.xq - P.xcam) * P.s(e.zm), e.y0, e.w, e.h);
}

function bambooPost(ctx, P, x, z, h0, h1, wd) {
  const a = P.pt(x, z, h1), b = P.pt(x, z, h0);
  const w = Math.max(1.2, a.s * wd);
  bambooV(ctx, a.x - w / 2, a.y, b.y, w, a.s * 0.42);
}

/** mái lá: khối mái (mặt trước + mặt hông nhìn thấy) + tua lá rủ ở mép trước */
function thatch(ctx, P, x0, x1, z0, z1, he, hr, inset) {
  const rl = x0 + inset, rr = x1 - inset, rz = (z0 + z1) / 2;
  const F0 = P.pt(x0, z1, he), F1 = P.pt(x1, z1, he), K0 = P.pt(x0, z0, he), K1 = P.pt(x1, z0, he);
  const R0 = P.pt(rl, rz, hr), R1 = P.pt(rr, rz, hr);
  const cols = ['#8a6c3d', '#6f552f', '#5a4426'];
  if (P.xcam < x0) poly(ctx, [K0, F0, R0], cols[1]);
  if (P.xcam > x1) poly(ctx, [F1, K1, R1], cols[1]);
  poly(ctx, [F0, F1, R1, R0], vGrad(ctx, R0.y, F0.y, [[0, '#a5834c'], [1, cols[0]]]));
  // lớp lá: vạch ngang so le
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(F0.x, F0.y); ctx.lineTo(F1.x, F1.y); ctx.lineTo(R1.x, R1.y); ctx.lineTo(R0.x, R0.y);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = 'rgba(40,26,10,0.4)';
  ctx.lineWidth = Math.max(0.6, F0.s * 0.02);
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    const a = { x: lerp(F0.x, R0.x, t), y: lerp(F0.y, R0.y, t) }, b = { x: lerp(F1.x, R1.x, t), y: lerp(F1.y, R1.y, t) };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const n = 10;
    for (let i = 1; i <= n; i++) ctx.lineTo(lerp(a.x, b.x, i / n), lerp(a.y, b.y, i / n) + (i % 2 ? F0.s * 0.035 : 0));
    ctx.stroke();
  }
  ctx.restore();
  // tua lá rủ mép trước
  const fringe = F0.s * 0.13;
  ctx.beginPath();
  ctx.moveTo(F0.x, F0.y);
  const n = Math.max(6, Math.round((F1.x - F0.x) / Math.max(2.5, F0.s * 0.07)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ctx.lineTo(lerp(F0.x, F1.x, t), lerp(F0.y, F1.y, t) + (i % 2 ? fringe : fringe * 0.35));
  }
  ctx.lineTo(F1.x, F1.y);
  ctx.closePath();
  ctx.fillStyle = cols[2];
  ctx.fill();
  if (P.xcam < x0) {
    ctx.beginPath();
    ctx.moveTo(K0.x, K0.y);
    const m = Math.max(4, Math.round(Math.abs(F0.y - K0.y) / Math.max(2.5, F0.s * 0.07)));
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      ctx.lineTo(lerp(K0.x, F0.x, t), lerp(K0.y, F0.y, t) + (i % 2 ? fringe * 0.9 : fringe * 0.3));
    }
    ctx.lineTo(F0.x, F0.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,225,160,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(R0.x, R0.y); ctx.lineTo(R1.x, R1.y); ctx.stroke();
  return { F0, F1 };
}

function paintSpeaker(ctx, P, sp) {
  const x0 = sp.x + 0.1, x1 = sp.x + sp.w - 0.1, z0 = sp.y + 0.12, z1 = sp.y + sp.h - 0.06;
  // chân đế tre thấp + thùng loa gỗ
  for (const [x, z] of [[x0 + 0.08, z1 - 0.08], [x1 - 0.08, z1 - 0.08]]) bambooPost(ctx, P, x, z, 0, 0.26, 0.09);
  const bb = box(ctx, P, x0 + 0.05, x1 - 0.05, z0 + 0.06, z1 - 0.06, 1.66, { top: '#4a3626', front: '#2c2018', left: '#21170f', right: '#21170f', edge: 'rgba(255,220,170,0.25)' }, 0.22);
  const f = bb.front;
  const fw = f.B.x - f.A.x, fh = f.A.y - f.D.y;
  const cx = (f.A.x + f.B.x) / 2;
  // vân gỗ mặt trước
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    const x = f.A.x + (fw * k) / 4;
    ctx.beginPath(); ctx.moveTo(x, f.D.y + 2); ctx.lineTo(x, f.A.y - 2); ctx.stroke();
  }
  // loa trầm + loa tép + lỗ thoát hơi
  for (const [ky, kr] of [[0.64, 0.3], [0.24, 0.13]]) {
    const cy = f.D.y + fh * ky, r = fw * kr;
    ctx.beginPath(); ctx.arc(cx, cy, r + fw * 0.04, 0, Math.PI * 2); ctx.fillStyle = '#a3814f'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#0d0b0a'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.fillStyle = '#1d1915'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2); ctx.fillStyle = '#332c25'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx - r * 0.28, cy - r * 0.3, r * 0.14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
  }
  fillRR(ctx, cx - fw * 0.16, f.D.y + fh * 0.88, fw * 0.32, Math.max(1.5, fh * 0.05), 2, '#0a0807');
  // khung tre bốn góc + thanh ngang
  for (const [x, z] of [[x0, z0], [x1, z0]]) bambooPost(ctx, P, x, z, 0, 1.9, 0.08);
  for (const [x, z] of [[x0, z1], [x1, z1]]) bambooPost(ctx, P, x, z, 0, 1.9, 0.09);
  for (const h of [0.24, 1.72]) {
    const a = P.pt(x0, z1, h), b = P.pt(x1, z1, h);
    bambooH(ctx, a.x, b.x, a.y - a.s * 0.045, a.s * 0.09, a.s * 0.5);
  }
  lashing(ctx, P.pt(x0, z1, 1.72).x - 2, P.pt(x0, z1, 1.76).y - 2, 4, 4);
  lashing(ctx, P.pt(x1, z1, 1.72).x - 2, P.pt(x1, z1, 1.76).y - 2, 4, 4);
  // mái lá nhỏ
  thatch(ctx, P, x0 - 0.16, x1 + 0.16, z0 - 0.14, z1 + 0.16, 1.8, 2.02, 0.3);
}

function drawSpeaker(ctx, P, sp, now) {
  const e = objSprite(`sp${sp.x}`, P, dprOf(ctx), { x0: sp.x - 0.1, x1: sp.x + sp.w + 0.1, z0: sp.y - 0.05, z1: sp.y + sp.h + 0.25, h: 2.1 },
    (c, Pq) => paintSpeaker(c, Pq, sp));
  drawObj(ctx, P, e);
}

function coconut(ctx, P, x, z, h, seed) {
  const p = P.pt(x, z, h);
  const r = p.s * 0.12;
  ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 0.9, r, r * 0.95, 0, 0, Math.PI * 2); ctx.fillStyle = '#4f6a2c'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(p.x - r * 0.3, p.y - r * 1.25, r * 0.35, r * 0.28, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(200,230,140,0.35)'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 1.75, r * 0.55, r * 0.2, 0, 0, Math.PI * 2); ctx.fillStyle = '#e9e2c8'; ctx.fill();
  // ống hút + ô giấy nhỏ
  const sx = p.x + r * 0.15, sy = p.y - r * 1.75;
  ctx.strokeStyle = seed % 2 ? '#ff7aa8' : '#7ad7ff';
  ctx.lineWidth = Math.max(0.8, r * 0.16);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + r * 0.5, sy - r * 1.3); ctx.lineTo(sx + r * 0.85, sy - r * 1.45); ctx.stroke();
  if (seed % 3 !== 1) {
    const ux = p.x - r * 0.4, uy = p.y - r * 2.6;
    ctx.strokeStyle = '#d9c9a8';
    ctx.lineWidth = Math.max(0.6, r * 0.08);
    ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(ux + r * 0.3, sy); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ux - r * 0.75, uy + r * 0.2); ctx.quadraticCurveTo(ux, uy - r * 0.55, ux + r * 0.75, uy + r * 0.2);
    ctx.closePath();
    ctx.fillStyle = ['#f6c343', '#ff6b6b', '#4dd4ac'][seed % 3];
    ctx.fill();
  }
}

function paintCounter(ctx, P, c) {
  const x0 = c.x, x1 = c.x + c.w, z0 = c.y, z1 = c.y + c.h;
  // cột mái phía sau (sau quầy)
  for (const [x, z] of [[x0 + 0.08, z0 + 0.1], [x1 - 0.08, z0 + 0.1]]) bambooPost(ctx, P, x, z, 1.0, 1.95, 0.08);
  // thân quầy: tre đứng
  box(ctx, P, x0, x1, z0, z1, 1.0, { top: '#3b2a1c', front: '#7d6538', left: '#6c5530', right: '#4b3a20' });
  const bw = 0.17;
  ctx.lineWidth = 1;
  if (P.xcam < x0) {
    for (let z = z0; z < z1 - 0.02; z += bw) {
      const a = P.pt(x0, z, 0.04), b = P.pt(x0, Math.min(z1, z + bw), 0.96);
      ctx.fillStyle = hGradX(ctx, Math.min(a.x, b.x), Math.max(1, Math.abs(b.x - a.x)), ['#5d4927', '#b59a62', '#8a7244']);
      poly(ctx, [P.pt(x0, z + 0.015, 0.04), P.pt(x0, Math.min(z1, z + bw) - 0.015, 0.04), P.pt(x0, Math.min(z1, z + bw) - 0.015, 0.96), P.pt(x0, z + 0.015, 0.96)], ctx.fillStyle);
      ctx.strokeStyle = 'rgba(50,35,15,0.6)';
      const n = P.pt(x0, z + bw / 2, 0.5 + hash2(Math.round(z * 10), 1, 3) * 0.2), n2 = P.pt(x0, z + bw / 2 + 0.06, 0.5 + hash2(Math.round(z * 10), 1, 3) * 0.2);
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(n2.x, n2.y); ctx.stroke();
    }
  }
  for (let x = x0; x < x1 - 0.02; x += bw) {
    const a = P.pt(x + 0.012, z1, 0.96), b = P.pt(Math.min(x1, x + bw) - 0.012, z1, 0.04);
    ctx.fillStyle = hGradX(ctx, a.x, b.x - a.x, ['#6e5830', '#c9ad72', '#8f7646', '#5a4625']);
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fillStyle = 'rgba(50,35,15,0.55)';
    const ny = lerp(a.y, b.y, 0.45 + hash2(Math.round(x * 10), 2, 3) * 0.2);
    ctx.fillRect(a.x, ny, b.x - a.x, 1);
  }
  // mặt quầy gỗ dày
  box(ctx, P, x0 - 0.1, x1 + 0.05, z0 - 0.06, z1 + 0.1, 1.09, { top: '#8e6a46', front: '#5a3f27', left: '#4a3320', right: '#3a2818', edge: 'rgba(255,225,180,0.45)' }, 1.0);
  // dừa tươi trên quầy
  coconut(ctx, P, x0 + 0.3, z1 - 0.85, 1.09, 0);
  coconut(ctx, P, x0 + 0.66, z1 - 0.52, 1.09, 1);
  coconut(ctx, P, x0 + 0.36, z1 - 0.2, 1.09, 2);
  // cột mái phía trước
  for (const [x, z] of [[x0 + 0.06, z1 - 0.05], [x1 - 0.08, z1 - 0.05]]) bambooPost(ctx, P, x, z, 1.05, 1.95, 0.085);
  // mái lá
  const r = thatch(ctx, P, x0 - 0.42, x1 + 0.28, z0 - 0.3, z1 + 0.32, 1.9, 2.32, 0.55);
  // dây bóng đèn dọc mép mái
  const glow = glowSprite('255,200,120');
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = lerp(r.F0.x, r.F1.x, t), y = lerp(r.F0.y, r.F1.y, t) + r.F0.s * (0.2 + 0.06 * Math.sin(t * Math.PI));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    stampGlow(ctx, glow, x, y, r.F0.s * 0.2, r.F0.s * 0.2, 0.55);
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r.F0.s * 0.035), 0, Math.PI * 2); ctx.fillStyle = '#ffe9b8'; ctx.fill();
  }
  // biển NƯỚC DỪA dựng trên nóc mái (hai cọc tre)
  const sg = signPos(c);
  const sp = P.pt(sg.x, sg.z, sg.h);
  const bwid = sp.s * 1.55, bh = sp.s * 0.42;
  for (const k of [-0.3, 0.3]) {
    const a = P.pt(sg.x + k * 1.55, sg.z, 2.2), b = P.pt(sg.x + k * 1.55, sg.z, sg.h);
    const w = Math.max(1, a.s * 0.06);
    bambooV(ctx, a.x - w / 2, b.y, a.y, w, 0);
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  fillRR(ctx, sp.x - bwid / 2, sp.y - bh / 2, bwid, bh, bh * 0.2, '#3a2716');
  ctx.restore();
  ctx.strokeStyle = '#8d6b43';
  ctx.lineWidth = Math.max(0.8, bh * 0.07);
  rrPath(ctx, sp.x - bwid / 2 + 1, sp.y - bh / 2 + 1, bwid - 2, bh - 2, bh * 0.18);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = 'rgba(255,190,90,0.85)';
  ctx.shadowBlur = Math.max(3, bh * 0.5);
  ctx.fillStyle = '#ffd98a';
  ctx.font = `800 ${Math.max(7, bh * 0.56)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NƯỚC DỪA', sp.x, sp.y + 0.5, bwid * 0.9);
  ctx.restore();
}

/** chỗ dựng biển NƯỚC DỪA: giữa nóc mái, cao 2,6 ô */
const signPos = (c) => ({ x: c.x + c.w / 2 - 0.1, z: (c.y - 0.3 + c.y + c.h + 0.32) / 2 + 0.15, h: 2.62 });

function drawCounter(ctx, P, c, now) {
  const e = objSprite('bar', P, dprOf(ctx), { x0: c.x - 0.75, x1: c.x + c.w + 0.45, z0: c.y - 0.4, z1: c.y + c.h + 0.5, h: 3.0 },
    (cc, Pq) => paintCounter(cc, Pq, c));
  drawObj(ctx, P, e);
  if (now) {
    // biển hiệu sáng "thở" nhẹ
    const sg = signPos(c);
    const p = P.pt(sg.x, sg.z, sg.h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    stampGlow(ctx, glowSprite('255,190,100'), p.x, p.y, p.s * 1.1, p.s * 0.45, 0.12 + 0.06 * Math.sin(now / 900));
    ctx.restore();
  }
}

// ================================================================ (3c) vật trang trí sắp theo độ sâu: đuốc hai góc sàn gỗ
function props() {
  return DECK_TORCHES.map((t) => ({
    key: t.z, x: t.x, z: t.z,
    draw(ctx, P, now) {
      const p = P.pt(t.x, t.z);
      const sp = torchSprite(p.s, dprOf(ctx));
      ctx.drawImage(sp.cv, p.x - sp.ox, p.y - sp.oy, sp.w, sp.h);
      flame(ctx, p.x + sp.fx, p.y + sp.fy, p.s, now, t.seed);
    },
  }));
}

function flame(ctx, x, y, s, now, seed) {
  const fl = 0.8 + 0.2 * Math.sin(now / 97 + seed * 4) * Math.sin(now / 233 + seed);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  stampGlow(ctx, glowSprite('255,150,60'), x, y - s * 0.18, s * 1.15, s * 1.15, 0.4 * fl);
  ctx.restore();
  drawFlame(ctx, x, y, s, now, seed, 1.2);
}

/** lửa đuốc ngoài hàng rào (mỗi khung); above = chỉ những ngọn nhô lên trên mép dưới video (vẽ ở skyFx) */
function torchFlames(ctx, P, L, now, above) {
  for (const t of TORCHES) {
    const p = P.pt(t.x, t.z);
    if (p.x < -30 || p.x > L.w + 30) continue;
    const fy = p.y - FLAME_BASE * p.s;
    if (above && fy - p.s * 0.6 > L.vb) continue;
    if (!above && fy < L.vb - p.s * 0.5) continue;
    flame(ctx, p.x, fy, p.s, now, t.seed);
  }
}

// ================================================================ (4) hiệu ứng mỗi khung
function drawDanceLights(ctx, P, dancers, now) {
  if (cur.L) torchFlames(ctx, P, cur.L, now, false);
  if (!dancers.length) return;
  const d = HALL.danceFloor;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // quầng ấm dưới chân người nhảy (nhịp theo điệu) + ván quanh đó ửng sáng
  const warm = poolSprite('255,168,88');
  for (const a of dancers) {
    if (!inDeck(a.x, a.y, 0.4)) continue;
    const p = P.pt(a.x, a.y);
    const beat = 0.72 + 0.28 * Math.sin(now / 140 + a.x * 1.7);
    stampGlow(ctx, warm, p.x, p.y, p.s * 1.35, P.k * 1.35, 0.36 * beat);
  }
  // đốm đèn màu quét trên sàn gỗ (vàng ấm, san hô, ngọc)
  const n = Math.min(3, dancers.length);
  const cols = ['255,196,112', '255,112,128', '72,214,200'];
  for (let i = 0; i < n; i++) {
    const t = now / (2700 + i * 650) + i * 2.1;
    const p = P.pt(d.x + d.w * (0.5 + 0.43 * Math.sin(t)), d.y + d.h * (0.5 + 0.36 * Math.cos(t * 1.3)));
    stampGlow(ctx, poolSprite(cols[i]), p.x, p.y, p.s * 1.5, P.k * 1.5, 0.3);
  }
  // dây đèn mép trước / sau sàn chạy đuổi theo nhịp (1/4 số bóng sáng mỗi lúc)
  const step = 0.62, beat = Math.floor(now / 150);
  const ex0 = d.x - 0.07, ex1 = d.x + d.w + 0.07;
  let i = 0;
  for (let x = ex0; x <= ex1; x += step, i++) {
    if ((i + beat) % 4) continue;
    const c = cols[(Math.floor(i / 4) + Math.floor(beat / 8)) % 3];
    for (const z of [d.y - 0.06, d.y + d.h + 0.07]) {
      const p = P.pt(x, z);
      stampGlow(ctx, poolSprite(c), p.x, p.y, p.s * 0.34, P.k * 0.34, 0.85);
    }
  }
  ctx.restore();
}

function skyFx(ctx, L, now) {
  const G = BG;
  if (!G || G.L !== L) return;
  ctx.save();
  const roomBoxes = cur.L === L ? cur.palmBoxes : []; // ngọn dừa gần (lớp phòng) — hiệu ứng trời né ra
  // sao lấp lánh
  ctx.fillStyle = '#f3f6ff';
  for (const s of G.twinkles) {
    const k = Math.sin(now / s.sp + s.ph);
    if (k < 0.2 || hitBox(roomBoxes, s.x, s.y, 3)) continue;
    const a = (k - 0.2) * 0.95;
    const r = s.sz * (1 + k * 1.6);
    ctx.globalAlpha = a;
    ctx.fillRect(s.x - r, s.y - 0.45, r * 2, 0.9);
    ctx.fillRect(s.x - 0.45, s.y - r, 0.9, r * 2);
    ctx.globalAlpha = Math.min(1, a * 1.2);
    ctx.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6);
  }
  // vệt trăng lăn tăn
  if (G.moon) {
    const m = G.moon;
    ctx.fillStyle = '#fff7da';
    for (let i = 0; i < 18; i++) {
      const sp = 520 + hash2(i, 2, 71) * 760;
      const ph = now / sp + hash2(i, 3, 71) * 6.28;
      const cyc = Math.floor(ph / (Math.PI * 2));
      const a = Math.sin(ph);
      if (a < 0.1) continue;
      const k = hash2(i, cyc, 72);
      const y = G.yH + 2 + k * (G.ySh - G.yH - 4);
      const half = m.r * (0.35 + k * 1.75);
      const x = m.x + (hash2(cyc, i, 73) - 0.5) * 2 * half;
      if (hitBox(roomBoxes, x, y, 2)) continue;
      const len = 2 + hash2(i, cyc, 74) * (3 + k * 12);
      ctx.globalAlpha = a * (0.75 - k * 0.35);
      ctx.fillRect(x - len / 2, y, len, 1);
    }
  }
  // sóng vỗ: vệt bọt tiến / lùi chậm trên cát ướt
  const wave = 0.5 + 0.5 * Math.sin(now / 2300);
  const yW = G.ySh + 1.5 + wave * Math.max(2, (G.yPF - G.ySh) * 0.1);
  ctx.globalAlpha = 0.18 + 0.22 * (1 - wave);
  ctx.strokeStyle = '#e6effa';
  ctx.lineWidth = 1.1;
  // né thân dừa, cột tre và cả bề ngang khung màn hình (phía sau màn hình bị cắt bỏ — khỏi vẽ phí)
  const skips = G.gaps.concat([[G.poleL - 2, G.poleR + G.pw + 2]]);
  ctx.beginPath();
  let pen = false;
  for (let x = 0; x <= G.AW; x += 5) {
    const y = yW + Math.sin(x * 0.05 + now / 1400) * 1.1;
    const blocked = skips.some(([a, b]) => x > a && x < b) || hitBox(roomBoxes, x, y, 1);
    if (blocked) { pen = false; continue; }
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // sao băng thỉnh thoảng vụt qua (mỗi ~11 s, 0,7 s)
  const SP = 11000, cyc = Math.floor(now / SP), tt = (now % SP) / 700;
  if (tt < 1 && G.twinkles.length) {
    const st = G.twinkles[Math.floor(hash2(cyc, 1, 97) * G.twinkles.length)];
    const dir = st.x < G.AW / 2 ? 1 : -1;
    const len = clamp(G.sc.h * 0.2, 40, 110);
    const hx = st.x + dir * len * 1.4 * tt, hy = st.y + len * 0.5 * tt;
    const tx = hx - dir * len * 0.9 * Math.min(1, tt * 3), ty = hy - len * 0.32 * Math.min(1, tt * 3);
    const inPanel = (xx) => xx < G.poleL - 4 || xx > G.poleR + G.pw + 4;
    if (inPanel(hx) && inPanel(tx) && hy < G.yH - 4 && !hitBox(G.boxes, hx, hy, 2) && !hitBox(roomBoxes, hx, hy, 2)) {
      const fade = Math.sin(tt * Math.PI);
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, 'rgba(220,232,255,0)');
      g.addColorStop(1, `rgba(240,246,255,${(0.9 * fade).toFixed(3)})`);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    }
  }
  // hải đăng nháy
  if (G.light && !hitBox(roomBoxes, G.light.x, G.light.y, 2)) {
    const ph = (now % 3200) / 3200;
    const on = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0;
    if (on > 0.01) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      stampGlow(ctx, glowSprite('255,235,180'), G.light.x, G.light.y, G.light.r * 1.6, G.light.r * 1.6, on * 0.9);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.restore();
  // ngọn đuốc nhô lên trên mép dưới video (lớp người bị cắt ở L.vb)
  if (cur.P && cur.L === L) torchFlames(ctx, cur.P, L, now, true);
}

/** tàn lửa bay lên từ các ngọn đuốc */
function fx(ctx, P, L, now) {
  ctx.save();
  ctx.fillStyle = '#ffc86e';
  const all = TORCHES.concat(DECK_TORCHES);
  for (let j = 0; j < all.length; j++) {
    const t = all[j];
    const p = P.pt(t.x, t.z);
    if (p.x < -20 || p.x > L.w + 20) continue;
    const fy = p.y - (FLAME_BASE + 0.32) * p.s;
    for (let i = 0; i < 3; i++) {
      const life = 1300 + hash2(j, i, 91) * 900;
      const age = (now + hash2(j, i, 92) * 5000) % life;
      const k = age / life;
      const x = p.x + Math.sin(now / 320 + i * 2.1 + j) * p.s * 0.1 * k + (hash2(j, i, 93) - 0.5) * p.s * 0.25 * k;
      const y = fy - k * p.s * 1.15;
      if (y < L.vb + 2) continue;
      ctx.globalAlpha = (1 - k) * 0.85;
      const sz = Math.max(1, p.s * 0.035) * (1 - k * 0.5);
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
  }
  ctx.restore();
}

/** chùm sáng máy chiếu từ sau lưng khán giả lên màn hình + bụi cát bay (px CSS) */
function drawBeam(ctx, L, now, motes) {
  const sc = L.screen;
  const ox = L.Xc ?? L.w / 2, oy = L.h + 40;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, oy, 0, sc.y + sc.h);
  g.addColorStop(0, 'rgba(195,212,255,0.09)');
  g.addColorStop(1, 'rgba(195,212,255,0.03)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(ox - 8, oy);
  ctx.lineTo(sc.x + 4, sc.y + sc.h);
  ctx.lineTo(sc.x + sc.w - 4, sc.y + sc.h);
  ctx.lineTo(ox + 8, oy);
  ctx.closePath();
  ctx.fill();
  if (motes) {
    for (let i = 0; i < 26; i++) {
      const r = hash2(i, 11, 3);
      const k = ((now / (9000 + r * 7000)) + hash2(i, 7, 5)) % 1;
      const y = oy + (sc.y + sc.h - oy) * k;
      const half = 8 + (sc.w / 2 - 8) * k;
      const x = ox + (hash2(i, 13, 9) * 2 - 1) * half * 0.92 + Math.sin(now / 1500 + i) * 3;
      ctx.fillStyle = `rgba(232,236,250,${(0.1 + 0.16 * Math.sin(k * Math.PI)).toFixed(3)})`;
      const sz = 1.1 + (1 - k) * 1.3;
      ctx.fillRect(x, y, sz, sz);
    }
  }
  ctx.restore();
}

/** ánh màn hình hắt xuống mấy hàng đầu + tối dần ở mép gần người xem (ánh trăng lạnh) */
function drawHallLight(ctx, P, L, playing) {
  if (playing) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = (P.Yn - P.Yf) * 0.8;
    ctx.translate(L.Xc ?? L.w / 2, P.Yf - P.k * 0.5);
    ctx.scale(2.1, 1);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, r);
    g.addColorStop(0, 'rgba(150,178,255,0.13)');
    g.addColorStop(1, 'rgba(150,178,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, 0, r * 2, r);
    ctx.restore();
  }
  ctx.save();
  const v = ctx.createLinearGradient(0, P.Yn - (P.Yn - P.Yf) * 0.4, 0, L.h);
  v.addColorStop(0, 'rgba(4,6,16,0)');
  v.addColorStop(1, 'rgba(4,6,16,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, P.Yf, L.w, L.h - P.Yf + 2);
  ctx.restore();
}

export default {
  id: 'bien',
  void: C.void,
  floorTexture,
  renderBand,
  drawRoom,
  renderRow,
  props,
  drawSpeaker,
  drawCounter,
  drawDanceLights,
  drawBeam,
  drawHallLight,
  skyFx,
  fx,
};
