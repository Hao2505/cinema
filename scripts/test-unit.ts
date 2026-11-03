// Test đơn vị (không mạng, không server): tách link YouTube, đọc độ dài ISO 8601, luật nhận video, lọc tên / chat,
// giới hạn tốc độ, sơ đồ rạp dùng chung (va chạm, ghế, ngoại hình). Chạy: npm run test:unit
import assert from 'node:assert/strict';
import { checkMeta, metaFromItem, parseIsoDuration, parseVideoId, VideoCache } from '../src/youtube.js';
import { Bucket, checkChat, checkName, cleanText, hasLink, maskProfanity, nameKey, WindowCounter } from '../src/moderation.js';
import { parseClientMsg } from '../src/protocol.js';
import {
  ACTIONS, HALL, ROOM_ID_RE, SEATS, VENUES, clampToWalkable, isWalkable, moveWithCollision, nearestSeat, normalizeLook, parseRoomId,
  randomLook, roomName, seatAt, spawnPoint,
} from '../public/js/shared/hall.js';
import { FIXTURES } from './fake-youtube.js';
import { httpsRedirectUrl, pickEncoding } from '../src/app.js';
import type { IncomingMessage } from 'node:http';

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  try { fn(); passed++; } catch (e) { failures.push(`✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

// ---------------------------------------------------------------- YouTube
test('parseVideoId: các dạng link', () => {
  const id = 'dQw4w9WgXcQ';
  for (const u of [
    id, `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&t=42s`, `youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`, `https://music.youtube.com/watch?v=${id}&list=RD`, `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}?feature=share`,
    `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`, `  https://youtu.be/${id}  `,
  ]) assert.equal(parseVideoId(u), id, u);
});
test('parseVideoId: từ chối link lạ', () => {
  for (const u of ['', 'abc', 'https://vimeo.com/123456789', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)',
    'https://youtube.com/watch?v=short', 'https://www.youtube.com/@kenh', 'https://youtu.be/', 'x'.repeat(600), 123 as unknown as string]) {
    assert.equal(parseVideoId(u), null, String(u).slice(0, 60));
  }
});
test('parseIsoDuration', () => {
  assert.equal(parseIsoDuration('PT4M13S'), 253);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('P1DT1S'), 86401);
  assert.equal(parseIsoDuration('P0D'), 0);
  assert.equal(parseIsoDuration('PT'), null);
  assert.equal(parseIsoDuration('4:13'), null);
  assert.equal(parseIsoDuration(null), null);
});
const rules = { region: 'VN', maxSeconds: 15 * 60, allowLive: true };
test('checkMeta: nhận video hợp lệ', () => {
  assert.equal(checkMeta(FIXTURES['jNQXAC9IVRw'], rules).ok, true);
  assert.equal(checkMeta(FIXTURES['liveNow0001'], rules).ok, true);
});
test('checkMeta: từ chối đúng lý do', () => {
  const why = (id: string, r = rules): string => { const c = checkMeta(FIXTURES[id], r); assert.equal(c.ok, false, id); return (c as { reason: string }).reason; };
  assert.match(why('noEmbed0001'), /không cho phép phát/);
  assert.match(why('private0001'), /không công khai/i);
  assert.match(why('unlisted001'), /không công khai/);
  assert.match(why('ageLimit001'), /độ tuổi/);
  assert.match(why('noVietnam01'), /Việt Nam/);
  assert.match(why('onlyUS00001'), /Việt Nam/);
  assert.match(why('tooLong0001'), /tối đa 15 phút/);
  assert.match(why('upcoming001'), /chưa bắt đầu/);
  assert.match(why('missing0001'), /Không tìm thấy/);
  assert.match(why('liveNow0001', { ...rules, allowLive: false }), /trực tiếp/);
});
test('metaFromItem: dữ liệu API thiếu trường → an toàn (bị từ chối)', () => {
  const m = metaFromItem({ id: 'dQw4w9WgXcQ', snippet: { title: 'X' } });
  assert.ok(m);
  assert.equal(m!.embeddable, false);
  assert.equal(checkMeta(m, rules).ok, false);
  assert.equal(metaFromItem({ id: 'bad' }), null);
  const full = metaFromItem({
    id: 'dQw4w9WgXcQ', status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
    contentDetails: { duration: 'PT3M33S', contentRating: {}, regionRestriction: { blocked: ['DE'] } },
    snippet: { title: 'Bài hát\u0007', channelTitle: 'Kênh', liveBroadcastContent: 'none' },
  });
  assert.equal(full!.durationSec, 213);
  assert.equal(full!.title, 'Bài hát');
  assert.equal(checkMeta(full, rules).ok, true);
});
test('VideoCache: hết hạn + giới hạn kích thước', () => {
  const c = new VideoCache(1000, 2);
  c.set('a', null, 0); c.set('b', null, 0); c.set('c', null, 0);
  assert.equal(c.get('a', 10), undefined);
  assert.ok(c.get('c', 10));
  assert.equal(c.get('c', 5000), undefined);
});

// ---------------------------------------------------------------- kiểm duyệt
test('checkName: hợp lệ', () => {
  for (const n of ['Hào', 'Minh Anh', 'Tèo_99', "O'Neil", 'Đặng Thị Ngọc Ánh']) assert.equal(checkName(n, 2, 20).ok, true, n);
});
test('checkName: từ chối', () => {
  for (const n of ['A', '   ', 'abcdefghijklmnopqrstuvwxy', 'admin', 'Admin 123', 'Quản trị viên', 'shop.vn', 'abc<script>', 'Đm mày', 'VibeCinema', 'lồn', '😀😀']) {
    assert.equal(checkName(n, 2, 20).ok, false, n);
  }
  assert.equal(checkName('Bảo', 2, 20).ok, true);
  assert.equal(checkName('Các bạn', 2, 20).ok, true); // "các" không bị nhầm với từ bậy
  assert.equal(checkName('Buổi tối', 2, 20).ok, true);
});
test('nameKey: so trùng tên không phân biệt dấu / hoa thường; tên không phải chữ Latin không trùng nhau oan', () => {
  assert.equal(nameKey('Hào'), nameKey('hao'));
  assert.equal(nameKey('Minh  Anh'), nameKey('minhanh'));
  assert.notEqual(nameKey('李明'), nameKey('王芳'));
  assert.notEqual(nameKey('李明'), '');
  assert.equal(checkName('аdmin', 2, 20).ok, false); // "а" Kirin trông như a Latin
});
test('checkChat: chặn link, che từ bậy, giữ chữ thường', () => {
  assert.equal(checkChat('xem ở shopee.vn nè', 140).ok, false);
  assert.equal(checkChat('vào www.abc.com', 140).ok, false);
  assert.equal(checkChat('https://youtu.be/dQw4w9WgXcQ', 140).ok, false);
  assert.equal(checkChat('bit.ly/abc', 140).ok, false);
  const r = checkChat('phim hay vl luôn đm', 140);
  assert.ok(r.ok);
  assert.equal((r as { text: string }).text, 'phim hay *** luôn ***');
  assert.equal(maskProfanity('Các bạn ơi, buổi tối vui nhé'), 'Các bạn ơi, buổi tối vui nhé');
  assert.equal(maskProfanity('đmmmm'), '***');
  assert.equal(maskProfanity('con mẹ mày'), '*** *** ***');
  assert.equal(maskProfanity('mẹ mày đẹp'), '*** *** đẹp');
  assert.equal(checkChat('   ', 140).ok, false);
  assert.ok(!hasLink('3.5 điểm'));
});
test('cleanText: bỏ ký tự vô hình, gộp khoảng trắng, cắt độ dài', () => {
  assert.equal(cleanText('a​ b\n\nc', 50), 'a b c');
  assert.equal(cleanText('aaaaaaaaaaaaaa', 50), 'aaaaaa');
  const emojis = Array.from({ length: 200 }, (_, i) => String.fromCodePoint(0x1f600 + (i % 50))).join('');
  assert.equal(Array.from(cleanText(emojis, 140)).length, 140);
  assert.equal(cleanText('😀'.repeat(200), 140), '😀'.repeat(6)); // lặp dài bị rút gọn
});
test('Bucket + WindowCounter', () => {
  const b = new Bucket(2, 1, 0);
  assert.ok(b.take(1, 0)); assert.ok(b.take(1, 0)); assert.ok(!b.take(1, 0));
  assert.ok(b.take(1, 1000));
  const w = new WindowCounter(1000, 2);
  assert.ok(w.hit('a', 0)); assert.ok(w.hit('a', 10)); assert.ok(!w.hit('a', 20)); assert.ok(w.hit('a', 1500));
});

// ---------------------------------------------------------------- giao thức
test('parseClientMsg: id phòng bản sao dài (congvien-2) không bị bỏ', () => {
  assert.deepEqual(parseClientMsg('{"t":"spec","room":"congvien-2"}'), { t: 'spec', room: 'congvien-2' });
  assert.equal((parseClientMsg('{"t":"join","name":"Ab","look":{},"room":"congvien-2","token":"","ck":""}') as { room: string }).room, 'congvien-2');
  assert.equal(parseClientMsg('{"t":"spec","room":"congvien-1"}'), null);
  assert.deepEqual(parseClientMsg('{"t":"switch","room":"bien-2"}'), { t: 'switch', room: 'bien-2' });
  assert.equal(parseClientMsg('{"t":"switch","room":"../x"}'), null);
});
test('parseClientMsg: nhận đúng dạng, bỏ rác', () => {
  assert.deepEqual(parseClientMsg('{"t":"move","x":3.2,"y":5,"d":1,"c":1234.6,"m":1}'), { t: 'move', x: 3.2, y: 5, d: 1, c: 1235, m: 1 });
  assert.equal(parseClientMsg('{"t":"move","x":"3","y":5,"d":1,"c":1}'), null);
  assert.equal(parseClientMsg('{"t":"move","x":3,"y":5,"d":9,"c":1}'), null);
  assert.equal(parseClientMsg('{"t":"act","a":"nope","c":1}'), null);
  assert.deepEqual(parseClientMsg('{"t":"act","a":"hiphop","c":5}'), { t: 'act', a: 'hiphop', c: 5 });
  assert.equal(parseClientMsg('{"t":"emo","e":"💩"}'), null);
  assert.equal(parseClientMsg('{"t":"adm","op":"ban","pid":3}'), null);
  assert.deepEqual(parseClientMsg('{"t":"adm","op":"ban","pid":3,"hours":24}'), { t: 'adm', op: 'ban', pid: 3, hours: 24 });
  assert.equal(parseClientMsg('not json'), null);
  assert.equal(parseClientMsg('[]'), null);
});

// ---------------------------------------------------------------- sơ đồ rạp
test('isWalkable: trong rạp được, tường / sân khấu / loa / quầy thì không', () => {
  assert.ok(isWalkable(16, 3));
  assert.ok(isWalkable(SEATS[0].x, SEATS[0].y)); // ghế đi vào được
  assert.ok(!isWalkable(16, 0.3)); // sân khấu
  assert.ok(!isWalkable(0.5, 5)); // tường trái
  assert.ok(!isWalkable(HALL.W - 0.5, 5)); // tường phải
  assert.ok(!isWalkable(16, HALL.H + 0.5)); // tường cuối
  assert.ok(!isWalkable(1.9, 1.2)); // loa trái
  assert.ok(!isWalkable(HALL.speakers[1].x + 0.6, 1.0)); // loa phải
  assert.ok(!isWalkable(HALL.counter.x + 0.3, HALL.counter.y + 1)); // quầy bar
  assert.ok(!isWalkable(NaN, 3));
});
test('moveWithCollision: trượt dọc tường, không xuyên', () => {
  const r = moveWithCollision(2.0, 5, -5, 0); // đâm tường trái
  assert.ok(r.x >= HALL.bounds.minX && isWalkable(r.x, r.y));
  const r2 = moveWithCollision(16, 2, 0, -10); // lao lên sân khấu
  assert.ok(r2.y >= HALL.bounds.minY);
  const r3 = moveWithCollision(5, 3, 3, 3); // đi chéo tự do
  assert.ok(Math.abs(r3.x - 8) < 1e-9 && Math.abs(r3.y - 6) < 1e-9);
  const r4 = moveWithCollision(HALL.counter.x - 4, 3, 5, 0); // đâm vào quầy bar
  assert.ok(r4.x < HALL.counter.x && isWalkable(r4.x, r4.y));
});
test('clampToWalkable + spawnPoint luôn đứng được', () => {
  for (const [x, y] of [[-5, -5], [50, 50], [1.9, 1.2], [HALL.counter.x + 0.4, 3], [NaN, NaN]]) {
    const p = clampToWalkable(x, y);
    assert.ok(isWalkable(p.x, p.y), `${x},${y}`);
  }
  for (let i = 0; i < 200; i++) { const s = spawnPoint(); assert.ok(isWalkable(s.x, s.y)); }
});
test('ghế: đủ chỗ, tìm ghế gần, ngồi đúng chỗ', () => {
  assert.equal(SEATS.length, HALL.rows.length * HALL.blocks.reduce((s, b) => s + b.n, 0));
  assert.ok(SEATS.length >= 120, 'rạp lớn: đầy phòng (60 người) vẫn còn hơn nửa ghế trống');
  const s = SEATS[10];
  assert.equal(nearestSeat(s.x + 0.2, s.y - 0.1, 0.5), s);
  assert.equal(seatAt(s.x, s.y), s);
  assert.equal(seatAt(s.x + 0.3, s.y), null);
});
test('ngoại hình: chỉ nhận giá trị trong bảng', () => {
  const l = normalizeLook({ skin: 'url(javascript:x)', hair: '#3A2A1E', hairStyle: 'mohawk', shirt: 'red', pants: 1, accessory: 'cap' });
  assert.equal(l.hair, '#3a2a1e');
  assert.equal(l.accessory, 'cap');
  assert.notEqual(l.skin, 'url(javascript:x)');
  assert.equal(l.hairStyle, 'short');
  assert.equal(l.body, 'nam', 'ngoại hình cũ tóc ngắn → nam');
  assert.equal(l.facial, 'none');
  assert.equal(normalizeLook({ hairStyle: 'ponytail' }).body, 'nu', 'ngoại hình cũ tóc đuôi ngựa → nữ');
  assert.equal(normalizeLook({ body: 'nam', facial: 'rau' }).facial, 'rau');
  assert.equal(normalizeLook({ body: 'nu', facial: 'rau' }).facial, 'none', 'nữ không có râu');
  assert.equal(normalizeLook({ body: 'robot' }).body, 'nam');
  const bodies = new Set();
  for (let i = 0; i < 50; i++) { const r = randomLook(); assert.deepEqual(normalizeLook(r), r, 'ngoại hình ngẫu nhiên phải hợp lệ'); bodies.add(r.body); }
  assert.equal(bodies.size, 2, 'ngẫu nhiên ra cả nam lẫn nữ');
});
test('rạp: id phòng, tên, bản sao', () => {
  assert.equal(VENUES.length, 4);
  assert.deepEqual(parseRoomId('bien-2'), { venue: VENUES.find((v) => v.id === 'bien'), n: 2 });
  assert.equal(parseRoomId('nhung')!.n, 1);
  for (const bad of ['1', 'bien-1', 'bien-10', 'BIEN', 'xyz', 'bien-2-3', '', null, 42]) assert.equal(parseRoomId(bad), null, String(bad));
  assert.equal(roomName('doxe'), 'Rạp Đỗ Xe');
  assert.equal(roomName('congvien-3'), 'Rạp Công Viên 3');
  assert.ok(VENUES.every((v) => ROOM_ID_RE.test(v.id) && v.name && v.emoji));
});
test('động tác: 8 động tác, phím 1–8', () => {
  assert.equal(ACTIONS.length, 8);
  assert.deepEqual(ACTIONS.map((a) => a.key), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(!ACTIONS.some((a) => /ke/i.test(a.label.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).find((w) => w.toLowerCase() === 'ke') ?? '')));
});

// ---------------------------------------------------------------- http → https (tên miền trỏ thẳng VPS)
test('httpsRedirectUrl: chỉ chuyển khi người xem vào bằng http, không bao giờ vòng lặp', () => {
  const req = (headers: Record<string, string>, url = '/?phong=bien'): IncomingMessage => ({ headers, url } as unknown as IncomingMessage);
  const site = 'https://cinema.vibe-coder.fun';
  assert.equal(httpsRedirectUrl(req({ host: 'cinema.vibe-coder.fun' }), site), ''); // không qua proxy (dev / test)
  assert.equal(httpsRedirectUrl(req({ host: 'cinema.vibe-coder.fun', 'x-forwarded-proto': 'http' }), site), 'https://cinema.vibe-coder.fun/?phong=bien');
  assert.equal(httpsRedirectUrl(req({ host: 'cinema.vibe-coder.fun', 'x-forwarded-proto': 'https' }), site), '');
  // Cloudflare Flexible: nginx nhận http nhưng người xem dùng https → không chuyển (tránh vòng lặp)
  assert.equal(httpsRedirectUrl(req({ host: 'cinema.vibe-coder.fun', 'x-forwarded-proto': 'http', 'cf-visitor': '{"scheme":"https"}' }), site), '');
  assert.equal(httpsRedirectUrl(req({ host: 'cinema.vibe-coder.fun', 'x-forwarded-proto': 'https', 'cf-visitor': '{"scheme":"http"}' }), site), 'https://cinema.vibe-coder.fun/?phong=bien');
  // Host lạ (gọi thẳng IP kèm Host giả) → vẫn về đúng tên miền SITE_URL
  assert.equal(httpsRedirectUrl(req({ host: 'evil.example', 'x-forwarded-proto': 'http' }, '/'), site), 'https://cinema.vibe-coder.fun/');
  assert.equal(httpsRedirectUrl(req({ host: 'localhost:3300', 'x-forwarded-proto': 'http' }), ''), '');
  assert.equal(httpsRedirectUrl(req({ host: 'bad host!', 'x-forwarded-proto': 'http' }), ''), '');
});

test('pickEncoding: chọn br > gzip, tôn trọng q=0', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.8'), 'gzip');
  assert.equal(pickEncoding('identity'), '');
  assert.equal(pickEncoding(undefined), '');
  assert.equal(pickEncoding('gzip;q=0'), '');
});

if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`\n❌ test-unit: ${failures.length} lỗi, ${passed} đạt`);
  process.exit(1);
}
console.log(`✅ test-unit: ${passed} mục đạt`);
