// Tạo ảnh dùng khi chia sẻ link + biểu tượng (không dùng trong giao diện), vẽ bằng code qua Chrome headless:
//   public/og-image.jpg (1200×630 — Facebook / Zalo / Messenger / Telegram / X): cảnh một rạp có người + thẻ tên rạp trên
//     màn chiếu. KHÔNG bao giờ chứa khung hình video YouTube (ẩn trình phát) — tranh / quảng cáo trong video là của chủ kênh.
//   public/screenshot-wide.jpg (1280×720), screenshot-narrow.jpg (390×844 @2×): ảnh app cho bảng cài đặt PWA
//   public/icon-512.png, icon-192.png, apple-touch-icon.png (180), icon-maskable-512.png (vùng an toàn 80 %),
//   favicon-48/32/16.png (bản vẽ đơn giản cho cỡ nhỏ), favicon.ico (16 + 32 + 48)
// Cách dùng: chạy server QA có bot trong rạp cần chụp (npx tsx scripts/qa-server.ts + npx tsx scripts/bots.ts --room
//   congvien) rồi: npm run share-images -- --url http://localhost:3399 [--room congvien] [--label cinema.vibe-coder.fun]
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, sleep } from './cdp.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1'); }
}
const url = args.get('url') || 'http://localhost:3399';
const outDir = resolve(args.get('out') || 'public');
const label = args.get('label') || 'cinema.vibe-coder.fun';
const room = args.get('room') || 'congvien'; // rạp làm ảnh chia sẻ (cảnh đẹp nhất)

/** biểu tượng: maskable = nền tràn viền + hình trong vùng an toàn 80 % (Android tự cắt tròn / bo) */
const ICON = (size: number, maskable = false) => `(() => {
  const s = ${size};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  const k = s / 512;
  x.scale(k, k);
  const bg = x.createLinearGradient(0, 0, 0, 512);
  bg.addColorStop(0, '#2a1631'); bg.addColorStop(1, '#0e0b12');
  x.fillStyle = bg;
  if (${maskable}) { x.fillRect(0, 0, 512, 512); x.translate(51.2, 51.2); x.scale(0.8, 0.8); }
  else { x.beginPath(); x.roundRect(0, 0, 512, 512, 112); x.fill(); }
  // diềm
  x.fillStyle = '#8c1528'; x.fillRect(40, 70, 432, 40);
  x.strokeStyle = '#e6b14a'; x.lineWidth = 10;
  x.beginPath(); x.moveTo(40, 110); for (let i = 0; i < 4; i++) x.quadraticCurveTo(40 + i * 108 + 54, 150, 40 + (i + 1) * 108, 110); x.stroke();
  // màn chiếu sáng
  const sc = x.createLinearGradient(0, 150, 0, 360);
  sc.addColorStop(0, '#dbe7ff'); sc.addColorStop(1, '#8fb3ff');
  x.fillStyle = '#05040a'; x.beginPath(); x.roundRect(112, 142, 288, 196, 14); x.fill();
  x.fillStyle = sc; x.beginPath(); x.roundRect(124, 154, 264, 172, 8); x.fill();
  // nút play vàng
  x.fillStyle = '#ffc14d'; x.beginPath(); x.moveTo(232, 196); x.lineTo(232, 284); x.lineTo(304, 240); x.closePath(); x.fill();
  // rèm hai bên
  for (const side of [0, 1]) {
    x.save();
    if (side) { x.translate(512, 0); x.scale(-1, 1); }
    const g = x.createLinearGradient(40, 0, 130, 0);
    g.addColorStop(0, '#5a0a16'); g.addColorStop(0.5, '#c42a40'); g.addColorStop(1, '#7a0f20');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(40, 100); x.lineTo(132, 100); x.quadraticCurveTo(92, 260, 124, 420); x.lineTo(40, 420); x.closePath(); x.fill();
    x.fillStyle = '#e6b14a'; x.beginPath(); x.arc(110, 300, 14, 0, Math.PI * 2); x.fill();
    x.restore();
  }
  // hàng ghế
  for (let i = 0; i < 5; i++) { x.fillStyle = '#a3192f'; x.beginPath(); x.roundRect(86 + i * 70, 398, 58, 52, 14); x.fill(); x.fillStyle = '#c92a44'; x.fillRect(92 + i * 70, 398, 46, 12); }
  return c.toDataURL('image/png').split(',')[1];
})()`;

/** favicon cỡ nhỏ (16–48 px): hình đơn giản cho rõ nét — nền tím, màn chiếu sáng, nút play vàng, hai mép rèm đỏ */
const FAVICON = (size: number) => `(() => {
  const s = ${size};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  x.scale(s / 64, s / 64);
  x.fillStyle = '#1c1022'; x.beginPath(); x.roundRect(0, 0, 64, 64, 14); x.fill();
  x.fillStyle = '#c42a40'; x.fillRect(4, 8, 8, 48); x.fillRect(52, 8, 8, 48);
  const sc = x.createLinearGradient(0, 12, 0, 50); sc.addColorStop(0, '#e2ecff'); sc.addColorStop(1, '#8fb3ff');
  x.fillStyle = sc; x.beginPath(); x.roundRect(13, 13, 38, 30, 4); x.fill();
  x.fillStyle = '#ffc14d'; x.beginPath(); x.moveTo(27, 20); x.lineTo(27, 36); x.lineTo(40, 28); x.closePath(); x.fill();
  x.fillStyle = '#a3192f'; for (let i = 0; i < 4; i++) { x.beginPath(); x.roundRect(10 + i * 11.5, 48, 9, 8, 2); x.fill(); }
  return c.toDataURL('image/png').split(',')[1];
})()`;

/** gói nhiều PNG thành một favicon.ico (định dạng ICO chứa PNG — mọi trình duyệt hiện đại + Google đọc được) */
function icoFromPngs(pngs: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o); dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(p.data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
  });
  return Buffer.concat([head, dir, ...pngs.map((p) => p.data)]);
}

/** thẻ tên rạp đặt lên ô màn chiếu (thay trình phát YouTube); compact = ảnh điện thoại */
const TITLE_CARD = (compact: boolean) => `(() => {
  const L = window.__vc.view().layout;
  const s = L.screen;
  document.getElementById('vc-card')?.remove();
  const card = document.createElement('div');
  card.id = 'vc-card';
  card.style.cssText = 'position:absolute;z-index:9;left:' + s.x + 'px;top:' + s.y + 'px;width:' + s.w + 'px;height:' + s.h + 'px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:' + (${compact} ? 4 : 10) + 'px;background:radial-gradient(circle at 50% 38%,#33215a,#100b1c 72%);color:#f4effa;font-family:"Be Vietnam Pro",sans-serif;text-align:center;padding:0 4%';
  document.getElementById('stage').append(card);
  // mỗi dòng đúng 1 dòng: không xuống dòng, chữ to quá khung thì thu nhỏ dần cho vừa (ảnh chia sẻ không bị chữ rớt dòng)
  const maxW = s.w * 0.92;
  const line = (text, size, css) => {
    const d = document.createElement('div');
    d.textContent = text;
    let fs = Math.round(s.h * size);
    d.style.cssText = 'font-size:' + fs + 'px;line-height:1.2;white-space:nowrap;' + css;
    card.append(d);
    while (d.scrollWidth > maxW && fs > 8) { fs--; d.style.fontSize = fs + 'px'; }
  };
  line('🎬 VibeCinema', ${compact} ? 0.17 : 0.19, 'font-weight:800;letter-spacing:.5px');
  line('Rạp phim 2D xem YouTube cùng bạn bè', ${compact} ? 0.075 : 0.08, 'font-weight:700;color:#ffc14d');
  line('🎭 Nhung Đỏ · 🌳 Công Viên · 🚗 Đỗ Xe · 🏖️ Bãi Biển', ${compact} ? 0.058 : 0.06, 'color:#e6dcf5;font-weight:600');
  line('Đặt tên là vào · chat · nhảy · thả tim · miễn phí', ${compact} ? 0.052 : 0.055, 'color:#cfc6dc');
  line(${JSON.stringify(label)}, ${compact} ? 0.055 : 0.058, 'margin-top:' + (${compact} ? 4 : 8) + 'px;font-weight:800;color:#fff;background:rgba(255,79,109,.9);padding:' + (${compact} ? '2px 10px' : '5px 16px') + ';border-radius:999px');
  document.getElementById('screen-slot').hidden = true;
  return [s.w, s.h];
})()`;

/** mở rạp, chờ có người + khung cảnh hiện xong */
async function openRoom(page: Awaited<ReturnType<Awaited<ReturnType<typeof launch>>['newPage']>>, w: number, h: number, dsf: number, mobile: boolean): Promise<void> {
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile });
  await page.send('Page.navigate', { url: `${url}/?phong=${encodeURIComponent(room)}` });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await page.evaluate<boolean>(`!!(window.__vc && window.__vc.store.ready && window.__vc.store.players.size >= 4 && window.__vc.view().venue === ${JSON.stringify(room)})`)) break;
  }
  await sleep(3500); // cho bot đi lại / nhảy, khung cảnh sáng hẳn
}

async function shotJpeg(page: Awaited<ReturnType<Awaited<ReturnType<typeof launch>>['newPage']>>, file: string, quality: number): Promise<void> {
  const r = (await page.send('Page.captureScreenshot', { format: 'jpeg', quality })) as { data: string };
  writeFileSync(join(outDir, file), Buffer.from(r.data, 'base64'));
  console.log('✅', join(outDir, file), `${Math.round(Buffer.from(r.data, 'base64').length / 1024)} KB`);
}

async function main(): Promise<void> {
  const browser = await launch({ width: 1200, height: 630 });
  try {
    const page = await browser.newPage();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    // ---- biểu tượng
    await page.send('Page.navigate', { url: `${url}/chinh-sach` });
    await sleep(800);
    for (const [file, size, mask] of [['icon-512.png', 512, false], ['icon-192.png', 192, false], ['apple-touch-icon.png', 180, false], ['icon-maskable-512.png', 512, true]] as [string, number, boolean][]) {
      const b64 = await page.evaluate<string>(ICON(size, mask));
      writeFileSync(join(outDir, file), Buffer.from(b64, 'base64'));
      console.log('✅', join(outDir, file));
    }
    const fav: { size: number; data: Buffer }[] = [];
    for (const size of [16, 32, 48]) {
      const data = Buffer.from(await page.evaluate<string>(FAVICON(size)), 'base64');
      writeFileSync(join(outDir, `favicon-${size}.png`), data);
      fav.push({ size, data });
      console.log('✅', join(outDir, `favicon-${size}.png`));
    }
    writeFileSync(join(outDir, 'favicon.ico'), icoFromPngs(fav));
    console.log('✅', join(outDir, 'favicon.ico'));
    // ---- ảnh xem trước 1200×630: rạp có người, ẩn hết nút nổi (rạp tự chiếm lại chỗ), thẻ tên rạp trên màn chiếu
    const hideAll = `(() => { const st = document.createElement('style'); st.id = 'vc-hide';
      st.textContent = '.join,.boot,.hud,.dock-wrap,.side,.sheet,.chat-feed,.screen-tools,.toasts,.conn-banner,.focus-hint,.joystick{display:none!important}';
      document.head.append(st); })()`;
    const hideJoin = `(() => { const st = document.createElement('style'); st.id = 'vc-hide';
      st.textContent = '.join,.boot,.toasts,.conn-banner,.focus-hint,.side,.sheet{display:none!important} .ui-quiet .hud,.ui-quiet .dock-wrap{opacity:1!important}';
      document.head.append(st); })()`;
    await openRoom(page, 1200, 630, 1, false);
    await page.evaluate(hideAll);
    await sleep(900);
    await page.evaluate(TITLE_CARD(false));
    await sleep(600);
    await shotJpeg(page, 'og-image.jpg', 86);
    // ---- ảnh app cho bảng cài đặt PWA (giữ cụm nút + dock để thấy là app)
    await openRoom(page, 1280, 720, 1, false);
    await page.evaluate(hideJoin);
    await sleep(900);
    await page.evaluate(TITLE_CARD(false));
    await sleep(600);
    await shotJpeg(page, 'screenshot-wide.jpg', 82);
    await openRoom(page, 390, 844, 2, true);
    await page.evaluate(hideJoin);
    await sleep(900);
    await page.evaluate(TITLE_CARD(true));
    await sleep(600);
    await shotJpeg(page, 'screenshot-narrow.jpg', 80);
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
