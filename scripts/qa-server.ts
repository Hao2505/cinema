// Server để QA trên máy dev: dùng YouTube GIẢ (scripts/fake-youtube.ts), không ghi đĩa, mã admin cố định cho máy dev.
//   npx tsx scripts/qa-server.ts            → http://localhost:3399  (admin: http://localhost:3399/#admin=qa-local-admin)
// Biến: PORT (mặc định 3399), CAPACITY (người / phòng), NO_KEY=1 (giả như chưa có YT_API_KEY → rạp kiểm cơ bản bằng
// oEmbed giả, trình phát thật đo độ dài). Không bao giờ dùng mã admin thật ở đây.
// Thử phòng riêng: tạo phòng ở một tab, mở link mời ở cửa sổ ẨN DANH / trình duyệt khác — các tab cùng hồ sơ dùng chung
// khoá máy (vc.ck) nên server coi là chính chủ phòng (không hỏi mật khẩu). Tab đang là admin (#admin=…) cũng vào thẳng.
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createFakeYouTube } from './fake-youtube.js';

const port = Number(process.env.PORT || 3399);
const cfg = loadConfig({
  port, host: '127.0.0.1', adminToken: 'qa-local-admin', persist: false, ytApiKey: 'fake',
  roomCapacity: Number(process.env.CAPACITY || 60), maxConnPerIp: 500, joinsPerMinute: 10000,
});
const noKey = process.env.NO_KEY === '1';
const app = createApp(cfg, { youtube: createFakeYouTube({ noKey }), dataDir: null });
app.listen(port, '127.0.0.1').then((p) => console.log(`QA server: http://localhost:${p}  (admin: #admin=qa-local-admin, YouTube giả${noKey ? ', KHÔNG key' : ''})`));
const stop = () => { app.close().finally(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
