// Smoke test toàn hệ thống (không ra Internet): dựng app thật với YouTube GIẢ + thư mục dữ liệu tạm, nối nhiều client
// WebSocket như trình duyệt, kiểm: HTTP tĩnh / chính sách / admin cookie, vào rạp, đi lại + server sửa vị trí, động tác,
// chat (lọc bậy, chặn link, giới hạn tốc độ), emoji, hàng chờ (luật YouTube, giới hạn, trùng), bỏ phiếu, hết bài, lỗi
// trình phát, báo cáo tự gỡ, admin (khoá, tắt tiếng, mời ra, cấm), nhiều phòng, rớt mạng vào lại, lưu / khôi phục.
//   npm run smoke
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { loadConfig, type Config } from '../src/config.js';
import { createApp, type App } from '../src/app.js';
import { createFakeYouTube } from './fake-youtube.js';
import { VENUES, randomLook } from '../public/js/shared/hall.js';

type Msg = Record<string, unknown> & { t: string };

const ADMIN = 'smoke-admin-token-123';
const dataDir = mkdtempSync(join(tmpdir(), 'vc-smoke-'));
const timers: NodeJS.Timeout[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => { timers.push(setTimeout(r, ms)); });

function makeCfg(over: Partial<Config> = {}): Config {
  return loadConfig({
    port: 0, host: '127.0.0.1', adminToken: ADMIN, ytApiKey: 'fake', persist: true, dataDir, roomCapacity: 8, maxRooms: 2, queueAddSeconds: 0.01, lookupsPerIpMinute: 1000,
    skipVoteRatio: 0.5, skipVoteMin: 2, reportAutoskip: 3, maxQueuePerUser: 2, maxVideoMinutes: 15, tickHz: 20,
    maxConnPerIp: 1000, joinsPerMinute: 1000, siteUrl: '', defaultVideo: '', ...over,
  });
}

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  id = 0;
  token = '';
  ck = Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16);
  closed = false;
  private waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = [];
  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (raw) => {
      let m: Msg;
      try { m = JSON.parse(String(raw)) as Msg; } catch { return; }
      this.msgs.push(m);
      for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
    });
    this.ws.on('close', () => { this.closed = true; });
    this.ws.on('error', () => { /* bỏ qua */ });
  }
  open(): Promise<void> {
    return new Promise((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
  }
  send(m: Record<string, unknown>): void { this.ws.send(JSON.stringify(m)); }
  /** chờ thông điệp thoả điều kiện (kể cả đã tới trước đó nếu since = true) */
  wait(pred: (m: Msg) => boolean, ms = 3000, since = false): Promise<Msg> {
    if (since) { const hit = this.msgs.find(pred); if (hit) return Promise.resolve(hit); }
    return new Promise((res, rej) => {
      const w = { pred, res };
      this.waiters.push(w);
      timers.push(setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(`hết giờ chờ (${pred.toString().slice(0, 120)})`)); } }, ms));
    });
  }
  waitT(t: string, ms = 3000, extra: (m: Msg) => boolean = () => true): Promise<Msg> { return this.wait((m) => m.t === t && extra(m), ms); }
  /** rt = vé phòng riêng (khi room là phòng riêng) */
  async join(name: string, room = '', rt = ''): Promise<Msg> {
    const p = this.wait((m) => m.t === 'welcome' || m.t === 'join_err', 3000);
    this.send({ t: 'join', name, look: randomLook(), room, token: this.token, ck: this.ck, ...(rt ? { rt } : {}) });
    const m = await p;
    if (m.t === 'welcome') { this.id = m.you as number; this.token = m.token as string; }
    return m;
  }
  close(): void { try { this.ws.close(); } catch { /* bỏ qua */ } }
}

/** chờ tới khi client đã nhận ít nhất n thông điệp thoả điều kiện (tính cả thông điệp đã tới) */
async function waitCount(c: Client, pred: (m: Msg) => boolean, n: number, ms = 5000): Promise<Msg[]> {
  const t0 = Date.now();
  for (;;) {
    const hits = c.msgs.filter(pred);
    if (hits.length >= n) return hits;
    if (Date.now() - t0 > ms) throw new Error(`hết giờ chờ: mới có ${hits.length}/${n} thông điệp`);
    await sleep(20);
  }
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  await fn();
  passed++;
  console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
}

async function main(): Promise<void> {
  const youtube = createFakeYouTube();
  let app: App = createApp(makeCfg(), { youtube, dataDir, log: () => {} });
  let port = await app.listen(0, '127.0.0.1');
  let http = `http://127.0.0.1:${port}`;
  let wsUrl = `ws://127.0.0.1:${port}/ws`;
  const all: Client[] = [];
  let ipN = 0;
  // mỗi client một IP giả (như người xem khác nhau, qua header X-Real-IP mà nginx ghi ở production)
  const connect = async (headers: Record<string, string> = {}, query = ''): Promise<Client> => {
    const c = new Client(wsUrl + query, { 'x-real-ip': `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`, ...headers });
    all.push(c);
    await c.open();
    await c.wait((m) => m.t === 'hello', 2000, true);
    return c;
  };
  console.log('🎬 smoke VibeCinema');

  // ------------------------------------------------------------ HTTP
  await step('HTTP: trang chủ có phiên bản tài nguyên + CSP, trang chính sách, chặn file lạ', async () => {
    const r = await fetch(`${http}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /src="\/v\/[0-9a-f]{12}\/js\/main\.js"/);
    assert.ok(!html.includes('%SITE_URL%'));
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-src https:\/\/www\.youtube\.com/);
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const ver = /\/v\/([0-9a-f]{12})\//.exec(html)![1];
    const js = await fetch(`${http}/v/${ver}/js/main.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('cache-control') ?? '', /immutable/);
    assert.equal((await fetch(`${http}/chinh-sach`)).status, 200);
    assert.match(await (await fetch(`${http}/chinh-sach`)).text(), /YouTube/);
    assert.equal((await fetch(`${http}/js/shared/hall.d.ts`)).status, 404);
    assert.equal((await fetch(`${http}/js/shared/hall.js`)).status, 200);
    assert.equal((await fetch(`${http}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${http}/.env`)).status, 404);
    const h = await (await fetch(`${http}/api/health`)).json() as { ok: boolean; yt: boolean };
    assert.equal(h.ok, true);
    assert.equal(h.yt, true);
    assert.equal((await fetch(`${http}/api/nope`)).status, 404);
  });

  let adminCookie = '';
  await step('Admin: sai mã 403, đúng mã → cookie HttpOnly SameSite=Strict (không chứa mã thật)', async () => {
    const bad = await fetch(`${http}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'sai-roi-nhe' }) });
    assert.equal(bad.status, 403);
    const notJson = await fetch(`${http}/api/admin/login`, { method: 'POST', body: `token=${ADMIN}` });
    assert.equal(notJson.status, 415);
    const ok = await fetch(`${http}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ADMIN }) });
    assert.equal(ok.status, 204);
    const sc = ok.headers.get('set-cookie') ?? '';
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Strict/);
    assert.ok(!sc.includes(ADMIN), 'cookie không được chứa mã admin thật');
    adminCookie = sc.split(';')[0];
    const out = await fetch(`${http}/api/admin/logout`, { method: 'POST' });
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });

  await step('WebSocket: trang khác (Origin lạ) bị từ chối', async () => {
    const ws = new WebSocket(wsUrl, { headers: { origin: 'https://evil.example' } });
    const r = await new Promise<string>((res) => { ws.on('open', () => res('open')); ws.on('error', () => res('error')); ws.on('unexpected-response', () => res('rejected')); });
    assert.notEqual(r, 'open');
  });

  // ------------------------------------------------------------ vào rạp
  const a = await connect();
  const b = await connect();
  await step('hello: người đứng xem nhận phòng + cài đặt, không phải admin', async () => {
    const h = a.msgs.find((m) => m.t === 'hello')!;
    assert.equal(h.admin, false);
    assert.equal((h.rooms as unknown[]).length, VENUES.length, 'mỗi rạp một phòng chính');
    assert.equal(h.room, 'nhung');
    assert.equal((h.cfg as { maxVideoMin: number }).maxVideoMin, 15);
  });
  await step('vào rạp: tên sai bị từ chối, tên đúng nhận welcome, người khác thấy pj', async () => {
    assert.equal((await a.join('A')).t, 'join_err');
    assert.equal((await a.join('admin')).code, 'name');
    const pj = b.waitT('pj');
    const w = await a.join('Hào');
    assert.equal(w.t, 'welcome');
    assert.equal(((await pj).p as { name: string }).name, 'Hào');
    const dup = await b.join('hao');
    assert.equal(dup.code, 'name_taken');
    assert.equal((await b.join('Bống')).t, 'welcome');
  });

  // ------------------------------------------------------------ di chuyển
  await step('di chuyển: hợp lệ → frame cho người khác (giữ giờ máy người đi)', async () => {
    const me = (b.msgs.find((m) => m.t === 'welcome')!.snap as { players: { id: number; x: number; y: number }[] }).players.find((p) => p.id === b.id)!;
    await sleep(300);
    const f = a.wait((m) => m.t === 'f' && (m.p as number[][]).some((e) => e[0] === b.id && e[4] === 5000));
    b.send({ t: 'move', x: me.x, y: me.y - 0.5, d: 1, c: 5000, m: 1 });
    const e = ((await f).p as number[][]).find((x) => x[0] === b.id)!;
    assert.ok(Math.abs(e[2] - (me.y - 0.5)) < 0.02);
  });
  await step('di chuyển: đi nhanh quá / vào tường → server sửa (corr) về chỗ đi được', async () => {
    const corr = b.waitT('corr');
    b.send({ t: 'move', x: 16, y: 1.5, d: 1, c: 5050, m: 1 }); // nhảy cóc nửa rạp trong 50 ms
    const c1 = await corr;
    assert.ok((c1.y as number) > 5, `server phải kéo lại, được y=${c1.y}`);
    await sleep(400);
    const corr2 = b.waitT('corr');
    b.send({ t: 'move', x: 0.2, y: c1.y as number, d: 2, c: 5600, m: 1 }); // vào tường trái
    const c2 = await corr2;
    assert.ok((c2.x as number) >= 1.3);
  });

  // ------------------------------------------------------------ động tác
  await step('động tác: là sự kiện (act) + đi thì server tự bỏ động tác', async () => {
    const ev = a.waitT('act', 2000, (m) => m.id === b.id);
    b.send({ t: 'act', a: 'hiphop', c: 6000 });
    const m = await ev;
    assert.equal(m.a, 'hiphop');
    assert.equal(m.c, 6000);
    const c3 = await connect();
    const snap = (c3.msgs.find((x) => x.t === 'hello')!.snap as { players: { id: number; a: string; ae: number }[] }).players.find((p) => p.id === b.id)!;
    assert.equal(snap.a, 'hiphop');
    c3.close();
    await sleep(250);
    b.send({ t: 'move', x: 16, y: 9.9, d: 0, c: 7000, m: 1 });
    await sleep(150);
    const c4 = await connect();
    const snap2 = (c4.msgs.find((x) => x.t === 'hello')!.snap as { players: { id: number; a: string }[] }).players.find((p) => p.id === b.id)!;
    assert.equal(snap2.a, '');
    c4.close();
  });

  // ------------------------------------------------------------ chat + emoji
  await step('chat: phát cho cả phòng, che từ bậy, chặn link, chặn lặp', async () => {
    const got = a.waitT('chat');
    b.send({ t: 'chat', text: 'phim hay vl' });
    assert.equal(((await got).m as { text: string }).text, 'phim hay ***');
    const n1 = b.waitT('notice');
    b.send({ t: 'chat', text: 'vào shopee.vn mua đi' });
    assert.match((await n1).text as string, /link/);
    await sleep(700);
    const n2 = b.waitT('notice');
    b.send({ t: 'chat', text: 'phim hay vl' });
    assert.match((await n2).text as string, /lặp/);
  });
  await step('chat: gửi dồn dập bị chặn rồi tự tắt tiếng 2 phút', async () => {
    const loud = await connect();
    assert.equal((await loud.join('Ồn Ào')).t, 'welcome');
    const slow = loud.waitT('notice', 2000, (m) => /Chậm lại/.test(m.text as string));
    const muted = loud.waitT('notice', 2000, (m) => /tắt tiếng 2 phút/.test(m.text as string));
    for (let i = 0; i < 7; i++) loud.send({ t: 'chat', text: `tin ${i}` });
    await slow;
    await muted;
    loud.close();
  });
  await step('emoji: hợp lệ thì phát, lạ thì bỏ qua', async () => {
    const e = a.waitT('emo');
    b.send({ t: 'emo', e: '💩' });
    b.send({ t: 'emo', e: '🔥' });
    assert.equal((await e).e, '🔥');
  });

  // ------------------------------------------------------------ hàng chờ
  // (giới hạn thêm video trong test: 1 lần / 10 ms → nghỉ 25 ms giữa các lần)
  const lastNow = (c: Client): { v: string; title: string } | null => (c.msgs.filter((m) => m.t === 'now').pop()?.n as { v: string; title: string } | null) ?? null;
  const qres = async (c: Client, url: string): Promise<Msg> => { await sleep(25); const p = c.waitT('q_res', 3000); c.send({ t: 'q_add', url }); return p; };
  await step('hàng chờ: link sai / chặn nhúng / 18+ / chặn VN / quá dài / riêng tư bị từ chối kèm lý do', async () => {
    assert.match((await qres(a, 'https://vimeo.com/1234')).text as string, /không phải link video YouTube/);
    await sleep(50);
    const cases: [string, RegExp][] = [
      ['https://youtu.be/noEmbed0001', /không cho phép phát/], ['https://youtu.be/ageLimit001', /độ tuổi/],
      ['https://youtu.be/noVietnam01', /Việt Nam/], ['https://youtu.be/tooLong0001', /tối đa 15 phút/],
      ['https://youtu.be/private0001', /không công khai/i], ['https://youtu.be/missing0001', /Không tìm thấy/],
    ];
    for (const [u, re] of cases) { const r = await qres(a, u); assert.match(r.text as string, re, `${u} → ${r.text}`); }
  });
  await step('hàng chờ: thêm được → chiếu ngay (now) + giới hạn mỗi người + chống trùng', async () => {
    const nowP = b.waitT('now', 3000, (m) => !!m.n);
    const r = await qres(b, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
    assert.equal(r.ok, true, r.text as string);
    const n = (await nowP).n as { v: string; at: number; dur: number };
    assert.equal(n.v, 'jNQXAC9IVRw');
    assert.ok(n.at > Date.now(), 'giây 0 nằm sau lúc thêm (cho máy tải trình phát)');
    assert.equal((await qres(b, 'https://youtu.be/YE7VzlLtp-4')).ok, true);
    const dup = await qres(a, 'https://youtu.be/YE7VzlLtp-4');
    assert.match(dup.text as string, /đã có trong hàng chờ/);
    assert.equal((await qres(b, 'https://youtu.be/eRsGyueVLvQ')).ok, true);
    const lim = await qres(b, 'https://youtu.be/abcdefghijk');
    assert.match(lim.text as string, /chỉ được chờ 2 video/);
  });
  await step('bỏ phiếu: đủ phiếu → bài kế; người thêm bỏ qua bài mình ngay', async () => {
    const c = await connect();
    await c.join('Cún');
    const cur = (a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string }).v;
    const nextP = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== cur);
    a.send({ t: 'vote', on: true });
    c.send({ t: 'vote', on: true });
    const nx = (await nextP).n as { v: string; by: string };
    assert.notEqual(nx.v, cur);
    // bài đang chiếu do b thêm → b bỏ qua ngay
    const p2 = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== nx.v);
    b.send({ t: 'vote', on: true });
    await p2;
    c.close();
  });
  await step('thêm clip 2 giây (để kiểm hết bài ở bước admin)', async () => {
    const r = await qres(a, 'https://youtu.be/shortClip01');
    assert.equal(r.ok, true, r.text as string);
    const q = a.msgs.filter((m) => m.t === 'queue').pop()!.q as { v: string }[];
    assert.ok(q.some((x) => x.v === 'shortClip01'));
  });

  // ------------------------------------------------------------ admin
  const adm = await connect({ cookie: adminCookie });
  await step('admin: cookie → hello.admin = true; người thường gửi lệnh admin bị lờ', async () => {
    assert.equal(adm.msgs.find((m) => m.t === 'hello')!.admin, true);
    assert.equal((await adm.join('Chủ Rạp')).t, 'welcome');
    a.send({ t: 'adm', op: 'lock', on: true });
    await sleep(200);
    assert.equal(a.msgs.filter((m) => m.t === 'queue').pop()!.locked, false);
  });
  await step('admin: bỏ qua tới clip ngắn, clip tự hết → bài kế', async () => {
    // bỏ qua cho tới khi clip 2 giây đang chiếu
    for (let i = 0; i < 6; i++) {
      const cur = a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string } | null;
      if (cur?.v === 'shortClip01') break;
      const p = a.waitT('now', 3000);
      adm.send({ t: 'adm', op: 'skip' });
      await p;
    }
    assert.equal((a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string }).v, 'shortClip01');
    const ended = await a.waitT('now', 9000, (m) => (m.n as { v: string } | null)?.v !== 'shortClip01');
    assert.ok(ended);
  });
  await step('admin: khoá hàng chờ → người thường không thêm được, admin vẫn thêm', async () => {
    const q = a.waitT('queue', 2000, (m) => m.locked === true);
    adm.send({ t: 'adm', op: 'lock', on: true });
    await q;
    const r = await qres(a, 'https://youtu.be/lockTest001');
    assert.match(r.text as string, /khoá/);
    assert.equal((await qres(adm, 'https://youtu.be/adminVid001')).ok, true);
    adm.send({ t: 'adm', op: 'lock', on: false });
    await a.waitT('queue', 2000, (m) => m.locked === false);
  });
  await step('admin: tắt tiếng → không chat được; bật lại → chat được', async () => {
    adm.send({ t: 'adm', op: 'mute', pid: b.id, minutes: 10 });
    await b.waitT('notice', 2000, (m) => /tắt tiếng/.test(m.text as string));
    await sleep(700);
    const n = b.waitT('notice', 2000, (m) => /đang bị tắt tiếng/.test(m.text as string));
    b.send({ t: 'chat', text: 'alo alo' });
    await n;
    adm.send({ t: 'adm', op: 'unmute', pid: b.id });
    await b.waitT('notice', 2000, (m) => /bật tiếng lại/.test(m.text as string));
    const got = a.waitT('chat', 2000, (m) => (m.m as { text: string }).text === 'đã được nói');
    b.send({ t: 'chat', text: 'đã được nói' });
    await got;
  });
  await step('báo cáo: 3 người báo cáo video đang chiếu → tự gỡ + chặn thêm lại', async () => {
    const extra: Client[] = [];
    for (const n of ['Rùa', 'Thỏ']) { const c = await connect(); assert.equal((await c.join(n)).t, 'welcome', n); extra.push(c); }
    let cur = a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string; title: string; adm?: boolean } | null;
    if (cur?.adm) {
      // video admin thêm: báo cáo không tự gỡ (admin được báo, tự quyết) — rồi admin bỏ qua cho bước dưới
      for (const c of [a, ...extra]) c.send({ t: 'report', kind: 'video', target: cur.v, reason: 'copyright', note: 'thử admin' });
      await assert.rejects(a.wait((m) => m.t === 'now' && (m.n as { v: string } | null)?.v !== cur!.v, 600), 'video admin không tự gỡ theo báo cáo');
      const skipped = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== cur!.v);
      adm.send({ t: 'adm', op: 'skip' });
      await skipped;
      cur = a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string; title: string; adm?: boolean } | null;
    }
    if (!cur || cur.adm) {
      const played = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v === 'reportMe001');
      assert.equal((await qres(extra[0], 'https://youtu.be/reportMe001')).ok, true);
      if (cur) { await sleep(30); adm.send({ t: 'adm', op: 'skip' }); }
      await played;
      cur = a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string; title: string };
    }
    const gone = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== cur!.v);
    for (const c of [a, ...extra]) c.send({ t: 'report', kind: 'video', target: cur.v, reason: 'copyright', note: 'thử' });
    await gone;
    const note = await adm.wait((m) => m.t === 'adm' && m.kind === 'note', 2000, true);
    assert.match(note.text as string, /báo cáo/);
    const again = await qres(a, `https://youtu.be/${cur.v}`);
    assert.match(again.text as string, /đã bị gỡ/);
    const log = readFileSync(join(dataDir, 'reports.jsonl'), 'utf8');
    assert.ok(log.includes(cur.v));
    for (const c of extra) c.close();
  });
  await step('lỗi trình phát 150 trên các máy → chuyển bài + không cho thêm lại', async () => {
    // dọn màn hình: admin bỏ qua tới khi không còn gì chiếu
    for (let i = 0; i < 12 && lastNow(a); i++) {
      const p = a.waitT('now', 3000);
      adm.send({ t: 'adm', op: 'skip' });
      await p;
    }
    assert.equal(lastNow(a), null);
    const playing = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v === 'embedFail01');
    assert.equal((await qres(adm, 'https://youtu.be/embedFail01')).ok, true);
    await playing;
    const next = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== 'embedFail01');
    a.send({ t: 'vid_err', v: 'embedFail01', code: 150 });
    b.send({ t: 'vid_err', v: 'embedFail01', code: 150 });
    await next;
    const r = await qres(b, 'https://youtu.be/embedFail01');
    assert.match(r.text as string, /không phát được/);
  });
  await step('admin: mời ra → bị đóng kết nối, 2 phút không vào lại được (theo máy, người chung mạng không bị vạ lây)', async () => {
    const victim = await connect({ 'x-real-ip': '10.9.9.9' });
    assert.equal((await victim.join('Phá Đám')).t, 'welcome');
    const k = victim.waitT('kicked');
    adm.send({ t: 'adm', op: 'kick', pid: victim.id });
    await k;
    await sleep(200);
    assert.equal(victim.closed, true);
    const again = await connect({ 'x-real-ip': '10.9.9.9' });
    again.ck = victim.ck;
    assert.equal((await again.join('Phá Đám 2')).code, 'kicked');
    again.close();
    const neighbour = await connect({ 'x-real-ip': '10.9.9.9' }); // cùng wifi, máy khác
    assert.equal((await neighbour.join('Hàng Xóm')).t, 'welcome');
    neighbour.close();
  });
  await step('admin: cấm → không vào lại được (lưu bans.json); bỏ cấm → vào được', async () => {
    const victim = await connect({ 'x-real-ip': '10.8.8.8' });
    assert.equal((await victim.join('Spam')).t, 'welcome');
    adm.send({ t: 'adm', op: 'ban', pid: victim.id, hours: 0 });
    await victim.waitT('kicked');
    const bans = JSON.parse(readFileSync(join(dataDir, 'bans.json'), 'utf8')) as { id: string; name: string }[];
    assert.equal(bans[0].name, 'Spam');
    const again = await connect({ 'x-real-ip': '10.8.8.8' });
    assert.equal((await again.join('Spam Lại')).code, 'banned');
    adm.send({ t: 'adm', op: 'unban', id: bans[0].id });
    await sleep(200);
    const ok = await again.join('Hết Cấm');
    assert.equal(ok.t, 'welcome');
    again.close();
  });
  await step('admin: gỡ hẳn video đang chiếu → chuyển bài + không ai thêm lại được', async () => {
    assert.equal((await qres(adm, 'https://youtu.be/takeDown001')).ok, true);
    for (let i = 0; i < 12 && lastNow(a)?.v !== 'takeDown001'; i++) {
      const p = a.waitT('now', 3000);
      adm.send({ t: 'adm', op: 'skip' });
      await p;
    }
    assert.equal(lastNow(a)?.v, 'takeDown001');
    const gone = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== 'takeDown001');
    adm.send({ t: 'adm', op: 'block', v: 'takeDown001' });
    await gone;
    assert.match((await qres(b, 'https://youtu.be/takeDown001')).text as string, /đã bị gỡ/);
  });
  await step('admin: state (danh sách người, báo cáo, cấm, video bị gỡ)', async () => {
    const st = adm.waitT('adm', 2000, (m) => m.kind === 'state');
    adm.send({ t: 'adm', op: 'state' });
    const s = await st;
    assert.ok(Array.isArray(s.players) && (s.players as unknown[]).length >= 2);
    assert.ok((s.blocked as unknown[]).length >= 1);
    assert.ok((s.reports as unknown[]).length >= 3);
  });

  // ------------------------------------------------------------ nhiều rạp + nhiều phòng + rớt mạng
  await step('rạp: link ?phong=bien → xem Rạp Bãi Biển; đổi sang xem rạp khác; vào đúng rạp đã chọn', async () => {
    const c = await connect({}, '?room=bien');
    const h = c.msgs.find((m) => m.t === 'hello')!;
    assert.equal(h.room, 'bien');
    assert.equal((h.snap as { venue: string }).venue, 'bien');
    const h2 = c.wait((m) => m.t === 'hello' && m.room === 'congvien', 2000);
    c.send({ t: 'spec', room: 'congvien' });
    assert.equal(((await h2).snap as { name: string }).name, 'Rạp Công Viên');
    const w = await c.join('Khách Biển', 'doxe');
    assert.equal(w.t, 'welcome');
    assert.equal(w.room, 'doxe');
    assert.equal((w.snap as { venue: string }).venue, 'doxe');
    const c2 = await connect({}, '?room=bien-7'); // bản sao không có → về phòng chính của rạp
    assert.equal(c2.msgs.find((m) => m.t === 'hello')!.room, 'bien');
    c.close();
    c2.close();
  });
  await step('vào lại ở tab mới (mất token, cùng khoá máy) → nhận lại đúng nhân vật, không báo trùng tên; đổi tên → nhân vật mới', async () => {
    const spy = await connect({}, '?room=congvien');
    const t1 = await connect();
    const w1 = await t1.join('Tab Cũ', 'congvien');
    assert.equal(w1.t, 'welcome');
    const ck = t1.ck;
    t1.close();
    await spy.waitT('pu', 2000, (m) => (m.p as { id: number; ghost: boolean }).id === w1.you && (m.p as { ghost: boolean }).ghost);
    const t2 = await connect();
    t2.ck = ck;
    const w2 = await t2.join('Tab Cũ', 'congvien');
    assert.equal(w2.t, 'welcome', 'cùng máy vào lại không được báo trùng tên');
    assert.equal(w2.you, w1.you, 'phải nhận lại đúng nhân vật cũ');
    const gone = spy.waitT('pl', 2000, (m) => m.id === w1.you);
    const t3 = await connect();
    t3.ck = ck;
    const w3 = await t3.join('Tên Mới Toanh', 'congvien');
    assert.equal(w3.t, 'welcome');
    assert.notEqual(w3.you, w1.you, 'đổi tên → nhân vật mới');
    await gone;
    spy.close(); t2.close(); t3.close();
  });
  await step('chuyển rạp tại chỗ (switch): giữ nhân vật, sang rạp mới, rạp cũ thấy rời đi; vào lại chọn rạp khác → chuyển luôn', async () => {
    const spy = await connect({}, '?room=congvien');
    const s1 = await connect();
    const w1 = await s1.join('Người Chuyển', 'congvien');
    assert.equal(w1.room, 'congvien');
    const left = spy.waitT('pl', 2000, (m) => m.id === w1.you);
    const moved = s1.wait((m) => m.t === 'welcome' && m.room === 'bien', 2000);
    s1.send({ t: 'switch', room: 'bien' });
    const w2 = await moved;
    assert.equal(w2.you, w1.you, 'giữ nguyên nhân vật');
    assert.equal((w2.snap as { venue: string }).venue, 'bien');
    await left;
    // tải lại trang (còn token) rồi bấm rạp khác trên thẻ chào lại → vào đúng rạp vừa chọn
    const tok = s1.token, ck = s1.ck;
    s1.close();
    await sleep(100);
    const s2 = await connect();
    s2.token = tok; s2.ck = ck;
    const w3 = await s2.join('Người Chuyển', 'doxe');
    assert.equal(w3.you, w1.you);
    assert.equal(w3.room, 'doxe');
    spy.close(); s2.close();
  });
  await step('đóng tab (leave) → nhân vật biến mất ngay, không kẹt lại; khách mới không chọn rạp → vào rạp đông nhất', async () => {
    const spy = await connect({}, '?room=doxe');
    const l1 = await connect();
    const w = await l1.join('Sắp Về', 'doxe');
    const gone = spy.waitT('pl', 1500, (m) => m.id === w.you);
    l1.send({ t: 'leave' });
    await gone;
    spy.close(); l1.close();
    // server riêng: 2 người ở Rạp Đỗ Xe → khách mới không chọn rạp được xếp vào Rạp Đỗ Xe (đông nhất), không phải rạp đầu danh sách
    const app3 = createApp(makeCfg({ persist: false }), { youtube, dataDir: null, log: () => {} });
    const port3 = await app3.listen(0, '127.0.0.1');
    const mk = (ip: string, q = ''): Client => new Client(`ws://127.0.0.1:${port3}/ws${q}`, { 'x-real-ip': ip });
    const ps: Client[] = [];
    try {
      for (const [i, n] of ['Đỗ Một', 'Đỗ Hai'].entries()) {
        const c = mk(`10.8.0.${i + 1}`);
        ps.push(c);
        await c.open();
        await c.wait((m) => m.t === 'hello', 2000, true);
        assert.equal((await c.join(n, 'doxe')).room, 'doxe');
      }
      const fresh = mk('10.8.0.9');
      ps.push(fresh);
      await fresh.open();
      const h = await fresh.wait((m) => m.t === 'hello', 2000, true);
      assert.equal(h.room, 'doxe', 'khách mới phải vào rạp đông nhất');
    } finally {
      for (const c of ps) c.close();
      await app3.close();
    }
  });
  await step('rạp đầy (8 người, tính cả người đang kết nối lại) → tự mở bản sao cùng rạp (nhung-2)', async () => {
    // đang có: a, b, adm (+ người vào / ra); thêm tới khi tràn
    const extra: Client[] = [];
    let room2 = false;
    for (let i = 0; i < 9 && !room2; i++) {
      const c = await connect();
      // chọn đúng Rạp Nhung Đỏ (không chọn thì server xếp sang rạp khác còn chỗ)
      const w = await c.join(`Khách ${i + 1}`, 'nhung');
      assert.equal(w.t, 'welcome');
      if (w.room === 'nhung-2') room2 = true;
      extra.push(c);
    }
    assert.ok(room2, 'phải có người được xếp sang Rạp Nhung Đỏ 2');
    const rooms = await a.wait((m) => m.t === 'rooms' && (m.rooms as unknown[]).length === VENUES.length + 1, 2500, true);
    assert.ok(rooms);
    for (const c of extra) c.close();
  });
  await step('nối lại khi server vẫn giữ socket cũ (đổi wifi ↔ 4G) → nhận lại nhân vật, socket cũ bị đóng 4002', async () => {
    const t = await connect();
    assert.equal((await t.join('Đổi Mạng')).t, 'welcome');
    const t2 = new Client(wsUrl, { 'x-real-ip': '10.7.7.7' });
    all.push(t2);
    await t2.open();
    t2.token = t.token; t2.ck = t.ck;
    const closed = new Promise<number>((res) => t.ws.once('close', (code) => res(code)));
    const w = await t2.join('Đổi Mạng');
    assert.equal(w.t, 'welcome');
    assert.equal(w.you, t.id);
    assert.equal(await closed, 4002);
    // F5: giờ máy mới bắt đầu gần 0 nhưng gói di chuyển vẫn được nhận
    const me = ((w.snap as { players: { id: number; x: number; y: number }[] }).players).find((p) => p.id === t.id)!;
    await sleep(300);
    // (có thể đang ở Phòng 2 → nghe frame của chính phòng đó qua t2)
    const seen = t2.wait((m) => m.t === 'f' && (m.p as number[][]).some((e) => e[0] === t.id && e[4] === 50), 2000);
    t2.send({ t: 'move', x: me.x + 0.3, y: me.y, d: 3, c: 50, m: 1 });
    await seen;
    t2.close();
  });
  await step('rớt mạng: người khác thấy "mất mạng"; nối lại bằng token → đúng nhân vật cũ', async () => {
    const ghost = a.waitT('pu', 2000, (m) => (m.p as { id: number; ghost: boolean }).id === b.id && (m.p as { ghost: boolean }).ghost);
    const oldId = b.id, token = b.token, ck = b.ck;
    b.ws.terminate();
    await ghost;
    const b2 = new Client(wsUrl);
    all.push(b2);
    await b2.open();
    b2.token = token; b2.ck = ck;
    const w = await b2.join('Bống');
    assert.equal(w.t, 'welcome');
    assert.equal(w.you, oldId);
  });

  // ------------------------------------------------------------ chống ngập
  await step('ngập tin nhắn → bị đóng kết nối', async () => {
    const f = await connect();
    for (let i = 0; i < 400; i++) f.send({ t: 'ping', c: i });
    await sleep(600);
    assert.equal(f.closed, true);
  });

  // ------------------------------------------------------------ lưu / khôi phục
  await step('tắt server → lưu hàng chờ; bật lại → khôi phục video đang chiếu + hàng chờ', async () => {
    assert.equal((await qres(adm, 'https://youtu.be/persist0001')).ok, true);
    const queued = a.waitT('queue', 3000, (m) => (m.q as { v: string }[]).some((q) => q.v === 'persist0002'));
    assert.equal((await qres(adm, 'https://youtu.be/persist0002')).ok, true);
    const before = (await queued).q as { v: string }[];
    for (const c of all) c.close();
    await app.close();
    const rawSaved = readFileSync(join(dataDir, 'rooms.json'), 'utf8');
    const saved = JSON.parse(rawSaved) as { rooms: { id: string; queue: { v: string }[] }[] };
    assert.ok(saved.rooms.find((r) => r.id === 'nhung')!.queue.length >= 1);
    assert.ok(!rawSaved.includes(adm.ck), 'người thêm video chỉ lưu băm khoá máy (byCkH), không lưu khoá thật');
    app = createApp(makeCfg(), { youtube, dataDir, log: () => {} });
    port = await app.listen(0, '127.0.0.1');
    http = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
    const c = await connect();
    const h = c.msgs.find((m) => m.t === 'hello')!;
    const snap = h.snap as { queue: { v: string; byId: number }[]; now: { v: string } | null };
    assert.ok(snap.now, 'phải còn video đang chiếu');
    assert.deepEqual(snap.queue.map((q) => q.v), before.map((q) => q.v).filter((v) => v !== snap.now!.v));
    // người lạ vào đầu tiên không được trùng id với chủ video cũ
    const stranger = await connect();
    const ws = await stranger.join('Người Lạ');
    assert.ok(!snap.queue.some((q) => q.byId === ws.you), 'id mới không được trùng byId của video khôi phục');
    // chủ video (cùng khoá máy) vào lại → nhận lại quyền xoá video của mình
    const owner = await connect();
    owner.ck = adm.ck;
    const wo = await owner.join('Chủ Rạp');
    assert.ok((wo.snap as { queue: { byId: number }[] }).queue.some((q) => q.byId === wo.you), 'chủ video nhận lại quyền theo khoá máy');
    c.close(); stranger.close(); owner.close();
  });

  // ------------------------------------------------------------ video mặc định (server riêng, không đụng các bước trên)
  await step('video mặc định: phòng trống → tự phát kênh trực tiếp; không bỏ phiếu được; có video mới → nhường ngay', async () => {
    const app2 = createApp(makeCfg({ persist: false, defaultVideo: 'liveNow0001', defaultIdleSeconds: 0.4 }), { youtube, dataDir: null, log: () => {} });
    const port2 = await app2.listen(0, '127.0.0.1');
    const c = new Client(`ws://127.0.0.1:${port2}/ws?room=bien`, { 'x-real-ip': '10.9.0.1' });
    try {
      await c.open();
      await c.wait((m) => m.t === 'hello', 2000, true);
      const f = await c.wait((m) => m.t === 'now' && !!(m.n as { filler?: boolean } | null)?.filler, 4000, true);
      const n = f.n as { v: string; live: boolean; title: string };
      assert.equal(n.v, 'liveNow0001');
      assert.equal(n.live, true);
      assert.equal(n.title, 'Đang phát trực tiếp');
      assert.equal((await c.join('Người Xem', 'bien')).t, 'welcome');
      const note = c.waitT('notice', 2000);
      c.send({ t: 'vote', on: true });
      assert.match((await note).text as string, /kênh mặc định/);
      const played = c.wait((m) => m.t === 'now' && (m.n as { v?: string } | null)?.v === 'jNQXAC9IVRw', 3000);
      c.send({ t: 'q_add', url: 'https://youtu.be/jNQXAC9IVRw' });
      assert.ok(!((await played).n as { filler?: boolean }).filler, 'video người xem thêm phải phát ngay, không phải video mặc định');
    } finally {
      c.close();
      await app2.close();
    }
  });

  // ------------------------------------------------------------ không có YT_API_KEY (server riêng)
  await step('không có YT_API_KEY: kiểm cơ bản bằng oEmbed → vẫn thêm được video (chưa rõ độ dài, chiếu tối đa giới hạn); người thêm báo độ dài thật → chỉnh giờ hết bài; người khác báo một mình không đủ; nhận ra live; API hết quota cũng tự kiểm cơ bản', async () => {
    type NowMsg = { v: string; unk?: boolean; dur: number; live: boolean; at: number; ends: number; qid: number };
    const ytNoKey = createFakeYouTube({ noKey: true });
    const app3 = createApp(makeCfg({ persist: false, defaultVideo: '' }), { youtube: ytNoKey, dataDir: null, log: () => {} });
    const port3 = await app3.listen(0, '127.0.0.1');
    const a = new Client(`ws://127.0.0.1:${port3}/ws`, { 'x-real-ip': '10.9.1.1' });
    const b = new Client(`ws://127.0.0.1:${port3}/ws`, { 'x-real-ip': '10.9.1.2' });
    try {
      await a.open(); await b.open();
      await a.wait((m) => m.t === 'hello', 2000, true); await b.wait((m) => m.t === 'hello', 2000, true);
      assert.equal((await a.join('Người Thêm', 'nhung')).t, 'welcome');
      assert.equal((await b.join('Người Xem', 'nhung')).t, 'welcome');
      const add = async (c: Client, id: string): Promise<{ ok: boolean; text: string }> => {
        await new Promise((res) => setTimeout(res, 40)); // giới hạn "thêm chậm thôi" (2 lần dồn, hồi 10 ms / lượt ở cấu hình test)
        const r = c.waitT('q_res', 3000);
        c.send({ t: 'q_add', url: `https://youtu.be/${id}` });
        const m = await r;
        return { ok: m.ok === true, text: String(m.text) };
      };
      const r1 = await add(a, 'noEmbed0001');
      assert.equal(r1.ok, false); assert.match(r1.text, /không cho phát trên trang khác/);
      const r2 = await add(a, 'missing0001');
      assert.equal(r2.ok, false); assert.match(r2.text, /Không tìm thấy video/);
      assert.equal(ytNoKey.calls.length, 0, 'không có key thì không gọi Data API');
      // video thường: nhận ngay, chưa rõ độ dài, giờ hết bài = giới hạn 15 phút
      const playing = b.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'jNQXAC9IVRw', 3000);
      const r3 = await add(a, 'jNQXAC9IVRw');
      assert.equal(r3.ok, true, r3.text);
      const n1 = (await playing).n as NowMsg;
      assert.equal(n1.unk, true); assert.equal(n1.dur, 0); assert.equal(n1.live, false);
      assert.ok(Math.abs(n1.ends - n1.at - 15 * 60_000) < 5000, `chiếu tối đa 15 phút, được ${n1.ends - n1.at} ms`);
      // người khác báo một mình (2 mạng đang có mặt → cần 2) → chưa đổi; người thêm báo → nhận ngay
      b.send({ t: 'vid_dur', v: 'jNQXAC9IVRw', d: 5, live: false });
      const fixed = b.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'jNQXAC9IVRw' && !(m.n as NowMsg).unk, 3000);
      await new Promise((r) => setTimeout(r, 150));
      a.send({ t: 'vid_dur', v: 'jNQXAC9IVRw', d: 19, live: false });
      const n2 = (await fixed).n as NowMsg;
      assert.equal(n2.dur, 19, 'lấy độ dài người thêm báo, không phải số người khác báo bừa');
      assert.ok(Math.abs(n2.ends - n2.at - 19_000) < 3000, `giờ hết bài theo độ dài thật, được ${n2.ends - n2.at} ms`);
      // live: người thêm (b) bỏ qua bài đang chiếu của a không được, nên a tự bỏ qua bài mình → tới bài live của b
      const r4 = await add(b, 'liveNow0001');
      assert.equal(r4.ok, true, r4.text);
      const liveNow = a.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'liveNow0001', 3000);
      a.send({ t: 'vote', on: true });
      const n3 = (await liveNow).n as NowMsg;
      assert.equal(n3.unk, true);
      const isLive = a.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'liveNow0001' && (m.n as NowMsg).live, 3000);
      b.send({ t: 'vid_dur', v: 'liveNow0001', d: 36_000, live: true });
      const n4 = (await isLive).n as NowMsg;
      assert.equal(n4.unk, undefined); assert.equal(n4.dur, 0);
      assert.ok(Math.abs(n4.ends - n4.at - 30 * 60_000) < 5000, 'live chiếu tối đa LIVE_MAX_MINUTES');
    } finally {
      a.close(); b.close();
      await app3.close();
    }
    // có key nhưng Data API hết quota → không chặn ai, tự kiểm cơ bản
    const ytQuota = createFakeYouTube({ fail: { ok: false, code: 'quota', text: 'hết quota' } });
    const app4 = createApp(makeCfg({ persist: false, defaultVideo: '' }), { youtube: ytQuota, dataDir: null, log: () => {} });
    const port4 = await app4.listen(0, '127.0.0.1');
    const c = new Client(`ws://127.0.0.1:${port4}/ws`, { 'x-real-ip': '10.9.2.1' });
    try {
      await c.open();
      await c.wait((m) => m.t === 'hello', 2000, true);
      assert.equal((await c.join('Người Xem', 'nhung')).t, 'welcome');
      const playing = c.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'eRsGyueVLvQ', 3000);
      const r = c.waitT('q_res', 3000);
      c.send({ t: 'q_add', url: 'https://youtu.be/eRsGyueVLvQ' });
      assert.equal((await r).ok, true);
      assert.equal(((await playing).n as NowMsg).unk, true);
      assert.deepEqual(ytQuota.calls, ['eRsGyueVLvQ']);
      assert.deepEqual(ytQuota.oembedCalls, ['eRsGyueVLvQ']);
    } finally {
      c.close();
      await app4.close();
    }
  });

  // ------------------------------------------------------------ video admin + điện thoại ẩn trang (server riêng)
  await step('video admin thêm: người thường không bỏ phiếu bỏ qua được; điện thoại ẩn trang → người khác thấy rời đi ngay, quay lại hiện đúng chỗ; ẩn mà đứt kết nối → bỏ luôn, không "mất mạng"; vào lại lúc đang ẩn → hiện lại', async () => {
    type P = { id: number; x: number; y: number; ghost?: boolean };
    const app5 = createApp(makeCfg({ persist: false, defaultVideo: '' }), { youtube, dataDir: null, log: () => {} });
    const port5 = await app5.listen(0, '127.0.0.1');
    const url5 = `ws://127.0.0.1:${port5}/ws`;
    const ad = new Client(url5, { 'x-real-ip': '10.9.3.1', cookie: adminCookie });
    const u1 = new Client(url5, { 'x-real-ip': '10.9.3.2' });
    const u2 = new Client(url5, { 'x-real-ip': '10.9.3.3' });
    const extra: Client[] = [];
    const roomCount = (m: Msg): number => (m.rooms as { id: string; count: number }[]).find((r) => r.id === 'nhung')?.count ?? -1;
    try {
      for (const c of [ad, u1, u2]) { await c.open(); await c.wait((m) => m.t === 'hello', 2000, true); }
      assert.equal((await ad.join('Quản Lý', 'nhung')).t, 'welcome');
      assert.equal((await u1.join('Khán Giả Một', 'nhung')).t, 'welcome');
      assert.equal((await u2.join('Khán Giả Hai', 'nhung')).t, 'welcome');
      // admin thêm video → có cờ adm; 2 người thường bỏ phiếu (bình thường là đủ) → bị từ chối, video vẫn chiếu
      const playing = u1.wait((m) => m.t === 'now' && (m.n as { v?: string } | null)?.v === 'eRsGyueVLvQ', 3000);
      ad.send({ t: 'q_add', url: 'https://youtu.be/eRsGyueVLvQ' });
      assert.equal(((await playing).n as { adm?: boolean }).adm, true);
      const note = u1.waitT('notice', 2000, (m) => /admin chọn/.test(String(m.text)));
      u1.send({ t: 'vote', on: true });
      await note;
      u2.send({ t: 'vote', on: true });
      await assert.rejects(u1.wait((m) => m.t === 'now' && (m.n as { v?: string } | null)?.v !== 'eRsGyueVLvQ', 600), 'video admin không được bị bỏ qua bằng phiếu');
      // ẩn trang (điện thoại chuyển app) → người khác nhận 'pl' ngay, số người trong phòng giảm
      const gone = u2.waitT('pl', 2000, (m) => m.id === u1.id);
      const fewer = u2.waitT('rooms', 3000, (m) => roomCount(m) === 2);
      u1.send({ t: 'away' });
      await gone; await fewer;
      // khách mới vào lúc u1 đang ẩn: không thấy u1
      const u3 = new Client(url5, { 'x-real-ip': '10.9.3.4' }); extra.push(u3);
      await u3.open();
      const hello3 = await u3.wait((m) => m.t === 'hello', 2000, true);
      assert.ok(!((hello3.snap as { players: P[] }).players.some((p) => p.id === u1.id)), 'người đang ẩn không có trong danh sách');
      // quay lại → hiện lại đúng nhân vật cũ
      const back = u2.waitT('pj', 2000, (m) => (m.p as P).id === u1.id);
      u1.send({ t: 'back' });
      assert.equal(((await back).p as P).id, u1.id);
      // ẩn rồi đứt kết nối (đóng tab từ màn đa nhiệm / hệ điều hành ngắt) → bỏ luôn, không có 'pu' "mất mạng"
      const gone2 = u2.waitT('pl', 2000, (m) => m.id === u1.id);
      u1.send({ t: 'away' });
      await gone2;
      const before = u2.msgs.length;
      const fewer2 = u2.waitT('rooms', 3000, (m) => roomCount(m) === 2);
      u1.close();
      await fewer2;
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(!u2.msgs.slice(before).some((m) => m.t === 'pu' && (m.p as P).id === u1.id), 'không hiện "mất mạng" cho người đã ẩn');
      // vào lại (socket mới, cùng token) lúc nhân vật đang ẩn → hiện lại cho người khác (pj)
      const u4 = new Client(url5, { 'x-real-ip': '10.9.3.5' }); extra.push(u4);
      await u4.open(); await u4.wait((m) => m.t === 'hello', 2000, true);
      assert.equal((await u4.join('Khán Giả Bốn', 'nhung')).t, 'welcome');
      const gone3 = u2.waitT('pl', 2000, (m) => m.id === u4.id);
      u4.send({ t: 'away' });
      await gone3;
      const u4b = new Client(url5, { 'x-real-ip': '10.9.3.5' }); extra.push(u4b);
      u4b.token = u4.token; u4b.ck = u4.ck;
      await u4b.open(); await u4b.wait((m) => m.t === 'hello', 2000, true);
      const again = u2.waitT('pj', 2000, (m) => (m.p as P).id === u4.id);
      assert.equal((await u4b.join('Khán Giả Bốn', 'nhung')).t, 'welcome');
      await again;
    } finally {
      for (const c of [ad, u1, u2, ...extra]) c.close();
      await app5.close();
    }
  });

  // ------------------------------------------------------------ phòng riêng (mỗi nhóm một server riêng)
  await privateRoomSteps(youtube, adminCookie);

  for (const c of all) c.close();
  await app.close();
  for (const t of timers) clearTimeout(t);
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`✅ smoke: ${passed} bước đạt`);
  process.exit(0);
}

// ================================================================ phòng riêng (docs/07 §20)
// Mỗi nhóm bước dựng server riêng (giới hạn nhỏ, thời gian chờ ngắn) để không đụng các bước trên và không phụ thuộc nhau.
type PrivMem = { id: number; name: string; away: boolean; ghost: boolean; adm?: boolean };
type PrivSnap = { name: string; cap: number; ownerId: number; admins?: number; members: PrivMem[] };
type SnapP = {
  id: string; venue: string; name: string; priv?: PrivSnap; queue: { v: string; qid: number; byId: number }[];
  now: { v: string; paused: boolean; filler?: boolean; at: number; ends: number; dur: number } | null;
};
const nowV = (m: Msg): string | undefined => (m.n as { v?: string } | null)?.v;
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const SHIELD = '🛡 Quản trị viên rạp đang xem phòng này.';
const isShield = (m: Msg): boolean => m.t === 'notice' && m.text === SHIELD;

async function privateRoomSteps(youtube: ReturnType<typeof createFakeYouTube>, adminCookie: string): Promise<void> {
  const apps = new Set<App>();
  const clients: Client[] = [];
  const privDir = mkdtempSync(join(tmpdir(), 'vc-smoke-priv-'));
  let ipN = 0;
  type ServeOpts = { youtube?: ReturnType<typeof createFakeYouTube>; log?: (...a: unknown[]) => void };
  const serve = async (over: Partial<Config>, dir: string | null = null, o: ServeOpts = {}): Promise<{ app: App; ws: string; http: string }> => {
    const app = createApp(makeCfg({ persist: !!dir, dataDir: dir ?? dataDir, defaultVideo: '', ...over }), {
      youtube: o.youtube ?? youtube, dataDir: dir, log: o.log ?? (() => {}),
    });
    apps.add(app);
    const port = await app.listen(0, '127.0.0.1');
    return { app, ws: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
  };
  // mỗi client một mạng (IP) riêng — và một dải mạng /24 riêng (giới hạn phòng / dải mạng không dính các bước khác) — trừ
  // khi chỉ định
  const mk = async (url: string, o: { ip?: string; admin?: boolean; query?: string } = {}): Promise<Client> => {
    ipN++;
    const c = new Client(url + (o.query ?? ''), { 'x-real-ip': o.ip ?? `10.${50 + Math.floor(ipN / 250)}.${ipN % 250}.1`, ...(o.admin ? { cookie: adminCookie } : {}) });
    clients.push(c);
    await c.open();
    await c.wait((m) => m.t === 'hello', 2000, true);
    return c;
  };
  const create = (c: Client, o: { pass?: string; cap?: number; venue?: string; name?: string } = {}): Promise<Msg> => {
    const r = c.wait((m) => m.t === 'proom_ok' || (m.t === 'proom_res' && m.code !== 'out'), 4000);
    c.send({ t: 'proom_new', pass: o.pass ?? 'matkhau1', cap: o.cap ?? 4, venue: o.venue ?? 'bien', name: o.name ?? '', ck: c.ck });
    return r;
  };
  const auth = (c: Client, room: string, pass: string): Promise<Msg> => {
    const r = c.wait((m) => (m.t === 'proom_ok' || m.t === 'proom_res' || m.t === 'proom_need') && m.room === room, 4000);
    c.send({ t: 'proom_auth', room, pass, ck: c.ck });
    return r;
  };
  /** chưa vào rạp: nhập mật khẩu → join kèm vé → đã ở trong phòng riêng. Trả vé */
  const enter = async (c: Client, room: string, pass: string, name: string): Promise<string> => {
    const ok = await auth(c, room, pass);
    assert.equal(ok.t, 'proom_ok', JSON.stringify(ok));
    const w = await c.join(name, room, ok.rt as string);
    assert.equal(w.t, 'welcome', JSON.stringify(w));
    assert.equal(w.room, room);
    return ok.rt as string;
  };
  // thao tác phòng riêng: server cho dồn 3, hồi 1 / 2 s mỗi người → client tự đợi đủ lượt rồi mới gửi
  const opTok = new Map<Client, { t: number; at: number }>();
  const op = async (c: Client, m: Record<string, unknown>): Promise<void> => {
    const s = opTok.get(c) ?? { t: 3, at: Date.now() };
    const refill = (): void => { const now = Date.now(); s.t = Math.min(3, s.t + ((now - s.at) / 1000) * 0.5); s.at = now; };
    refill();
    if (s.t < 1.05) { await sleep(Math.ceil(((1.05 - s.t) / 0.5) * 1000)); refill(); }
    s.t -= 1;
    opTok.set(c, s);
    c.send({ t: 'proom_op', ...m });
  };
  const qadd = async (c: Client, id: string): Promise<Msg> => {
    await sleep(25);
    const r = c.waitT('q_res', 3000);
    c.send({ t: 'q_add', url: `https://youtu.be/${id}` });
    return r;
  };
  const snapOf = (m: Msg): SnapP => m.snap as SnapP;
  const isPrivMsg = (pred: (p: PrivSnap) => boolean) => (m: Msg): boolean => m.t === 'priv' && pred(m.priv as PrivSnap);

  try {
    // ---------------------------------------------------------- server A: luồng chính (có video mặc định ở phòng chung)
    const A = await serve({ defaultVideo: 'liveNow0001', defaultIdleSeconds: 0.3 });
    const PASS_A = 'Xem phim tối';
    let roomA = ''; // của O: Rạp Bãi Biển, tối đa 3 người
    let roomN = ''; // của N (tạo khi chưa vào rạp)
    let roomC = ''; // của OC (lỗi trình phát, báo cáo, admin)
    const O = await mk(A.ws);
    const N = await mk(A.ws);
    const Q = await mk(A.ws); // người xem phòng chung
    const AD = await mk(A.ws, { admin: true });
    let M!: Client; // thành viên phòng A
    let rtM = '';
    let memN!: Client; // thành viên phòng N
    let OC!: Client;
    const memC: Client[] = [];

    await step('phòng riêng: tạo — kiểm dữ liệu; đã vào rạp → proom_ok rồi vào thẳng phòng; chưa vào → join kèm vé; bấm đúp → "bận"; không có trong danh sách rạp', async () => {
      assert.equal((await O.join('Chủ Phòng', 'nhung')).t, 'welcome');
      const bad: [{ pass?: string; cap?: number; venue?: string }, RegExp][] = [
        [{ pass: 'abc' }, /4–40 ký tự/], [{ pass: '   abc    ' }, /4–40 ký tự/], [{ pass: 'x'.repeat(41) }, /4–40 ký tự/],
        [{ cap: 1 }, /từ 2 đến 20/], [{ cap: 21 }, /từ 2 đến 20/], [{ venue: 'xyz' }, /rạp/],
      ];
      for (const [o, re] of bad) {
        const r = await create(O, o);
        assert.equal(r.code, 'invalid', JSON.stringify(r));
        assert.match(String(r.text), re);
      }
      const moved = O.wait((m) => m.t === 'welcome' && String(m.room).startsWith('p-'), 4000);
      const ok = await create(O, { pass: `  ${PASS_A} `, cap: 3, venue: 'bien' });
      assert.equal(ok.t, 'proom_ok', JSON.stringify(ok));
      assert.equal(ok.created, true);
      assert.match(String(ok.room), /^p-[a-z0-9]{10}$/);
      assert.equal(ok.venue, 'bien');
      assert.equal(ok.name, 'Phòng của Chủ Phòng');
      assert.match(String(ok.rt), /^[A-Za-z0-9_-]{24}$/);
      roomA = ok.room as string;
      const w = await moved;
      assert.equal(w.room, roomA);
      assert.equal(w.you, O.id, 'giữ nguyên nhân vật');
      assert.ok(O.msgs.indexOf(ok) < O.msgs.indexOf(w), 'proom_ok tới trước welcome');
      const s = snapOf(w);
      assert.equal(s.venue, 'bien');
      assert.equal(s.name, 'Phòng của Chủ Phòng');
      assert.deepEqual(s.priv, { name: 'Phòng của Chủ Phòng', cap: 3, ownerId: O.id, members: [{ id: O.id, name: 'Chủ Phòng', away: false, ghost: false }] });
      // chưa vào rạp: tên kiểm như tên nhân vật → tạo → join kèm vé (chủ phòng vào bằng khoá máy)
      const badName = await create(N, { name: 'admin', pass: 'matkhau2', cap: 2, venue: 'congvien' });
      assert.equal(badName.code, 'invalid');
      assert.match(String(badName.text), /dành cho rạp/);
      const ok2 = await create(N, { name: 'Người Mới', pass: 'matkhau2', cap: 2, venue: 'congvien' });
      assert.equal(ok2.t, 'proom_ok', JSON.stringify(ok2));
      assert.equal(ok2.name, 'Phòng của Người Mới');
      roomN = ok2.room as string;
      const w2 = await N.join('Người Mới', roomN, ok2.rt as string);
      assert.equal(w2.room, roomN);
      assert.equal(snapOf(w2).priv!.ownerId, N.id);
      // bấm đúp: lần hai trả "bận" ngay (mỗi kết nối một phép băm), chỉ một phòng được tạo
      const D = await mk(A.ws);
      const two = waitCount(D, (m) => m.t === 'proom_ok' || m.t === 'proom_res', 2);
      for (let i = 0; i < 2; i++) D.send({ t: 'proom_new', pass: 'matkhau3', cap: 2, venue: 'nhung', name: 'Bấm Đúp', ck: D.ck });
      assert.deepEqual((await two).map((m) => (m.t === 'proom_ok' ? 'ok' : m.code)).sort(), ['busy', 'ok']);
      // không có trong danh sách rạp; /api/health đếm riêng
      const h = (await mk(A.ws)).msgs.find((m) => m.t === 'hello')!;
      assert.equal((h.rooms as { id: string }[]).length, VENUES.length);
      assert.ok(!(h.rooms as { id: string }[]).some((r) => r.id.startsWith('p-')));
      const health = await (await fetch(`${A.http}/api/health`)).json() as { rooms: number; priv: number };
      assert.equal(health.priv, 3);
      assert.equal(health.rooms, VENUES.length);
    });

    await step('phòng riêng: link ?room=p-… → hello của phòng chung + proom_need; người thường không đứng xem được (spec / join không vé); id lạ → exists:false', async () => {
      const S = await mk(A.ws, { query: `?room=${roomA}` });
      const h = S.msgs.find((m) => m.t === 'hello')!;
      assert.equal(h.room, 'nhung', 'đứng xem phòng chung mặc định trong lúc nhập mật khẩu');
      assert.equal(snapOf(h).priv, undefined);
      const need = await S.wait((m) => m.t === 'proom_need', 2000, true);
      assert.deepEqual({ room: need.room, exists: need.exists }, { room: roomA, exists: true });
      const n2 = S.waitT('proom_need', 2000);
      S.send({ t: 'spec', room: roomA });
      assert.equal((await n2).exists, true);
      await assert.rejects(S.wait((m) => m.t === 'hello' && m.room === roomA, 300), 'không được đứng xem phòng riêng');
      const lost = await mk(A.ws, { query: '?room=p-zzzzzzzzzz' });
      assert.equal((await lost.wait((m) => m.t === 'proom_need', 2000, true)).exists, false);
      const n3 = S.waitT('proom_need', 2000);
      assert.equal((await S.join('Lén Nhìn', roomA)).code, 'priv_need');
      assert.equal((await n3).exists, true);
      assert.equal((await S.join('Lén Nhìn', 'p-zzzzzzzzzz')).code, 'priv_gone');
    });

    await step('phòng riêng: sai / đúng mật khẩu (gõ NFD + dính khoảng trắng vẫn đúng); vé gắn với máy; rời rồi mở lại bằng vé → vào thẳng', async () => {
      M = await mk(A.ws);
      const wrong = await auth(M, roomA, 'sai mật khẩu');
      assert.equal(wrong.code, 'bad_pass');
      assert.equal(wrong.text, 'Mật khẩu chưa đúng — xem lại tin nhắn bạn bè gửi nhé.');
      assert.equal((await auth(M, roomA, 'abc')).code, 'bad_pass');
      const ok = await auth(M, roomA, `  ${PASS_A.normalize('NFD')}  `);
      assert.equal(ok.t, 'proom_ok', JSON.stringify(ok));
      assert.equal(ok.venue, 'bien');
      assert.equal(ok.name, 'Phòng của Chủ Phòng');
      assert.equal(ok.created, undefined);
      rtM = ok.rt as string;
      const seen = O.wait(isPrivMsg((p) => p.members.length === 2), 2000);
      assert.equal((await M.join('Thành Viên', roomA, rtM)).room, roomA);
      await seen;
      // vé của máy khác (khoá máy khác) không dùng được
      const X = await mk(A.ws);
      assert.equal((await X.join('Kẻ Lạ', roomA, rtM)).code, 'priv_need');
      // rời (đóng tab) → kết nối cũ hết quyền nghe phòng, về đứng xem phòng chung; mở lại (cùng máy, vé cũ) → vào thẳng
      const backToPublic = M.wait((m) => m.t === 'hello' && m.room === 'bien', 2000);
      M.send({ t: 'leave' });
      await backToPublic;
      const M2 = await mk(A.ws);
      M2.ck = M.ck;
      const w2 = await M2.join('Thành Viên', roomA, rtM);
      assert.equal(w2.room, roomA, JSON.stringify(w2));
      M = M2;
    });

    await step('phòng riêng: 30 lần nhập mật khẩu dồn dập từ một kết nối → chỉ 1 phép băm chạy; mạng chạm 10 lần → khoá (đúng cũng phải đợi); phòng chạm 20 lần → khoá + báo chủ phòng; vé vẫn vào được', async () => {
      const O4 = await mk(A.ws);
      assert.equal((await O4.join('Chủ Phòng Bốn', 'doxe')).t, 'welcome');
      const ok = await create(O4, { pass: 'bon bon bon', cap: 4, venue: 'doxe' });
      assert.equal(ok.t, 'proom_ok');
      const r4 = ok.room as string;
      const B = await mk(A.ws);
      const burst = waitCount(B, (m) => m.t === 'proom_res' && m.room === r4, 30);
      for (let i = 0; i < 30; i++) B.send({ t: 'proom_auth', room: r4, pass: `sai ${i}`, ck: B.ck });
      const codes = (await burst).map((m) => String(m.code));
      const hashed = codes.filter((x) => x === 'bad_pass').length;
      assert.equal(codes.filter((x) => x === 'busy').length + hashed, 30, codes.join(','));
      assert.ok(hashed >= 1 && hashed <= 3, `mỗi kết nối chỉ 1 phép băm cùng lúc — đã băm ${hashed}`);
      // tiếp từng lần: tổng số lần thật sự được kiểm của mạng này dừng ở 10
      let total = hashed;
      for (let i = 0; i < 15; i++) {
        const r = await auth(B, r4, `sai nữa ${i}`);
        if (r.code === 'rate') break;
        assert.equal(r.code, 'bad_pass');
        total++;
      }
      assert.equal(total, 10, 'mỗi mạng 10 lần / 10 phút');
      const right = await auth(B, r4, 'bon bon bon');
      assert.equal(right.code, 'rate', 'đã khoá thì mật khẩu đúng cũng phải đợi (không dò tiếp được)');
      assert.equal(right.text, 'Sai nhiều lần quá — đợi 10 phút rồi thử lại nhé.');
      const B2 = await mk(A.ws); // mạng khác vẫn vào được
      const ok2 = await auth(B2, r4, 'bon bon bon');
      assert.equal(ok2.t, 'proom_ok');
      // mạng thứ ba dò tiếp: phòng chạm 20 lần → khoá phòng + chủ phòng được báo
      const B3 = await mk(A.ws);
      const warned = O4.waitT('notice', 4000, (m) => m.text === 'Có người nhập sai mật khẩu phòng nhiều lần.');
      let locked = false;
      for (let i = 0; i < 10 && !locked; i++) {
        const r = await auth(B3, r4, `dò ${i}`);
        locked = r.code === 'rate';
        if (!locked) assert.equal(r.code, 'bad_pass');
      }
      assert.ok(locked, 'phòng phải khoá khi đủ 20 lần');
      await warned;
      // vé không bao giờ bị khoá / tính lượt
      assert.equal((await B2.join('Khách Có Vé', r4, ok2.rt as string)).room, r4);
    });

    await step('phòng riêng: đủ người (tính cả người đang ẩn) → "đầy"; thành viên ẩn / hiện → cả phòng nhận priv', async () => {
      const M3 = await mk(A.ws);
      await enter(M3, roomA, PASS_A, 'Thành Viên Ba'); // 3/3
      const away = O.wait(isPrivMsg((p) => p.members.some((x) => x.name === 'Thành Viên Ba' && x.away)), 2000);
      M3.send({ t: 'away' });
      await away;
      const Y = await mk(A.ws);
      const ok = await auth(Y, roomA, PASS_A);
      assert.equal(ok.t, 'proom_ok', 'mật khẩu đúng vẫn được vé (vào được khi có chỗ)');
      const j = await Y.join('Khách Thứ Tư', roomA, ok.rt as string);
      assert.equal(j.code, 'full');
      assert.equal(j.text, 'Phòng đã đủ 3/3 người — nhờ chủ phòng tăng số người nhé.');
      const back = O.wait(isPrivMsg((p) => p.members.length === 3 && p.members.every((x) => !x.away)), 2000);
      M3.send({ t: 'back' });
      await back;
    });

    await step('phòng riêng: video dài vẫn nhận (tooLong0001 — phòng chung từ chối); không tự phát video mặc định', async () => {
      assert.equal((await Q.join('Người Ngoài', 'nhung')).t, 'welcome');
      const filler = (m: Msg): boolean => (m.t === 'now' && !!(m.n as { filler?: boolean } | null)?.filler)
        || ((m.t === 'welcome' || m.t === 'hello') && !!snapOf(m).now?.filler);
      assert.ok(Q.msgs.some(filler), 'phòng chung của server này đang phát video mặc định');
      assert.ok(!N.msgs.some((m) => m.t === 'now' && !!(m.n as { filler?: boolean } | null)?.filler), 'phòng riêng không phát video mặc định');
      assert.equal(snapOf(N.msgs.filter((m) => m.t === 'welcome').pop()!).now, null);
      const playing = M.wait((m) => m.t === 'now' && nowV(m) === 'tooLong0001', 3000);
      const r = await qadd(O, 'tooLong0001');
      assert.equal(r.ok, true, String(r.text));
      const n = (await playing).n as { dur: number; at: number; ends: number };
      assert.equal(n.dur, 7200);
      assert.ok(Math.abs(n.ends - n.at - 7200_000) < 5000, 'chiếu hết 2 tiếng');
      assert.match(String((await qadd(Q, 'tooLong0001')).text), /tối đa 15 phút/);
    });

    await step('phòng riêng: thành viên dừng / phát tiếp cho cả phòng (cả phòng thấy ai bấm); thành viên không dùng được lệnh chủ phòng', async () => {
      const paused = O.wait((m) => m.t === 'now' && (m.n as { paused?: boolean } | null)?.paused === true, 2000);
      const note1 = O.waitT('notice', 2000, (m) => m.text === '⏸ Thành Viên đã dừng video cho cả phòng');
      await op(M, { op: 'pause' });
      await paused;
      await note1;
      const resumed = O.wait((m) => m.t === 'now' && (m.n as { paused?: boolean } | null)?.paused === false, 2000);
      const note2 = O.waitT('notice', 2000, (m) => m.text === '▶ Thành Viên đã phát tiếp');
      await op(M, { op: 'resume' });
      await resumed;
      await note2;
      const denied = M.waitT('proom_res', 2000, (m) => m.code === 'denied');
      await op(M, { op: 'skip' });
      assert.equal((await denied).text, 'Chỉ chủ phòng làm được việc này.');
    });

    await step('phòng riêng: chủ phòng xoá bài / bỏ qua / đổi số người (không dưới số người đang có); không đụng được người ở phòng chung', async () => {
      assert.equal((await qadd(O, 'jNQXAC9IVRw')).ok, true);
      const queued = O.wait((m) => m.t === 'queue' && (m.q as { v: string }[]).some((q) => q.v === 'YE7VzlLtp-4'), 3000);
      assert.equal((await qadd(M, 'YE7VzlLtp-4')).ok, true);
      const qid = ((await queued).q as { v: string; qid: number }[]).find((q) => q.v === 'YE7VzlLtp-4')!.qid;
      const removed = M.wait((m) => m.t === 'queue' && !(m.q as { v: string }[]).some((q) => q.v === 'YE7VzlLtp-4'), 2000);
      await op(O, { op: 'remove', qid });
      await removed;
      const skipped = M.wait((m) => m.t === 'now' && nowV(m) === 'jNQXAC9IVRw', 2000);
      const note = M.waitT('notice', 2000, (m) => m.text === '⏭ Chủ phòng đã bỏ qua video.');
      await op(O, { op: 'skip' });
      await skipped;
      await note;
      const tooFew = O.waitT('proom_res', 2000);
      await op(O, { op: 'cap', cap: 2 });
      const tf = await tooFew;
      assert.equal(tf.code, 'invalid');
      assert.match(String(tf.text), /đang có 3 người/);
      // chủ phòng khác (N): không mời được người ở phòng chung; số người ngoài khoảng → lỗi; hợp lệ → cả phòng nhận priv
      const deny = N.waitT('proom_res', 2000);
      await op(N, { op: 'kick', pid: Q.id });
      assert.equal((await deny).code, 'denied');
      const big = N.waitT('proom_res', 2000);
      await op(N, { op: 'cap', cap: 21 });
      assert.equal((await big).code, 'invalid');
      const cap3 = N.wait(isPrivMsg((p) => p.cap === 3), 2000);
      await op(N, { op: 'cap', cap: 3 });
      await cap3;
      assert.ok(!Q.msgs.some((m) => m.t === 'proom_res'), 'người ở phòng chung không bị gì');
      assert.equal(Q.msgs.filter((m) => m.t === 'welcome').pop()!.room, 'nhung');
    });

    await step('phòng riêng: chủ phòng mời ra → người đó nhận "out" rồi về phòng chung (giữ nhân vật); không vào lại được (mật khẩu, vé, switch, tab mới)', async () => {
      const out = M.waitT('proom_res', 4000, (m) => m.code === 'out');
      const landed = M.wait((m) => m.t === 'welcome' && m.room !== roomA, 4000);
      const res = O.waitT('proom_res', 4000, (m) => m.code === 'ok');
      await op(O, { op: 'kick', pid: M.id });
      const o = await out;
      assert.equal(o.text, 'Chủ phòng đã mời bạn ra khỏi phòng riêng.');
      assert.equal(o.room, roomA);
      const w = await landed;
      assert.equal(w.room, 'bien', 'về phòng chính chung của cùng rạp');
      assert.equal(w.you, M.id, 'giữ nguyên nhân vật');
      assert.ok(M.msgs.indexOf(o) < M.msgs.indexOf(w), "'out' tới trước welcome");
      assert.equal((await res).text, 'Đã mời Thành Viên ra. Họ vẫn biết mật khẩu — đổi mật khẩu nếu không muốn họ vào lại.');
      assert.equal((await auth(M, roomA, PASS_A)).code, 'kicked', 'đúng mật khẩu cũng không vào được');
      const sw = M.wait((m) => m.t === 'proom_res' && m.code === 'kicked', 2000);
      M.send({ t: 'switch', room: roomA, rt: rtM });
      await sw;
      // tab mới cùng máy, vé cũ: nối lại nhân vật ở phòng chung, không vào được phòng riêng
      const M4 = await mk(A.ws);
      M4.ck = M.ck;
      const refused = M4.wait((m) => m.t === 'proom_res' && m.code === 'kicked', 3000);
      const w4 = await M4.join('Thành Viên', roomA, rtM);
      assert.equal(w4.t, 'welcome');
      assert.equal(w4.room, 'bien');
      await refused;
    });

    await step('phòng riêng: đổi mật khẩu → người đang trong phòng nhận vé mới (proom_rt), vé cũ hết hiệu lực; mật khẩu cũ sai, mới đúng', async () => {
      const W = await mk(A.ws);
      const rtOld = await enter(W, roomN, 'matkhau2', 'Bạn Của Mới');
      const rtN = N.waitT('proom_rt', 4000);
      const rtW = W.waitT('proom_rt', 4000);
      const done = N.waitT('proom_res', 4000, (m) => m.code === 'ok');
      await op(N, { op: 'pass', pass: 'mật khẩu mới' });
      assert.equal((await done).text, 'Đã đổi mật khẩu. Người đang trong phòng vẫn ở lại; ai vào sau cần mật khẩu mới.');
      assert.equal((await rtN).room, roomN);
      const fresh = (await rtW).rt as string;
      assert.notEqual(fresh, rtOld);
      // W tắt tab rồi mở lại: vé cũ → cần mật khẩu; vé mới → vào thẳng
      W.send({ t: 'leave' });
      await sleep(50);
      memN = await mk(A.ws);
      memN.ck = W.ck;
      assert.equal((await memN.join('Bạn Của Mới', roomN, rtOld)).code, 'priv_need');
      assert.equal((await memN.join('Bạn Của Mới', roomN, fresh)).room, roomN);
      const Z = await mk(A.ws);
      assert.equal((await auth(Z, roomN, 'matkhau2')).code, 'bad_pass');
      assert.equal((await auth(Z, roomN, 'mật khẩu mới')).t, 'proom_ok');
    });

    await step('phòng riêng: cùng máy đang ở phòng chung, nhập đúng mật khẩu ở tab mới → nối lại đúng nhân vật, vào thẳng phòng riêng', async () => {
      const K = await mk(A.ws);
      assert.equal((await K.join('Khách Cũ', 'nhung')).t, 'welcome');
      const K2 = await mk(A.ws);
      K2.ck = K.ck;
      const closed = new Promise<number>((res) => K.ws.once('close', (code) => res(code)));
      const ok = await auth(K2, roomA, PASS_A);
      assert.equal(ok.t, 'proom_ok');
      const w = await K2.join('Khách Cũ', roomA, ok.rt as string);
      assert.equal(w.t, 'welcome');
      assert.equal(w.room, roomA);
      assert.equal(w.you, K.id, 'đúng nhân vật cũ');
      assert.equal(await closed, 4002);
    });

    await step('phòng riêng: lỗi trình phát chỉ chuyển bài trong phòng (phòng chung vẫn thêm được); đủ báo cáo chỉ bỏ qua trong phòng + báo admin (không gỡ khỏi rạp)', async () => {
      OC = await mk(A.ws);
      assert.equal((await OC.join('Chủ Phòng Ba', 'congvien')).t, 'welcome');
      const ok = await create(OC, { pass: 'ba ba ba', cap: 5, venue: 'congvien' });
      roomC = ok.room as string;
      await OC.wait((m) => m.t === 'welcome' && m.room === roomC, 2000, true);
      const playing = OC.wait((m) => m.t === 'now' && nowV(m) === 'privFail001', 3000);
      assert.equal((await qadd(OC, 'privFail001')).ok, true);
      await playing;
      const skipped = OC.wait((m) => m.t === 'now' && nowV(m) !== 'privFail001', 3000);
      OC.send({ t: 'vid_err', v: 'privFail001', code: 150 }); // một mình trong phòng: 1 máy là đủ số
      await skipped;
      const pub = await qadd(Q, 'privFail001');
      assert.equal(pub.ok, true, `phòng chung vẫn thêm được: ${pub.text}`);
      for (const n of ['Bạn Một', 'Bạn Hai']) { const c = await mk(A.ws); await enter(c, roomC, 'ba ba ba', n); memC.push(c); }
      const playing2 = OC.wait((m) => m.t === 'now' && nowV(m) === 'privRep0001', 3000);
      assert.equal((await qadd(OC, 'privRep0001')).ok, true);
      await playing2;
      const note = AD.wait((m) => m.t === 'adm' && m.kind === 'note' && /chưa gỡ khỏi rạp/.test(String(m.text)), 3000);
      const gone = OC.wait((m) => m.t === 'now' && nowV(m) !== 'privRep0001', 3000);
      for (const c of [OC, ...memC]) c.send({ t: 'report', kind: 'video', target: 'privRep0001', reason: 'copyright', note: '' });
      await gone;
      assert.ok(String((await note).text).includes(roomC));
      assert.equal((await qadd(Q, 'privRep0001')).ok, true, 'không bị gỡ khỏi cả rạp');
    });

    await step('admin gỡ hẳn video → tới cả phòng riêng (hàng chờ + đang chiếu); phòng riêng cũng không thêm lại được', async () => {
      const playing = OC.wait((m) => m.t === 'now' && nowV(m) === 'blockNow001', 3000);
      assert.equal((await qadd(OC, 'blockNow001')).ok, true);
      await playing;
      assert.equal((await qadd(memC[0], 'blockQue001')).ok, true);
      const dequeued = OC.wait((m) => m.t === 'queue' && !(m.q as { v: string }[]).some((q) => q.v === 'blockQue001'), 2000);
      AD.send({ t: 'adm', op: 'block', v: 'blockQue001' });
      await dequeued;
      const stopped = OC.wait((m) => m.t === 'now' && nowV(m) !== 'blockNow001', 2000);
      const why = OC.waitT('notice', 2000, (m) => /khỏi rạp/.test(String(m.text)));
      AD.send({ t: 'adm', op: 'block', v: 'blockNow001' });
      await stopped;
      await why;
      assert.match(String((await qadd(OC, 'blockNow001')).text), /đã bị gỡ/);
    });

    await step('admin: thấy danh sách phòng riêng; mở link phòng riêng → đứng xem thẳng, cả phòng được báo 🛡; vào hẳn → thành viên thấy ghi rõ quản trị viên, chủ phòng không mời ra được; đóng phòng → mọi người về phòng chung', async () => {
      const st = AD.waitT('adm', 2000, (m) => m.kind === 'state');
      AD.send({ t: 'adm', op: 'state' });
      const list = (await st).privRooms as { id: string; name: string; venue: string; count: number; cap: number; now: string; v: string; createdAt: number; lastInput: number }[];
      const c = list.find((r) => r.id === roomC)!;
      assert.ok(c, 'phòng riêng có trong bảng admin');
      assert.deepEqual([c.name, c.venue, c.count, c.cap], ['Phòng của Chủ Phòng Ba', 'congvien', 3, 5]);
      assert.ok(c.createdAt > 0 && c.lastInput >= c.createdAt);
      assert.ok(list.every((r, i) => i === 0 || list[i - 1].lastInput >= r.lastInput), 'mới thao tác xếp trước');
      // người thường gửi lệnh admin: như không tồn tại
      OC.send({ t: 'adm', op: 'close_room', room: roomC });
      await sleep(150);
      assert.ok(!OC.msgs.some((m) => m.t === 'proom_res' && m.code === 'out'));
      const told = OC.waitT('notice', 2000, (m) => m.text === '🛡 Quản trị viên rạp đang xem phòng này.');
      const AD2 = await mk(A.ws, { admin: true, query: `?room=${roomC}` });
      const h = AD2.msgs.find((m) => m.t === 'hello')!;
      assert.equal(h.room, roomC);
      assert.equal(snapOf(h).priv!.cap, 5);
      await told;
      // admin vào hẳn (không mật khẩu / vé, không tính chỗ): cả phòng thấy người đó ghi rõ là quản trị viên (adm) — chủ phòng
      // không mời ra được (giao diện không hiện nút "Mời ra" cho người này)
      type Mem = { id: number; name: string; adm?: boolean };
      const AD3 = await mk(A.ws, { admin: true, query: `?room=${roomC}` });
      const privAdm = OC.waitT('priv', 2000, (m) => (m.priv as { members: Mem[] }).members.some((x) => x.name === 'Người Trực' && x.adm === true));
      assert.equal((await AD3.join('Người Trực', roomC)).room, roomC);
      const mems = ((await privAdm).priv as { members: Mem[] }).members;
      assert.deepEqual(mems.filter((x) => x.adm).map((x) => x.id), [AD3.id], 'chỉ admin có cờ adm');
      const denied = OC.waitT('proom_res', 2000, (m) => m.code === 'denied');
      OC.send({ t: 'proom_op', op: 'kick', pid: AD3.id });
      assert.equal((await denied).text, 'Không mời người này ra được.');
      AD3.close();
      const outs = [OC, ...memC].map((x) => x.waitT('proom_res', 3000, (m) => m.code === 'out'));
      const landed = [OC, ...memC].map((x) => x.wait((m) => m.t === 'welcome' && m.room === 'congvien', 3000));
      const admHello = AD2.wait((m) => m.t === 'hello' && m.room === 'congvien', 3000);
      const admNote = AD2.waitT('notice', 3000, (m) => m.text === 'Quản trị viên đã đóng phòng riêng này.');
      AD2.send({ t: 'adm', op: 'close_room', room: roomC });
      for (const o of await Promise.all(outs)) assert.equal(o.text, 'Quản trị viên đã đóng phòng riêng này.');
      await Promise.all(landed);
      await admHello;
      await admNote;
      assert.equal((await auth(Q, roomC, 'ba ba ba')).exists, false, 'phòng đã đóng');
    });

    await step('phòng riêng: chủ phòng đóng phòng → mọi người nhận "out" rồi về phòng chung, phòng biến mất', async () => {
      const outs = [N, memN].map((x) => x.waitT('proom_res', 3000, (m) => m.code === 'out'));
      const landed = [N, memN].map((x) => x.wait((m) => m.t === 'welcome' && m.room === 'congvien', 3000));
      await op(N, { op: 'close' });
      for (const o of await Promise.all(outs)) assert.equal(o.text, 'Chủ phòng đã đóng phòng riêng.');
      await Promise.all(landed);
      assert.equal((await auth(Q, roomN, 'mật khẩu mới')).exists, false);
    });

    // ---------------------------------------------------------- server L: giới hạn tạo phòng (nhỏ để dễ chạm)
    await step('phòng riêng — giới hạn: máy đang có phòng còn người → "owned" (phòng trống thì được thay); mỗi mạng 2 phòng; 3 lần tạo / giờ / mạng; cả rạp 3 phòng (thu hồi phòng trống lâu nhất)', async () => {
      const L = await serve({ privatePerNet: 2, privateCreatePerHour: 3, privateRoomsMax: 3 });
      const probe = await mk(L.ws);
      const exists = async (room: unknown): Promise<boolean> => {
        const r = probe.waitT('proom_need', 2000, (m) => m.room === room);
        probe.send({ t: 'spec', room });
        return (await r).exists === true;
      };
      const net1 = '10.60.0.1';
      const c1 = await mk(L.ws, { ip: net1 });
      const r1 = await create(c1, { name: 'Một' });
      assert.equal(r1.t, 'proom_ok');
      const r1b = await create(c1, { name: 'Một' }); // phòng cũ của máy này còn trống → được thay
      assert.equal(r1b.t, 'proom_ok', JSON.stringify(r1b));
      assert.equal(await exists(r1.room), false, 'phòng trống cũ của máy này đã đóng');
      assert.equal((await c1.join('Một', r1b.room as string, r1b.rt as string)).room, r1b.room);
      const owned = await create(c1);
      assert.equal(owned.code, 'owned');
      assert.equal(owned.room, r1b.room);
      assert.equal(owned.text, 'Bạn đang có phòng 🔒 Phòng của Một — vào lại phòng đó nhé.');
      const c1b = await mk(L.ws, { ip: net1 });
      const r2 = await create(c1b, { name: 'Hai' }); // lần tạo thứ 3 của mạng này, mạng có 2 phòng
      assert.equal(r2.t, 'proom_ok');
      const lim = await create(await mk(L.ws, { ip: net1 }), { name: 'Ba' });
      assert.equal(lim.code, 'limit');
      assert.equal(lim.text, 'Mạng bạn đang dùng đã có nhiều phòng riêng — thử lại sau ít phút nhé.');
      const rate = await create(c1b, { name: 'Hai' }); // phòng của nó trống (không tính vào mạng) nhưng hết lượt tạo / giờ
      assert.equal(rate.code, 'rate');
      assert.equal(await exists(r2.room), true, 'bị từ chối thì phòng cũ không bị đóng oan');
      // cả rạp tối đa 3: r1b (có người) + r2 (trống) + r3 → phòng thứ 4 thu hồi phòng trống lâu nhất (r2)
      const c2 = await mk(L.ws);
      const r3 = await create(c2, { name: 'Bốn' });
      assert.equal(r3.t, 'proom_ok');
      const c3 = await mk(L.ws);
      const r4 = await create(c3, { name: 'Năm' });
      assert.equal(r4.t, 'proom_ok', JSON.stringify(r4));
      assert.equal(await exists(r2.room), false, 'phòng trống lâu nhất bị thu hồi');
      assert.equal(await exists(r3.room), true);
      assert.equal((await c2.join('Bốn', r3.room as string, r3.rt as string)).room, r3.room);
      assert.equal((await c3.join('Năm', r4.room as string, r4.rt as string)).room, r4.room);
      const full = await create(await mk(L.ws), { name: 'Sáu' });
      assert.equal(full.code, 'limit');
      assert.equal(full.text, 'Rạp đang có nhiều phòng riêng quá — thử lại sau ít phút nhé.');
    });

    // ---------------------------------------------------------- server E: vòng đời (thời gian chờ rất ngắn)
    await step('phòng riêng — vòng đời: không còn ai quá thời gian chờ → tự đóng; lâu không ai thao tác → tạm dừng video (+ báo) rồi đóng phòng', async () => {
      const E = await serve({ privateEmptySeconds: 0.5, privateIdlePauseMinutes: 0.7 / 60, privateIdleCloseMinutes: 2 / 60 });
      const probe = await mk(E.ws);
      const exists = async (room: unknown): Promise<boolean> => {
        const r = probe.waitT('proom_need', 2000, (m) => m.room === room);
        probe.send({ t: 'spec', room });
        return (await r).exists === true;
      };
      const e1 = await mk(E.ws);
      const r = await create(e1, { name: 'Vắng Vẻ' });
      assert.equal((await e1.join('Vắng Vẻ', r.room as string, r.rt as string)).room, r.room);
      assert.equal(await exists(r.room), true);
      e1.send({ t: 'leave' });
      await sleep(900);
      assert.equal(await exists(r.room), false, 'không còn ai quá 0,5 s → đóng');
      const e2 = await mk(E.ws);
      assert.equal((await e2.join('Ngồi Im', 'doxe')).t, 'welcome');
      const r2 = await create(e2, { venue: 'doxe' });
      await e2.wait((m) => m.t === 'welcome' && m.room === r2.room, 2000, true);
      const paused = e2.wait((m) => m.t === 'now' && (m.n as { paused?: boolean } | null)?.paused === true, 3000);
      const note = e2.waitT('notice', 3000, (m) => m.text === '⏸ Đã tạm dừng vì lâu không ai thao tác — bấm ▶ để xem tiếp.');
      assert.equal((await qadd(e2, 'eRsGyueVLvQ')).ok, true);
      await paused;
      await note;
      const out = e2.waitT('proom_res', 4000, (m) => m.code === 'out');
      const home = e2.wait((m) => m.t === 'welcome' && m.room === 'doxe', 4000);
      assert.equal((await out).text, 'Phòng riêng đã đóng vì lâu không ai thao tác.');
      await home;
    });

    // ---------------------------------------------------------- server P: lưu / khôi phục (thư mục dữ liệu riêng)
    await step('phòng riêng — lưu / khôi phục: rooms.json khoá "priv" chỉ có BĂM (mật khẩu, vé, khoá máy chủ phòng / người có vé / người bị mời ra / người thêm video — lộ file cũng không vào được phòng); bật lại → vào bằng vé, chủ phòng vào bằng khoá máy, người thêm video vẫn là chủ video, người bị mời ra vẫn bị chặn', async () => {
      const P1 = await serve({}, privDir);
      const po = await mk(P1.ws);
      assert.equal((await po.join('Chủ Lưu', 'doxe')).t, 'welcome');
      const ok = await create(po, { pass: 'luu lai nhe', cap: 4, venue: 'doxe' });
      const room = ok.room as string;
      await po.wait((m) => m.t === 'welcome' && m.room === room, 2000, true);
      const pm = await mk(P1.ws);
      const rt = await enter(pm, room, 'luu lai nhe', 'Khách Lưu');
      const pk = await mk(P1.ws);
      const rtK = await enter(pk, room, 'luu lai nhe', 'Khách Bị Mời');
      const kicked = pk.waitT('proom_res', 3000, (m) => m.code === 'out');
      await op(po, { op: 'kick', pid: pk.id });
      await kicked;
      const playing = po.wait((m) => m.t === 'now' && nowV(m) === 'persist0003', 3000);
      assert.equal((await qadd(po, 'persist0003')).ok, true);
      await playing;
      const queued = po.wait((m) => m.t === 'queue' && (m.q as { v: string }[]).some((q) => q.v === 'persist0004'), 3000);
      assert.equal((await qadd(pm, 'persist0004')).ok, true);
      await queued;
      po.close();
      pm.close();
      pk.close();
      apps.delete(P1.app);
      await P1.app.close();
      const raw = readFileSync(join(privDir, 'rooms.json'), 'utf8');
      const saved = JSON.parse(raw) as { rooms: { id: string }[]; priv: Record<string, unknown>[] };
      assert.ok(saved.rooms.every((x) => !x.id.startsWith('p-')), 'phòng riêng không lẫn vào rooms[]');
      const pr = saved.priv.find((x) => x.id === room)!;
      assert.ok(pr, 'có phòng riêng trong khoá priv');
      assert.deepEqual([pr.venue, pr.cap, pr.name], ['doxe', 4, 'Phòng của Chủ Lưu']);
      assert.match(String(pr.passHash), /^[a-f0-9]{64}$/);
      assert.match(String(pr.salt), /^[a-f0-9]{32}$/);
      assert.ok(!raw.includes('luu lai nhe') && !raw.includes(rt) && !raw.includes(rtK) && !raw.includes(String(ok.rt)), 'không lưu mật khẩu / vé thật');
      // khoá máy: chỉ có băm sha256 — chủ phòng, vé {h, ckh, at}, người bị mời ra, người thêm video (byCkH)
      for (const ck of [po.ck, pm.ck, pk.ck]) assert.ok(!raw.includes(ck), `rooms.json không được có khoá máy thật ${ck}`);
      assert.equal(pr.ownerCkH, sha256(po.ck));
      assert.ok(!('ownerCk' in pr) && !('kickedCk' in pr));
      const toks = pr.tokens as Record<string, unknown>[];
      assert.ok(toks.length >= 2 && toks.every((t) => /^[a-f0-9]{64}$/.test(String(t.h)) && /^[a-f0-9]{64}$/.test(String(t.ckh)) && !('ck' in t)));
      assert.ok(toks.some((t) => t.ckh === sha256(pm.ck)), 'vé của khách còn trong phòng');
      assert.ok(!toks.some((t) => t.ckh === sha256(pk.ck)), 'người bị mời ra mất vé');
      assert.deepEqual(pr.kickedCkH, [sha256(pk.ck)]);
      const items = [...(pr.queue as Record<string, unknown>[]), pr.now as Record<string, unknown>];
      assert.ok(items.every((q) => !('byCk' in q) && /^[a-f0-9]{64}$/.test(String(q.byCkH))), 'người thêm video chỉ lưu băm');
      const P2 = await serve({}, privDir);
      const pm2 = await mk(P2.ws);
      pm2.ck = pm.ck;
      const w = await pm2.join('Khách Lưu', room, rt);
      assert.equal(w.room, room, JSON.stringify(w));
      const s = snapOf(w);
      assert.deepEqual([s.venue, s.name, s.priv!.cap], ['doxe', 'Phòng của Chủ Lưu', 4]);
      assert.equal(s.now?.v, 'persist0003');
      assert.deepEqual(s.queue.map((q) => q.v), ['persist0004']);
      assert.equal(s.queue[0].byId, w.you, 'người thêm video nhận lại video của mình (so băm khoá máy)');
      const po2 = await mk(P2.ws);
      po2.ck = po.ck;
      const w2 = await po2.join('Chủ Lưu', room);
      assert.equal(w2.room, room, 'chủ phòng vào lại bằng khoá máy, không cần vé');
      assert.equal(snapOf(w2).priv!.ownerId, w2.you);
      const pk2 = await mk(P2.ws);
      pk2.ck = pk.ck;
      assert.equal((await pk2.join('Khách Bị Mời', room, rtK)).code, 'priv_kicked', 'người bị mời ra vẫn bị chặn sau khi khởi động lại');
    });

    await step('rooms.json bản trước (khoá máy THẬT của người thêm video — byCk): nạp thành băm, người thêm vẫn nhận lại video; lưu lại không còn khoá thật', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vc-smoke-legacy-'));
      try {
        const ck = 'abcdef0123456789';
        const at = Date.now();
        const item = (v: string, qid: number): Record<string, unknown> => ({
          qid, v, title: `Video ${v}`, ch: 'Kênh', dur: 200, live: false, by: 'Người Cũ', byId: 9, byCk: ck, addedAt: at,
        });
        writeFileSync(join(dir, 'rooms.json'), JSON.stringify({
          savedAt: at, qid: 20, pid: 40,
          rooms: [{ id: 'congvien', queue: [item('legacy00002', 12)], now: { ...item('legacy00001', 11), at, paused: false, pos: 0, ends: at + 200_000 }, locked: false }],
          blocked: [],
        }));
        const L1 = await serve({}, dir);
        const c = await mk(L1.ws);
        c.ck = ck;
        const w = await c.join('Người Cũ', 'congvien');
        const s = snapOf(w);
        assert.equal(s.now?.v, 'legacy00001');
        assert.equal(s.queue[0].byId, w.you, 'nhận lại video theo khoá máy (so băm)');
        c.close();
        apps.delete(L1.app);
        await L1.app.close();
        const raw = readFileSync(join(dir, 'rooms.json'), 'utf8');
        assert.ok(!raw.includes(ck) && raw.includes(sha256(ck)), 'lưu lại: chỉ còn băm');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    // ---------------------------------------------------------- quản trị viên trong phòng riêng (mỗi bước một server)
    await step('phòng riêng — quản trị viên có mặt là TRẠNG THÁI: người vào sau vẫn biết (welcome có priv.admins + báo 🛡 sau welcome); admin rời → priv hết admins; vào lại trên cùng kết nối → báo lại; đứng xem rồi vào hẳn → chỉ một lần báo', async () => {
      const S = await serve({});
      const own = await mk(S.ws);
      assert.equal((await own.join('Chủ Trạng Thái', 'nhung')).t, 'welcome');
      const ok = await create(own, { pass: 'trang thai', cap: 4, venue: 'nhung' });
      const room = ok.room as string;
      await own.wait((m) => m.t === 'welcome' && m.room === room, 2000, true);
      // admin mở link → đứng xem thẳng: cả phòng được báo + priv.admins = 1
      const told = own.wait(isShield, 2000);
      const watching = own.wait(isPrivMsg((p) => p.admins === 1), 2000);
      const ad = await mk(S.ws, { admin: true, query: `?room=${room}` });
      assert.equal(ad.msgs.find((m) => m.t === 'hello')!.room, room);
      await told;
      await watching;
      // người vào SAU lúc admin đang xem: welcome đã có admins = 1, và được báo 🛡 ngay sau welcome
      const late = await mk(S.ws);
      await enter(late, room, 'trang thai', 'Khách Đến Sau');
      const w = late.msgs.find((m) => m.t === 'welcome' && m.room === room)!;
      assert.equal(snapOf(w).priv!.admins, 1);
      const n = await late.wait(isShield, 2000, true);
      assert.ok(late.msgs.indexOf(w) < late.msgs.indexOf(n), 'báo 🛡 tới sau welcome');
      // admin sang phòng khác → cả phòng nhận priv không còn quản trị viên
      const gone = late.wait(isPrivMsg((p) => !p.admins && !p.members.some((x) => x.adm)), 2000);
      ad.send({ t: 'spec', room: 'nhung' });
      await gone;
      // quay lại trên CÙNG kết nối = vào lại thật → cả phòng được báo lại
      const again = [own, late].map((c) => c.wait(isShield, 2000));
      ad.send({ t: 'spec', room });
      await Promise.all(again);
      // đứng xem rồi vào hẳn trên cùng kết nối: không báo thêm; thành viên có adm, hết người đứng xem
      const before = own.msgs.filter(isShield).length;
      const asMember = own.wait(isPrivMsg((p) => !p.admins && p.members.some((x) => x.adm && x.name === 'Người Trực Ca')), 2000);
      assert.equal((await ad.join('Người Trực Ca', room)).room, room);
      await asMember;
      await sleep(150);
      assert.equal(own.msgs.filter(isShield).length, before, 'đứng xem → vào hẳn trên cùng kết nối: chỉ một lần báo');
      // người vào sau lúc admin đang có nhân vật trong phòng → cũng được báo, welcome ghi rõ quản trị viên
      const late2 = await mk(S.ws);
      await enter(late2, room, 'trang thai', 'Khách Thứ Ba');
      await late2.wait(isShield, 2000, true);
      assert.ok(snapOf(late2.msgs.find((m) => m.t === 'welcome' && m.room === room)!).priv!.members.some((x) => x.adm));
      // admin mất kết nối rồi nối lại (kết nối mới) → vào lại thật → báo lại
      const back = own.wait(isShield, 3000);
      ad.close();
      await own.wait(isPrivMsg((p) => p.members.some((x) => x.adm && x.ghost)), 2000);
      const ad2 = await mk(S.ws, { admin: true, query: `?room=${room}` });
      ad2.ck = ad.ck;
      ad2.token = ad.token;
      assert.equal((await ad2.join('Người Trực Ca', room)).room, room);
      await back;
    });

    await step('phòng riêng — quản trị viên KHÔNG chiếm chỗ: vào hẳn phòng 3 chỗ đang có 2 người → bạn thứ ba vẫn vào được; chủ phòng hạ số người theo thành viên thật; thành viên rời rồi vào lại bằng vé không bị "đầy"; còn mỗi admin → phòng vẫn tự đóng khi hết thời gian chờ; chủ rạp (cookie admin) tạo phòng của chính mình → vẫn là thành viên, ngồi chờ một mình không bị đóng', async () => {
      const S = await serve({ privateEmptySeconds: 0.8 });
      const own = await mk(S.ws);
      assert.equal((await own.join('Chủ Ghế', 'congvien')).t, 'welcome');
      const ok = await create(own, { pass: 'ghe ngoi', cap: 3, venue: 'congvien' });
      const room = ok.room as string;
      await own.wait((m) => m.t === 'welcome' && m.room === room, 2000, true);
      const m1 = await mk(S.ws);
      const rt1 = await enter(m1, room, 'ghe ngoi', 'Bạn Ghế Một');
      const ad = await mk(S.ws, { admin: true, query: `?room=${room}` });
      assert.equal((await ad.join('Kiểm Duyệt', room)).room, room);
      // bạn thứ ba: 2 thành viên + admin trong phòng 3 chỗ → vẫn còn chỗ
      const m2 = await mk(S.ws);
      await enter(m2, room, 'ghe ngoi', 'Bạn Ghế Hai');
      const st = ad.waitT('adm', 2000, (m) => m.kind === 'state');
      ad.send({ t: 'adm', op: 'state' });
      assert.equal(((await st).privRooms as { id: string; count: number }[]).find((r) => r.id === room)!.count, 3, 'admin không tính vào số người');
      // m2 rời; chủ phòng hạ xuống 2 chỗ (thành viên thật: chủ + m1 — admin không tính)
      const without = (name: string) => isPrivMsg((p) => !p.members.some((x) => x.name === name));
      const m2Left = own.wait(without('Bạn Ghế Hai'), 2000);
      m2.send({ t: 'leave' });
      await m2Left;
      const cap2 = own.wait(isPrivMsg((p) => p.cap === 2), 2000);
      await op(own, { op: 'cap', cap: 2 });
      await cap2;
      // m1 tắt tab rồi mở lại bằng vé: phòng 2 chỗ, đang có chủ phòng + admin → vẫn vào được
      const m1Left = own.wait(without('Bạn Ghế Một'), 2000);
      m1.send({ t: 'leave' });
      await m1Left;
      const m1b = await mk(S.ws);
      m1b.ck = m1.ck;
      assert.equal((await m1b.join('Bạn Ghế Một', room, rt1)).room, room, 'admin không giữ chỗ của thành viên');
      // mọi thành viên rời, còn mỗi admin (có nhân vật) → hết thời gian chờ phòng vẫn đóng; admin về phòng chung
      const out = ad.waitT('proom_res', 4000, (m) => m.code === 'out');
      const home = ad.wait((m) => m.t === 'welcome' && m.room === 'congvien', 4000);
      m1b.send({ t: 'leave' });
      own.send({ t: 'leave' });
      await out;
      await home;
      // chủ rạp (trình duyệt có cookie admin) tạo phòng riêng của CHÍNH MÌNH: là thành viên bình thường (chiếm chỗ, ngồi chờ
      // bạn bè một mình phòng không tự đóng) và KHÔNG bị gắn 🛡 / không bật "quản trị viên đang xem" trong phòng của mình
      const boss = await mk(S.ws, { admin: true });
      assert.equal((await boss.join('Chủ Rạp Đây', 'congvien')).t, 'welcome');
      const mine = await create(boss, { pass: 'phong cua toi', cap: 2, venue: 'congvien' });
      assert.equal(mine.t, 'proom_ok', JSON.stringify(mine));
      const bw = await boss.wait((m) => m.t === 'welcome' && m.room === mine.room, 2000, true);
      const bp = snapOf(bw).priv!;
      assert.ok(bp.members.some((x) => x.id === bp.ownerId && !x.adm), 'chủ phòng là admin trong phòng của mình: không gắn adm');
      assert.ok(!bp.admins, 'không tính là quản trị viên đang xem');
      assert.ok(!boss.msgs.some((m) => m.t === 'notice' && /Quản trị viên rạp đang xem/.test(String(m.text))), 'không tự báo "quản trị viên đang xem" trong phòng mình');
      assert.equal(bp.members.filter((x) => !x.adm).length, 1, 'client đếm chủ phòng là thành viên');
      await sleep(1500); // > PRIVATE_EMPTY_SECONDS (0,8 s) của bước này
      const br = S.app.hub.rooms.get(mine.room as string);
      assert.ok(br && !br.priv!.closed, 'phòng của chủ rạp không tự đóng lúc chủ rạp ngồi chờ một mình');
      assert.equal(br!.members(), 1);
      assert.ok(!boss.msgs.some((m) => m.t === 'proom_res' && m.code === 'out'));
    });

    await step('phòng riêng — video chỉ qua kiểm cơ bản (không có YT_API_KEY) giữ giới hạn rạp chung: "không công khai" chiếu tối đa 15 phút, báo dài 2 tiếng vẫn 15 phút, live tối đa LIVE_MAX_MINUTES (12 giờ chỉ dành cho video Data API kiểm đủ)', async () => {
      type N = { v: string; unk?: boolean; live: boolean; dur: number; at: number; ends: number };
      const S = await serve({}, null, { youtube: createFakeYouTube({ noKey: true }) });
      const own = await mk(S.ws);
      assert.equal((await own.join('Chủ Cơ Bản', 'bien')).t, 'welcome');
      const ok = await create(own, { pass: 'co ban nhe', cap: 2, venue: 'bien' });
      await own.wait((m) => m.t === 'welcome' && m.room === ok.room, 2000, true);
      const mins = (n: N): number => (n.ends - n.at) / 60_000;
      const playing = own.wait((m) => m.t === 'now' && nowV(m) === 'unlisted001', 3000);
      assert.equal((await qadd(own, 'unlisted001')).ok, true);
      const n1 = (await playing).n as N;
      assert.equal(n1.unk, true);
      assert.ok(Math.abs(mins(n1) - 15) < 0.1, `chiếu tối đa 15 phút, được ${mins(n1)} phút`);
      const fixed = own.wait((m) => m.t === 'now' && nowV(m) === 'unlisted001' && !(m.n as N).unk, 3000);
      own.send({ t: 'vid_dur', v: 'unlisted001', d: 7200, live: false });
      const n2 = (await fixed).n as N;
      assert.equal(n2.dur, 7200);
      assert.ok(Math.abs(mins(n2) - 15) < 0.1, `người thêm báo 2 tiếng vẫn 15 phút, được ${mins(n2)} phút`);
      assert.equal((await qadd(own, 'liveNow0001')).ok, true);
      const liveNow = own.wait((m) => m.t === 'now' && nowV(m) === 'liveNow0001', 3000);
      await op(own, { op: 'skip' });
      await liveNow;
      const isLive = own.wait((m) => m.t === 'now' && nowV(m) === 'liveNow0001' && (m.n as N).live, 3000);
      own.send({ t: 'vid_dur', v: 'liveNow0001', d: 600, live: true });
      const n3 = (await isLive).n as N;
      assert.ok(Math.abs(mins(n3) - 30) < 0.1, `live chiếu tối đa 30 phút, được ${mins(n3)} phút`);
    });

    await step('phòng riêng — nhật ký server không bao giờ có video / người trong phòng riêng (tên, mã video, độ dài, báo cáo, lỗi trình phát, admin gỡ video từ trong phòng) — chỉ mã + tên phòng lúc tạo / đổi mật khẩu / đóng; phòng chung vẫn ghi như cũ', async () => {
      const logs: string[] = [];
      const S = await serve({}, null, { youtube: createFakeYouTube({ noKey: true }), log: (...a) => { logs.push(a.map(String).join(' ')); } });
      const own = await mk(S.ws);
      assert.equal((await own.join('Lan Anh', 'nhung')).t, 'welcome');
      const ok = await create(own, { pass: 'nhat ky kin', cap: 3, venue: 'nhung' });
      const room = ok.room as string;
      await own.wait((m) => m.t === 'welcome' && m.room === room, 2000, true);
      const mem = await mk(S.ws);
      await enter(mem, room, 'nhat ky kin', 'Bạn Của Lan');
      const playing = own.wait((m) => m.t === 'now' && nowV(m) === 'eRsGyueVLvQ', 3000);
      assert.equal((await qadd(own, 'eRsGyueVLvQ')).ok, true);
      await playing;
      const timed = own.wait((m) => m.t === 'now' && nowV(m) === 'eRsGyueVLvQ' && (m.n as { dur: number }).dur === 888, 2000);
      own.send({ t: 'vid_dur', v: 'eRsGyueVLvQ', d: 888, live: false });
      await timed;
      const reported = mem.waitT('notice', 2000, (m) => /Đã gửi báo cáo/.test(String(m.text)));
      mem.send({ t: 'report', kind: 'video', target: 'eRsGyueVLvQ', reason: 'copyright', note: 'ghi chú riêng tư' });
      await reported;
      const skipped = own.wait((m) => m.t === 'now' && nowV(m) !== 'eRsGyueVLvQ', 3000);
      for (const c of [own, mem]) c.send({ t: 'vid_err', v: 'eRsGyueVLvQ', code: 150 });
      await skipped;
      // admin đứng trong phòng riêng gỡ video đang chiếu khỏi cả rạp: log không có mã video
      const bunny = own.wait((m) => m.t === 'now' && nowV(m) === 'YE7VzlLtp-4', 3000);
      assert.equal((await qadd(mem, 'YE7VzlLtp-4')).ok, true);
      await bunny;
      const ad = await mk(S.ws, { admin: true, query: `?room=${room}` });
      const blocked = ad.waitT('notice', 2000, (m) => /Đã gỡ hẳn/.test(String(m.text)));
      ad.send({ t: 'adm', op: 'block', v: '' });
      await blocked;
      const changed = own.waitT('proom_res', 4000, (m) => m.code === 'ok');
      await op(own, { op: 'pass', pass: 'mat khau moi' });
      await changed;
      const out = own.waitT('proom_res', 3000, (m) => m.code === 'out');
      await op(own, { op: 'close' });
      await out;
      // đối chứng phòng chung: cùng thao tác thì nhật ký có tên video (bộ bắt nhật ký hoạt động)
      const pub = await mk(S.ws);
      assert.equal((await pub.join('Người Chung', 'bien')).t, 'welcome');
      const pubPlaying = pub.wait((m) => m.t === 'now' && nowV(m) === 'jNQXAC9IVRw', 3000);
      assert.equal((await qadd(pub, 'jNQXAC9IVRw')).ok, true);
      await pubPlaying;
      const pubTimed = pub.wait((m) => m.t === 'now' && nowV(m) === 'jNQXAC9IVRw' && (m.n as { dur: number }).dur === 19, 2000);
      pub.send({ t: 'vid_dur', v: 'jNQXAC9IVRw', d: 19, live: false });
      await pubTimed;
      assert.ok(logs.some((l) => l.includes('Me at the zoo')), `phòng chung: nhật ký có tên video — ${logs.join(' | ')}`);
      const all = logs.join('\n');
      assert.ok(logs.some((l) => l.startsWith('🚫 Admin gỡ một video')), 'có dòng admin gỡ video (không mã)');
      for (const bad of ['Sintel', 'eRsGyueVLvQ', 'Big Buck Bunny', 'YE7VzlLtp-4', 'ghi chú riêng tư', 'Bạn Của Lan', 'nhat ky kin', 'mat khau moi', String(ok.rt)]) {
        assert.ok(!all.includes(bad), `nhật ký không được có "${bad}":\n${all}`);
      }
      const privLines = logs.filter((l) => l.includes(room));
      assert.equal(privLines.length, 3, `chỉ 3 dòng có mã phòng (tạo / đổi mật khẩu / đóng):\n${privLines.join('\n')}`);
      assert.ok(privLines[0].includes('Phòng của Lan Anh') && /đổi mật khẩu/.test(privLines[1]) && /Đóng phòng riêng/.test(privLines[2]));
    });

    await step('phòng riêng — chống chiếm hết phòng: mỗi dải mạng (IPv4 /24, IPv6 /48) tối đa PRIVATE_PER_SUBNET phòng; rạp đủ PRIVATE_ROOMS_MAX mà không có phòng trống → người từ dải mạng chưa có phòng lấy phòng lâu không thao tác nhất của dải mạng giữ nhiều phòng nhất', async () => {
      const S = await serve({ privatePerNet: 3, privatePerSubnet: 2, privateRoomsMax: 3 });
      // tạo + vào phòng (phòng có thành viên, không phải phòng trống)
      const own = async (ip: string, name: string): Promise<{ c: Client; room: string }> => {
        const c = await mk(S.ws, { ip });
        const r = await create(c, { name, pass: 'chia deu nhe', cap: 2, venue: 'nhung' });
        assert.equal(r.t, 'proom_ok', JSON.stringify(r));
        assert.equal((await c.join(name, r.room as string, r.rt as string)).room, r.room);
        return { c, room: r.room as string };
      };
      const a1 = await own('10.70.1.1', 'Dải A Một');
      await sleep(20);
      await own('10.70.1.2', 'Dải A Hai');
      const lim = await create(await mk(S.ws, { ip: '10.70.1.3' }), { name: 'Dải A Ba' });
      assert.equal(lim.code, 'limit', 'cùng dải /24 đã có 2 phòng (mạng /32 khác vẫn tính chung)');
      assert.equal(lim.text, 'Mạng bạn đang dùng đã có nhiều phòng riêng — thử lại sau ít phút nhé.');
      await own('2001:db8:aa:1::1', 'Dải B Một'); // rạp đủ 3 phòng
      // cùng dải /48 (khác /64) với phòng B: dải đã có phòng → không được lấy chỗ của ai
      const sameB = await create(await mk(S.ws, { ip: '2001:db8:aa:2::1' }), { name: 'Dải B Hai' });
      assert.equal(sameB.code, 'limit');
      assert.equal(sameB.text, 'Rạp đang có nhiều phòng riêng quá — thử lại sau ít phút nhé.');
      // dải mạng mới: phòng lâu không thao tác nhất của dải A (giữ 2 phòng) nhường chỗ
      const out = a1.c.waitT('proom_res', 3000, (m) => m.code === 'out');
      const landed = a1.c.wait((m) => m.t === 'welcome' && m.room === 'nhung', 3000);
      const fresh = await create(await mk(S.ws, { ip: '10.80.0.1' }), { name: 'Dải Mới' });
      assert.equal(fresh.t, 'proom_ok', JSON.stringify(fresh));
      assert.equal((await out).text, 'Rạp đang đủ số phòng riêng — phòng này đã đóng để nhường chỗ cho người khác.');
      await landed;
      assert.equal((await auth(await mk(S.ws), a1.room, 'chia deu nhe')).exists, false, 'phòng bị thu hồi đã đóng');
    });

    await step('phòng riêng — đổi mật khẩu: thành viên đang mất mạng / đang ẩn GIỮ vé (quay lại bằng vé cũ được), người đã rời mất vé; đổi mật khẩu xoá lượt dò của phòng (phòng bị dò tới khoá thì người có mật khẩu mới vào được ngay); tối đa 5 lần / 10 phút / phòng', async () => {
      const S = await serve({});
      const own = await mk(S.ws);
      assert.equal((await own.join('Chủ Đổi Khoá', 'doxe')).t, 'welcome');
      const ok = await create(own, { pass: 'khoa so mot', cap: 6, venue: 'doxe' });
      const room = ok.room as string;
      await own.wait((m) => m.t === 'welcome' && m.room === room, 2000, true);
      let pass = 'khoa so mot';
      let changes = 0;
      const change = async (next: string): Promise<Msg> => {
        const r = own.waitT('proom_res', 6000, (m) => m.code === 'ok' || m.code === 'rate');
        await op(own, { op: 'pass', pass: next });
        const m = await r;
        if (m.code === 'ok') { pass = next; changes++; }
        return m;
      };
      // G: mất mạng (đang là "ma") đúng lúc đổi; H: đang ẩn (điện thoại tắt màn hình); X: đã vào rồi rời hẳn trước khi đổi
      const g = await mk(S.ws);
      const rtG = await enter(g, room, pass, 'Bạn Mất Mạng');
      const h = await mk(S.ws);
      const rtH = await enter(h, room, pass, 'Bạn Đang Ẩn');
      const x = await mk(S.ws);
      const rtX = await enter(x, room, pass, 'Bạn Đã Về');
      const states = own.wait(isPrivMsg((p) => p.members.some((m) => m.name === 'Bạn Mất Mạng' && m.ghost)
        && p.members.some((m) => m.name === 'Bạn Đang Ẩn' && m.away) && !p.members.some((m) => m.name === 'Bạn Đã Về')), 3000);
      g.close();
      h.send({ t: 'away' });
      x.send({ t: 'leave' });
      await states;
      assert.equal((await change('khoa so hai')).code, 'ok');
      // G nối lại (cùng tab: token + khoá máy) → đúng chỗ; đóng tab hẳn → mở lại bằng vé cũ → vào thẳng
      const g2 = await mk(S.ws);
      g2.ck = g.ck;
      g2.token = g.token;
      assert.equal((await g2.join('Bạn Mất Mạng', room, rtG)).room, room);
      g2.send({ t: 'leave' });
      await sleep(50);
      const g3 = await mk(S.ws);
      g3.ck = g.ck;
      assert.equal((await g3.join('Bạn Mất Mạng', room, rtG)).room, room, 'mất mạng lúc đổi mật khẩu vẫn giữ vé');
      // H: socket chết lúc đang ẩn (bị bỏ ngay) → mở lại bằng vé cũ → vào thẳng
      const hGone = own.wait(isPrivMsg((p) => !p.members.some((m) => m.name === 'Bạn Đang Ẩn')), 2000);
      h.close();
      await hGone;
      const h2 = await mk(S.ws);
      h2.ck = h.ck;
      assert.equal((await h2.join('Bạn Đang Ẩn', room, rtH)).room, room, 'đang ẩn lúc đổi mật khẩu vẫn giữ vé');
      // X: đã rời trước khi đổi → vé cũ hết hiệu lực
      const x2 = await mk(S.ws);
      x2.ck = x.ck;
      assert.equal((await x2.join('Bạn Đã Về', room, rtX)).code, 'priv_need');
      // phòng bị dò tới khoá (2 mạng × 10 lần = 20 / 10 phút): người có mật khẩu đúng cũng phải đợi → đổi mật khẩu → vào ngay
      for (const c of [await mk(S.ws), await mk(S.ws)]) {
        for (let i = 0; i < 10; i++) assert.equal((await auth(c, room, `doan bua ${i}`)).code, 'bad_pass');
      }
      assert.equal((await auth(await mk(S.ws), room, pass)).code, 'rate', 'phòng đang khoá vì bị dò');
      assert.equal((await change('khoa so ba')).code, 'ok');
      assert.equal((await auth(await mk(S.ws), room, pass)).t, 'proom_ok', 'mật khẩu mới: lượt dò cũ không còn tính');
      // tối đa 5 lần đổi / 10 phút / phòng (mỗi lần một phép băm scrypt)
      while (changes < 5) assert.equal((await change(`khoa so ${changes + 10}`)).code, 'ok');
      const r6 = await change('khoa qua nhieu');
      assert.equal(r6.code, 'rate');
      assert.equal(r6.text, 'Đổi mật khẩu nhiều quá — đợi vài phút rồi thử lại nhé.');
      assert.equal((await auth(await mk(S.ws), room, pass)).t, 'proom_ok', 'bị từ chối thì mật khẩu cũ vẫn dùng được');
    });

    await step('phòng riêng — lệnh admin là thao tác thật: video tự dừng vì lâu không ai thao tác, admin cho chiếu tiếp → không bị dừng lại ngay nhịp sau', async () => {
      const S = await serve({ privateIdlePauseMinutes: 0.6 / 60, privateIdleCloseMinutes: 1 });
      const own = await mk(S.ws);
      assert.equal((await own.join('Chủ Ngủ Gật', 'nhung')).t, 'welcome');
      const ok = await create(own, { pass: 'ngu gat nhe', cap: 2, venue: 'nhung' });
      const room = ok.room as string;
      await own.wait((m) => m.t === 'welcome' && m.room === room, 2000, true);
      const ad = await mk(S.ws, { admin: true, query: `?room=${room}` });
      const isPaused = (v: boolean) => (m: Msg): boolean => m.t === 'now' && (m.n as { paused?: boolean } | null)?.paused === v;
      const paused = own.wait(isPaused(true), 3000);
      assert.equal((await qadd(own, 'eRsGyueVLvQ')).ok, true);
      await paused;
      const resumed = own.wait(isPaused(false), 2000);
      const done = ad.waitT('notice', 2000, (m) => m.text === 'Đã chiếu tiếp.');
      ad.send({ t: 'adm', op: 'resume' });
      await resumed;
      await done;
      await assert.rejects(own.wait(isPaused(true), 350), 'không bị dừng lại ngay nhịp sau');
    });

    await step('phòng riêng: tab mới cùng máy (nhân vật cũ ở phòng chung) vào phòng riêng mà trùng tên người trong đó → nối lại tại chỗ (welcome) rồi MỚI báo lý do (proom_res "name" kèm id phòng — báo được ngay trên thẻ vào rạp)', async () => {
      const S = await serve({});
      const own = await mk(S.ws);
      assert.equal((await own.join('Trùng Tên', 'nhung')).t, 'welcome');
      const ok = await create(own, { pass: 'trung ten a', cap: 4, venue: 'nhung' });
      const room = ok.room as string;
      await own.wait((m) => m.t === 'welcome' && m.room === room, 2000, true);
      const d1 = await mk(S.ws);
      assert.equal((await d1.join('Trùng Tên', 'bien')).t, 'welcome');
      const d2 = await mk(S.ws);
      d2.ck = d1.ck;
      const a = await auth(d2, room, 'trung ten a');
      assert.equal(a.t, 'proom_ok');
      const refused = d2.wait((m) => m.t === 'proom_res' && m.code === 'name', 2000);
      const w = await d2.join('Trùng Tên', room, a.rt as string);
      assert.equal(w.t, 'welcome');
      assert.equal(w.room, 'bien', 'nối lại tại chỗ');
      const r = await refused;
      assert.equal(r.room, room);
      assert.equal(r.text, 'Tên "Trùng Tên" đang có người dùng trong Phòng của Trùng Tên — đổi tên rồi vào nhé.');
      assert.ok(d2.msgs.indexOf(w) < d2.msgs.indexOf(r), 'lý do tới SAU welcome');
      assert.ok(!d2.msgs.slice(0, d2.msgs.indexOf(w)).some((m) => m.t === 'notice'), 'không có lời báo nào lọt trước welcome');
    });
  } finally {
    for (const c of clients) c.close();
    for (const a of apps) await a.close();
    rmSync(privDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('❌ smoke lỗi:', e instanceof Error ? e.stack : e);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  process.exit(1);
});
