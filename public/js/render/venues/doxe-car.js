// Rạp Đỗ Xe (3) — hàng ghế = hàng xe mui trần thập niên 50 (mỗi cặp ghế một xe), nhìn từ phía sau trên cao.
// Mỗi hàng hai sprite (render/venues/index.js): lớp SAU (key z − 0.3, vẽ trước người ngồi) = hông xe, capô + chắn bùn
// trước, kính chắn gió viền crôm, khoang lái (táp-lô, đệm ghế, vô-lăng); lớp TRƯỚC (key z + 0.32, vẽ sau người ngồi) =
// lưng ghế băng, cuộn mui vải gấp, nắp cốp, vây đuôi (đèn hậu đỏ phát sáng trên vây), mặt đuôi (đèn tròn, biển số, cản
// crôm) → người ngồi lộ đầu + vai. Camera máy tính nhìn rất xiên nên hàng sau bị capô hàng trước che phần dưới: đèn hậu
// đặt cao trên vây để hàng nào cũng thấy. Toạ độ tương đối hàng z (chân người ngồi): mũi z−0.92 → đuôi z+0.56.
import { HALL } from '../../shared/hall.js';
import { hash2 } from '../../util.js';
import { makeCanvas, mix, shade } from '../draw.js';
import { CARS } from './doxe-floor.js';

const W = HALL.W;
const HW = 0.9; // nửa bề ngang thân (khe 0.2 giữa hai xe)
const ZF = -0.92, ZR = 0.56; // mũi / đuôi
const HC = 0.08; // gầm
const HP = 0.42; // mặt thân (mép cửa)
const HH = 0.38; // capô
const ZWS = -0.36, WT = 0.76; // kính chắn gió: mặt phẳng + đỉnh
const CW = 0.74; // nửa bề ngang khoang lái
const ZC0 = ZWS + 0.05, ZC1 = 0.2; // khoang lái: trước / sau
const ZSB = 0.05, ZSB2 = 0.15, HSB = 0.6; // lưng ghế băng
const ZRL = 0.3, RT = 0.54; // cuộn mui gấp
const FIN = 0.72, FW = 0.15; // vây đuôi: đỉnh + bề ngang
const INK = 'rgba(12,10,24,0.6)'; // nét viền kiểu hoạt hình (giống nhân vật)

// sơn pastel (đã ngả màu đêm): bạc hà, hồng, kem, đỏ, xanh baby, vàng, oải hương, ngọc, san hô
const PAINTS = ['#7fd3b6', '#f09cc0', '#e6d8ae', '#d6474b', '#8dbbe6', '#ebc95c', '#b6a1e6', '#4fc2bf', '#ec8a70'];
const UPHOLSTERY = ['#c03645', '#ece3cf', '#c03645', '#3a3440'];
const ROOFS = ['#ece7da', '#2a2a31', '#ece7da', '#d8c69c'];
const CHROME = '#d5dbe6';
let GLOW = null; // quầng đỏ đèn hậu vẽ sẵn (rẻ hơn hàng trăm radial gradient mỗi lần vẽ lại hàng xe)
function tailGlow() {
  if (GLOW) return GLOW;
  const n = 64;
  GLOW = makeCanvas(n, n);
  const c = GLOW.getContext('2d');
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,70,85,1)');
  g.addColorStop(0.35, 'rgba(255,60,80,0.45)');
  g.addColorStop(1, 'rgba(255,60,80,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  return GLOW;
}

const palCache = new Map();
function palette(c) {
  const key = `${c.row}:${c.cx}`;
  let p = palCache.get(key);
  if (p) return p;
  const paint = PAINTS[(c.row * 3 + c.col * 5) % PAINTS.length];
  const warm = paint === '#d6474b' || paint === '#ec8a70' || paint === '#f09cc0';
  const seat = warm ? '#ece3cf' : UPHOLSTERY[Math.floor(hash2(c.row, c.col, 61) * UPHOLSTERY.length)];
  p = {
    paint,
    top: mix(paint, '#eef2ff', 0.12), hood: mix(paint, '#eef2ff', 0.2),
    rear0: shade(paint, -0.08), rear1: shade(paint, -0.5),
    side: shade(paint, -0.4), sideHi: shade(paint, -0.22), dash: shade(paint, -0.45),
    seat, seatHi: shade(seat, 0.12), seatLo: shade(seat, -0.4),
    roof: ROOFS[(c.row + c.col * 2) % ROOFS.length],
  };
  p.roofTop = shade(p.roof, 0.08);
  p.roofMid = shade(p.roof, -0.12);
  p.roofLo = shade(p.roof, -0.4);
  palCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------- tiện ích phối cảnh
function path(ctx, P, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = P.pt(pts[i][0], pts[i][1], pts[i][2]);
    if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
  }
  ctx.closePath();
}
function fillPath(ctx, P, pts, fill, ink) {
  path(ctx, P, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ink) { ctx.strokeStyle = INK; ctx.lineWidth = ink; ctx.stroke(); }
}
function seg(ctx, P, a, b, stroke, lw) {
  const p = P.pt(a[0], a[1], a[2]), q = P.pt(b[0], b[1], b[2]);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
}
/** vẽ trên mặt phẳng đứng z = const (song song màn hình → không méo): toạ độ (u = x − cx, h), đơn vị ô */
function onPlane(ctx, P, cx, zAbs, fn) {
  const S = P.s(zAbs);
  ctx.save();
  ctx.transform(S, 0, 0, -S, P.Xc + (cx - P.xcam) * S, P.sy(zAbs));
  fn(S);
  ctx.restore();
}
/** elip trên mặt hông x = const (bánh xe, hốc bánh) */
function sideEllipse(ctx, P, x, zc, hc, rz, rh, a0 = 0, a1 = Math.PI * 2, n = 14) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    const p = P.pt(x, zc + rz * Math.cos(t), hc + rh * Math.sin(t));
    if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
  }
  ctx.closePath();
}
function wheelSide(ctx, P, x, zc) {
  sideEllipse(ctx, P, x, zc, HC, 0.21, 0.17, 0, Math.PI, 8);
  ctx.fillStyle = '#0a0b0f';
  ctx.fill();
  sideEllipse(ctx, P, x, zc, 0.15, 0.15, 0.15);
  ctx.fillStyle = '#16171c';
  ctx.fill();
  sideEllipse(ctx, P, x, zc, 0.15, 0.105, 0.105);
  ctx.fillStyle = '#e2ddd0';
  ctx.fill();
  sideEllipse(ctx, P, x, zc, 0.15, 0.065, 0.065);
  ctx.fillStyle = '#939cae';
  ctx.fill();
}
/** mặt hông bên ngoài đang quay về camera: +1 (hông phải), −1 (hông trái), 0 (xe gần như ngay trước camera) */
function visibleSide(P, cx) {
  if (cx + HW < P.xcam - 0.5) return 1;
  if (cx - HW > P.xcam + 0.5) return -1;
  return 0;
}
const SIDE_PROFILE = [
  [ZF + 0.08, HC + 0.04], [ZR - 0.05, HC], [ZR, HC + 0.05], [ZR, FIN - 0.05], [ZR - 0.04, FIN],
  [ZC1 - 0.12, HP + 0.01], [ZWS, HP], [ZF + 0.3, HH + 0.02], [ZF + 0.12, HH], [ZF, HH - 0.08], [ZF - 0.02, HC + 0.14],
];

// ---------------------------------------------------------------- lớp sau (trước người ngồi)
function carBack(ctx, P, c) {
  const { cx, z } = c, p = palette(c);
  const side = visibleSide(P, cx);
  const xl = cx - HW, xr = cx + HW, s = P.s(z);
  const ink = Math.max(0.8, s * 0.022);
  // hông ngoài cả thân (lớp trước vẽ lại phần đuôi)
  if (side) {
    const x = side > 0 ? xr : xl;
    fillPath(ctx, P, SIDE_PROFILE.map(([dz, h]) => [x, z + dz, h]), p.side);
    seg(ctx, P, [x, z + ZF + 0.1, 0.3], [x, z + ZR - 0.06, 0.33], CHROME, Math.max(0.8, s * 0.02));
    wheelSide(ctx, P, x, z + ZF + 0.28);
  }
  // mặt thân phía trước: capô + chắn bùn bo tròn liền một khối sơn
  fillPath(ctx, P, [
    [xl, z + ZC1, HP], [xl, z + ZWS, HP], [xl, z + ZF + 0.3, HH + 0.02],
    [xl + 0.04, z + ZF + 0.14, HH], [xl + 0.16, z + ZF + 0.04, HH - 0.03], [xl + 0.36, z + ZF, HH - 0.05],
    [xr - 0.36, z + ZF, HH - 0.05], [xr - 0.16, z + ZF + 0.04, HH - 0.03], [xr - 0.04, z + ZF + 0.14, HH],
    [xr, z + ZF + 0.3, HH + 0.02], [xr, z + ZWS, HP], [xr, z + ZC1, HP],
  ], p.top, ink);
  fillPath(ctx, P, [
    [xl + 0.14, z + ZWS - 0.03, HH + 0.01], [xl + 0.14, z + ZF + 0.16, HH], [xl + 0.3, z + ZF + 0.06, HH - 0.03],
    [xr - 0.3, z + ZF + 0.06, HH - 0.03], [xr - 0.14, z + ZF + 0.16, HH], [xr - 0.14, z + ZWS - 0.03, HH + 0.01],
  ], p.hood);
  seg(ctx, P, [cx, z + ZF + 0.04, HH - 0.04], [cx, z + ZWS, HH + 0.02], 'rgba(255,255,255,0.3)', Math.max(0.6, s * 0.016));
  for (const sx of [-1, 1]) {
    const q = P.pt(cx + sx * (HW - 0.2), z + ZF + 0.09, HH);
    ctx.fillStyle = CHROME;
    ctx.beginPath(); ctx.ellipse(q.x, q.y, q.s * 0.13, Math.max(1, q.s * 0.055), 0, 0, Math.PI * 2); ctx.fill();
  }
  // kính chắn gió hơi ôm (hình thang bo đỉnh), kính trong + vệt sáng + khung crôm
  onPlane(ctx, P, cx, z + ZWS, (S) => {
    const ub = 0.8, ut = 0.7, r = 0.12, b = HP - 0.01;
    const ws = () => {
      ctx.beginPath();
      ctx.moveTo(-ub, b); ctx.lineTo(-ut, WT - r); ctx.quadraticCurveTo(-ut + 0.01, WT, -ut + r, WT);
      ctx.lineTo(ut - r, WT); ctx.quadraticCurveTo(ut - 0.01, WT, ut, WT - r); ctx.lineTo(ub, b);
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.moveTo(-0.5, b); ctx.lineTo(-0.3, b); ctx.lineTo(0.0, WT - 0.01); ctx.lineTo(-0.2, WT - 0.01); ctx.closePath(); ctx.fill();
    ws();
    ctx.fillStyle = 'rgba(160,195,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,209,225,0.78)';
    ctx.lineWidth = Math.max(1 / S, 0.028);
    ctx.stroke();
  });
  // khoang lái: lòng xe tối, táp-lô sơn sẫm viền crôm, đệm ghế, vô-lăng
  fillPath(ctx, P, [
    [cx - CW, z + ZC0 + 0.06, HP], [cx - CW + 0.08, z + ZC0, HP], [cx + CW - 0.08, z + ZC0, HP],
    [cx + CW, z + ZC0 + 0.06, HP], [cx + CW, z + ZC1, HP], [cx - CW, z + ZC1, HP],
  ], '#141118');
  onPlane(ctx, P, cx, z + ZC0, (S) => {
    ctx.fillStyle = p.dash;
    ctx.fillRect(-CW + 0.06, 0.26, 2 * (CW - 0.06), HP - 0.26);
    ctx.fillStyle = CHROME;
    ctx.fillRect(-CW + 0.06, HP - 0.03, 2 * (CW - 0.06), Math.max(0.9 / S, 0.022));
  });
  fillPath(ctx, P, [[cx - CW + 0.04, z - 0.16, 0.3], [cx + CW - 0.04, z - 0.16, 0.3], [cx + CW - 0.04, z + ZSB, 0.3], [cx - CW + 0.04, z + ZSB, 0.3]], p.seat);
  const wq = P.pt(cx - 0.5, z - 0.2, 0.55);
  ctx.strokeStyle = 'rgba(22,20,28,0.55)';
  ctx.lineWidth = Math.max(0.8, wq.s * 0.025);
  ctx.beginPath(); ctx.ellipse(wq.x, wq.y, wq.s * 0.13, Math.max(1, wq.s * 0.055), 0, 0, Math.PI * 2); ctx.stroke();
}

// ---------------------------------------------------------------- lớp trước (sau người ngồi)
function rearPanel(ctx, p, S) {
  const px = (n) => Math.max(n / S, 0.012);
  ctx.beginPath();
  ctx.moveTo(-HW + 0.08, HC);
  ctx.quadraticCurveTo(-HW, HC, -HW, HC + 0.08);
  ctx.lineTo(-HW, FIN - 0.05); ctx.lineTo(-HW + 0.04, FIN); ctx.lineTo(-HW + FW, FIN - 0.04); ctx.lineTo(-HW + FW + 0.03, HP + 0.02);
  ctx.lineTo(HW - FW - 0.03, HP + 0.02); ctx.lineTo(HW - FW, FIN - 0.04); ctx.lineTo(HW - 0.04, FIN); ctx.lineTo(HW, FIN - 0.05);
  ctx.lineTo(HW, HC + 0.08);
  ctx.quadraticCurveTo(HW, HC, HW - 0.08, HC);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, FIN, 0, HC);
  g.addColorStop(0, p.rear0);
  g.addColorStop(1, p.rear1);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = px(1);
  ctx.stroke();
  // viền crôm mép cốp + logo chữ V
  ctx.fillStyle = CHROME;
  ctx.fillRect(-HW + FW + 0.03, HP - 0.025, 2 * (HW - FW - 0.03), px(0.9));
  ctx.strokeStyle = CHROME;
  ctx.lineWidth = px(0.8);
  ctx.beginPath(); ctx.moveTo(-0.055, HP - 0.05); ctx.lineTo(0, HP - 0.1); ctx.lineTo(0.055, HP - 0.05); ctx.stroke();
  // đèn hậu: viên đạn trên vây + đèn tròn viền crôm
  for (const sx of [-1, 1]) {
    const fx = sx * (HW - FW / 2), fy = FIN - 0.14;
    ctx.fillStyle = '#7a1020';
    ctx.beginPath(); ctx.ellipse(fx, fy, 0.06, 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3a4c';
    ctx.beginPath(); ctx.ellipse(fx, fy, 0.045, 0.072, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,225,225,0.85)';
    ctx.beginPath(); ctx.ellipse(fx - 0.012, fy + 0.025, 0.014, 0.022, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CHROME;
    ctx.beginPath(); ctx.arc(sx * 0.56, 0.29, 0.085, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3346';
    ctx.beginPath(); ctx.arc(sx * 0.56, 0.29, 0.064, 0, Math.PI * 2); ctx.fill();
  }
  // biển số vàng
  ctx.fillStyle = '#e9cd66';
  ctx.fillRect(-0.15, 0.17, 0.3, 0.11);
  ctx.fillStyle = 'rgba(40,30,10,0.75)';
  ctx.fillRect(-0.11, 0.205, 0.09, 0.04);
  ctx.fillRect(0.02, 0.205, 0.09, 0.04);
  // cản crôm + vấu cản
  ctx.fillStyle = '#aeb6c5';
  const bx = HW + 0.03, br = 0.045, b0 = 0.05, b1 = 0.165;
  ctx.beginPath();
  ctx.moveTo(-bx + br, b0); ctx.lineTo(bx - br, b0); ctx.quadraticCurveTo(bx, b0, bx, b0 + br);
  ctx.lineTo(bx, b1 - br); ctx.quadraticCurveTo(bx, b1, bx - br, b1); ctx.lineTo(-bx + br, b1);
  ctx.quadraticCurveTo(-bx, b1, -bx, b1 - br); ctx.lineTo(-bx, b0 + br); ctx.quadraticCurveTo(-bx, b0, -bx + br, b0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = px(0.8);
  ctx.stroke();
  ctx.fillStyle = '#f2f5fa';
  ctx.fillRect(-bx + br, b1 - 0.035, 2 * (bx - br), 0.025);
  ctx.fillStyle = CHROME;
  for (const sx of [-1, 1]) ctx.fillRect(sx * 0.32 - 0.025, b0, 0.05, 0.16);
  // đèn hậu toả sáng
  ctx.globalCompositeOperation = 'lighter';
  const gl = tailGlow();
  for (const sx of [-1, 1]) {
    for (const [lx, ly, rad, a] of [[sx * (HW - FW / 2), FIN - 0.14, 0.24, 0.55], [sx * 0.56, 0.29, 0.22, 0.4]]) {
      ctx.globalAlpha = a;
      ctx.drawImage(gl, lx - rad, ly - rad, rad * 2, rad * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function carFront(ctx, P, c) {
  const { cx, z } = c, p = palette(c);
  const side = visibleSide(P, cx);
  const xl = cx - HW, xr = cx + HW, s = P.s(z);
  // lốp sau thò dưới gầm
  onPlane(ctx, P, cx, z + ZR - 0.1, () => {
    ctx.fillStyle = '#0c0d11';
    for (const sx of [-1, 1]) ctx.fillRect(sx * 0.7 - 0.11, 0, 0.22, HC + 0.06);
  });
  // hông sau phía đang thấy (vây dựng lên tới đuôi)
  if (side) {
    const x = side > 0 ? xr : xl;
    fillPath(ctx, P, [[x, z + ZC1 - 0.12, HC], [x, z + ZR - 0.05, HC], [x, z + ZR, HC + 0.05], [x, z + ZR, FIN - 0.05], [x, z + ZR - 0.04, FIN], [x, z + ZC1 - 0.12, HP + 0.01]], p.side);
    seg(ctx, P, [x, z + ZC1 - 0.12, 0.315], [x, z + ZR - 0.06, 0.33], CHROME, Math.max(0.8, s * 0.02));
    wheelSide(ctx, P, x, z + ZR - 0.28);
  }
  // mặt thân phía sau: hai dải hông cạnh ghế + sàn cốp
  fillPath(ctx, P, [
    [xl, z + ZSB, HP], [cx - CW, z + ZSB, HP], [cx - CW, z + ZRL, HP], [cx + CW, z + ZRL, HP], [cx + CW, z + ZSB, HP],
    [xr, z + ZSB, HP], [xr, z + ZR - 0.02, HP + 0.02], [xl, z + ZR - 0.02, HP + 0.02],
  ], p.top);
  // lưng ghế băng bọc da (nếp dọc)
  fillPath(ctx, P, [[cx - CW + 0.02, z + ZSB, HSB], [cx + CW - 0.02, z + ZSB, HSB], [cx + CW - 0.02, z + ZSB2, HSB], [cx - CW + 0.02, z + ZSB2, HSB]], p.seatHi);
  onPlane(ctx, P, cx, z + ZSB2, (S) => {
    const u = CW - 0.02, r = 0.08, b = HP - 0.02;
    ctx.beginPath();
    ctx.moveTo(-u, b); ctx.lineTo(-u, HSB - r); ctx.quadraticCurveTo(-u, HSB, -u + r, HSB);
    ctx.lineTo(u - r, HSB); ctx.quadraticCurveTo(u, HSB, u, HSB - r); ctx.lineTo(u, b);
    ctx.closePath();
    ctx.fillStyle = p.seat;
    ctx.fill();
    ctx.fillStyle = p.seatHi;
    ctx.fillRect(-u + r * 0.5, HSB - 0.05, 2 * u - r, 0.035);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = Math.max(0.7 / S, 0.014);
    ctx.beginPath();
    for (let x = -u + 0.15; x < u - 0.05; x += 0.15) { ctx.moveTo(x, b); ctx.lineTo(x, HSB - 0.03); }
    ctx.stroke();
  });
  // cuộn mui vải gấp
  fillPath(ctx, P, [[cx - CW, z + ZSB2 + 0.02, RT], [cx + CW, z + ZSB2 + 0.02, RT], [cx + CW, z + ZRL, RT], [cx - CW, z + ZRL, RT]], p.roofTop);
  onPlane(ctx, P, cx, z + ZRL, (S) => {
    const u = CW, rr = 0.06, b = HP - 0.02;
    ctx.beginPath();
    ctx.moveTo(-u, b); ctx.lineTo(-u, RT - rr); ctx.quadraticCurveTo(-u, RT, -u + rr * 1.6, RT);
    ctx.lineTo(u - rr * 1.6, RT); ctx.quadraticCurveTo(u, RT, u, RT - rr); ctx.lineTo(u, b);
    ctx.closePath();
    ctx.fillStyle = p.roofMid;
    ctx.fill();
    ctx.fillStyle = p.roofLo;
    ctx.fillRect(-u, b, 2 * u, (RT - b) * 0.4);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8 / S, 0.014);
    ctx.stroke();
  });
  // vây đuôi: mặt trong (phía camera thấy) + sống vây sáng viền crôm
  for (const sx of [-1, 1]) {
    const xi = cx + sx * (HW - FW), xo = cx + sx * HW;
    if ((sx < 0 && P.xcam > xi) || (sx > 0 && P.xcam < xi)) fillPath(ctx, P, [[xi, z + ZSB, HP], [xi, z + ZR - 0.04, FIN - 0.02], [xi, z + ZR, HP]], p.sideHi);
    fillPath(ctx, P, [[xo, z + ZSB - 0.05, HP + 0.01], [xi, z + ZSB - 0.05, HP + 0.01], [xi, z + ZR - 0.04, FIN], [xo, z + ZR - 0.04, FIN]], p.top);
    seg(ctx, P, [xo, z + ZSB - 0.05, HP + 0.01], [xo, z + ZR - 0.04, FIN], 'rgba(235,240,250,0.55)', Math.max(0.6, s * 0.014));
  }
  seg(ctx, P, [cx - CW + 0.06, z + ZRL + 0.05, HP + 0.005], [cx + CW - 0.06, z + ZRL + 0.05, HP + 0.005], 'rgba(0,0,0,0.25)', Math.max(0.6, s * 0.014));
  onPlane(ctx, P, cx, z + ZR, (S) => rearPanel(ctx, p, S));
}

// ---------------------------------------------------------------- sprite hàng xe
function sprite(P, dpr, z, key, pts3, draw) {
  const pts = [];
  for (const x of [1.95, W - 1.95]) for (const [dz, h] of pts3) pts.push(P.pt(x, z + dz, h));
  const bx0 = Math.floor(Math.min(...pts.map((q) => q.x))) - 4, bx1 = Math.ceil(Math.max(...pts.map((q) => q.x))) + 4;
  const by0 = Math.floor(Math.min(...pts.map((q) => q.y))) - 3, by1 = Math.ceil(Math.max(...pts.map((q) => q.y))) + 3;
  const w = Math.max(1, bx1 - bx0), h = Math.max(1, by1 - by0);
  const cv = makeCanvas(w * dpr, h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, -bx0 * dpr, -by0 * dpr);
  ctx.lineJoin = 'round';
  draw(ctx);
  return { kind: 'row', key, z, canvas: cv, x0: bx0, y0: by0, w, h, xcam: P.xcam, s: P.s(z + 0.2) };
}
// điểm bao (dz, h) của từng lớp: sprite vừa khít → mỗi khung dán ít điểm ảnh hơn
const BACK_PTS = [[ZF - 0.02, 0], [ZF - 0.02, HH + 0.04], [ZWS, WT + 0.04], [ZC1 + 0.02, 0], [ZC1 + 0.02, HP]];
const FRONT_PTS = [[ZSB - 0.06, HSB + 0.02], [ZR, FIN + 0.12], [ZR + 0.04, 0], [ZSB - 0.06, 0]];

/** hàng i → [lớp sau (vẽ trước người ngồi), lớp trước (vẽ sau người ngồi)] */
export function renderRow(P, rowIndex, dpr) {
  const z = HALL.rows[rowIndex];
  const cars = CARS.filter((c) => c.row === rowIndex).sort((a, b) => a.cx - b.cx).map((c, col) => ({ ...c, col }));
  // từ ngoài vào giữa: hông xe ngoài không bị xe trong đè sai
  cars.sort((a, b) => Math.abs(b.cx - P.xcam) - Math.abs(a.cx - P.xcam));
  const back = sprite(P, dpr, z, z - 0.3, BACK_PTS, (ctx) => {
    for (const c of cars) carBack(ctx, P, c);
  });
  const front = sprite(P, dpr, z, z + 0.32, FRONT_PTS, (ctx) => {
    for (const c of cars) carFront(ctx, P, c);
  });
  return [back, front];
}
