// QA hình ảnh: dựng server (YouTube GIẢ, không ghi đĩa) + bot người xem, mở Chrome headless qua CDP, vào rạp như
// người thật trên máy tính (1440×900) và điện thoại (390×844), chụp màn hình, bắt lỗi console, đo độ mượt; phòng riêng:
// chủ phòng (máy tính) tạo phòng → khách (điện thoại) mở link, nhập mật khẩu → vào phòng.
//   npm run qa -- --out <thư mục ảnh> [--bots 14] [--video aqz-KE-bpKQ] [--only desktop|mobile|smooth|private]
// Trang có nhúng trình phát YouTube thật (cần Internet); phần còn lại chạy cục bộ. Không chạy trong `npm test`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createFakeYouTube } from './fake-youtube.js';
import { startBots } from './bots.js';
import { launch, sleep, type Browser, type Page } from './cdp.js';
import { SPEED } from '../public/js/shared/hall.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1'); }
}
const outDir = resolve(args.get('out') || 'qa-shots');
const nBots = Number(args.get('bots') ?? 14);
const video = args.get('video') ?? 'aqz-KE-bpKQ';
const only = args.get('only') || ''; // 'desktop' | 'mobile' | 'smooth' (chỉ đo độ mượt, không chụp) | 'private' (phòng riêng)
const smoothSecs = Number(args.get('secs') || 15);
const room = args.get('room') || ''; // rạp cần chụp (vd 'bien'): người xem giả + trang QA vào đúng rạp đó
const roomQs = room ? `?phong=${encodeURIComponent(room)}` : '';
const jitter = Number(args.get('jitter') || 0); // giả lập mạng xấu cho người xem giả (ms)
const bunch = args.has('bunch'); // giả lập gói dồn cục + khựng như đo trên production
mkdirSync(outDir, { recursive: true });

const errors: string[] = [];
function watch(page: Page, tag: string): void {
  page.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
    errors.push(`[${tag}] exception: ${d?.exception?.description ?? d?.text}`);
  });
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'warning') return;
    const a = (p.args as { value?: unknown; description?: string }[] | undefined) ?? [];
    errors.push(`[${tag}] console.${p.type}: ${a.map((x) => String(x.value ?? x.description ?? '')).join(' ')}`);
  });
  page.on('Log.entryAdded', (p) => {
    const e = p.entry as { level?: string; text?: string; url?: string } | undefined;
    if (e && (e.level === 'error' || e.level === 'warning')) errors.push(`[${tag}] log.${e.level}: ${e.text} ${e.url ?? ''}`);
  });
}

async function key(page: Page, code: string, keyName: string, vk: number, type: 'keyDown' | 'keyUp'): Promise<void> {
  // Enter cần kèm text '\r' thì form mới tự submit (giống bấm phím thật)
  const text = type === 'keyDown' && keyName === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {};
  await page.send('Input.dispatchKeyEvent', { type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...text });
}
async function hold(page: Page, code: string, keyName: string, vk: number, ms: number): Promise<void> {
  await key(page, code, keyName, vk, 'keyDown');
  await sleep(ms);
  await key(page, code, keyName, vk, 'keyUp');
}
async function shot(page: Page, name: string): Promise<void> {
  const buf = await page.screenshot();
  writeFileSync(join(outDir, name), buf);
  console.log('📸', join(outDir, name));
}
async function waitFor(page: Page, expr: string, ms = 15000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await page.evaluate<boolean>(expr)) return true; } catch { /* trang đang tải */ }
    await sleep(150);
  }
  return false;
}

/** luật YouTube của rạp: không phần tử giao diện nào được đè lên khung video */
async function checkOverlap(page: Page, tag: string): Promise<void> {
  const bad = await page.evaluate<string[]>(`(() => {
    const slot = document.getElementById('screen-slot');
    if (!slot || slot.hidden) return [];
    const v = slot.getBoundingClientRect();
    const out = [];
    for (const id of ['hud-l', 'hud-r', 'dock', 'side', 'sheet', 'toasts', 'react-pop', 'joystick', 'user-card', 'chat-feed', 'screen-tools', 'conn', 'focus-hint']) {
      const e = document.getElementById(id);
      if (!e || e.hidden) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      for (const b of [e.getBoundingClientRect(), ...[...e.children].map((c) => c.getBoundingClientRect())]) {
        if (!b.width || !b.height) continue;
        const ox = Math.min(b.right, v.right) - Math.max(b.left, v.left), oy = Math.min(b.bottom, v.bottom) - Math.max(b.top, v.top);
        if (ox > 0.5 && oy > 0.5) { out.push(id + ' đè video ' + Math.round(ox) + '×' + Math.round(oy)); break; }
      }
    }
    return out;
  })()`);
  for (const b of bad) errors.push(`[${tag}] ${b}`);
}

/**
 * khung YouTube do rạp tự dựng (player.js buildFrame): src chỉ có gốc trang — không bao giờ mang id phòng (phong) hay địa
 * chỉ trang / trang trước (forigin, gporigin — IFrame API tự gắn khi nó tự dựng khung)
 */
async function checkIframe(page: Page, tag: string): Promise<void> {
  const expr = "(() => { const f = document.querySelector('#screen-slot iframe'); return f ? f.src : ''; })()";
  await waitFor(page, `!!${expr}`, 12000);
  const src = await page.evaluate<string>(expr);
  if (!src) { errors.push(`[${tag}] chưa có khung trình phát YouTube`); return; }
  for (const bad of ['phong', 'forigin', 'gporigin']) if (src.includes(bad)) errors.push(`[${tag}] src khung YouTube có "${bad}": ${src}`);
  if (!/[?&]enablejsapi=1/.test(src) || !/[?&]origin=/.test(src)) errors.push(`[${tag}] src khung YouTube thiếu enablejsapi / origin: ${src}`);
}

/**
 * dải nút dưới video trên điện thoại khi MỌI nút cùng hiện (🔊 Bật tiếng + ↩ Về video của rạp + ⏭ Bỏ qua ngay · ⏸ · 🚩 · ⛶):
 * nút nào cũng nằm trong màn hình (xuống hàng thay vì tràn), không đè video. Ép hiện tạm → đo → chụp → trả lại như cũ
 */
async function checkStrip(page: Page, tag: string, shotName: string): Promise<void> {
  const r = await page.evaluate<{ bad: string[]; rows: number }>(`(() => {
    const ids = ['btn-unmute', 'btn-back-room', 'tool-group', 'btn-vote', 'btn-room-pause', 'btn-report', 'btn-fs'];
    const vc = document.getElementById('vote-count');
    const was = ids.map((id) => [id, document.getElementById(id).hidden]);
    const vcText = vc.textContent;
    window.__qaStripRestore = () => { for (const [id, h] of was) document.getElementById(id).hidden = h; vc.textContent = vcText; };
    for (const id of ids) document.getElementById(id).hidden = false;
    vc.textContent = 'Bỏ qua ngay'; // nhãn dài nhất (chủ phòng)
    const slot = document.getElementById('screen-slot');
    const v = slot.getBoundingClientRect();
    const W = window.innerWidth;
    const bad = [];
    const tops = [];
    for (const id of ['btn-unmute', 'btn-back-room', 'btn-vote', 'btn-room-pause', 'btn-report', 'btn-fs']) {
      const b = document.getElementById(id).getBoundingClientRect();
      if (b.left < -0.5 || b.right > W + 0.5) bad.push(id + ' tràn màn hình ' + Math.round(b.left) + '…' + Math.round(b.right) + ' / ' + W);
      if (!slot.hidden && b.top < v.bottom - 0.5 && b.bottom > v.top + 0.5) bad.push(id + ' đè video');
      tops.push(b.top);
    }
    tops.sort((a, b) => a - b);
    const rows = tops.filter((t, i) => i === 0 || t - tops[i - 1] > 6).length;
    return { bad, rows };
  })()`);
  for (const b of r.bad) errors.push(`[${tag}] ${b}`);
  console.log(`🧪 ${tag}: dải nút dưới video ${r.rows} hàng`);
  await page.evaluate("window.dispatchEvent(new Event('pointermove'))"); // thôi "tự làm mờ các nút" để ảnh rõ
  await sleep(700);
  await shot(page, shotName);
  await checkOverlap(page, tag);
  await page.evaluate('window.__qaStripRestore?.()');
}

/** cụm nút góc trên trái phải nằm hẳn bên trái cụm phải (tên phòng dài tự rút gọn) */
async function checkHud(page: Page, tag: string): Promise<void> {
  const r = await page.evaluate<{ l: number; r: number }>(`(() => {
    const l = document.getElementById('hud-l').getBoundingClientRect(), r = document.getElementById('hud-r').getBoundingClientRect();
    return { l: l.right, r: r.left };
  })()`);
  if (!(r.l < r.r)) errors.push(`[${tag}] cụm trái (phải ${Math.round(r.l)}) chạm cụm phải (trái ${Math.round(r.r)})`);
}

async function enterCinema(page: Page, name: string): Promise<void> {
  await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
  await page.evaluate(`(() => { const i = document.getElementById('join-name'); i.value = ${JSON.stringify(name)}; document.getElementById('join-form').requestSubmit(); })()`);
  if (!(await waitFor(page, 'window.__vc.store.joined === true', 8000))) {
    errors.push(`[${name}] không vào được rạp: ${await page.evaluate<string>("document.getElementById('join-err').textContent")}`);
  }
}

/**
 * đo độ mượt của người khác: khung "khựng" khi đang đi, bước nhảy vọt, và ĐỘ ĐỀU tốc độ — tốc độ từng khung so với tốc độ
 * đi thật (SPEED; 1/4 bot đi 0,6× như cần analog đẩy nhẹ) + mức đổi tốc giữa 2 khung liền nhau. Thời gian lấy đúng mốc
 * khung vẽ đã dùng cho người đó (a.posAt) nên không lẫn nhịp rAF của trang QA.
 */
async function smoothness(page: Page, seconds = 6): Promise<unknown> {
  return page.evaluate(`new Promise((resolve) => {
    const { store } = window.__vc;
    const SPEED = ${SPEED};
    const last = new Map();
    const lastV = new Map();
    let frames = 0, moving = 0, stalls = 0, steps = [];
    const dirs = new Map(); // hướng mặt người khác lúc đang đi — phải có nhiều hướng (bắt lỗi luôn quay một phía)
    const ratios = [], dv = [];
    const deltas = [];
    const net0 = { ...store.net };
    let prevT = performance.now();
    const t0 = prevT;
    function f() {
      const now = performance.now();
      deltas.push(now - prevT); prevT = now;
      for (const a of store.players.values()) {
        if (a.isMe || !a.lastCt) continue;
        if (a.moveAmt > 0.6) dirs.set(a.dir, (dirs.get(a.dir) || 0) + 1);
        const p = last.get(a.id);
        if (p && a.moveAmt > 0.6 && a.posAt > p.t) {
          moving++;
          const d = Math.hypot(a.x - p.x, a.y - p.y);
          if (d < 1e-4) stalls++; else steps.push(d);
          const dtf = (a.posAt - p.t) / 1000;
          if (dtf > 0.004 && dtf < 0.1) {
            const v = d / dtf;
            ratios.push(v / SPEED);
            const pv = lastV.get(a.id);
            if (pv !== undefined && pv > 0.15 && v > 0.15) dv.push(Math.abs(v - pv) / Math.max(v, pv));
            lastV.set(a.id, v);
          }
        } else lastV.delete(a.id);
        last.set(a.id, { x: a.x, y: a.y, t: a.posAt });
      }
      frames++;
      if (now - t0 < ${seconds * 1000}) requestAnimationFrame(f);
      else {
        const mean = steps.reduce((s, x) => s + x, 0) / Math.max(1, steps.length);
        const sd = Math.sqrt(steps.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, steps.length));
        deltas.shift();
        const hitches = deltas.filter((d) => d > 50).length;
        const ss = [...steps].sort((p, q) => p - q);
        const med = ss.length ? ss[ss.length >> 1] : 0;
        const jumps = med ? steps.filter((x) => x > med * 4).length : 0;
        // phân bố tốc độ (× SPEED) lúc đang đi — đi đều thì dồn vào 0.9–1.1 (và 0.5–0.7 cho bot đi chậm)
        const bins = [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.1], [1.1, 1.3], [1.3, 1.7], [1.7, 99]];
        const hist = {};
        for (const [lo, hi] of bins) hist[lo + '-' + (hi > 9 ? '∞' : hi)] = ratios.length ? +(100 * ratios.filter((r) => r >= lo && r < hi).length / ratios.length).toFixed(1) : 0;
        const dvs = [...dv].sort((p, q) => p - q);
        const q95 = dvs.length ? +dvs[Math.floor(dvs.length * 0.95)].toFixed(3) : null;
        resolve({ frames, fps: Math.round(frames / ${seconds}), movingSamples: moving, stallRatio: moving ? +(stalls / moving).toFixed(3) : null,
          jumps, maxStepRatio: med ? +(ss[ss.length - 1] / med).toFixed(1) : null,
          speedHist: hist, speedChangeP95: q95, speedChangeOver15: dv.length ? +(100 * dv.filter((x) => x > 0.15).length / dv.length).toFixed(2) : null,
          dry: store.net.dry - net0.dry, holdMs: Math.round(store.net.holdMs - net0.holdMs), catchup: store.net.catchup - net0.catchup,
          dirs: Object.fromEntries(dirs),
          stepCV: steps.length ? +(sd / mean).toFixed(3) : null, hitches, buffer: Math.round(store.net.buffer), netFrames: store.net.frames - net0.frames,
          view: window.__vc.view() });
      }
    }
    requestAnimationFrame(f);
  })`);
}

/** bấm phần tử theo id (trong trang) */
const click = (page: Page, id: string): Promise<unknown> => page.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
/** gán chữ vào ô nhập (như người gõ) */
const fill = (page: Page, id: string, text: string): Promise<unknown> =>
  page.evaluate(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const sheetIs = (id: string): string => `!document.getElementById('sheet').hidden && !!document.getElementById(${JSON.stringify(id)})`;
/** bấm chuột vào giữa khung video (như người xem bấm dừng / phát trên trình phát YouTube) */
async function clickVideo(page: Page): Promise<void> {
  const r = await page.evaluate<{ x: number; y: number }>("(() => { const b = document.getElementById('screen-slot').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.45 }; })()");
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
}

/**
 * "Máy" của một trang QA phòng riêng (mỗi máy đã là một hồ sơ Chrome riêng — privateFlow): trước khi trang chạy đặt khoá
 * máy (vc.ck), tên / cờ "đã từng vào" theo kịch bản. Chỉ chạy lần tải đầu của tab (sessionStorage) — tải lại trang sau
 * đó giữ nguyên (thử vào lại bằng vé).
 */
async function asDevice(page: Page, ck: string, set: Record<string, string>, del: string[]): Promise<void> {
  const lines = [
    ...['vc.rt', 'vc.room', ...del].map((k) => `localStorage.removeItem(${JSON.stringify(k)});`),
    `localStorage.setItem('vc.ck', ${JSON.stringify(ck)});`,
    ...Object.entries(set).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`),
  ];
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { try { if (sessionStorage.getItem('qa-device')) return; sessionStorage.setItem('qa-device', '1'); ${lines.join(' ')} } catch {} })()`,
  });
}

/**
 * Phòng riêng (spec §3.6): chủ phòng (máy tính, tên 20 ký tự → tên phòng 30 ký tự) tạo phòng từ thẻ chào lại → thẻ mời
 * (link /#phong=p-… — id sau dấu #); khách mở link trên điện thoại 390×844 → thẻ vào chế độ phòng riêng → sai mật khẩu (báo
 * ngay trên thẻ) → đúng mật khẩu → trong phòng (ô phòng 🔒, cụm nút có ⏸, dải nút dưới video không tràn); bảng phòng của
 * chủ phòng / khách; chủ phòng dừng / phát tiếp cho cả phòng; khách rời phòng rồi mở lại link trong cùng tab (vào lại bằng
 * vé); khách bấm 🎬 rồi vào rạp chung (khung YouTube không mang id phòng); chủ phòng đổi mật khẩu, đang gõ mật khẩu mới thì
 * admin đến đứng xem (link cũ ?phong=) + khách vào lại (ô nhập giữ con trỏ; người vào sau vẫn thấy 🛡); admin vào hẳn không
 * chiếm chỗ; chủ phòng đóng phòng → mọi người về rạp chung. Mọi lúc: src khung YouTube không có phong / forigin / gporigin.
 */
async function privateFlow(base: string): Promise<void> {
  // mỗi "máy" (chủ phòng, khách, admin) một hồ sơ Chrome RIÊNG — localStorage (vc.ck, vc.rt, tên…) + cookie riêng như
  // máy thật: vé của khách không bị vé mới của chủ phòng ghi đè, cookie admin không lan sang máy khác
  const browsers: Browser[] = [];
  const devicePage = async (): Promise<Page> => { const b = await launch(); browsers.push(b); return b.newPage(); };
  try {
    await privateSteps(base, devicePage);
  } finally {
    for (const b of browsers) await b.close().catch(() => { /* bỏ qua */ });
  }
}

async function privateSteps(base: string, devicePage: () => Promise<Page>): Promise<void> {
  const OWNER = 'Chủ Phòng Tên Dài Xx'; // 20 ký tự (tối đa) → "Phòng của …" = 30 ký tự
  const GUEST = 'Khách Mời';
  const PASS = 'qa-mat-khau-1';
  const isPriv = "/^p-[a-z0-9]{10}$/.test(window.__vc.store.roomId)";
  const fail = (m: string): void => { errors.push(`[phòng riêng] ${m}`); };

  // ---- chủ phòng: máy tính, không phải admin
  const owner = await devicePage();
  watch(owner, 'priv-chủ');
  await owner.send('Page.enable'); await owner.send('Runtime.enable'); await owner.send('Log.enable');
  await asDevice(owner, 'a1'.repeat(16), { 'vc.name': OWNER, 'vc.returning': '1' }, []);
  await owner.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await owner.send('Page.navigate', { url: `${base}/` });
  await waitFor(owner, 'window.__vc && window.__vc.store.ready === true && window.__vc.store.rooms.length > 0');
  if (!(await waitFor(owner, "!document.getElementById('join-quick').hidden && !document.getElementById('jq-create').hidden", 6000))) {
    return fail('thẻ chào lại không có nút "🔒 Tạo phòng riêng"');
  }
  await sleep(500);
  await click(owner, 'jq-create');
  if (!(await waitFor(owner, sheetIs('pr-pass'), 4000))) return fail('bấm "🔒 Tạo phòng riêng" không mở tấm tạo phòng');
  await sleep(400);
  await shot(owner, 'desktop-private-create.png');
  const notes = await owner.evaluate<string>("document.querySelector('.pr-notes')?.textContent || ''");
  if (!notes.includes('Video dài tới 12 giờ') || !notes.includes('kiểm như rạp chung') || !notes.includes('Quản trị viên rạp')) {
    fail(`tấm tạo phòng ghi sai luật: ${JSON.stringify(notes)}`);
  }
  // mật khẩu quá ngắn → báo ngay trong tấm
  await fill(owner, 'pr-pass', 'abc');
  await click(owner, 'pr-go');
  if (!(await waitFor(owner, "(document.querySelector('.pr-err')?.textContent || '').includes('4–40')", 2000))) fail('mật khẩu 3 ký tự không bị báo lỗi');
  await fill(owner, 'pr-pass', PASS);
  await owner.evaluate("[...document.querySelectorAll('.pr-form .pr-chips')][0].querySelector('[data-v=\"4\"]').click()");
  await click(owner, 'pr-go');
  if (!(await waitFor(owner, `window.__vc.store.joined && ${isPriv}`, 12000))) {
    return fail(`tạo phòng không vào được phòng riêng: ${await owner.evaluate<string>("document.querySelector('.pr-err')?.textContent || document.getElementById('jq-err').textContent || ''")}`);
  }
  if (!(await waitFor(owner, sheetIs('pr-copy'), 4000))) fail('tạo phòng xong không hiện thẻ mời');
  const room = await owner.evaluate<string>('window.__vc.store.roomId');
  await sleep(800);
  await shot(owner, 'desktop-private-share.png');
  await checkOverlap(owner, 'máy tính thẻ mời');
  // link phòng riêng: id sau dấu # (không bao giờ tới máy chủ / nhật ký / YouTube), không có ?phong=
  const invite = await owner.evaluate<string>("document.querySelector('.invite-box')?.textContent || ''");
  if (!invite.includes(`/#phong=${room}`) || invite.includes('?phong=') || !invite.includes(PASS)) fail(`lời mời thiếu link #phong= / mật khẩu: ${JSON.stringify(invite)}`);
  const shareNote = await owner.evaluate<string>("[...document.querySelectorAll('#sheet-body .pr-note')].map((p) => p.textContent).join(' ')");
  if (!shareNote.includes('quản trị viên rạp khi xử lý báo cáo')) fail(`thẻ mời không nói quản trị viên rạp vào được: ${JSON.stringify(shareNote)}`);
  const addr = await owner.evaluate<string>('location.pathname + location.search + location.hash');
  if (addr !== `/#phong=${room}`) fail(`thanh địa chỉ không ghi /#phong=<phòng riêng>: ${addr}`);
  const pill = await owner.evaluate<string>("document.getElementById('room-name').textContent");
  if (!pill.startsWith('🔒')) fail(`ô phòng không ghi 🔒: ${pill}`);
  await click(owner, 'sheet-close');
  // thêm video để có nút ⏸ dưới màn hình
  await click(owner, 'btn-queue');
  await sleep(300);
  await fill(owner, 'add-input', `https://youtu.be/${video}`);
  await owner.evaluate("document.getElementById('add-form').requestSubmit()");
  if (!(await waitFor(owner, 'window.__vc.store.now !== null', 10000))) fail('chủ phòng thêm video vào phòng riêng không được');
  await click(owner, 'side-close');
  await checkIframe(owner, 'chủ phòng tạo phòng riêng');
  // tự dừng trên trình phát YouTube trong phòng riêng: GIỮ dừng (không tự phát lại — chính sách YouTube), đồng hồ phòng vẫn
  // chạy; bấm phát lại → xem tiếp đúng giờ chung
  if (await waitFor(owner, 'window.__vc.player().state === 1', 20000)) {
    await sleep(2500);
    await clickVideo(owner);
    await sleep(800);
    if ((await owner.evaluate<{ state: number }>('window.__vc.player()')).state !== 2) {
      console.log('⏭️  bấm vào video không dừng được trong Chrome headless — bỏ qua kiểm "dừng riêng"');
    } else {
      await sleep(4000);
      const st = await owner.evaluate<{ state: number }>('window.__vc.player()');
      if (st.state !== 2) fail(`dừng riêng trong phòng riêng bị tự phát lại (state ${st.state})`);
      if (await owner.evaluate<boolean>('window.__vc.store.now.paused')) fail('dừng riêng mà cả phòng bị dừng');
      await clickVideo(owner);
      if (!(await waitFor(owner, '(() => { const p = window.__vc.player(); return p.state === 1 && Math.abs(p.cur - p.target) < 1.5; })()', 6000))) {
        fail(`bấm phát lại sau khi dừng riêng không về giờ chung: ${JSON.stringify(await owner.evaluate('window.__vc.player()'))}`);
      }
    }
  } else fail('video phòng riêng không phát trên máy chủ phòng');

  // ---- khách: điện thoại, lần đầu (form), chưa có vé
  const guest = await devicePage();
  watch(guest, 'priv-khách');
  await guest.send('Page.enable'); await guest.send('Runtime.enable'); await guest.send('Log.enable');
  await asDevice(guest, 'b2'.repeat(16), {}, ['vc.returning', 'vc.name']);
  await guest.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await guest.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await guest.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await guest.send('Page.navigate', { url: `${base}/#phong=${room}` });
  await waitFor(guest, 'window.__vc && window.__vc.store.ready === true');
  if (!(await waitFor(guest, "!document.getElementById('join-form').hidden && !document.getElementById('join-pass-field').hidden", 6000))) {
    return fail('mở link phòng riêng không hiện ô mật khẩu');
  }
  await sleep(900);
  await shot(guest, 'mobile-private-join.png');
  const mode = await guest.evaluate<string>("(document.getElementById('join-venue-field').hidden ? 'ẩn-rạp ' : 'CÒN-rạp ') + document.getElementById('join-go').textContent");
  if (mode !== 'ẩn-rạp Vào phòng 🔒') fail(`form chế độ phòng riêng sai: ${mode}`);
  await fill(guest, 'join-name', GUEST);
  await fill(guest, 'join-pass', 'sai-mat-khau');
  await guest.evaluate("document.getElementById('join-form').requestSubmit()");
  if (!(await waitFor(guest, "document.getElementById('join-err').textContent.includes('Mật khẩu chưa đúng')", 8000))) {
    fail(`sai mật khẩu không báo ngay trên thẻ: "${await guest.evaluate<string>("document.getElementById('join-err').textContent")}"`);
  }
  await sleep(300);
  await shot(guest, 'mobile-private-wrong.png');
  await fill(guest, 'join-pass', `  ${PASS} `); // dán từ tin nhắn hay dính khoảng trắng
  await guest.evaluate("document.getElementById('join-form').requestSubmit()");
  if (!(await waitFor(guest, `window.__vc.store.joined && window.__vc.store.roomId === ${JSON.stringify(room)}`, 10000))) {
    return fail(`đúng mật khẩu mà không vào được: "${await guest.evaluate<string>("document.getElementById('join-err').textContent")}"`);
  }
  await sleep(3500);
  await shot(guest, 'mobile-private-room.png');
  await checkOverlap(guest, 'điện thoại trong phòng riêng');
  await checkHud(guest, 'điện thoại tên phòng 30 ký tự');
  await checkIframe(guest, 'khách vào phòng riêng bằng link #phong=');
  if ((await guest.evaluate<string>('location.pathname + location.search + location.hash')) !== `/#phong=${room}`) fail('khách trong phòng riêng: thanh địa chỉ không phải /#phong=<phòng>');
  await checkStrip(guest, 'điện thoại 390 px mọi nút dưới video', 'mobile-private-strip.png');
  const gTools = await guest.evaluate<string>(`(() => {
    const g = document.getElementById('tool-group'), p = document.getElementById('btn-room-pause');
    return (g.hidden ? 'cụm-ẩn' : 'cụm') + ' ' + (p.hidden ? 'không-⏸' : p.textContent) + ' ' + document.getElementById('room-name').textContent;
  })()`);
  if (!gTools.startsWith('cụm ⏸ 🔒')) fail(`khách trong phòng: cụm nút / ô phòng sai: ${gTools}`);
  if ((await guest.evaluate<string>("document.getElementById('room-count').textContent + '/' + document.getElementById('room-cap').textContent")) !== '2/4') {
    fail('ô phòng không ghi 2/4 người');
  }
  // khách: bảng phòng — phần phòng riêng, không có công cụ chủ phòng
  await click(guest, 'room-pill');
  await sleep(600);
  await shot(guest, 'mobile-private-rooms.png');
  await checkOverlap(guest, 'điện thoại bảng phòng riêng');
  // ô đổi mật khẩu dựng sẵn một lần (ẩn với người không phải chủ phòng) — kiểm theo hiện / ẩn, không theo có / không
  const ownerToolsShown = "(() => { const f = document.querySelector('.pr-passrow'); return !!f && !f.closest('[hidden]'); })()";
  if (await guest.evaluate<boolean>(ownerToolsShown)) fail('khách thấy công cụ chủ phòng');
  await click(guest, 'sheet-close');

  // ---- chủ phòng: bảng phòng (thành viên + công cụ)
  await click(owner, 'room-pill');
  await sleep(700);
  await shot(owner, 'desktop-private-rooms.png');
  await checkOverlap(owner, 'máy tính bảng phòng riêng (chủ phòng)');
  const members = await owner.evaluate<string>("[...document.querySelectorAll('.pr-member')].map((m) => m.textContent).join(' | ')");
  if (!members.includes(GUEST) || !(await owner.evaluate<boolean>(`${ownerToolsShown} && !!document.querySelector('.pr-kick')`))) {
    fail(`bảng phòng của chủ phòng thiếu thành viên / công cụ: ${members}`);
  }
  await click(owner, 'sheet-close');
  // dừng cho cả phòng (nút ⏸ dưới màn hình) → khách thấy ▶; phát tiếp → khách chạy lại
  await click(owner, 'btn-room-pause');
  if (!(await waitFor(guest, 'window.__vc.store.now && window.__vc.store.now.paused === true', 5000))) fail('chủ phòng bấm ⏸ mà phòng không dừng');
  else if ((await guest.evaluate<string>("document.getElementById('btn-room-pause').textContent")) !== '▶') fail('phòng đang dừng mà nút không đổi sang ▶');
  await sleep(500);
  await guest.evaluate("document.getElementById('btn-room-pause').click()");
  if (!(await waitFor(owner, 'window.__vc.store.now && window.__vc.store.now.paused === false', 5000))) fail('khách bấm ▶ mà phòng không phát tiếp');

  // ---- khách rời phòng (về rạp chung) → tấm tạo phòng khi đang xem rạp chung (video đang chạy) không đè video
  await click(guest, 'room-pill');
  await sleep(400);
  await guest.evaluate("[...document.querySelectorAll('.pr-actions .btn')].find((b) => b.textContent.includes('Rời phòng riêng'))?.click()");
  if (!(await waitFor(guest, `window.__vc.store.joined && !${isPriv}`, 6000))) fail('"🚪 Rời phòng riêng" không về rạp chung');
  if ((await guest.evaluate<string>('location.search + location.hash')).includes('phong=p-')) fail('rời phòng riêng mà thanh địa chỉ còn phong=');
  await sleep(1500);
  await click(guest, 'room-pill');
  await sleep(400);
  await guest.evaluate("document.querySelector('.pr-create-row')?.click()");
  if (!(await waitFor(guest, sheetIs('pr-pass'), 3000))) fail('bảng chọn rạp không có hàng "🔒 Tạo phòng riêng"');
  await sleep(500);
  await shot(guest, 'mobile-private-create.png');
  await checkOverlap(guest, 'điện thoại tấm tạo phòng');
  await click(guest, 'sheet-close');
  // mở lại link ngay trong tab đang mở rạp (chỉ đổi phần sau # — trang tự tải lại): vào thẳng bằng vé (không cần mật
  // khẩu) — thẻ chào lại "Đang vào phòng riêng…"
  const inRoom = `window.__vc && window.__vc.store.joined && window.__vc.store.roomId === ${JSON.stringify(room)}`;
  await guest.send('Page.navigate', { url: `${base}/#phong=${room}` });
  if (!(await waitFor(guest, inRoom, 12000))) fail('mở lại link #phong= trong tab đang mở rạp không tự vào bằng vé');
  await sleep(1500);

  // ---- khách bấm 🎬 (về trang chủ) ngay trong phòng riêng → vào một rạp chung: khung YouTube không mang id phòng riêng
  // (trước đây trang sau có document.referrer = …?phong=p-… và IFrame API gắn nó vào gporigin)
  await guest.evaluate("document.querySelector('.hud-brand').click()");
  const homeQuick = "location.hash === '' && !!window.__vc && window.__vc.store.ready && !document.getElementById('join-quick').hidden && !!document.querySelector('.jq-room:not([disabled])')";
  if (!(await waitFor(guest, homeQuick, 10000))) fail('bấm 🎬 trong phòng riêng không về thẻ chào lại');
  else {
    const ref = await guest.evaluate<string>('document.referrer');
    if (ref.includes('phong')) fail(`trang sau khi bấm 🎬 có document.referrer chứa phong: ${ref}`);
    await guest.evaluate("document.querySelector('.jq-room:not([disabled])').click()");
    if (!(await waitFor(guest, `window.__vc.store.joined && !${isPriv}`, 8000))) fail('sau khi bấm 🎬 không vào được rạp chung');
    else await checkIframe(guest, 'khách bấm 🎬 từ phòng riêng rồi vào rạp chung');
  }
  await sleep(800);

  // ---- chủ phòng đổi mật khẩu → thẻ mời mới (khách đang ở rạp chung: vé cũ hết hiệu lực)
  const PASS2 = 'mat-khau-moi-2';
  await click(owner, 'room-pill');
  await sleep(400);
  await owner.evaluate(`(() => { const i = document.querySelector('.pr-passrow input'); i.value = ${JSON.stringify(PASS2)}; document.querySelector('.pr-passrow').requestSubmit(); })()`);
  if (!(await waitFor(owner, `${sheetIs('pr-copy')} && document.querySelector('.invite-box').textContent.includes(${JSON.stringify(PASS2)})`, 8000))) {
    fail('đổi mật khẩu không hiện thẻ mời mới');
  }
  await sleep(400);
  await shot(owner, 'desktop-private-newpass.png');
  await checkOverlap(owner, 'máy tính thẻ mời sau khi đổi mật khẩu');
  await click(owner, 'sheet-close');
  await sleep(300);

  // ---- chủ phòng mở bảng phòng, đang gõ "Mật khẩu mới" thì quản trị viên đến xem / có người vào (tin 'priv'): ô nhập phải
  // giữ con trỏ + chữ (trước đây mỗi tin 'priv' gỡ ô ra khỏi trang → mất con trỏ, điện thoại cụp bàn phím)
  await click(owner, 'room-pill');
  await sleep(500);
  await owner.evaluate("(() => { window.__qaPriv = 0; window.__vc.store.on('priv', () => { window.__qaPriv++; }); const i = document.querySelector('.pr-passrow input'); i.value = ''; i.focus(); })()");
  await owner.send('Input.insertText', { text: 'abc' });
  const ownerTyping = "(() => { const i = document.querySelector('.pr-passrow input'); return !!i && document.activeElement === i; })()";

  // ---- admin mở link kiểu CŨ (?phong=p-… → tự đổi sang #phong=): đứng xem thẳng phòng riêng (không hỏi mật khẩu), chưa
  // vào hẳn → cả phòng được báo + dấu 🛡 thường trực
  const adminP = await devicePage();
  watch(adminP, 'priv-admin');
  await adminP.send('Page.enable'); await adminP.send('Runtime.enable'); await adminP.send('Log.enable');
  await asDevice(adminP, 'c3'.repeat(16), { 'vc.name': 'Người Trực', 'vc.returning': '1' }, []);
  await adminP.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await adminP.send('Page.navigate', { url: `${base}/?phong=${room}#admin=qa-local-admin` });
  await waitFor(adminP, 'window.__vc && window.__vc.store.ready === true && window.__vc.store.admin === true');
  const adminAddr = await adminP.evaluate<string>('location.pathname + location.search + location.hash');
  if (adminAddr !== `/#phong=${room}`) fail(`link cũ ?phong=p-… không tự đổi sang /#phong= (admin): ${adminAddr}`);
  const adminReady = await waitFor(adminP, "!document.getElementById('jq-pass-form').hidden && document.getElementById('jq-pass').hidden", 5000);
  if (!adminReady) fail('admin mở link phòng riêng vẫn bị hỏi mật khẩu');
  if (!(await waitFor(adminP, `window.__vc.store.roomId === ${JSON.stringify(room)} && !window.__vc.store.joined`, 4000))) fail('admin mở link không đứng xem thẳng phòng riêng');
  if (!(await waitFor(owner, "document.getElementById('chat-log').textContent.includes('Quản trị viên rạp đang xem phòng này')", 5000))) {
    fail('chủ phòng không được báo "🛡 Quản trị viên rạp đang xem phòng này." khi admin đứng xem');
  }
  if (!(await waitFor(owner, "!document.getElementById('room-adm').hidden && !!document.querySelector('#sheet-body .pr-adm')", 5000))) {
    fail('admin đứng xem phòng riêng mà chủ phòng không thấy dấu 🛡 (ô phòng / đầu bảng phòng)');
  }

  // ---- khách mở lại link bằng vé cũ → "Mật khẩu phòng đã đổi…" → nhập mật khẩu mới → vào. Vào SAU lúc admin bắt đầu đứng
  // xem: vẫn được báo + thấy dấu 🛡
  await guest.send('Page.navigate', { url: `${base}/#phong=${room}` });
  if (!(await waitFor(guest, "window.__vc && document.getElementById('jq-err').textContent.includes('Mật khẩu phòng đã đổi') && !document.getElementById('jq-pass').hidden && !document.getElementById('jq-pass-form').hidden", 12000))) {
    fail(`vé cũ (mật khẩu đã đổi) không báo trên thẻ chào lại: "${await guest.evaluate<string>("document.getElementById('jq-err').textContent")}"`);
  }
  await sleep(400);
  await shot(guest, 'mobile-private-rtold.png');
  await fill(guest, 'jq-pass', PASS2);
  await guest.evaluate("document.getElementById('jq-pass-form').requestSubmit()");
  if (!(await waitFor(guest, inRoom, 10000))) fail(`nhập mật khẩu mới trên thẻ chào lại không vào được: "${await guest.evaluate<string>("document.getElementById('jq-err').textContent")}"`);
  if (!(await waitFor(guest, "!document.getElementById('room-adm').hidden", 5000))) fail('người vào sau không thấy dấu 🛡 khi admin đang đứng xem phòng');
  if (!(await waitFor(guest, "document.getElementById('chat-log').textContent.includes('Quản trị viên rạp đang xem phòng này')", 5000))) {
    fail('người vào sau (admin đang đứng xem) không được báo "🛡 Quản trị viên rạp đang xem phòng này."');
  }
  await sleep(1200);
  await shot(guest, 'mobile-private-admin-watching.png');
  await checkHud(guest, 'điện thoại tên phòng 30 ký tự + 🛡');

  // ---- ô "Mật khẩu mới" của chủ phòng vẫn giữ con trỏ + chữ qua các lần cập nhật phòng
  const privN = await owner.evaluate<number>('window.__qaPriv || 0');
  if (privN < 1) fail('chủ phòng không nhận tin cập nhật phòng nào trong lúc gõ (kiểm giữ con trỏ không có ý nghĩa)');
  if (!(await owner.evaluate<boolean>(ownerTyping))) fail(`ô "Mật khẩu mới" của chủ phòng mất con trỏ sau ${privN} lần cập nhật phòng`);
  await owner.send('Input.insertText', { text: 'de' });
  const typed = await owner.evaluate<string>("document.querySelector('.pr-passrow input')?.value || ''");
  if (typed !== 'abcde') fail(`gõ tiếp vào ô "Mật khẩu mới" sau ${privN} lần cập nhật phòng: "${typed}" (cần "abcde")`);
  await shot(owner, 'desktop-private-admin-watching.png');
  await checkOverlap(owner, 'máy tính bảng phòng khi admin đang xem');
  await owner.evaluate("(() => { const i = document.querySelector('.pr-passrow input'); if (i) { i.value = ''; i.blur(); } })()");
  await click(owner, 'sheet-close');

  // ---- admin vào hẳn (có nhân vật): không chiếm chỗ của ai (khách vẫn thấy 2/4), dấu 🛡 vẫn còn; bảng 🛠 có tab 🔒 Phòng
  // riêng liệt kê phòng
  if (adminReady) {
    await adminP.evaluate("document.getElementById('jq-pass-form').requestSubmit()");
    if (!(await waitFor(adminP, `window.__vc.store.joined && window.__vc.store.roomId === ${JSON.stringify(room)}`, 8000))) fail('admin không vào được phòng riêng');
    else {
      await checkIframe(adminP, 'admin vào phòng riêng (mở bằng link cũ ?phong=)');
      await sleep(800);
      const cnt = await guest.evaluate<string>("document.getElementById('room-count').textContent + '/' + document.getElementById('room-cap').textContent");
      if (cnt !== '2/4') fail(`admin vào phòng riêng bị tính chỗ: ô phòng của khách ghi ${cnt} (cần 2/4)`);
      if (await guest.evaluate<boolean>("document.getElementById('room-adm').hidden")) fail('admin vào hẳn phòng mà dấu 🛡 biến mất');
    }
    await click(adminP, 'btn-admin');
    await sleep(500);
    await adminP.evaluate("[...document.querySelectorAll('.adm-tabs .btn')].find((b) => b.textContent.includes('Phòng riêng'))?.click()");
    if (!(await waitFor(adminP, `[...document.querySelectorAll('.adm-list li')].some((li) => li.textContent.includes(${JSON.stringify(room)}))`, 5000))) {
      fail('bảng admin không liệt kê phòng riêng');
    }
    await sleep(300);
    await shot(adminP, 'desktop-private-admin.png');
    await checkOverlap(adminP, 'admin tab phòng riêng');
    await click(adminP, 'sheet-close');
  }

  // ---- chủ phòng đóng phòng (xác nhận trong tấm) → cả hai về rạp chung
  await click(owner, 'room-pill');
  await sleep(500);
  await owner.evaluate("[...document.querySelectorAll('.pr-close .btn')].find((b) => b.textContent.includes('Đóng phòng'))?.click()");
  await sleep(250);
  await shot(owner, 'desktop-private-close-ask.png');
  await owner.evaluate("[...document.querySelectorAll('.pr-confirm .btn-danger')].find((b) => b.textContent.includes('Đóng phòng'))?.click()");
  if (!(await waitFor(owner, `window.__vc.store.joined && !${isPriv}`, 6000))) fail('chủ phòng đóng phòng mà không về rạp chung');
  if (!(await waitFor(guest, `window.__vc.store.joined && !${isPriv}`, 6000))) fail('phòng đóng mà khách không về rạp chung');
  await sleep(1200);
  await shot(guest, 'mobile-private-closed.png');
  await checkOverlap(guest, 'điện thoại sau khi phòng đóng');
  // link phòng đã đóng: màn vào rạp thường + dòng giải thích, thanh địa chỉ thôi #phong=
  await guest.send('Page.navigate', { url: `${base}/#phong=${room}` });
  if (!(await waitFor(guest, "window.__vc && window.__vc.store.ready && document.getElementById('jq-sub').textContent.includes('đã đóng')", 10000))) {
    fail('mở link phòng đã đóng không báo "đã đóng" trên thẻ chào lại');
  }
  if ((await guest.evaluate<string>('location.search + location.hash')).includes('phong')) fail('link phòng đã đóng: thanh địa chỉ còn phong=');
  await sleep(500);
  await shot(guest, 'mobile-private-gone.png');
  await owner.close();
  await guest.close();
  await adminP.close();
}

async function main(): Promise<void> {
  const cfg = loadConfig({ port: 0, host: '127.0.0.1', adminToken: 'qa-local-admin', persist: false, ytApiKey: 'fake', maxConnPerIp: 1000, joinsPerMinute: 100000 });
  const app = createApp(cfg, { youtube: createFakeYouTube(), dataDir: null, log: () => {} });
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://localhost:${port}`;
  const stopBots = startBots({ url: `ws://127.0.0.1:${port}/ws`, n: nBots, video, room, jitter, bunch });
  const browser = await launch();
  try {
    await sleep(2500);
    if (only === 'smooth') {
      // chỉ đo độ mượt người khác (so sánh thuật toán / mạng giả lập), không chụp ảnh
      const page = await browser.newPage();
      watch(page, 'smooth');
      await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.send('Page.navigate', { url: `${base}/${roomQs}` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
      await enterCinema(page, 'Tao Test');
      await sleep(4000);
      const sm = await smoothness(page, smoothSecs);
      console.log('🎞️  smooth', JSON.stringify(sm));
    }
    if (only !== 'mobile' && only !== 'smooth' && only !== 'private') {
      const page = await browser.newPage();
      watch(page, 'desktop');
      await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.send('Page.navigate', { url: `${base}/${roomQs}#admin=qa-local-admin` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
      await sleep(1200);
      await shot(page, 'desktop-join.png');
      await enterCinema(page, 'Tao Test');
      await sleep(3500);
      await shot(page, 'desktop.png');
      await checkIframe(page, 'desktop');
      // đi xuống sàn nhảy rồi nhảy
      await hold(page, 'KeyW', 'w', 87, 3000);
      await hold(page, 'KeyA', 'a', 65, 600);
      await key(page, 'Digit3', '3', 51, 'keyDown'); await key(page, 'Digit3', '3', 51, 'keyUp');
      await sleep(900);
      await shot(page, 'desktop-dance.png');
      await key(page, 'KeyE', 'e', 69, 'keyDown'); await key(page, 'KeyE', 'e', 69, 'keyUp');
      await sleep(500);
      await shot(page, 'desktop-wheel.png');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      await page.evaluate("document.getElementById('chat-input').focus()");
      await page.send('Input.insertText', { text: 'Chào cả rạp nha 👋' });
      await key(page, 'Enter', 'Enter', 13, 'keyDown'); await key(page, 'Enter', 'Enter', 13, 'keyUp');
      await sleep(900);
      await shot(page, 'desktop-chat.png');
      await checkOverlap(page, 'desktop');
      await page.evaluate("document.getElementById('btn-react').click()");
      await sleep(400);
      await shot(page, 'desktop-react.png');
      await checkOverlap(page, 'desktop cảm xúc');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      await page.evaluate("document.getElementById('btn-queue').click()");
      await sleep(700);
      await shot(page, 'desktop-drawer.png');
      await checkOverlap(page, 'desktop ngăn kéo');
      // 📋 và 💬 là 2 thẻ riêng: chỉ nút của thẻ đang mở sáng, chỉ khung của thẻ đó hiện
      const tabState = (): Promise<string> => page.evaluate<string>(`(() => {
        const on = (id) => document.getElementById(id).classList.contains('on') ? 1 : 0;
        const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none' ? 1 : 0;
        return 'q' + on('btn-queue') + 'c' + on('btn-chat') + ' Q' + shown('.queue-panel') + 'C' + shown('.chat-panel');
      })()`);
      const s1 = await tabState();
      if (s1 !== 'q1c0 Q1C0') errors.push(`[desktop] mở 📋: trạng thái ${s1} (cần q1c0 Q1C0 — chỉ hàng chờ)`);
      await page.evaluate("document.getElementById('btn-chat').click()");
      await sleep(400);
      const s2 = await tabState();
      if (s2 !== 'q0c1 Q0C1') errors.push(`[desktop] bấm 💬: trạng thái ${s2} (cần q0c1 Q0C1 — chỉ trò chuyện)`);
      await shot(page, 'desktop-drawer-chat.png');
      await checkOverlap(page, 'desktop thẻ trò chuyện');
      await page.evaluate("document.getElementById('btn-chat').click()");
      await sleep(400);
      if (await page.evaluate<boolean>("document.getElementById('side').classList.contains('open')")) errors.push('[desktop] bấm lại 💬 không đóng ngăn kéo');
      await page.evaluate("document.getElementById('btn-queue').click()");
      await sleep(300);
      await page.evaluate("document.getElementById('btn-queue').click()");
      await sleep(400);
      const sm = await smoothness(page, 6);
      console.log('🎞️  desktop', JSON.stringify(sm));
      const ds = (sm as { dirs?: Record<string, number> }).dirs || {};
      if (Object.values(ds).reduce((a, b) => a + b, 0) > 200 && Object.keys(ds).length < 3) errors.push(`[desktop] người khác lúc đi chỉ quay ${Object.keys(ds).join('/')} — hướng mặt không theo hướng đi`);
      console.log('▶️  player', JSON.stringify(await page.evaluate('window.__vc.player()')));
      await page.evaluate("document.getElementById('btn-admin').click()");
      await sleep(700);
      await shot(page, 'desktop-admin.png');
      await checkOverlap(page, 'desktop admin');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      await page.evaluate("document.getElementById('btn-prefs').click()");
      await sleep(700);
      await shot(page, 'desktop-prefs.png');
      await checkOverlap(page, 'desktop tùy chọn');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      // góc xem (menu 📺): rộng = video to nhất · cân = khán phòng rộng · rồi về mặc định (lớn)
      for (const v of ['rong', 'can', 'lon']) {
        await page.evaluate("document.getElementById('btn-theater').click()");
        await sleep(250);
        await page.evaluate(`document.querySelector('[data-view="${v}"]').click()`);
        await sleep(800);
        if (v !== 'lon') {
          await shot(page, `desktop-${v}.png`);
          await checkOverlap(page, `desktop góc xem ${v}`);
        }
      }
      // laptop nhỏ
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 680, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      await shot(page, 'desktop-small.png');
      await checkOverlap(page, 'desktop 1280×680');
      // chuyển rạp tại chỗ (không tải lại trang): canvas tối dần → rạp mới sáng dần
      const fromRoom = await page.evaluate<string>('window.__vc.store.roomId');
      await page.evaluate("window.__vcDoc = performance.timeOrigin; document.getElementById('room-pill').click()");
      await sleep(400);
      await page.evaluate("[...document.querySelectorAll('.room-item .btn')].find((b) => b.textContent.includes('Chuyển sang'))?.click()");
      if (!(await waitFor(page, `window.__vc.store.roomId !== ${JSON.stringify(fromRoom)} && window.__vc.store.joined`, 6000))) errors.push('[desktop] chuyển rạp tại chỗ không được');
      if (!(await page.evaluate<boolean>('window.__vcDoc === performance.timeOrigin'))) errors.push('[desktop] chuyển rạp bị tải lại trang');
      await sleep(1200);
      await shot(page, 'desktop-switched.png');
      await checkOverlap(page, 'desktop sau khi chuyển rạp');
      // mở lại trang: người đã vào rạp thấy thẻ "Chào mừng quay lại", bấm một rạp là vào luôn (khỏi đặt tên lại)
      await page.send('Page.navigate', { url: `${base}/` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true && window.__vc.store.rooms.length > 0');
      await sleep(800);
      await shot(page, 'desktop-quick.png');
      const quick = await page.evaluate<boolean>("!document.getElementById('join-quick').hidden && document.getElementById('join-form').hidden");
      if (!quick) errors.push('[desktop] mở lại trang không hiện thẻ "Chào mừng quay lại"');
      await page.evaluate("document.querySelector('.jq-room:not([disabled])').click()");
      if (!(await waitFor(page, 'window.__vc.store.joined === true', 8000))) errors.push('[desktop] bấm rạp trên thẻ chào lại không vào được');
      await page.close();
    }
    if (only !== 'desktop' && only !== 'smooth' && only !== 'private') {
      const page = await browser.newPage();
      watch(page, 'mobile');
      await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
      await page.send('Page.navigate', { url: `${base}/${roomQs}` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
      await sleep(1200);
      await shot(page, 'mobile-join.png');
      await enterCinema(page, 'Điện Thoại');
      await sleep(3500);
      await shot(page, 'mobile.png');
      await checkOverlap(page, 'mobile');
      await checkIframe(page, 'mobile');
      await page.evaluate("document.getElementById('btn-actions').click()");
      await sleep(500);
      await shot(page, 'mobile-wheel.png');
      await page.evaluate("document.querySelector('.wheel-btn:nth-child(6)').click()");
      await sleep(1200);
      await page.evaluate("document.getElementById('btn-queue').click()");
      await sleep(600);
      await shot(page, 'mobile-queue.png');
      await checkOverlap(page, 'mobile hàng chờ');
      await page.evaluate("document.getElementById('btn-chat').click()");
      await sleep(500);
      await shot(page, 'mobile-chat.png');
      await page.evaluate("document.getElementById('side-close').click()");
      await sleep(300);
      await page.evaluate("document.getElementById('btn-prefs').click()");
      await sleep(600);
      await shot(page, 'mobile-prefs.png');
      await checkOverlap(page, 'mobile tùy chọn');
      await page.evaluate("document.getElementById('sheet-close').click()");
      await sleep(300);
      const sm = await smoothness(page, 5);
      console.log('🎞️  mobile', JSON.stringify(sm));
      // điện thoại xoay ngang
      await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true });
      await sleep(900);
      await shot(page, 'mobile-land.png');
      await checkOverlap(page, 'mobile ngang');
      await page.close();
    }
    if (only === '' || only === 'private') {
      try { await privateFlow(base); } catch (e) { errors.push(`[phòng riêng] lỗi kịch bản: ${e instanceof Error ? e.message : String(e)}`); }
    }
  } finally {
    stopBots();
    await browser.close();
    await app.close();
  }
  const real = errors.filter((e) => !/youtube|ytimg|googlevideo|doubleclick|google\.com|gstatic|ERR_BLOCKED_BY_CLIENT/i.test(e));
  if (errors.length) console.log(`\n⚠️  ${errors.length} dòng lỗi / cảnh báo (${real.length} không phải của YouTube):\n${errors.slice(0, 40).join('\n')}`);
  else console.log('\n✅ Không có lỗi console');
  process.exit(real.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
