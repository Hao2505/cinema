// Rạp Công Viên — rạp chiếu phim ngoài trời ban đêm trong công viên.
// Dải trên (congvien-band.js): trời sao, trăng, ánh phố, hàng cây xa, màn hình bơm hơi + cột + dây néo.
// Sàn + lớp phòng (congvien-floor.js): cỏ đêm, lối sỏi, thảm picnic caro, sàn gỗ có đèn dây, bục gỗ, cây, cột đèn, hàng rào.
// File này: hàng gối lười (2 lớp: thân sau người ngồi + lưng tựa trước mặt người ngồi), loa ba chân, xe bắp rang có mái sọc,
// ánh đèn sàn nhảy, ánh màn hình, đom đóm. Không dùng ảnh — vẽ hết bằng code.
import { HALL, SEATS } from '../../shared/hall.js';
import { hash2, clamp } from '../../util.js';
import { FONT, makeCanvas, vGrad, rrPath, shade } from '../draw.js';
import { box, poly } from '../persp.js';
import { drawBeam } from '../hall.js';
import { C, W, glow, blitGlow } from './congvien-art.js';
import { floorTexture, drawRoom } from './congvien-floor.js';
import { renderBand, skyFx } from './congvien-band.js';

// ================================================================ hàng gối lười
const BEAN = ['#ef8fa3', '#86d1bd', '#b7a1ea', '#f4c07c', '#8fc3ee', '#efdc87', '#e7a0d3', '#9fd88e', '#f3a580', '#a8b8f5'];
const beanPal = new Map();
function palOf(i) {
  let p = beanPal.get(i);
  if (!p) {
    const c = BEAN[i];
    p = { top: shade(c, -0.08), base: shade(c, -0.26), dark: shade(c, -0.56), hi: shade(c, 0.2) };
    beanPal.set(i, p);
  }
  return p;
}

/** màu gối của từng ghế (cố định, hai ghế cạnh nhau không trùng màu) */
const SEAT_COLOR = (() => {
  const out = new Map();
  let prev = -1;
  for (const s of SEATS) {
    let i = Math.floor(hash2(s.col, s.row, 23) * BEAN.length);
    if (i === prev) i = (i + 3) % BEAN.length;
    out.set(s, i);
    prev = i;
  }
  return out;
})();

/** một hàng: [lớp thân gối (sau người ngồi, key z − 0.3), lớp lưng tựa (che nửa dưới người ngồi, key z + 0.32)] */
export function renderRow(P, rowIndex, dpr) {
  const z = HALL.rows[rowIndex];
  const seats = SEATS.filter((s) => s.row === rowIndex);
  const g = beanGeo(P, z);
  const yc = P.sy(z);
  const by0 = Math.floor(yc - Math.max(0.48 * g.kk + 0.32 * g.s, g.hb * 1.06 * g.s - 0.2 * g.kk)) - 6;
  const by1 = Math.ceil(yc + 0.62 * g.kk) + 4;
  const bx0 = Math.floor(P.sx(HALL.blocks[0].x0 - 0.3, z)) - 4;
  const bx1 = Math.ceil(P.sx(HALL.blocks[2].x0 + HALL.blocks[2].n + 0.3, z)) + 4;
  const w = Math.max(1, bx1 - bx0), h = Math.max(1, by1 - by0);
  const back = makeCanvas(w * dpr, h * dpr), front = makeCanvas(w * dpr, h * dpr);
  const bc = back.getContext('2d'), fc = front.getContext('2d');
  for (const c of [bc, fc]) c.setTransform(dpr, 0, 0, dpr, -bx0 * dpr, -by0 * dpr);
  const order = [...seats].sort((a, b) => Math.abs(b.x - P.xcam) - Math.abs(a.x - P.xcam));
  for (const s of order) beanBody(bc, P, g, s, z, palOf(SEAT_COLOR.get(s)));
  for (const s of order) beanBack(fc, P, g, s, z, palOf(SEAT_COLOR.get(s)));
  const base = { kind: 'row', z, x0: bx0, y0: by0, w, h, xcam: P.xcam, s: P.s(z + 0.2) };
  return [{ ...base, key: z - 0.3, canvas: back }, { ...base, key: z + 0.32, canvas: front }];
}

/**
 * Cỡ gối quanh hàng z (hình chiếu cục bộ: ngang theo s, sâu theo kk). Điện thoại dọc sàn rất dốc (k > s) → gối bị kéo
 * cao thành "quả trứng": giới hạn kk ≤ 0,62 s cho gối luôn bầu bĩnh. Lưng tựa đủ cao để che hông + nửa dưới thân người ngồi.
 */
function beanGeo(P, z) {
  const s = P.s(z), kk = Math.min(P.k, 0.62 * s);
  return { s, kk, hb: clamp((0.41 * s + 0.2 * kk) / s, 0.48, 0.66) };
}

/** gối nào cũng hơi lệch / nghiêng / xẹp một chút cho tự nhiên (cố định theo ghế) */
function slouch(seat) {
  return {
    dx: (hash2(seat.col, seat.row, 51) - 0.5) * 0.08,
    tilt: (hash2(seat.col, seat.row, 52) - 0.5) * 0.14,
    k: 0.94 + hash2(seat.col, seat.row, 53) * 0.12,
  };
}

/** thân gối: bóng, khối phồng (đáy elip trên sàn + mặt trên elip cao ~0,3 ô), chỗ lún ngồi, viền sáng phía màn hình */
function beanBody(ctx, P, g, seat, z, pal) {
  const j = slouch(seat);
  const { s, kk } = g;
  const cx = P.sx(seat.x + j.dx, z), cy = P.sy(z);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath(); ctx.ellipse(cx + s * 0.05, cy + kk * 0.02, s * 0.5, kk * 0.46, 0, 0, Math.PI * 2); ctx.fill();
  const F = { x: cx, y: cy - 0.12 * kk }, T = { x: cx, y: cy - 0.18 * kk - 0.3 * s * j.k };
  const frx = 0.42 * s, fry = 0.44 * kk, trx = 0.33 * s, tr = 0.3 * kk;
  ctx.beginPath();
  ctx.moveTo(F.x - frx, F.y);
  ctx.ellipse(F.x, F.y, frx, fry, 0, Math.PI, 0, true);
  ctx.bezierCurveTo(F.x + frx, F.y - (F.y - T.y) * 0.7, T.x + trx * 1.25, T.y, T.x + trx, T.y);
  ctx.ellipse(T.x, T.y, trx, tr, 0, 0, Math.PI, true);
  ctx.bezierCurveTo(T.x - trx * 1.25, T.y, F.x - frx, F.y - (F.y - T.y) * 0.7, F.x - frx, F.y);
  ctx.closePath();
  ctx.fillStyle = vGrad(ctx, T.y - tr, F.y + fry, [[0, pal.top], [0.5, pal.base], [1, pal.dark]]);
  ctx.fill();
  // chỗ lún
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(cx, cy - 0.1 * kk - 0.26 * s * j.k, s * 0.22, kk * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  // viền sáng phía màn hình + đốm bóng vải
  ctx.strokeStyle = 'rgba(190,210,255,0.34)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath(); ctx.ellipse(T.x, T.y, trx * 0.97, tr * 0.95, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  ctx.fillStyle = pal.hi;
  ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.ellipse(T.x - trx * 0.45, T.y - tr * 0.1, trx * 0.22, tr * 0.3, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

/** lưng tựa: ụ phồng quay về người xem (khuất ánh màn hình nên tối hơn; đỉnh bắt sáng), hơi nghiêng mỗi chiếc một kiểu */
function beanBack(ctx, P, g, seat, z, pal) {
  const j = slouch(seat);
  const { s, kk } = g;
  const bx = P.sx(seat.x + j.dx, z), by = P.sy(z) + 0.34 * kk;
  const hh = 0.14 * kk + g.hb * j.k * s;
  const wb = 0.38 * s, wt = 0.26 * s;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(j.tilt);
  const top = -hh;
  ctx.beginPath();
  ctx.moveTo(-wb * 0.7, 0);
  ctx.quadraticCurveTo(-wb * 1.06, 0, -wb, -hh * 0.3);
  ctx.bezierCurveTo(-wb * 0.94, top + hh * 0.16, -wt, top, 0, top);
  ctx.bezierCurveTo(wt, top, wb * 0.94, top + hh * 0.16, wb, -hh * 0.3);
  ctx.quadraticCurveTo(wb * 1.06, 0, wb * 0.7, 0);
  ctx.closePath();
  ctx.fillStyle = vGrad(ctx, top, 0, [[0, pal.top], [0.32, pal.base], [1, pal.dark]]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // đường may chia múi + bóng trăng trên đỉnh
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = Math.max(0.8, s * 0.022);
  ctx.beginPath();
  for (const k of [-0.42, 0.42]) {
    ctx.moveTo(wt * k, top + hh * 0.04);
    ctx.quadraticCurveTo(wb * k * 1.12, -hh * 0.45, wb * k * 0.95, 0);
  }
  ctx.stroke();
  ctx.fillStyle = pal.hi;
  ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.ellipse(-wt * 0.35, top + hh * 0.2, wt * 0.45, hh * 0.13, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = 'rgba(205,220,255,0.4)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(-wb * 0.82, -hh * 0.55);
  ctx.bezierCurveTo(-wt * 0.8, top + 0.4, wt * 0.8, top + 0.4, wb * 0.82, -hh * 0.55);
  ctx.stroke();
  ctx.restore();
}

// ================================================================ loa ba chân hai bên bục
/** loa ngoài trời trên chân máy ba càng */
export function drawSpeaker(ctx, P, sp) {
  ctx.save();
  const cx = sp.x + sp.w / 2, cz = sp.y + sp.h / 2;
  const g = P.pt(cx, cz), s = g.s;
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(1, P.k / s);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const hub = P.pt(cx, cz, 0.72);
  const leg = (fx, fz) => { const f = P.pt(fx, fz); ctx.moveTo(hub.x, hub.y); ctx.lineTo(f.x, f.y); };
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2b2f37';
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.beginPath(); leg(cx, cz - 0.5); ctx.stroke();
  const top = P.pt(cx, cz, 1.02);
  ctx.strokeStyle = '#3a3f49';
  ctx.lineWidth = Math.max(1.4, s * 0.06);
  ctx.beginPath(); ctx.moveTo(hub.x, hub.y + s * 0.12); ctx.lineTo(top.x, top.y); ctx.stroke();
  ctx.strokeStyle = '#2b2f37';
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.beginPath(); leg(cx - 0.5, cz + 0.34); leg(cx + 0.5, cz + 0.34); ctx.stroke();
  const bb = box(ctx, P, cx - 0.36, cx + 0.36, cz - 0.22, cz + 0.22, 1.8,
    { top: '#2c2f37', front: '#16181d', left: '#0e0f13', right: '#0e0f13', edge: 'rgba(200,215,255,0.25)' }, 1.02);
  const f = bb.front;
  const fw = f.B.x - f.A.x, fh = f.A.y - f.D.y, fx = (f.A.x + f.B.x) / 2;
  ctx.fillStyle = '#0a0b0e';
  rrPath(ctx, f.D.x + fw * 0.08, f.D.y + fh * 0.06, fw * 0.84, fh * 0.88, fw * 0.08);
  ctx.fill();
  for (const [ky, r] of [[0.24, 0.13], [0.64, 0.3]]) {
    const y = f.D.y + fh * ky;
    ctx.fillStyle = '#272a32';
    ctx.beginPath(); ctx.arc(fx, y, fw * (r + 0.04), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#07080a';
    ctx.beginPath(); ctx.arc(fx, y, fw * r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2e323b';
    ctx.beginPath(); ctx.arc(fx, y, fw * r * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,215,255,0.16)';
    ctx.beginPath(); ctx.arc(fx - fw * r * 0.3, y - fw * r * 0.3, fw * r * 0.16, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(f.B.x - fw * 0.2, f.D.y + fh * 0.05, Math.max(1, fw * 0.05), Math.max(1, fw * 0.05));
  ctx.restore();
  return bb;
}

// ================================================================ xe bắp rang (vật cản sát hàng rào phải, cạnh sàn gỗ)
/** mặt phẳng x = const: vẽ hình tròn bán kính r (ô) tâm (z, h) thành elip phối cảnh */
function sideDisc(ctx, P, x, z, h, r, fill) {
  const o = P.pt(x, z, h), ez = P.pt(x, z + 1, h), eh = P.pt(x, z, h + 1);
  ctx.save();
  ctx.transform(ez.x - o.x, ez.y - o.y, eh.x - o.x, eh.y - o.y, o.x, o.y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawCounter(ctx, P, c, now) {
  ctx.save();
  const x0 = c.x + 0.08, x1 = c.x + c.w - 0.02, z0 = c.y + 0.15, z1 = c.y + c.h - 0.15;
  // bóng + vũng sáng ấm từ tủ bắp
  const g = P.pt(x0 + 0.4, (z0 + z1) / 2);
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(1, P.k / g.s);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(0, 0, g.s * 0.75, g.s * 1.45, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  blitGlow(ctx, glow('255,190,90', 0.16), -g.s * 0.5, 0, g.s * 1.6);
  ctx.restore();
  // thân xe đỏ viền trắng
  box(ctx, P, x0, x1, z0, z1, 1.0, { left: '#9f1d26', top: '#e6d2ad', front: '#b8242e', right: '#7d151d', edge: 'rgba(255,240,215,0.7)' }, 0.32);
  ctx.strokeStyle = 'rgba(255,236,214,0.8)';
  ctx.lineWidth = Math.max(1, P.s(z1) * 0.035);
  ctx.beginPath();
  for (const h of [0.42, 0.9]) { const a = P.pt(x0, z0, h), b = P.pt(x0, z1, h), q = P.pt(x1, z1, h); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(q.x, q.y); }
  ctx.stroke();
  // chữ trên hông xe
  const mid = P.pt(x0, (z0 + z1) / 2, 0.66);
  ctx.save();
  const ez = P.pt(x0, (z0 + z1) / 2 + 1, 0.66);
  ctx.transform((ez.x - mid.x) / mid.s, (ez.y - mid.y) / mid.s, 0, 1, mid.x, mid.y);
  ctx.fillStyle = '#ffe9a8';
  ctx.font = `800 ${Math.max(6, mid.s * 0.24)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BẮP RANG', 0, 0);
  ctx.restore();
  // bánh xe phía trong
  for (const wz of [z0 + 0.38, z1 - 0.38]) {
    sideDisc(ctx, P, x0 - 0.03, wz, 0.3, 0.3, '#15161a');
    sideDisc(ctx, P, x0 - 0.04, wz, 0.3, 0.2, '#d8b45a');
    sideDisc(ctx, P, x0 - 0.05, wz, 0.3, 0.07, '#5a4420');
  }
  // tủ kính bắp rang (sáng ấm)
  const gb = box(ctx, P, x0 + 0.08, x1 - 0.06, z0 + 0.3, z0 + 1.4, 1.62,
    { left: 'rgba(255,214,130,0.5)', top: '#8f1d24', front: 'rgba(255,224,150,0.55)', right: 'rgba(160,90,40,0.6)' }, 1.0);
  const gf = gb.front;
  for (let i = 0; i < 16; i++) {
    const zz = z0 + 0.38 + hash2(i, 1, 7) * 0.95, hh = 1.04 + hash2(i, 2, 7) * 0.28;
    const p = P.pt(x0 + 0.08, zz, hh);
    ctx.fillStyle = hash2(i, 3, 7) > 0.3 ? '#fff4cf' : '#f6c453';
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.9, p.s * 0.045), 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#6e141b';
  ctx.lineWidth = Math.max(1, P.s(z1) * 0.03);
  ctx.strokeRect(gf.D.x, gf.D.y, gf.B.x - gf.A.x, gf.A.y - gf.D.y);
  // cột mái
  ctx.strokeStyle = '#d9d2c4';
  ctx.lineWidth = Math.max(1, P.s(z1) * 0.03);
  ctx.beginPath();
  for (const [px, pz] of [[x0 + 0.04, z0 + 0.06], [x0 + 0.04, z1 - 0.06], [x1 - 0.04, z1 - 0.06]]) {
    const a = P.pt(px, pz, 1.0), b = P.pt(px, pz, 1.92);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // mái sọc đỏ trắng + diềm lượn sóng
  const ax0 = x0 - 0.12, ax1 = x1 + 0.06, az0 = z0 - 0.12, az1 = z1 + 0.14, ah = 1.95;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const za = az0 + ((az1 - az0) * i) / n, zb = az0 + ((az1 - az0) * (i + 1)) / n;
    poly(ctx, [P.pt(ax0, za, ah), P.pt(ax1, za, ah), P.pt(ax1, zb, ah), P.pt(ax0, zb, ah)], i % 2 ? '#f3ece0' : '#c8232f');
  }
  const scallops = (pa, pb, cnt, i0) => {
    for (let i = 0; i < cnt; i++) {
      const a = { x: pa.x + ((pb.x - pa.x) * i) / cnt, y: pa.y + ((pb.y - pa.y) * i) / cnt };
      const b = { x: pa.x + ((pb.x - pa.x) * (i + 1)) / cnt, y: pa.y + ((pb.y - pa.y) * (i + 1)) / cnt };
      const d = pa.s * 0.13;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + d * 2, b.x, b.y);
      ctx.closePath();
      ctx.fillStyle = (i + i0) % 2 ? '#f3ece0' : '#c8232f';
      ctx.fill();
    }
  };
  scallops(P.pt(ax0, az0, ah), P.pt(ax0, az1, ah), n, 0);
  scallops(P.pt(ax0, az1, ah), P.pt(ax1, az1, ah), 3, 1);
  // biển BẮP NƯỚC trên mái (mặt quay về người xem)
  const sb = P.pt(x0 + 0.25, z1 - 0.05, 2.32);
  const bw = sb.s * 1.5, bh = sb.s * 0.42;
  ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now / 700);
  blitGlow(ctx, glow('255,190,80', 0.42), sb.x, sb.y, bw * 0.78, bh * 1.5);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2a1608';
  rrPath(ctx, sb.x - bw / 2, sb.y - bh / 2, bw, bh, bh * 0.25);
  ctx.fill();
  ctx.strokeStyle = '#f5c451';
  ctx.lineWidth = Math.max(1, sb.s * 0.03);
  rrPath(ctx, sb.x - bw / 2, sb.y - bh / 2, bw, bh, bh * 0.25);
  ctx.stroke();
  ctx.fillStyle = '#ffd36b';
  ctx.font = `800 ${Math.max(7, sb.s * 0.27)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BẮP NƯỚC', sb.x, sb.y + 0.5);
  const pole = P.pt(x0 + 0.25, z1 - 0.05, 1.98);
  ctx.fillStyle = '#d9d2c4';
  ctx.fillRect(pole.x - 0.8, sb.y + bh / 2, 1.6, pole.y - sb.y - bh / 2);
  ctx.restore();
  return gb;
}

// ================================================================ hiệu ứng
const POOLS = ['255,100,200', '160,120,255', '80,215,255', '110,255,190'];

/** sàn gỗ: quầng màu dưới chân người nhảy (đập theo nhịp, viền sáng như đèn rọi) + vài đốm đèn lướt qua */
export function drawDanceLights(ctx, P, dancers, now) {
  if (!dancers.length) return;
  const d = HALL.danceFloor;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  let n = 0;
  for (const a of dancers) {
    if (a.x < d.x - 0.3 || a.x > d.x + d.w + 0.3 || a.y < d.y - 0.3 || a.y > d.y + d.h + 0.3) continue;
    const p = P.pt(a.x, a.y);
    const id = Number(a.id) || 0;
    const rgb = POOLS[(Math.floor(now / 520) + id) % POOLS.length];
    const beat = Math.max(0, Math.sin(now / 130 + id));
    const rx = p.s * (1.25 + 0.12 * beat), ry = P.k * (1.25 + 0.12 * beat);
    ctx.globalAlpha = 0.62 + 0.38 * beat;
    blitGlow(ctx, glow(rgb, 0.85, 0.35), p.x, p.y, rx, ry);
    ctx.globalAlpha = 0.35 + 0.3 * beat;
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.lineWidth = Math.max(1, p.s * 0.04);
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2); ctx.stroke();
    n++;
  }
  for (let i = 0; i < Math.min(3, Math.max(1, n)); i++) {
    const t = now / (2700 + i * 650) + i * 2.1;
    const p = P.pt(d.x + d.w * (0.5 + 0.43 * Math.sin(t)), d.y + d.h * (0.5 + 0.36 * Math.cos(t * 1.3)));
    ctx.globalAlpha = 0.75;
    blitGlow(ctx, glow(POOLS[(i + 1) % POOLS.length], 0.6, 0.3), p.x, p.y, p.s * 1.7, P.k * 1.7);
  }
  ctx.restore();
}

/** ánh màn hình hắt xuống bục + mấy hàng đầu, tối dần ở mép gần người xem */
function drawHallLight(ctx, P, L, playing) {
  if (playing) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = (P.Yn - P.Yf) * 0.8;
    ctx.translate(L.Xc ?? L.w / 2, P.Yf - P.k * 0.5);
    ctx.scale(2.0, 1);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, r);
    g.addColorStop(0, 'rgba(150,175,255,0.13)');
    g.addColorStop(1, 'rgba(150,175,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, 0, r * 2, r);
    ctx.restore();
  }
  ctx.save();
  const v = ctx.createLinearGradient(0, P.Yn - (P.Yn - P.Yf) * 0.35, 0, L.h);
  v.addColorStop(0, 'rgba(2,8,6,0)');
  v.addColorStop(1, 'rgba(2,8,6,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, P.Yf, L.w, L.h - P.Yf + 2);
  ctx.restore();
}

// đom đóm: bay lượn quanh hai hàng rào + mấy con lạc vào gần sàn gỗ
const FLIES = Array.from({ length: 18 }, (_, i) => {
  const left = i % 2 === 0;
  const inner = i >= 13;
  const off = inner ? 0.8 + hash2(i, 1, 5) * 0.9 : -1.2 + hash2(i, 1, 5) * 2.6;
  return {
    x: left ? off : W - off,
    z: inner ? 0.6 + hash2(i, 2, 5) * 6 : 0.8 + hash2(i, 2, 5) * 15,
    h: 0.35 + hash2(i, 3, 5) * 1.1,
    fx: 0.25 + hash2(i, 4, 5) * 0.35, fz: 0.2 + hash2(i, 5, 5) * 0.3, fb: 0.9 + hash2(i, 6, 5) * 1.4,
    p1: hash2(i, 7, 5) * 6.28, p2: hash2(i, 8, 5) * 6.28, p3: hash2(i, 9, 5) * 6.28, p4: hash2(i, 10, 5) * 6.28, p5: hash2(i, 11, 5) * 6.28,
  };
});

function fireflies(ctx, P, L, now) {
  const t = now / 1000;
  const spr = glow('205,255,120', 0.9, 0.18);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of FLIES) {
    const x = f.x + Math.sin(t * f.fx + f.p1) * 0.6 + Math.sin(t * 2.3 * f.fx + f.p2) * 0.18;
    const z = f.z + Math.cos(t * f.fz + f.p3) * 0.55;
    const p = P.pt(x, z, f.h + Math.sin(t * 1.3 * f.fz + f.p4) * 0.25);
    if (p.x < -20 || p.x > L.w + 20 || p.y < L.vb + 4 || p.y > L.h + 10) continue;
    const b = 0.5 + 0.5 * Math.sin(t * f.fb + f.p5);
    ctx.globalAlpha = 0.22 + 0.78 * b * b * b;
    blitGlow(ctx, spr, p.x, p.y, Math.max(6, p.s * 0.42));
    ctx.fillStyle = '#f6ffd0';
    ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
  }
  ctx.restore();
}

export default {
  id: 'congvien',
  void: C.void,
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
  fx: fireflies,
};
