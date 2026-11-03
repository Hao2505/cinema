// Vẽ rạp theo phối cảnh một điểm tụ (render/persp.js): nhìn từ cuối rạp, trên cao, về phía màn hình.
// (1) Dải màn hình (px CSS, cố định): tường cuối, tấm tiêu âm, quầng sáng, màn nhung, diềm, khung màn hình.
// (2) Phòng: thảm sàn (vẽ từ trên xuống một lần rồi trải theo phối cảnh), tường hai bên (ốp gỗ, đèn tường, dải LED
//     chân tường chụm về màn hình, biển LỐI RA), sân khấu khối 3D + đèn chân.
// (3) Vật thể sắp theo độ sâu: hàng ghế nhung (khối 3D, mỗi hàng một sprite), loa cột, quầy bar bắp nước.
// (4) Hiệu ứng: sàn nhảy đổi màu dưới chân người nhảy, đốm đèn quét, chùm máy chiếu + bụi, ánh màn hình hắt xuống.
// Không dùng ảnh — vẽ hết bằng code.
import { HALL, SEATS } from '../shared/hall.js';
import { hash2 } from '../util.js';
import { FONT, fillRR, rrPath, makeCanvas, vGrad, hGrad, circle, drawEmoji } from './draw.js';
import { box, poly, drawFloor } from './persp.js';

export const C = {
  void: '#07050a',
  carpet: '#3a1426',
  carpetDot: '#2c0e1c',
  aisle: '#24101a',
  runner: '#30131f',
  dance: '#161021',
  danceLine: '#2a2138',
  led: '#ffb347',
  seat: '#a3192f',
  seatHi: '#d1344d',
  seatLo: '#5e0c1a',
  arm: '#20141b',
  wood: '#4a2c19',
  woodLo: '#2a170c',
  woodHi: '#7a4a28',
  curtain: '#8c1528',
  curtainLo: '#4a0812',
  gold: '#e6b14a',
  goldLo: '#a8781f',
  wall: '#24162c',
  wallLo: '#120b17',
  exit: '#34d399',
};

const W = HALL.W, H = HALL.H;
const XL = 1, XR = W - 1; // mặt trong tường trái / phải
export const ZW = -1.2; // mặt tường cuối (màn hình)
export const STAGE_H = 0.75; // cao sân khấu (ô)

// ================================================================ (2a) thảm sàn: texture nhìn từ trên xuống
const TEX = { x0: -5, x1: W + 5, z0: -0.3, z1: H + 7 }; // sàn kéo dài sau hàng cuối (dưới dock nổi)

/** vẽ một lần: thảm hoạ tiết, bậc hàng ghế, lối đi có dải LED, sàn nhảy, LED chân tường; ngoài tường là sàn tối */
export function floorTexture(scale = 64) {
  const cv = makeCanvas((TEX.x1 - TEX.x0) * scale, (TEX.z1 - TEX.z0) * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, -TEX.x0 * scale, -TEX.z0 * scale);
  ctx.fillStyle = '#0b0710';
  ctx.fillRect(TEX.x0, TEX.z0, TEX.x1 - TEX.x0, TEX.z1 - TEX.z0);
  ctx.fillStyle = C.carpet;
  ctx.fillRect(XL, TEX.z0, XR - XL, TEX.z1 - TEX.z0);
  ctx.fillStyle = C.carpetDot;
  for (let z = 0.35; z < TEX.z1; z += 0.6) {
    const off = Math.round(z / 0.6) % 2 ? 0.3 : 0;
    for (let x = XL + 0.15 + off; x < XR; x += 0.6) {
      ctx.beginPath();
      ctx.moveTo(x, z - 0.08); ctx.lineTo(x + 0.08, z); ctx.lineTo(x, z + 0.08); ctx.lineTo(x - 0.08, z);
      ctx.closePath();
      ctx.fill();
    }
  }
  // bậc từng hàng ghế (rạp dốc): bậc sau sáng hơn chút, mép bậc có viền sáng
  HALL.rows.forEach((z, i) => {
    const z0 = z - 0.95, z1 = i < HALL.rows.length - 1 ? HALL.rows[i + 1] - 0.95 : TEX.z1;
    ctx.fillStyle = `rgba(255,190,205,${0.02 + i * 0.012})`;
    ctx.fillRect(XL, z0, XR - XL, z1 - z0);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(XL, z0 - 0.06, XR - XL, 0.06);
    ctx.fillStyle = 'rgba(255,214,170,0.14)';
    ctx.fillRect(XL, z0, XR - XL, 0.025);
  });
  // lối đi: thảm sẫm + dải LED hai mép (chạy dọc về phía màn hình → chụm về điểm tụ)
  const top = HALL.rows[0] - 0.95;
  const b = HALL.blocks;
  const aisles = [[b[0].x0 + b[0].n, b[1].x0], [b[1].x0 + b[1].n, b[2].x0]];
  for (const [a0, a1] of aisles) {
    ctx.fillStyle = C.aisle;
    ctx.fillRect(a0 + 0.06, top, a1 - a0 - 0.12, TEX.z1 - top);
    ctx.fillStyle = C.runner;
    ctx.fillRect(a0 + 0.42, top, a1 - a0 - 0.84, TEX.z1 - top);
    for (const lx of [a0 + 0.1, a1 - 0.1]) ledLine(ctx, lx, top, lx, TEX.z1, 0.035);
    for (const rz of HALL.rows) for (const lx of [a0 + 0.22, a1 - 0.22]) ledDot(ctx, lx, rz - 0.95, 0.06);
  }
  ledLine(ctx, XL + 0.05, -0.2, XL + 0.05, TEX.z1, 0.04);
  ledLine(ctx, XR - 0.05, -0.2, XR - 0.05, TEX.z1, 0.04);
  drawDanceFloorTex(ctx);
  // bóng của sân khấu đổ xuống mép sàn
  ctx.fillStyle = vGrad(ctx, 0, 0.6, [[0, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]);
  ctx.fillRect(XL, 0, XR - XL, 0.6);
  return { canvas: cv, ...TEX, scale };
}

function ledLine(ctx, x0, z0, x1, z1, w) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,170,80,0.28)';
  ctx.lineWidth = w * 5;
  ctx.beginPath(); ctx.moveTo(x0, z0); ctx.lineTo(x1, z1); ctx.stroke();
  ctx.strokeStyle = '#ffc070';
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.restore();
}

function ledDot(ctx, x, z, r) {
  const g = ctx.createRadialGradient(x, z, 0, x, z, r * 4);
  g.addColorStop(0, 'rgba(255,190,110,0.6)');
  g.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 4, z - r * 4, r * 8, r * 8);
  circle(ctx, x, z, r, C.led);
}

function drawDanceFloorTex(ctx) {
  const d = HALL.danceFloor;
  ctx.save();
  rrPath(ctx, d.x, d.y, d.w, d.h, 0.12);
  ctx.fillStyle = C.dance;
  ctx.fill();
  ctx.clip();
  for (let x = d.x; x < d.x + d.w - 0.01; x += 1) {
    for (let z = d.y; z < d.y + d.h - 0.01; z += 1) {
      const h = hash2(Math.round(x * 3), Math.round(z * 3), 7);
      ctx.fillStyle = `rgba(${120 + h * 60},${90 + h * 50},${190 + h * 50},${0.05 + h * 0.04})`;
      ctx.fillRect(x + 0.04, z + 0.04, 0.92, Math.min(0.92, d.y + d.h - z - 0.08));
    }
  }
  ctx.strokeStyle = C.danceLine;
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  for (let x = d.x + 1; x < d.x + d.w; x += 1) { ctx.moveTo(x, d.y); ctx.lineTo(x, d.y + d.h); }
  for (let z = d.y + 1; z < d.y + d.h; z += 1) { ctx.moveTo(d.x, z); ctx.lineTo(d.x + d.w, z); }
  ctx.stroke();
  ctx.fillStyle = vGrad(ctx, d.y, d.y + d.h, [[0, 'rgba(170,195,255,0.16)'], [1, 'rgba(170,195,255,0)']]);
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 0.07;
  ctx.strokeStyle = hGrad(ctx, d.x, d.x + d.w, [[0, '#ff4fd8'], [0.5, '#7c5cff'], [1, '#22d3ee']]);
  rrPath(ctx, d.x, d.y, d.w, d.h, 0.12);
  ctx.stroke();
  ctx.restore();
}

// ================================================================ (2b) phòng: sàn + tường + sân khấu (theo camera)
/** vẽ phần tĩnh của phòng (ctx đang ở px CSS × dpr). L = bố cục (stage.js), P = phép chiếu. */
export function drawRoom(ctx, P, tex, L, dpr, step = 2) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFloor(ctx, P, tex, dpr, P.Yf, L.h, step);
  ctx.restore();
  // tường hai bên được phép che màn nhung, KHÔNG BAO GIỜ che khung video
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, L.w, L.h);
  ctx.rect(L.screen.x - L.frame, L.screen.y - L.frame, L.screen.w + L.frame * 2, L.screen.h + L.frame * 2);
  ctx.clip('evenodd');
  drawWall(ctx, P, L, XL, -1);
  drawWall(ctx, P, L, XR, 1);
  ctx.restore();
  drawStage(ctx, P, L);
}

function drawWall(ctx, P, L, x, side) {
  // tường kéo dài tới tận sau lưng người xem (z rất lớn) để luôn ra khỏi khung nhìn, cao hơn trần khung nhìn
  const zn = H + 80, top = 60;
  const a = P.pt(x, ZW, 0), b = P.pt(x, ZW, top), c = P.pt(x, zn, top), d = P.pt(x, zn, 0);
  if ((side < 0 && Math.max(a.x, d.x) < -2) || (side > 0 && Math.min(a.x, d.x) > L.w + 2)) return;
  const g = ctx.createLinearGradient(a.x, 0, d.x, 0);
  g.addColorStop(0, '#2e1c38');
  g.addColorStop(0.35, C.wall);
  g.addColorStop(1, C.wallLo);
  poly(ctx, [a, b, c, d], g);
  // ốp gỗ: đường nối đứng (đường đứng giữ đứng trong phối cảnh một điểm tụ)
  ctx.lineWidth = 1;
  for (let z = ZW + 1.4; z < zn; z += 1.4) {
    const p0 = P.pt(x, z, 0);
    if (p0.x < -40 || p0.x > L.w + 40) continue;
    const p1 = P.pt(x, z, top);
    ctx.strokeStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,240,0.06)';
    ctx.beginPath(); ctx.moveTo(p0.x - side * 1.5, p0.y); ctx.lineTo(p1.x - side * 1.5, p1.y); ctx.stroke();
  }
  // len chân tường + dải LED
  poly(ctx, [P.pt(x, ZW, 0), P.pt(x, ZW, 0.28), P.pt(x, zn, 0.28), P.pt(x, zn, 0)], '#120a14');
  ctx.save();
  ctx.strokeStyle = 'rgba(255,176,90,0.85)';
  ctx.shadowColor = 'rgba(255,170,80,0.9)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.4;
  const l0 = P.pt(x, ZW, 0.28), l1 = P.pt(x, zn, 0.28);
  ctx.beginPath(); ctx.moveTo(l0.x, l0.y); ctx.lineTo(l1.x, l1.y); ctx.stroke();
  ctx.restore();
  // đèn tường hắt sáng (bóp ngang theo phối cảnh)
  for (let z = 0.9; z < H - 1.5; z += 3) {
    const p = P.pt(x, z, 2.3);
    if (p.x < -60 || p.x > L.w + 60) continue;
    const span = Math.abs(P.pt(x, z + 0.6, 2.3).x - P.pt(x, z - 0.6, 2.3).x) / 2 + 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(Math.max(0.15, span / p.s), 1);
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, p.s * 1.6);
    gl.addColorStop(0, 'rgba(255,175,95,0.42)');
    gl.addColorStop(1, 'rgba(255,175,95,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(-p.s * 1.6, -p.s * 1.6, p.s * 3.2, p.s * 3.2);
    ctx.restore();
    fillRR(ctx, p.x - Math.max(1.5, span * 0.18), p.y - p.s * 0.22, Math.max(3, span * 0.36), p.s * 0.44, 2, '#ffd296');
  }
  // biển LỐI RA (hộp đèn nhô ra khỏi tường, mặt quay về người xem)
  for (const z of HALL.exits) {
    const x0 = side < 0 ? x : x - 0.9, x1 = side < 0 ? x + 0.9 : x;
    const bb = box(ctx, P, x0, x1, z - 0.06, z + 0.06, 2.95, { front: '#0b3a2a', top: '#0f4d38', left: '#08281d', right: '#08281d' }, 2.45);
    const f = bb.front;
    const cx = (f.A.x + f.B.x) / 2, cy = (f.A.y + f.D.y) / 2, hgt = Math.abs(f.A.y - f.D.y);
    ctx.save();
    ctx.shadowColor = 'rgba(52,211,153,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = C.exit;
    ctx.font = `800 ${Math.max(6, hgt * 0.55)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LỐI RA', cx, cy + 0.5);
    ctx.restore();
  }
}

function drawStage(ctx, P, L) {
  const topFar0 = P.pt(XL, ZW, STAGE_H), topFar1 = P.pt(XR, ZW, STAGE_H);
  const topNear0 = P.pt(XL, 0, STAGE_H), topNear1 = P.pt(XR, 0, STAGE_H);
  poly(ctx, [topFar0, topFar1, topNear1, topNear0], vGrad(ctx, topFar0.y, topNear0.y, [[0, '#2a170d'], [1, '#5a3520']]));
  // ván sàn sân khấu chụm về điểm tụ
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  for (let x = XL + 1; x < XR; x += 1) {
    const a = P.pt(x, ZW, STAGE_H), b = P.pt(x, 0, STAGE_H);
    if (b.x < -10 || b.x > L.w + 10) continue;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  const f0 = P.pt(XL, 0, 0), f1 = P.pt(XR, 0, 0);
  poly(ctx, [topNear0, topNear1, f1, f0], vGrad(ctx, topNear0.y, f0.y, [[0, C.woodHi], [0.12, C.wood], [1, C.woodLo]]));
  ctx.strokeStyle = 'rgba(255,220,180,0.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(topNear0.x, topNear0.y); ctx.lineTo(topNear1.x, topNear1.y); ctx.stroke();
  for (let x = XL + 1; x < XR; x += 1.5) {
    const p = P.pt(x, 0, STAGE_H * 0.45);
    if (p.x < -20 || p.x > L.w + 20) continue;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 0.7);
    g.addColorStop(0, 'rgba(255,214,140,0.5)');
    g.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - p.s * 0.7, p.y - p.s * 0.7, p.s * 1.4, p.s * 1.4);
    fillRR(ctx, p.x - p.s * 0.14, p.y - p.s * 0.06, p.s * 0.28, p.s * 0.12, 2, '#ffe2a8');
  }
}

// ================================================================ (3) vật thể sắp theo độ sâu
/** một hàng ghế (khối 3D nhìn từ sau lưng) vào sprite px CSS; vẽ lại khi bố cục / phóng đổi */
export function renderRow(P, rowIndex, dpr) {
  const z = HALL.rows[rowIndex];
  const seats = SEATS.filter((s) => s.row === rowIndex);
  const pL = P.pt(XL, z + 0.32, 0), pR = P.pt(XR, z + 0.32, 0), pT = P.pt(0, z - 0.5, 0.95);
  const bx0 = Math.floor(Math.min(pL.x, P.pt(XL, z - 0.5).x)) - 6, bx1 = Math.ceil(Math.max(pR.x, P.pt(XR, z - 0.5).x)) + 6;
  const by0 = Math.floor(pT.y) - 6, by1 = Math.ceil(pL.y) + 4;
  const w = Math.max(1, bx1 - bx0), h = Math.max(1, by1 - by0);
  const cv = makeCanvas(w * dpr, h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, -bx0 * dpr, -by0 * dpr);
  ctx.lineJoin = 'round';
  // từ ngoài vào giữa: mặt bên quay vào giữa của ghế ngoài không bị ghế trong đè sai
  const order = [...seats].sort((a, b) => Math.abs(b.x - P.xcam) - Math.abs(a.x - P.xcam));
  for (const s of order) drawSeat(ctx, P, s.x, z);
  return { kind: 'row', key: z + 0.32, z, canvas: cv, x0: bx0, y0: by0, w, h, xcam: P.xcam, s: P.s(z + 0.2) };
}

function drawSeat(ctx, P, x, z) {
  const sh = P.pt(x, z, 0);
  ctx.save();
  ctx.translate(sh.x, sh.y);
  ctx.scale(1, P.k / sh.s);
  ctx.beginPath();
  ctx.ellipse(0, 0, sh.s * 0.5, sh.s * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();
  box(ctx, P, x - 0.37, x + 0.37, z - 0.46, z + 0.08, 0.36, { top: C.seatHi, front: C.seat, left: C.seatLo, right: C.seatLo });
  for (const ax of [x - 0.47, x + 0.47]) {
    box(ctx, P, ax - 0.05, ax + 0.05, z - 0.4, z + 0.3, 0.52, { top: '#3a2a32', front: C.arm, left: '#170e13', right: '#170e13' });
  }
  // lưng ghế (mặt sau quay về người xem): nhung đỏ, mép trên sáng, đường may, biển số
  const bb = box(ctx, P, x - 0.41, x + 0.41, z + 0.08, z + 0.3, 0.86, { top: C.seatHi, left: C.seatLo, right: C.seatLo });
  const f = bb.front;
  const fw = f.B.x - f.A.x, fh = f.A.y - f.D.y;
  ctx.save();
  rrPath(ctx, f.D.x, f.D.y, fw, fh, [fw * 0.22, fw * 0.22, fw * 0.06, fw * 0.06]);
  ctx.fillStyle = vGrad(ctx, f.D.y, f.A.y, [[0, '#c02640'], [0.4, C.seat], [1, '#62101e']]);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,150,165,0.16)';
  ctx.fillRect(f.D.x + fw * 0.12, f.D.y + fh * 0.08, fw * 0.12, fh * 0.75);
  ctx.strokeStyle = 'rgba(40,0,8,0.35)';
  ctx.lineWidth = Math.max(0.6, fw * 0.025);
  ctx.beginPath(); ctx.moveTo(f.D.x + fw * 0.5, f.D.y + fh * 0.15); ctx.lineTo(f.D.x + fw * 0.5, f.A.y - fh * 0.1); ctx.stroke();
  ctx.restore();
  fillRR(ctx, f.D.x + fw * 0.38, f.D.y + fh * 0.18, fw * 0.24, Math.max(1.5, fh * 0.07), 1, 'rgba(230,177,74,0.75)');
}

/** loa cột hai bên mép sân khấu (khối 3D) */
export function drawSpeaker(ctx, P, sp) {
  const bb = box(ctx, P, sp.x, sp.x + sp.w, sp.y, sp.y + sp.h, 2.3, { top: '#2e2933', front: '#141116', left: '#0d0b0f', right: '#0d0b0f', edge: 'rgba(255,255,255,0.08)' });
  const f = bb.front;
  const cx = (f.A.x + f.B.x) / 2, w = f.B.x - f.A.x, top = f.D.y, hh = f.A.y - f.D.y;
  for (const [ky, r] of [[0.16, 0.13], [0.42, 0.2], [0.74, 0.27]]) {
    const cy = top + hh * ky, rr = w * r;
    circle(ctx, cx, cy, rr + w * 0.03, '#2c2830');
    circle(ctx, cx, cy, rr, '#08070a');
    circle(ctx, cx, cy, rr * 0.4, '#24202a');
    circle(ctx, cx - rr * 0.25, cy - rr * 0.25, rr * 0.13, 'rgba(255,255,255,0.14)');
  }
  circle(ctx, f.B.x - w * 0.12, top + hh * 0.04, Math.max(1, w * 0.03), '#60a5fa');
  return bb;
}

/** quầy bar bắp nước sát tường phải (mặt quầy quay vào phòng) + máy bắp rang + biển neon */
export function drawCounter(ctx, P, c, now) {
  const x0 = c.x, x1 = c.x + c.w, z0 = c.y, z1 = c.y + c.h;
  const bb = box(ctx, P, x0, x1, z0, z1, 1.05, { top: '#d6c3a5', front: '#3a1f12', left: '#4a2816', right: '#2a160c', edge: 'rgba(255,240,210,0.6)' });
  const l0 = P.pt(x0, z0, 0.62), l1 = P.pt(x0, z1, 0.62);
  ctx.save();
  ctx.strokeStyle = '#f59e0b';
  ctx.shadowColor = 'rgba(245,158,11,0.9)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = Math.max(1, l1.s * 0.05);
  ctx.beginPath(); ctx.moveTo(l0.x, l0.y); ctx.lineTo(l1.x, l1.y); ctx.stroke();
  ctx.restore();
  const m = box(ctx, P, x0 + 0.12, x1 - 0.08, z0 + 0.5, z0 + 1.3, 1.95, { top: '#991b1b', front: 'rgba(255,240,200,0.28)', left: 'rgba(255,235,190,0.22)', right: '#7f1d1d' }, 1.05);
  const mf = m.front;
  for (let i = 0; i < 14; i++) {
    const px = mf.A.x + (mf.B.x - mf.A.x) * (0.1 + hash2(i, 3, 1) * 0.8);
    const py = mf.A.y - (mf.A.y - mf.D.y) * (0.06 + hash2(i, 5, 2) * 0.42);
    circle(ctx, px, py, Math.max(1, (mf.B.x - mf.A.x) * 0.06), '#fff3c4');
  }
  for (let k = 0; k < 3; k++) {
    const p = P.pt(x0 + 0.4, z0 + 1.8 + k * 0.28, 1.05);
    fillRR(ctx, p.x - p.s * 0.08, p.y - p.s * 0.28, p.s * 0.16, p.s * 0.28, 1, '#f8fafc');
    ctx.fillStyle = '#e11d48';
    ctx.fillRect(p.x - p.s * 0.08, p.y - p.s * 0.2, p.s * 0.16, p.s * 0.06);
  }
  const n = P.pt(x0 + 0.1, z0 + 1.6, 2.65);
  ctx.save();
  ctx.globalAlpha = 0.85 + 0.15 * Math.sin(now / 900);
  ctx.shadowColor = 'rgba(251,191,36,0.95)';
  ctx.shadowBlur = 12;
  fillRR(ctx, n.x - n.s * 0.95, n.y - n.s * 0.24, n.s * 1.9, n.s * 0.48, n.s * 0.08, '#2a1606');
  ctx.fillStyle = '#fbbf24';
  ctx.font = `800 ${Math.max(7, n.s * 0.3)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BẮP NƯỚC', n.x, n.y + 0.5);
  ctx.restore();
  return bb;
}

// ================================================================ (1) dải màn hình (px CSS, cố định)
/** tường cuối + màn nhung + diềm + khung màn hình (iframe nằm khít bên trong); sân khấu + tường bên vẽ đè ở lớp phòng */
export function renderScreenBand(L, dpr) {
  const bandH = Math.ceil(L.Yf + 2);
  const cv = makeCanvas(L.w * dpr, bandH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sc = L.screen;
  ctx.fillStyle = vGrad(ctx, 0, bandH, [[0, '#0a070e'], [0.7, '#150e1b'], [1, '#1d1323']]);
  ctx.fillRect(0, 0, L.w, bandH);
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  const cell = Math.max(26, sc.h / 7);
  for (let y = L.valance + 6; y < L.Yf - 4; y += cell) {
    for (let x = 6; x < L.w; x += cell * 1.6) {
      rrPath(ctx, x, y, cell * 1.6 - 8, cell - 8, 6);
      ctx.fill();
    }
  }
  const glow = ctx.createRadialGradient(sc.x + sc.w / 2, sc.y + sc.h / 2, sc.h * 0.3, sc.x + sc.w / 2, sc.y + sc.h / 2, Math.max(sc.w, sc.h) * 0.85);
  glow.addColorStop(0, 'rgba(140,170,255,0.16)');
  glow.addColorStop(1, 'rgba(140,170,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, L.w, bandH);
  const gap = Math.max(6, Math.min(26, sc.x * 0.18));
  const bottom = L.Yf - 2;
  drawCurtain(ctx, 0, L.valance - 2, Math.max(0, sc.x - gap), bottom - L.valance + 2, 'left');
  drawCurtain(ctx, sc.x + sc.w + gap, L.valance - 2, Math.max(0, L.w - (sc.x + sc.w + gap)), bottom - L.valance + 2, 'right');
  const fb = L.frame;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  fillRR(ctx, sc.x - fb, sc.y - fb, sc.w + fb * 2, sc.h + fb * 2, 4, '#050406');
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  rrPath(ctx, sc.x - fb + 0.5, sc.y - fb + 0.5, sc.w + fb * 2 - 1, sc.h + fb * 2 - 1, 4);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
  drawValance(ctx, L.w, L.valance);
  return { canvas: cv, h: bandH };
}

function drawCurtain(ctx, x, y, w, h, side) {
  if (w < 2 || h < 2) return;
  ctx.save();
  ctx.beginPath();
  if (side === 'left') {
    ctx.moveTo(x, y); ctx.lineTo(x + w, y);
    ctx.quadraticCurveTo(x + w * 0.62, y + h * 0.55, x + w * 0.9, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w * 0.1, y + h);
    ctx.quadraticCurveTo(x + w * 0.38, y + h * 0.55, x, y);
  }
  ctx.closePath();
  ctx.fillStyle = C.curtain;
  ctx.fill();
  ctx.clip();
  const fold = Math.max(10, Math.min(26, w / 4));
  for (let fx = x - fold; fx < x + w + fold; fx += fold) {
    const g = ctx.createLinearGradient(fx, 0, fx + fold, 0);
    g.addColorStop(0, 'rgba(40,0,8,0.55)');
    g.addColorStop(0.35, 'rgba(255,90,110,0.20)');
    g.addColorStop(0.6, 'rgba(255,120,130,0.10)');
    g.addColorStop(1, 'rgba(40,0,8,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(fx, y, fold, h);
  }
  ctx.fillStyle = vGrad(ctx, y, y + h, [[0, 'rgba(0,0,0,0.35)'], [0.25, 'rgba(0,0,0,0)'], [0.85, 'rgba(0,0,0,0.1)'], [1, 'rgba(0,0,0,0.45)']]);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  if (w > 18) {
    const ty = y + h * 0.58;
    const tx = side === 'left' ? x + w * 0.72 : x + w * 0.28;
    ctx.save();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = Math.max(2, w * 0.05);
    ctx.beginPath();
    if (side === 'left') { ctx.moveTo(x, ty - 6); ctx.quadraticCurveTo(tx - w * 0.2, ty + 8, tx, ty); }
    else { ctx.moveTo(x + w, ty - 6); ctx.quadraticCurveTo(tx + w * 0.2, ty + 8, tx, ty); }
    ctx.stroke();
    circle(ctx, tx, ty + 3, Math.max(2.5, w * 0.045), C.goldLo);
    ctx.restore();
  }
}

function drawValance(ctx, w, vh) {
  if (vh < 4) return;
  ctx.save();
  ctx.fillStyle = vGrad(ctx, 0, vh, [[0, C.curtainLo], [0.6, C.curtain], [1, '#6d0f1e']]);
  ctx.fillRect(0, 0, w, vh * 0.72);
  const n = Math.max(4, Math.round(w / 120));
  const sw = w / n;
  ctx.beginPath();
  ctx.moveTo(0, vh * 0.6);
  for (let i = 0; i < n; i++) ctx.quadraticCurveTo(i * sw + sw / 2, vh * 1.25, (i + 1) * sw, vh * 0.6);
  ctx.lineTo(w, 0); ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = vGrad(ctx, 0, vh, [[0, '#5a0a16'], [1, C.curtain]]);
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = Math.max(1.5, vh * 0.09);
  ctx.beginPath();
  ctx.moveTo(0, vh * 0.6);
  for (let i = 0; i < n; i++) ctx.quadraticCurveTo(i * sw + sw / 2, vh * 1.25, (i + 1) * sw, vh * 0.6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,220,150,0.35)';
  ctx.fillRect(0, 0, w, Math.max(1, vh * 0.06));
  ctx.restore();
}

// ================================================================ (4) hiệu ứng mỗi khung
/** sàn nhảy: ô gạch quanh chân người đang nhảy đổi màu theo nhịp + đốm đèn quét (tròn trên sàn → elip phối cảnh) */
export function drawDanceLights(ctx, P, dancers, now) {
  if (!dancers.length) return;
  const d = HALL.danceFloor;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const a of dancers) {
    const tx = Math.floor(a.x), tz = Math.floor(a.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = tx + dx, cz = tz + dz;
        if (cx < d.x || cz < d.y || cx + 1 > d.x + d.w || cz + 1 > d.y + d.h + 0.01) continue;
        const beat = (Math.floor(now / 280) + cx * 3 + cz * 5) % 4;
        const hue = [320, 265, 190, 45][(beat + 4) % 4];
        const dist = Math.hypot(cx + 0.5 - a.x, cz + 0.5 - a.y);
        const k = Math.max(0, 1 - dist / 1.9) * (0.55 + 0.45 * Math.sin(now / 140 + cx + cz));
        if (k <= 0.02) continue;
        poly(ctx, [P.pt(cx + 0.05, cz + 0.05), P.pt(cx + 0.95, cz + 0.05), P.pt(cx + 0.95, cz + 0.95), P.pt(cx + 0.05, cz + 0.95)], `hsla(${hue},90%,60%,${0.24 * k})`);
      }
    }
  }
  const n = Math.min(3, dancers.length);
  for (let i = 0; i < n; i++) {
    const t = now / (2600 + i * 700) + i * 2.1;
    const p = P.pt(d.x + d.w * (0.5 + 0.42 * Math.sin(t)), d.y + d.h * (0.5 + 0.35 * Math.cos(t * 1.3)));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, P.k / p.s);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.s * 1.4);
    const hue = [300, 190, 45][i];
    g.addColorStop(0, `hsla(${hue},95%,65%,0.28)`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-p.s * 1.4, -p.s * 1.4, p.s * 2.8, p.s * 2.8);
    ctx.restore();
  }
  ctx.restore();
}

/** chùm sáng máy chiếu từ phía sau người xem lên màn hình + bụi bay (px CSS) */
export function drawBeam(ctx, L, now, motes) {
  const sc = L.screen;
  const ox = L.Xc ?? L.w / 2, oy = L.h + 40;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, oy, 0, sc.y + sc.h);
  g.addColorStop(0, 'rgba(190,210,255,0.10)');
  g.addColorStop(1, 'rgba(190,210,255,0.035)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(ox - 8, oy);
  ctx.lineTo(sc.x + 4, sc.y + sc.h);
  ctx.lineTo(sc.x + sc.w - 4, sc.y + sc.h);
  ctx.lineTo(ox + 8, oy);
  ctx.closePath();
  ctx.fill();
  if (motes) {
    for (let i = 0; i < 28; i++) {
      const r = hash2(i, 11, 3);
      const k = ((now / (9000 + r * 7000)) + hash2(i, 7, 5)) % 1;
      const y = oy + (sc.y + sc.h - oy) * k;
      const half = 8 + (sc.w / 2 - 8) * k;
      const x = ox + (hash2(i, 13, 9) * 2 - 1) * half * 0.92 + Math.sin(now / 1500 + i) * 3;
      ctx.fillStyle = `rgba(230,236,255,${0.12 + 0.18 * Math.sin(k * Math.PI)})`;
      const sz = 1.2 + (1 - k) * 1.4;
      ctx.fillRect(x, y, sz, sz);
    }
  }
  ctx.restore();
}

/** ánh màn hình hắt xuống mấy hàng đầu + tối dần ở mép gần người xem */
export function drawHallLight(ctx, P, L, playing) {
  if (playing) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = (P.Yn - P.Yf) * 0.8;
    ctx.translate(L.Xc ?? L.w / 2, P.Yf - P.k * 0.5);
    ctx.scale(2.0, 1);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, r);
    g.addColorStop(0, 'rgba(150,175,255,0.15)');
    g.addColorStop(1, 'rgba(150,175,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, 0, r * 2, r);
    ctx.restore();
  }
  ctx.save();
  const v = ctx.createLinearGradient(0, P.Yn - (P.Yn - P.Yf) * 0.35, 0, L.h);
  v.addColorStop(0, 'rgba(5,2,8,0)');
  v.addColorStop(1, 'rgba(5,2,8,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, P.Yf, L.w, L.h - P.Yf + 2);
  ctx.restore();
}

/** chữ "Đang chiếu…" / "chưa có video" vẽ thẳng lên màn hình khi không có trình phát (px CSS) */
export function drawIdleScreen(ctx, sc, title, sub, now) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(sc.x, sc.y, sc.w, sc.h);
  ctx.clip();
  const g = ctx.createLinearGradient(sc.x, sc.y, sc.x + sc.w, sc.y + sc.h);
  g.addColorStop(0, '#0b0a14');
  g.addColorStop(1, '#151027');
  ctx.fillStyle = g;
  ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
  const k = (now / 6000) % 1;
  const sx = sc.x - sc.w * 0.3 + k * sc.w * 1.6;
  const lg = ctx.createLinearGradient(sx - 80, 0, sx + 80, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(0.5, 'rgba(255,255,255,0.035)');
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
  const cx = sc.x + sc.w / 2, cy = sc.y + sc.h / 2;
  const size = Math.max(14, Math.min(26, sc.w / 26));
  drawEmoji(ctx, '🎬', cx, cy - size * 1.6, size * 1.8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4effa';
  ctx.font = `700 ${size}px ${FONT}`;
  fitLine(ctx, title, cx, cy, sc.w - 40);
  if (sub) {
    ctx.fillStyle = 'rgba(244,239,250,0.66)';
    ctx.font = `500 ${Math.max(11, size * 0.6)}px ${FONT}`;
    fitLine(ctx, sub, cx, cy + size * 1.25, sc.w - 40);
  }
  ctx.restore();
}

function fitLine(ctx, text, x, y, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 3 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    t = `${t}…`;
  }
  ctx.fillText(t, x, y);
}
