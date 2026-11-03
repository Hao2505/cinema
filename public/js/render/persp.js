// Phối cảnh một điểm tụ cho khán phòng (nhìn từ cuối rạp, trên cao, về phía màn hình).
// Toạ độ thế giới: x ngang (ô), z = độ sâu (ô; = toạ độ y của mô phỏng: 0 ở mép sân khấu, H ở cuối rạp), h = độ cao (ô).
// Mô hình "2.5D tuyến tính": độ cao màn hình của mặt sàn sy(z) và tỉ lệ s(z) (px / ô) đều tuyến tính theo z —
// vẫn là một phép chiếu phối cảnh hợp lệ (đường dọc theo z thành đường thẳng chụm về điểm tụ, đường ngang giữ ngang,
// đường đứng giữ đứng), chỉ "giãn" trục sâu cho các hàng ghế cách đều nhau trên màn hình.
// Mặt phẳng song song màn hình (tường cuối, màn chiếu) không méo → khung YouTube vẫn là hình chữ nhật y nguyên.

/** p: { Xc, Yf, Yn, s0, s1, H, xcam } — Xc: px điểm giữa; Yf/Yn: px mặt sàn ở z=0 / z=H; s0/s1: px/ô ở z=0 / z=H */
export function projection(p) {
  const { Xc, Yf, Yn, s0, s1, H } = p;
  const xcam = p.xcam;
  const k = (Yn - Yf) / H; // px màn hình / 1 ô sâu
  const ds = (s1 - s0) / H; // tỉ lệ tăng thêm / 1 ô sâu
  const s = (z) => s0 + ds * z;
  const sy = (z) => Yf + k * z;
  return {
    Xc, Yf, Yn, s0, s1, H, xcam, k, ds,
    s,
    sy,
    sx: (x, z) => Xc + (x - xcam) * s(z),
    /** điểm (x, z) cao h ô → px */
    pt(x, z, h = 0) {
      const sc = s0 + ds * z;
      return { x: Xc + (x - xcam) * sc, y: Yf + k * z - h * sc, s: sc };
    },
    /** px trên mặt sàn → (x, z) thế giới */
    inv(px, py) {
      const z = (py - Yf) / k;
      const sc = s0 + ds * z;
      return { x: xcam + (px - Xc) / sc, z };
    },
    /** điểm tụ (nơi s = 0) */
    vp() {
      const z = -s0 / ds;
      return { x: Xc, y: Yf + k * z };
    },
  };
}

export function poly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/**
 * Khối hộp: x ∈ [x0, x1], z ∈ [z0, z1] (z1 gần camera hơn), cao từ hb tới ht (ô).
 * c: { top, front, left, right, edge } — màu từng mặt (thiếu thì bỏ mặt đó). Vẽ xa → gần (mặt bên, mặt trên, mặt trước).
 * Trả về khung bao px (để bấm trúng / đặt chữ).
 */
export function box(ctx, P, x0, x1, z0, z1, ht, c, hb = 0) {
  const A = P.pt(x0, z1, hb), B = P.pt(x1, z1, hb), C = P.pt(x1, z1, ht), D = P.pt(x0, z1, ht);
  const E = P.pt(x0, z0, ht), F = P.pt(x1, z0, ht), G = P.pt(x0, z0, hb), Hh = P.pt(x1, z0, hb);
  if (c.left && P.xcam < x0) poly(ctx, [G, A, D, E], c.left);
  if (c.right && P.xcam > x1) poly(ctx, [B, Hh, F, C], c.right);
  if (c.top) poly(ctx, [D, C, F, E], c.top);
  if (c.front) poly(ctx, [A, B, C, D], c.front);
  if (c.edge) {
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = Math.max(0.6, P.s(z1) * 0.025);
    ctx.beginPath(); ctx.moveTo(D.x, D.y); ctx.lineTo(C.x, C.y); ctx.stroke();
  }
  return { x0: Math.min(A.x, G.x, E.x), x1: Math.max(B.x, Hh.x, F.x), y0: Math.min(E.y, F.y, D.y), y1: Math.max(A.y, B.y), front: { A, B, C, D } };
}

/**
 * Trải thảm sàn (texture nhìn từ trên xuống) theo phối cảnh: mỗi dải ngang màn hình ứng với một độ sâu z,
 * cắt đúng một hàng của texture rồi kéo giãn theo s(z). tex: { canvas, x0, x1, z0, z1, scale (px texture / ô) }.
 * ctx đang ở hệ px thiết bị (không transform). step: bề cao mỗi dải (px thiết bị).
 */
export function drawFloor(ctx, P, tex, dpr, yTop, yBottom, step = 2) {
  const y0 = Math.max(Math.floor(yTop * dpr), Math.floor(P.Yf * dpr));
  const y1 = Math.ceil(yBottom * dpr);
  const tw = tex.canvas.width, th = tex.canvas.height;
  for (let yd = y0; yd < y1; yd += step) {
    const yc = (yd + step / 2) / dpr;
    const z = (yc - P.Yf) / P.k;
    const ty = (z - tex.z0) * tex.scale;
    if (ty < 0 || ty >= th) continue;
    const sc = P.s(z);
    const dx = (P.Xc + (tex.x0 - P.xcam) * sc) * dpr;
    const dw = (tex.x1 - tex.x0) * sc * dpr;
    ctx.drawImage(tex.canvas, 0, Math.floor(ty), tw, 1, dx, yd, dw, step + 0.5);
  }
}
