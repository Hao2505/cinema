// Rạp Đỗ Xe (1) — dải trời phía trên (px CSS, vẽ một lần theo bố cục): trời đêm đầy sao, đồi xa + ánh đèn thành phố ở
// chân trời, cột ăng-ten, bãi đất tối tới chân tháp màn hình; tháp màn hình khổng lồ (mặt trắng viền dày, giàn thép hai
// bên); biển neon DRIVE-IN trên cột bên trái màn hình (chỉ vẽ khi còn đủ chỗ — không lấn video, không nằm dưới cụm nút).
// skyFx (mỗi khung, rẻ): sao lấp lánh, bóng đèn chạy quanh mũi tên, đèn đỏ đỉnh ăng-ten nháy, thỉnh thoảng sao băng.
import { HALL } from '../../shared/hall.js';
import { hash2, clamp } from '../../util.js';
import { FONT, makeCanvas, vGrad, fillRR, rrPath } from '../draw.js';

const HUD_Y = 50; // mép dưới cụm nút góc trên (~42 px) + khoảng thở
export const NEON = { red: '#ff3b5c', teal: '#3ff0e0', bulb: '#ffd98a' };
let fx = null; // hiệu ứng của dải đang dùng: { L, stars, bulbs, star, mast, shoot, dim }

/** số đo dải trời theo bố cục */
function geom(L) {
  const sc = L.screen;
  const k = (L.Yn - L.Yf) / HALL.H;
  const yG = L.Yf - 1.2 * k; // chân tường cuối (z = −1.2)
  const yP = yG - 0.75 * L.sw; // mép xa mặt bục bê tông
  const fr = L.frame;
  const tf = L.narrow ? 3 : clamp(Math.round(sc.w * 0.012), 5, 11);
  const face = { x: sc.x - fr - tf, y: sc.y - fr - tf, w: sc.w + 2 * (fr + tf), h: sc.h + 2 * (fr + tf) };
  const tw = L.narrow ? 0 : clamp(Math.round(sc.w * 0.026), 9, 24);
  const yH = Math.round(clamp(sc.y + sc.h * 0.7, sc.y + 30, yP - 24));
  return { sc, k, yG, yP, fr, tf, face, tw, yH, left: face.x - tw, right: face.x + face.w + tw };
}

function glowSprite(rgb, size = 32) {
  const cv = makeCanvas(size, size);
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.25, `rgba(${rgb},0.55)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return cv;
}
let SPR = null;
const sprites = () => SPR || (SPR = { dot: glowSprite('235,240,255'), bulb: glowSprite('255,214,130'), red: glowSprite('255,60,70') });

// ---------------------------------------------------------------- trời, sao, chân trời
function drawSky(ctx, g, w) {
  ctx.fillStyle = vGrad(ctx, 0, g.yH, [[0, '#03040b'], [0.5, '#080a1d'], [0.82, '#141436'], [1, '#2a1d44']]);
  ctx.fillRect(0, 0, w, g.yH + 1);
  const twinkle = [];
  const n = Math.round((w * g.yH) / 1700);
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 1, 41) * w, y = Math.pow(hash2(i, 2, 41), 1.35) * (g.yH - 12);
    const r = hash2(i, 3, 41);
    const behind = x > g.left - 6 && x < g.right + 6 && y > g.face.y - 6;
    const sz = r > 0.94 ? 1.9 : r > 0.72 ? 1.3 : 0.9;
    ctx.fillStyle = `rgba(${215 + r * 40 | 0},${222 + r * 30 | 0},255,${(0.22 + r * 0.6) * (1 - (y / g.yH) * 0.5)})`;
    ctx.fillRect(x, y, sz, sz);
    if (r > 0.975) {
      ctx.fillStyle = 'rgba(235,240,255,0.35)';
      ctx.fillRect(x - 2.5, y + sz / 2 - 0.4, 5 + sz, 0.8);
      ctx.fillRect(x + sz / 2 - 0.4, y - 2.5, 0.8, 5 + sz);
    }
    if (r > 0.86 && !behind && y > 6 && twinkle.length < 44) twinkle.push({ x: x + sz / 2, y: y + sz / 2, r: sz * 1.6, ph: hash2(i, 4, 41) * 6.28, sp: 380 + hash2(i, 5, 41) * 700 });
  }
  return twinkle;
}

function drawHorizon(ctx, g, w, bandH) {
  const yH = g.yH, amp = clamp(g.sc.h * 0.07, 8, 34);
  // quầng sáng thành phố
  const clusters = [];
  const lw = g.left, rw = w - g.right;
  if (lw > 60) clusters.push({ x: lw * 0.42, w: Math.min(150, lw * 0.75) });
  if (rw > 60) clusters.push({ x: g.right + rw * 0.62, w: Math.min(150, rw * 0.75) });
  for (const c of clusters) {
    const gl = ctx.createRadialGradient(c.x, yH, 0, c.x, yH, c.w);
    gl.addColorStop(0, 'rgba(255,150,95,0.26)');
    gl.addColorStop(1, 'rgba(255,150,95,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(c.x - c.w, yH - c.w, c.w * 2, c.w);
  }
  // đồi xa
  ctx.beginPath();
  ctx.moveTo(0, yH + 2);
  for (let x = 0; x <= w + 8; x += 6) ctx.lineTo(x, yH - amp * (0.35 + 0.4 * (0.5 + 0.5 * Math.sin(x / 160 + 0.7)) + 0.25 * (0.5 + 0.5 * Math.sin(x / 61 + 2.1))));
  ctx.lineTo(w, yH + 2);
  ctx.closePath();
  ctx.fillStyle = '#15163a';
  ctx.fill();
  // thành phố: nhà cao thấp + cửa sổ sáng
  for (const [ci, c] of clusters.entries()) {
    const nb = Math.round(c.w / 7);
    for (let i = 0; i < nb; i++) {
      const bx = c.x - c.w * 0.45 + (i / nb) * c.w * 0.9 + (hash2(i, ci, 7) - 0.5) * 4;
      const bw = 4 + hash2(i, ci, 8) * 7;
      const bh = (5 + Math.pow(hash2(i, ci, 9), 1.6) * amp * 1.1) * (1 - Math.abs(i / nb - 0.5) * 0.9);
      ctx.fillStyle = '#0d0e26';
      ctx.fillRect(bx, yH - bh, bw, bh + 2);
      for (let wy = yH - bh + 2; wy < yH - 1; wy += 2.6) {
        for (let wx = bx + 1; wx < bx + bw - 1; wx += 2.4) {
          const h = hash2(Math.round(wx * 3), Math.round(wy * 3), ci + 11);
          if (h < 0.72) continue;
          ctx.fillStyle = h > 0.95 ? 'rgba(200,225,255,0.8)' : `rgba(255,${200 + h * 40 | 0},120,${0.4 + h * 0.4})`;
          ctx.fillRect(wx, wy, 1, 1);
        }
      }
    }
  }
  // đồi gần (có hàng cây lô nhô)
  ctx.beginPath();
  ctx.moveTo(0, yH + 3);
  for (let x = 0; x <= w + 6; x += 4) {
    const tree = Math.max(0, Math.sin(x / 9 + Math.sin(x / 37) * 2)) * 3.5 * (0.5 + 0.5 * Math.sin(x / 90));
    ctx.lineTo(x, yH - amp * 0.18 * (0.5 + 0.5 * Math.sin(x / 120 + 4)) - tree);
  }
  ctx.lineTo(w, yH + 3);
  ctx.closePath();
  ctx.fillStyle = '#0a0b1b';
  ctx.fill();
  // bãi đất tối tới chân tháp + vài ngọn đèn xa (xa lộ)
  ctx.fillStyle = vGrad(ctx, yH, bandH, [[0, '#0b0c17'], [0.6, '#0e1018'], [1, '#111319']]);
  ctx.fillRect(0, yH, w, bandH - yH);
  for (let i = 0; i < 60; i++) {
    const x = hash2(i, 5, 77) * w;
    if (x > g.left - 4 && x < g.right + 4) continue;
    const y = yH + 2 + hash2(i, 6, 77) * Math.min(14, (g.yG - yH) * 0.3);
    ctx.fillStyle = hash2(i, 7, 77) > 0.5 ? 'rgba(255,190,110,0.7)' : 'rgba(255,240,220,0.55)';
    ctx.fillRect(x, y, 1.2, 1);
  }
  return clusters;
}

/** cột ăng-ten xa (đèn đỏ đỉnh cột nháy trong skyFx) */
function drawMast(ctx, g, w) {
  const rw = w - g.right;
  if (rw < 90) return null;
  const x = g.right + rw * 0.28;
  const top = Math.max(HUD_Y + 8, g.yH - clamp(g.sc.h * 0.3, 40, 150));
  const base = g.yH - 2, bw = clamp((base - top) * 0.09, 4, 10);
  ctx.strokeStyle = '#1b1d36';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - bw / 2, base); ctx.lineTo(x, top); ctx.lineTo(x + bw / 2, base);
  const n = Math.max(4, Math.round((base - top) / 7));
  for (let i = 1; i < n; i++) {
    const y = top + ((base - top) * i) / n, hw = (bw / 2) * (i / n);
    ctx.moveTo(x - hw, y); ctx.lineTo(x + hw, y);
    if (i % 2) { ctx.moveTo(x - hw, y); ctx.lineTo(x + hw * 1.1, y + (base - top) / n); }
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,70,80,0.55)';
  ctx.fillRect(x - 1, top - 2, 2, 2);
  return { x, y: top - 1 };
}

// ---------------------------------------------------------------- tháp màn hình
function truss(ctx, x, y, w, h) {
  if (w < 4 || h < 4) return;
  ctx.fillStyle = '#20263a';
  ctx.fillRect(x, y, 2.5, h);
  ctx.fillRect(x + w - 2.5, y, 2.5, h);
  ctx.strokeStyle = '#2c3349';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  const step = w * 1.15;
  for (let yy = y; yy < y + h - 1; yy += step) {
    const y2 = Math.min(y + h, yy + step);
    ctx.moveTo(x + 1.5, yy); ctx.lineTo(x + w - 1.5, y2);
    ctx.moveTo(x + w - 1.5, yy); ctx.lineTo(x + 1.5, y2);
    ctx.moveTo(x, yy); ctx.lineTo(x + w, yy);
  }
  ctx.stroke();
}

function drawTower(ctx, g) {
  const { face, tw, sc, fr } = g;
  // giàn thép hai bên, chân đứng trên bục bê tông
  if (tw) {
    truss(ctx, face.x - tw, face.y + 8, tw + 3, g.yP + 3 - face.y - 8);
    truss(ctx, face.x + face.w - 3, face.y + 8, tw + 3, g.yP + 3 - face.y - 8);
    // ánh màn hình hắt lên mép trong giàn
    ctx.fillStyle = 'rgba(150,175,235,0.16)';
    ctx.fillRect(face.x - 3.5, face.y + 8, 1.5, g.yP - face.y - 8);
    ctx.fillRect(face.x + face.w + 2, face.y + 8, 1.5, g.yP - face.y - 8);
  }
  // giàn ngang dưới mặt màn (khi còn chỗ)
  const fb = face.y + face.h;
  if (g.yP - fb > 7) truss(ctx, face.x + 6, fb, face.w - 12, g.yP + 2 - fb);
  // mặt màn: thép sơn trắng ngà, ánh máy chiếu hắt nhẹ
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  fillRR(ctx, face.x, face.y, face.w, face.h, 3, '#7d8597');
  ctx.restore();
  rrPath(ctx, face.x, face.y, face.w, face.h, 3);
  ctx.fillStyle = vGrad(ctx, face.y, face.y + face.h, [[0, '#737b8e'], [0.5, '#8a92a4'], [1, '#949bab']]);
  ctx.fill();
  // mối nối tấm + đinh tán trên viền
  ctx.strokeStyle = 'rgba(30,34,48,0.35)';
  ctx.lineWidth = 1;
  const pw = Math.max(40, face.w / 14);
  ctx.beginPath();
  for (let x = face.x + pw; x < face.x + face.w - 4; x += pw) {
    ctx.moveTo(x + 0.5, face.y); ctx.lineTo(x + 0.5, sc.y - fr);
    ctx.moveTo(x + 0.5, sc.y + sc.h + fr); ctx.lineTo(x + 0.5, face.y + face.h);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(25,28,40,0.45)';
  const ty = face.y + g.tf / 2, by = sc.y + sc.h + fr + g.tf / 2;
  if (g.tf >= 5) {
    for (let x = face.x + 7; x < face.x + face.w - 5; x += 13) { ctx.fillRect(x, ty - 0.6, 1.3, 1.3); ctx.fillRect(x, by - 0.6, 1.3, 1.3); }
    for (let y = face.y + 9; y < face.y + face.h - 6; y += 13) { ctx.fillRect(face.x + g.tf / 2 - 0.6, y, 1.3, 1.3); ctx.fillRect(face.x + face.w - g.tf / 2 - 0.6, y, 1.3, 1.3); }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(face.x + 2, face.y, face.w - 4, 1);
  // gờ đen ôm video (L.frame) + ô video đen (iframe nằm đè lên)
  ctx.fillStyle = '#060608';
  ctx.fillRect(sc.x - fr, sc.y - fr, sc.w + fr * 2, sc.h + fr * 2);
  ctx.fillStyle = '#000';
  ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
}

// ---------------------------------------------------------------- biển neon DRIVE-IN (bên trái tháp màn hình)
function neonText(ctx, text, x, y, size, color, glow) {
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = size * 0.45;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  // lõi ống neon: dải sáng giữa nét chữ
  const g = ctx.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
  g.addColorStop(0, color);
  g.addColorStop(0.45, '#fff1f3');
  g.addColorStop(0.55, '#fff1f3');
  g.addColorStop(1, color);
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = size * 0.12;
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function sparklePath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
}

function drawSign(ctx, g, L) {
  const avail = g.left - 18;
  const top = HUD_Y + 6;
  const bottom = Math.min(g.yG - 36, L.vb - 10);
  if (avail < 56 || bottom - top < 90) return null;
  // lưỡi biển cao ≥ 1.9 lần bề ngang + ngôi sao (0.42) + mũi tên (0.62) → co bề ngang cho vừa chiều cao còn trống
  // ưu tiên lưỡi biển thon (cao ≈ 3 lần ngang, chữ to vừa lòng biển); thiếu chỗ mới chịu lưỡi lùn (≥ 1.9 lần)
  let bw = Math.min(clamp(avail * 0.38, 26, 62), (bottom - top) / 4.04);
  if (bw < 24) bw = Math.min(clamp(avail * 0.38, 24, 62), (bottom - top) / 2.94);
  if (bw < 22) return null;
  const ah = bw * 0.62;
  const star = bw * 0.42;
  const bh = Math.min(bw * 3.3, bottom - top - ah - star);
  const aw = Math.min(avail, bw * 2.25);
  const ax = 8 + (avail - aw) / 2, bx = ax + bw * 0.12;
  const by = top + star, ay = by + bh - bw * 0.08;
  const cx = bx + bw / 2;
  // quầng neon hắt lên trời
  const gl = ctx.createRadialGradient(cx, by + bh * 0.5, 0, cx, by + bh * 0.5, bh * 0.75);
  gl.addColorStop(0, 'rgba(255,60,100,0.16)');
  gl.addColorStop(1, 'rgba(255,60,100,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(cx - bh, by - bh * 0.3, bh * 2, bh * 1.6);
  // cột + thanh giằng
  const pw = Math.max(3, bw * 0.13);
  ctx.fillStyle = '#232838';
  ctx.fillRect(cx - pw / 2, ay + ah - 2, pw, g.yG + 30 - ay - ah);
  ctx.fillStyle = 'rgba(160,180,230,0.22)';
  ctx.fillRect(cx + pw / 2 - 1, ay + ah - 2, 1, g.yG + 30 - ay - ah);
  // lưỡi biển (đỉnh tròn kiểu Googie): nền xanh đêm, viền neon xanh ngọc, chữ DRIVE dọc neon đỏ
  rrPath(ctx, bx, by, bw, bh, [bw * 0.5, bw * 0.5, bw * 0.14, bw * 0.14]);
  ctx.fillStyle = vGrad(ctx, by, by + bh, [[0, '#0e2a3a'], [1, '#0a1824']]);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(63,240,224,0.9)';
  ctx.shadowBlur = 9;
  ctx.strokeStyle = NEON.teal;
  ctx.lineWidth = Math.max(1.6, bw * 0.045);
  rrPath(ctx, bx + 3, by + 3, bw - 6, bh - 6, [bw * 0.5 - 3, bw * 0.5 - 3, bw * 0.1, bw * 0.1]);
  ctx.stroke();
  ctx.restore();
  const letters = ['D', 'R', 'I', 'V', 'E'];
  const cell = (bh - bw * 0.42) / letters.length;
  const fs = Math.min(bw * 0.56, cell * 0.92);
  letters.forEach((ch, i) => neonText(ctx, ch, cx, by + bw * 0.3 + cell * (i + 0.5), fs, NEON.red, 'rgba(255,40,80,0.95)'));
  // ngôi sao lấp lánh trên đỉnh
  ctx.save();
  ctx.shadowColor = 'rgba(255,214,110,0.95)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffd66e';
  sparklePath(ctx, cx, by - star * 0.45, star * 0.55);
  ctx.fill();
  ctx.restore();
  // mũi tên chỉ vào màn hình: bảng đỏ, viền bóng đèn, chữ IN neon xanh ngọc
  const tip = ah * 0.58;
  const arrow = [[ax, ay], [ax + aw - tip, ay], [ax + aw, ay + ah / 2], [ax + aw - tip, ay + ah], [ax, ay + ah]];
  ctx.beginPath();
  arrow.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = vGrad(ctx, ay, ay + ah, [[0, '#8a1428'], [1, '#4a0814']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,160,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const ins = Math.max(3, ah * 0.13);
  const inner = [[ax + ins, ay + ins], [ax + aw - tip, ay + ins], [ax + aw - ins * 1.6, ay + ah / 2], [ax + aw - tip, ay + ah - ins], [ax + ins, ay + ah - ins]];
  const bulbs = [];
  const sp = clamp(ah / 4.2, 5.5, 9);
  const br = clamp(ah * 0.055, 1.1, 2);
  for (let i = 0; i < inner.length; i++) {
    const [x0, y0] = inner[i], [x1, y1] = inner[(i + 1) % inner.length];
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / sp));
    for (let j = 0; j < n; j++) bulbs.push({ x: x0 + ((x1 - x0) * j) / n, y: y0 + ((y1 - y0) * j) / n, r: br });
  }
  for (const b of bulbs) {
    ctx.fillStyle = 'rgba(255,214,140,0.5)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe2a6';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  }
  const tx = ax + (aw - tip * 0.6) / 2;
  neonText(ctx, 'IN', tx, ay + ah / 2 + 0.5, ah * 0.5, NEON.teal, 'rgba(63,240,224,0.95)');
  return {
    bulbs,
    star: { x: cx, y: by - star * 0.45, r: star * 0.55 },
    dim: { x: tx - ah * 0.45, y: ay + ah * 0.22, w: ah * 0.9, h: ah * 0.56 },
    box: { x0: ax, y0: by - star, x1: ax + aw, y1: ay + ah },
  };
}

// ---------------------------------------------------------------- dải trời (cache theo bố cục)
export function renderBand(L, dpr) {
  const bandH = Math.ceil(L.Yf + 2);
  const cv = makeCanvas(L.w * dpr, bandH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = geom(L);
  const stars = drawSky(ctx, g, L.w);
  drawHorizon(ctx, g, L.w, bandH);
  const mast = drawMast(ctx, g, L.w);
  const sign = L.narrow ? null : drawSign(ctx, g, L);
  drawTower(ctx, g);
  // sao lấp lánh không được nằm trên biển neon
  const tw = sign ? stars.filter((s) => s.x < sign.box.x0 - 6 || s.x > sign.box.x1 + 6 || s.y < sign.box.y0 - 6 || s.y > sign.box.y1 + 6) : stars;
  // vùng sao băng: lề trời rộng hơn (tránh tháp, biển, cụm nút)
  const rw = L.w - g.right, lw = sign ? 0 : g.left;
  let shoot = null;
  const y1 = Math.min(g.yH - 50, L.vb - 20);
  if (Math.max(rw, lw) > 150 && y1 - HUD_Y > 50) {
    shoot = rw >= lw ? { x0: g.right + 20, x1: L.w - 12, y0: HUD_Y, y1 } : { x0: 12, x1: g.left - 20, y0: HUD_Y, y1 };
  }
  fx = { L, stars: tw, bulbs: sign ? sign.bulbs : [], star: sign && sign.star, dim: sign && sign.dim, mast, shoot };
  return { canvas: cv, h: bandH };
}

/** mỗi khung trên dải trời (stage đã cắt bỏ khung video): sao lấp lánh, đèn chạy, ăng-ten nháy, sao băng */
export function skyFx(ctx, L, now) {
  const f = fx;
  if (!f || f.L !== L) return;
  const S = sprites();
  ctx.save();
  for (const s of f.stars) {
    const a = Math.sin(now / s.sp + s.ph);
    if (a < 0.2) continue;
    ctx.globalAlpha = (a - 0.2) * 0.9;
    const r = s.r * (1.6 + a);
    ctx.drawImage(S.dot, s.x - r, s.y - r, r * 2, r * 2);
  }
  if (f.bulbs.length) {
    const step = Math.floor(now / 150);
    ctx.globalAlpha = 0.95;
    for (let i = 0; i < f.bulbs.length; i++) {
      if ((i + step) % 3) continue;
      const b = f.bulbs[i], r = b.r * 3.4;
      ctx.drawImage(S.bulb, b.x - r, b.y - r, r * 2, r * 2);
    }
  }
  if (f.star) {
    const a = 0.5 + 0.5 * Math.sin(now / 420);
    ctx.globalAlpha = 0.25 + a * 0.5;
    const r = f.star.r * (1.3 + a * 0.5);
    ctx.drawImage(S.bulb, f.star.x - r, f.star.y - r, r * 2, r * 2);
  }
  // chữ IN chập chờn vài nhịp mỗi ~9 s
  if (f.dim) {
    const t = now % 9000;
    if (t < 700 && Math.floor(t / 90) % 2 === 0) {
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = '#4a0814';
      ctx.fillRect(f.dim.x, f.dim.y, f.dim.w, f.dim.h);
    }
  }
  if (f.mast && now % 1700 < 650) {
    ctx.globalAlpha = 0.9;
    ctx.drawImage(S.red, f.mast.x - 5, f.mast.y - 5, 10, 10);
  }
  // sao băng mỗi ~12 s
  const sh = f.shoot;
  if (sh) {
    const cyc = Math.floor(now / 12000), t = (now % 12000) / 900;
    if (t < 1) {
      const sx = sh.x0 + hash2(cyc, 1, 5) * (sh.x1 - sh.x0) * 0.6 + (sh.x1 - sh.x0) * 0.4;
      const sy = sh.y0 + hash2(cyc, 2, 5) * (sh.y1 - sh.y0) * 0.4;
      const len = Math.min(90, (sh.x1 - sh.x0) * 0.5);
      const hx = sx - len * t, hy = sy + len * 0.38 * t;
      const lg = ctx.createLinearGradient(hx, hy, hx + len * 0.5, hy - len * 0.19);
      lg.addColorStop(0, 'rgba(255,255,255,0.9)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = Math.sin(t * Math.PI);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + len * 0.5, hy - len * 0.19); ctx.stroke();
    }
  }
  ctx.restore();
}
