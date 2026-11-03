// Rạp Đỗ Xe (2) — sàn + phòng: mặt nhựa đường nhìn từ trên (hạt sạn, vết nứt, vết dầu, bóng xe, vạch ô đỗ trắng, vạch
// vàng + mũi tên trắng ở lối đi, sàn nhảy ô bàn cờ viền neon, quầng đèn cột) trải theo phối cảnh; hàng rào lưới B40 hai
// bên, cột đèn bãi xe (đứng ngoài rào — không ai đi ra sau được nên không cần sắp theo độ sâu), bục bê tông dưới tháp
// màn hình có sọc vàng đen. Tất cả cache theo camera (render/stage.js).
import { HALL } from '../../shared/hall.js';
import { hash2 } from '../../util.js';
import { makeCanvas, vGrad, rrPath } from '../draw.js';
import { poly, drawFloor, box } from '../persp.js';
import { ZW, STAGE_H } from '../hall.js';

const W = HALL.W, H = HALL.H, XL = 1, XR = W - 1;
const TEX = { x0: -5, x1: W + 5, z0: -0.3, z1: H + 7 };
const FENCE_H = 1.9;
export const LAMP_H = 3.9;
/** cột đèn bãi xe: đứng ngoài rào, cần đèn vươn vào trong (dir) */
export const LAMPS = [
  { x: 0.45, z: 7.0, dir: 1 }, { x: 0.45, z: 13.4, dir: 1 },
  { x: W - 0.45, z: 7.0, dir: -1 }, { x: W - 0.45, z: 13.4, dir: -1 },
];
/** ô bàn cờ sàn nhảy (drawDanceLights dùng cùng lưới) */
export const PAD = { ...HALL.danceFloor, cw: 1, ch: HALL.danceFloor.h / 4, nx: HALL.danceFloor.w, nz: 4 };

/** xe = một cặp ghế cạnh nhau trong cùng dãy: tâm xe cx, hàng z */
export const CARS = (() => {
  const out = [];
  HALL.rows.forEach((z, row) => {
    HALL.blocks.forEach((b, bi) => {
      for (let i = 0; i + 1 < b.n; i += 2) out.push({ row, z, cx: b.x0 + i + 1, block: bi, idx: i / 2 });
    });
  });
  return out;
})();

// ================================================================ texture sàn (vẽ một lần)
export function floorTexture(scale = 48) {
  const cv = makeCanvas((TEX.x1 - TEX.x0) * scale, (TEX.z1 - TEX.z0) * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, -TEX.x0 * scale, -TEX.z0 * scale);
  // ngoài rào: đất sỏi lẫn cỏ úa
  ctx.fillStyle = '#0e1213';
  ctx.fillRect(TEX.x0, TEX.z0, TEX.x1 - TEX.x0, TEX.z1 - TEX.z0);
  for (let i = 0; i < 900; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side < 0 ? TEX.x0 + hash2(i, 1, 3) * (XL - TEX.x0) : XR + hash2(i, 1, 3) * (TEX.x1 - XR);
    const z = TEX.z0 + hash2(i, 2, 3) * (TEX.z1 - TEX.z0);
    const h = hash2(i, 3, 3);
    ctx.fillStyle = h > 0.6 ? `rgba(60,82,52,${0.25 + h * 0.3})` : `rgba(0,0,0,${0.2 + h * 0.3})`;
    ctx.fillRect(x, z, 0.05 + h * 0.08, 0.05 + h * 0.05);
  }
  // trong rào: nhựa đường
  ctx.fillStyle = '#1b1e26';
  ctx.fillRect(XL, TEX.z0, XR - XL, TEX.z1 - TEX.z0);
  for (let i = 0; i < 24; i++) {
    const x = XL + hash2(i, 4, 9) * (XR - XL), z = hash2(i, 5, 9) * TEX.z1, r = 1 + hash2(i, 6, 9) * 1.8;
    const g = ctx.createRadialGradient(x, z, 0, x, z, r);
    const c = hash2(i, 7, 9) > 0.5 ? '255,255,255' : '0,0,0';
    g.addColorStop(0, `rgba(${c},0.05)`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, z - r, r * 2, r * 2);
  }
  // vết nứt
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    let x = XL + 1 + hash2(i, 8, 9) * (XR - XL - 2), z = 0.4 + hash2(i, 9, 9) * (TEX.z1 - 1);
    let a = hash2(i, 10, 9) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, z);
    for (let j = 0; j < 9; j++) {
      a += (hash2(i, j, 11) - 0.5) * 1.4;
      x += Math.cos(a) * 0.32; z += Math.sin(a) * 0.32;
      ctx.lineTo(x, z);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
  }
  // vết dầu (chỗ trống: lối đi, đầu bãi, cuối bãi)
  const stains = [[11, 9.4], [23.2, 12.6], [6.5, 15.2], [27.5, 15.4], [16.8, 15.6], [10.6, 16.6], [3.1, 5.6], [30.6, 5.7]];
  for (const [x, z] of stains) {
    const r = 0.45 + hash2(x | 0, z | 0, 4) * 0.35;
    ctx.save();
    ctx.translate(x, z);
    ctx.scale(1, 0.75);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(4,5,8,0.55)');
    g.addColorStop(0.7, 'rgba(30,20,50,0.25)');
    g.addColorStop(0.85, 'rgba(60,120,110,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  // vạch ô đỗ: mỗi xe = một cặp ghế → vạch trắng mỗi 2 ghế trong từng dãy
  const zTop = HALL.rows[0] - 1.25, zBot = HALL.rows[HALL.rows.length - 1] + 0.8;
  for (const b of HALL.blocks) {
    for (let x = b.x0; x <= b.x0 + b.n + 0.01; x += 2) paintLine(ctx, x, zTop, x, zBot, 0.07, 'rgba(226,230,238,', 0.62);
    for (const z of HALL.rows) paintLine(ctx, b.x0, z - 1.16, b.x0 + b.n, z - 1.16, 0.05, 'rgba(226,230,238,', 0.4);
  }
  // bóng xe trên nền
  // bóng xe trên nền: gom mọi ô vào một đường rồi làm mờ một lần (mẹo shadowOffset của draw.softShadow)
  {
    const off = 20000;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 0.14 * scale;
    ctx.shadowOffsetX = off;
    ctx.beginPath();
    for (const c of CARS) {
      const x = c.cx - 0.95 - off / scale, z = c.z - 0.97, w = 1.9, h = 1.62, r = 0.3;
      ctx.moveTo(x + r, z);
      ctx.arcTo(x + w, z, x + w, z + h, r); ctx.arcTo(x + w, z + h, x, z + h, r);
      ctx.arcTo(x, z + h, x, z, r); ctx.arcTo(x, z, x + w, z, r);
      ctx.closePath();
    }
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }
  // ánh đỏ đèn hậu loang trên nhựa đường sau mỗi xe
  for (const c of CARS) {
    const z = c.z + 0.78;
    ctx.save();
    ctx.translate(c.cx, z);
    ctx.scale(1, 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.95);
    g.addColorStop(0, 'rgba(255,45,65,0.2)');
    g.addColorStop(1, 'rgba(255,45,65,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.95, -0.95, 1.9, 1.9);
    ctx.restore();
  }
  // lối đi: vạch vàng hai mép + mũi tên trắng chỉ về màn hình
  const bl = HALL.blocks;
  const aisles = [[bl[0].x0 + bl[0].n, bl[1].x0], [bl[1].x0 + bl[1].n, bl[2].x0]];
  for (const [a0, a1] of aisles) {
    for (const lx of [a0 + 0.12, a1 - 0.12]) paintLine(ctx, lx, 5.5, lx, TEX.z1, 0.06, 'rgba(242,196,58,', 0.8);
    for (const z of [8.1, 11.5, 15.0, 18.6]) arrow(ctx, (a0 + a1) / 2, z);
  }
  // làn ngang cuối bãi: vạch vàng đứt + mũi tên rẽ vào lối đi
  for (let x = XL + 0.6; x < XR - 0.6; x += 1.1) paintLine(ctx, x, 15.55, x + 0.6, 15.55, 0.06, 'rgba(242,196,58,', 0.55);
  drawPadTex(ctx);
  // quầng đèn cột trên nền
  for (const l of LAMPS) {
    const x = l.x + l.dir * 0.85;
    const g = ctx.createRadialGradient(x, l.z, 0, x, l.z, 2.6);
    g.addColorStop(0, 'rgba(255,184,100,0.2)');
    g.addColorStop(0.5, 'rgba(255,184,100,0.07)');
    g.addColorStop(1, 'rgba(255,184,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 2.6, l.z - 2.6, 5.2, 5.2);
  }
  // gờ bê tông chân rào
  for (const x of [XL, XR]) {
    ctx.fillStyle = 'rgba(150,156,168,0.32)';
    ctx.fillRect(x - 0.08, TEX.z0, 0.16, TEX.z1 - TEX.z0);
  }
  // bóng bục bê tông đổ xuống mép sàn
  ctx.fillStyle = vGrad(ctx, 0, 0.55, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]);
  ctx.fillRect(TEX.x0, 0, TEX.x1 - TEX.x0, 0.55);
  grain(cv);
  return { canvas: cv, ...TEX, scale };
}

/** vạch sơn mòn: chia khúc, mỗi khúc đậm nhạt khác nhau */
function paintLine(ctx, x0, z0, x1, z1, w, rgb, a) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.35));
  ctx.lineWidth = w;
  ctx.lineCap = 'butt';
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    ctx.strokeStyle = `${rgb}${(a * (0.6 + 0.4 * hash2(Math.round(x0 * 7 + i), Math.round(z0 * 7), 21))).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0);
    ctx.lineTo(x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1);
    ctx.stroke();
  }
}

function arrow(ctx, x, z) {
  ctx.fillStyle = 'rgba(232,235,242,0.55)';
  ctx.fillRect(x - 0.09, z - 0.05, 0.18, 0.75);
  ctx.beginPath();
  ctx.moveTo(x, z - 0.6); ctx.lineTo(x + 0.33, z); ctx.lineTo(x - 0.33, z);
  ctx.closePath();
  ctx.fill();
}

function drawPadTex(ctx) {
  const d = PAD;
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  for (let i = 0; i < d.nx; i++) {
    for (let j = 0; j < d.nz; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#14131b' : '#34333f';
      ctx.fillRect(d.x + i * d.cw, d.y + j * d.ch, d.cw + 0.01, d.ch + 0.01);
    }
  }
  ctx.fillStyle = vGrad(ctx, d.y, d.y + d.h, [[0, 'rgba(170,190,255,0.12)'], [1, 'rgba(170,190,255,0)']]);
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.restore();
  // viền neon: hồng ngoài, xanh ngọc trong (vầng sáng loang trên nhựa đường)
  for (const [inset, col, rgb] of [[0, '#ff4fd8', '255,79,216'], [0.16, '#2ee6d6', '46,230,214']]) {
    const x = d.x + inset, y = d.y + inset, w = d.w - inset * 2, h = d.h - inset * 2;
    for (const [lw, a] of [[0.42, 0.06], [0.22, 0.12]]) {
      ctx.strokeStyle = `rgba(${rgb},${a})`;
      ctx.lineWidth = lw;
      rrPath(ctx, x, y, w, h, 0.1);
      ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.06;
    rrPath(ctx, x, y, w, h, 0.1);
    ctx.stroke();
  }
}

/** hạt sạn nhựa đường: ô nhiễu nhỏ sinh sẵn (không đọc ngược điểm ảnh) rồi phủ lặp lên cả texture */
function grain(cv) {
  const n = 96;
  const tile = makeCanvas(n, n);
  const tc = tile.getContext('2d');
  const img = tc.createImageData(n, n);
  const d = img.data;
  let s = 1234567;
  for (let i = 0; i < d.length; i += 4) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const r = (s >>> 16) & 255;
    const light = r > 128;
    const v = light ? 255 : 0;
    d[i] = v; d[i + 1] = v; d[i + 2] = v;
    d[i + 3] = r > 250 ? 60 : r < 5 ? 70 : (Math.abs(r - 128) & 15) * 1.5;
  }
  tc.putImageData(img, 0, 0);
  const c = cv.getContext('2d');
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = c.createPattern(tile, 'repeat');
  c.fillRect(0, 0, cv.width, cv.height);
  c.restore();
}

// ================================================================ phòng (cache theo camera)
export function drawRoom(ctx, P, tex, L, dpr, step = 2) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFloor(ctx, P, tex, dpr, P.Yf, L.h, step);
  ctx.restore();
  // rào, cột đèn, bục được phép lên dải trời nhưng KHÔNG BAO GIỜ che khung video
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, L.w, L.h);
  ctx.rect(L.screen.x - L.frame, L.screen.y - L.frame, L.screen.w + L.frame * 2, L.screen.h + L.frame * 2);
  ctx.clip('evenodd');
  ctx.lineJoin = 'round';
  for (const l of LAMPS) drawLamp(ctx, P, L, l);
  drawFence(ctx, P, L, XL, -1);
  drawFence(ctx, P, L, XR, 1);
  drawPlatform(ctx, P, L);
  ctx.restore();
}

/** z xa nhất (gần camera nhất) còn cần vẽ cho vật đứng ở mép x, cao h */
function zLimit(P, L, x, h) {
  let z = H + 8;
  const dx = x - P.xcam;
  if (Math.abs(dx) > 0.01) {
    const sNeed = (dx < 0 ? P.Xc + 30 : L.w - P.Xc + 30) / Math.abs(dx);
    z = Math.min(z, (sNeed - P.s0) / P.ds + 0.6);
  }
  const zy = (L.h + 10 - P.Yf + h * P.s1) / P.k + 0.5;
  return Math.max(ZW + 0.5, Math.min(z, zy));
}

function drawFence(ctx, P, L, x, side) {
  const z0 = ZW, z1 = zLimit(P, L, x, FENCE_H);
  const at = (z, h) => P.pt(x, z, h);
  const pa = at(z0, 0), pd = at(z1, 0);
  if ((side < 0 && Math.max(pa.x, pd.x) < -4) || (side > 0 && Math.min(pa.x, pd.x) > L.w + 4)) return;
  // lưới mắt cáo: lớp mờ + đường chéo hai chiều
  poly(ctx, [at(z0, 0), at(z0, FENCE_H), at(z1, FENCE_H), at(z1, 0)], 'rgba(130,140,165,0.07)');
  ctx.strokeStyle = 'rgba(170,182,205,0.24)';
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  const sp = 0.3;
  for (let zs = z0 - FENCE_H; zs < z1; zs += sp) {
    for (const up of [true, false]) {
      const t0 = Math.max(0, (z0 - zs) / FENCE_H), t1 = Math.min(1, (z1 - zs) / FENCE_H);
      if (t1 <= t0) continue;
      for (let k = 0; k < 3; k++) {
        const ta = t0 + ((t1 - t0) * k) / 3, tb = t0 + ((t1 - t0) * (k + 1)) / 3;
        const a = at(zs + FENCE_H * ta, FENCE_H * (up ? ta : 1 - ta)), b = at(zs + FENCE_H * tb, FENCE_H * (up ? tb : 1 - tb));
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
  }
  ctx.stroke();
  // ống trên + dây căng dưới
  const rail = (h, th, col) => poly(ctx, [at(z0, h + th), at(z1, h + th), at(z1, h - th), at(z0, h - th)], col);
  rail(FENCE_H, 0.035, '#7d8699');
  rail(0.06, 0.012, 'rgba(150,160,180,0.6)');
  // cột rào
  for (let z = z0; z < z1; z += 2) {
    const b = at(z, 0), t = at(z, FENCE_H + 0.1);
    const w = Math.max(1.2, b.s * 0.06);
    ctx.fillStyle = '#5c6476';
    ctx.fillRect(b.x - w / 2, t.y, w, b.y - t.y);
    ctx.fillStyle = 'rgba(220,228,245,0.28)';
    ctx.fillRect(b.x + (side < 0 ? w / 2 - 1 : -w / 2), t.y, Math.min(1, w / 2), b.y - t.y);
    ctx.fillStyle = '#3c4252';
    ctx.beginPath(); ctx.ellipse(t.x, t.y, w * 0.85, w * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawLamp(ctx, P, L, l) {
  const base = P.pt(l.x, l.z, 0);
  if (base.x < -120 || base.x > L.w + 120 || base.y - LAMP_H * base.s > L.h) return;
  box(ctx, P, l.x - 0.14, l.x + 0.14, l.z - 0.14, l.z + 0.14, 0.22, { top: '#575c69', front: '#3a3e49', left: '#2c2f38', right: '#2c2f38' });
  const b = P.pt(l.x, l.z, 0.22), t = P.pt(l.x, l.z, LAMP_H);
  const w0 = 0.065 * b.s, w1 = 0.04 * t.s;
  poly(ctx, [{ x: b.x - w0, y: b.y }, { x: b.x + w0, y: b.y }, { x: t.x + w1, y: t.y }, { x: t.x - w1, y: t.y }], '#2b303c');
  ctx.fillStyle = 'rgba(200,215,245,0.2)';
  ctx.fillRect(t.x + (l.dir > 0 ? w1 * 0.2 : -w1), t.y, w1 * 0.8, b.y - t.y);
  // cần đèn vươn vào bãi + chao đèn hình đầu rắn hổ mang
  const e = P.pt(l.x + l.dir * 0.85, l.z, LAMP_H + 0.06);
  ctx.strokeStyle = '#2b303c';
  ctx.lineWidth = Math.max(1.4, t.s * 0.05);
  ctx.beginPath();
  ctx.moveTo(t.x, t.y + 1);
  ctx.quadraticCurveTo(t.x + (e.x - t.x) * 0.4, e.y - t.s * 0.22, e.x, e.y);
  ctx.stroke();
  const hw = t.s * 0.3, hh = t.s * 0.1;
  ctx.fillStyle = '#353b49';
  ctx.beginPath(); ctx.ellipse(e.x, e.y, hw, hh, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#fff2cf';
  ctx.beginPath(); ctx.ellipse(e.x, e.y, hw * 0.85, hh * 0.55, 0, 0, Math.PI); ctx.fill();
  // nón sáng xuống mặt nhựa đường + quầng quanh chao
  const g0 = P.pt(l.x + l.dir * 0.85, l.z, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cone = ctx.createLinearGradient(0, e.y, 0, g0.y);
  cone.addColorStop(0, 'rgba(255,200,120,0.2)');
  cone.addColorStop(1, 'rgba(255,200,120,0.015)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(e.x - hw * 0.8, e.y + hh * 0.3); ctx.lineTo(e.x + hw * 0.8, e.y + hh * 0.3);
  ctx.lineTo(g0.x + g0.s * 1.25, g0.y); ctx.lineTo(g0.x - g0.s * 1.25, g0.y);
  ctx.closePath();
  ctx.fill();
  const hg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, t.s * 0.9);
  hg.addColorStop(0, 'rgba(255,214,150,0.45)');
  hg.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(e.x - t.s, e.y - t.s, t.s * 2, t.s * 2);
  ctx.restore();
}

function drawPlatform(ctx, P, L) {
  const tF0 = P.pt(XL, ZW, STAGE_H), tF1 = P.pt(XR, ZW, STAGE_H);
  const tN0 = P.pt(XL, 0, STAGE_H), tN1 = P.pt(XR, 0, STAGE_H);
  poly(ctx, [tF0, tF1, tN1, tN0], vGrad(ctx, tF0.y, tN0.y, [[0, '#23262e'], [1, '#353943']]));
  // khe co giãn bê tông
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = XL + 4; x < XR; x += 4) {
    const a = P.pt(x, ZW, STAGE_H), b = P.pt(x, 0, STAGE_H);
    if (b.x < -10 || b.x > L.w + 10) continue;
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // mặt trước: bê tông, sọc vàng đen ở mép trên, đèn mốc hổ phách sát chân
  const f0 = P.pt(XL, 0, 0), f1 = P.pt(XR, 0, 0);
  poly(ctx, [tN0, tN1, f1, f0], vGrad(ctx, tN0.y, f0.y, [[0, '#3b3f49'], [1, '#202329']]));
  const sTop = tN0.y, sBot = P.pt(XL, 0, STAGE_H - 0.2).y, sw = Math.max(5, P.s0 * 0.32);
  ctx.save();
  ctx.beginPath();
  ctx.rect(tN0.x, sTop, tN1.x - tN0.x, sBot - sTop);
  ctx.clip();
  ctx.fillStyle = '#d9a91f';
  ctx.fillRect(tN0.x, sTop, tN1.x - tN0.x, sBot - sTop);
  ctx.fillStyle = '#17171b';
  const hgt = sBot - sTop;
  ctx.beginPath();
  for (let x = tN0.x - hgt; x < tN1.x + sw; x += sw * 2) {
    ctx.moveTo(x, sBot); ctx.lineTo(x + sw, sBot); ctx.lineTo(x + sw + hgt, sTop); ctx.lineTo(x + hgt, sTop);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(tN0.x, sBot - 1, tN1.x - tN0.x, 1);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,236,200,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tN0.x, tN0.y + 0.5); ctx.lineTo(tN1.x, tN1.y + 0.5); ctx.stroke();
  for (let x = XL + 1.5; x < XR; x += 2.5) {
    const p = P.pt(x, 0, 0.2);
    if (p.x < -20 || p.x > L.w + 20) continue;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 0.55);
    g.addColorStop(0, 'rgba(255,170,70,0.45)');
    g.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - p.s * 0.55, p.y - p.s * 0.55, p.s * 1.1, p.s * 1.1);
    ctx.fillStyle = '#ffc46b';
    ctx.fillRect(p.x - p.s * 0.08, p.y - p.s * 0.04, p.s * 0.16, p.s * 0.08);
  }
}
