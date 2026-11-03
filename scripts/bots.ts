// Bot giả người xem (QA / thử tải): vào rạp, đi lại, ngồi ghế, nhảy, chat, thả emoji.
//   npx tsx scripts/bots.ts --url ws://localhost:3399/ws --n 20 [--video aqz-KE-bpKQ] [--seconds 0 (= chạy mãi)] [--room bien]
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { ACTIONS, HALL, HOME, LIMITS, REACTIONS, SEATS, SPEED, moveWithCollision, randomLook, spawnPoint } from '../public/js/shared/hall.js';

export interface BotOpts {
  url: string; n: number; video?: string; seconds?: number;
  /** id phòng / rạp (vd 'bien'); rỗng = server tự xếp */
  room?: string;
  /** giả lập mạng xấu: mỗi gói vị trí trễ ngẫu nhiên 0..jitter ms (như qua Cloudflare / 4G) */
  jitter?: number;
  /** giả lập đúng kiểu đo được trên production: gói dồn cục (xả mỗi 40–140 ms), thỉnh thoảng khựng 0,4–1,2 s rồi ùa tới */
  bunch?: boolean;
}
const NAMES = ['Minh Anh', 'Tuấn', 'Lan Chi', 'Bảo', 'Hà My', 'Khoa', 'Ngọc', 'Phúc', 'Thảo', 'Duy', 'Quỳnh', 'Hiếu', 'Trang', 'Long', 'Vy', 'Nam', 'Linh', 'Sơn', 'Mai', 'Đạt', 'Yến', 'Toàn', 'Hạnh', 'Kiên'];
const CHATS = ['Hay quá mọi người ơi 😍', 'Bài này đỉnh thật', 'Ai ngồi cạnh mình không?', 'Quẩy lên nào 🕺', 'Hahaha', 'Âm thanh chuẩn ghê', 'Chào cả rạp 👋', 'Cho bài tiếp đi', '10 điểm!', 'Nhảy chung không?'];
const rand = Math.random;

export function startBots(o: BotOpts): () => void {
  const { url, n } = o;
  const video = o.video || '';
  const seconds = o.seconds || 0;
  const socks: WebSocket[] = [];
  const cleanups: (() => void)[] = [];
  let stopped = false;
  function bot(i: number): void {
    if (stopped) return;
    const ws = new WebSocket(url);
    socks.push(ws);
    let id = 0;
    let x = HOME.x, y = HOME.y, d = 1;
    let target: { x: number; y: number } | null = null;
    const t0 = Date.now();
    const now = () => Date.now() - t0 + 1000;
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''}`, look: randomLook(), room: o.room || '', token: '', ck: '' }));
    });
    ws.on('message', (raw) => {
      let m: { t?: string; you?: number; snap?: { players?: { id: number; x: number; y: number }[] }; x?: number; y?: number; text?: string };
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t === 'welcome') {
        id = m.you ?? 0;
        const me = m.snap?.players?.find((p) => p.id === id);
        if (me) { x = me.x; y = me.y; }
        if (video && i === 0) ws.send(JSON.stringify({ t: 'q_add', url: `https://youtu.be/${video}` }));
      } else if (m.t === 'corr' && typeof m.x === 'number' && typeof m.y === 'number') { x = m.x; y = m.y; }
      else if (m.t === 'join_err') console.log(`bot ${i}: ${m.text}`);
    });
    // gửi gói (giả lập mạng xấu: trễ ngẫu nhiên — có thể đến lệch thứ tự, server bỏ gói cũ như thật)
    const jitter = o.jitter || 0;
    let held: string[] = [];
    const sendMove = (m: Record<string, unknown>): void => {
      const data = JSON.stringify(m);
      if (o.bunch) { held.push(data); return; }
      if (!jitter) { ws.send(data); return; }
      setTimeout(() => { if (ws.readyState === 1) ws.send(data); }, Math.random() * jitter);
    };
    if (o.bunch) {
      const flush = (): void => {
        if (stopped) return;
        if (ws.readyState === 1) for (const d of held) ws.send(d);
        held = [];
        const stall = Math.random() < 0.04;
        setTimeout(flush, stall ? 400 + Math.random() * 800 : 40 + Math.random() * 100);
      };
      setTimeout(flush, 100);
    }
    // đi: cùng nhịp gửi với người thật (LIMITS.sendHz); quãng đi mỗi nhịp theo thời gian thật đã trôi (như me.js) để vị trí
    // khớp đúng giờ gửi c. 1/4 bot đi 0,6× tốc độ — như người dùng điện thoại đẩy nhẹ cần analog.
    const HZ = LIMITS.sendHz;
    const speedMul = i % 4 === 3 ? 0.6 : 1;
    let lastStep = Date.now();
    const moveTimer = setInterval(() => {
      const tNow = Date.now();
      const el = Math.min(0.2, (tNow - lastStep) / 1000);
      lastStep = tNow;
      if (!id || ws.readyState !== 1) return;
      if (!target) return;
      const dx = target.x - x, dy = target.y - y, dist = Math.hypot(dx, dy);
      if (dist < 0.05) {
        target = null;
        sendMove({ t: 'move', x, y, d, c: now(), m: 0 });
        return;
      }
      const step = Math.min(dist, SPEED * speedMul * el);
      const r = moveWithCollision(x, y, (dx / dist) * step, (dy / dist) * step);
      if (Math.hypot(r.x - x, r.y - y) < 0.001) target = null;
      x = r.x; y = r.y;
      d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0;
      sendMove({ t: 'move', x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, d, c: now(), m: 1 });
    }, 1000 / HZ);
    let thinkTimer: NodeJS.Timeout | null = null;
    cleanups.push(() => { clearInterval(moveTimer); if (thinkTimer) clearTimeout(thinkTimer); });
    // quyết định: 1,5–5 s một lần
    const think = (): void => {
      if (stopped) return;
      thinkTimer = setTimeout(think, 1500 + rand() * 3500);
      if (!id || ws.readyState !== 1 || target) return;
      const r = rand();
      if (r < 0.32) {
        const s = SEATS[Math.floor(rand() * SEATS.length)];
        target = { x: s.x, y: s.y };
      } else if (r < 0.55) {
        const f = HALL.danceFloor;
        target = { x: f.x + 0.5 + rand() * (f.w - 1), y: f.y + 0.35 + rand() * (f.h - 0.7) };
      } else if (r < 0.75) {
        const a = ACTIONS[Math.floor(rand() * ACTIONS.length)];
        ws.send(JSON.stringify({ t: 'act', a: a.id, c: now() }));
      } else if (r < 0.87) {
        ws.send(JSON.stringify({ t: 'emo', e: REACTIONS[Math.floor(rand() * REACTIONS.length)] }));
      } else if (r < 0.95) {
        ws.send(JSON.stringify({ t: 'chat', text: CHATS[Math.floor(rand() * CHATS.length)] }));
      } else {
        const p = spawnPoint();
        target = p;
      }
    };
    setTimeout(think, 500 + rand() * 2000);
    ws.on('close', () => {
      clearInterval(moveTimer);
      if (thinkTimer) clearTimeout(thinkTimer);
      if (!seconds && !stopped) setTimeout(() => bot(i), 3000);
    });
    ws.on('error', () => { /* close sẽ xử lý */ });
    if (seconds) setTimeout(() => ws.close(), seconds * 1000);
  }
  for (let i = 0; i < n; i++) setTimeout(() => bot(i), i * 120);
  return () => {
    stopped = true;
    for (const c of cleanups) c();
    for (const s of socks) { try { s.terminate(); } catch { /* bỏ qua */ } }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    if (k.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1'); }
  }
  const url = args.get('url') || 'ws://localhost:3399/ws';
  const n = Number(args.get('n') || 12);
  const seconds = Number(args.get('seconds') || 0);
  startBots({ url, n, video: args.get('video') || '', seconds, room: args.get('room') || '', jitter: Number(args.get('jitter') || 0), bunch: args.has('bunch') });
  console.log(`${n} bot → ${url}`);
  if (seconds) setTimeout(() => process.exit(0), seconds * 1000 + 500);
}
