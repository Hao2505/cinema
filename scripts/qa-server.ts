// Server để QA trên máy dev: dùng YouTube GIẢ (scripts/fake-youtube.ts), không ghi đĩa, mã admin cố định cho máy dev.
//   npx tsx scripts/qa-server.ts            → http://localhost:3399  (admin: http://localhost:3399/#admin=qa-local-admin)
// Biến: PORT (mặc định 3399), CAPACITY (người / phòng). Không bao giờ dùng mã admin thật ở đây.
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createFakeYouTube } from './fake-youtube.js';

const port = Number(process.env.PORT || 3399);
const cfg = loadConfig({
  port, host: '127.0.0.1', adminToken: 'qa-local-admin', persist: false, ytApiKey: 'fake',
  roomCapacity: Number(process.env.CAPACITY || 60), maxConnPerIp: 500, joinsPerMinute: 10000,
});
const app = createApp(cfg, { youtube: createFakeYouTube(), dataDir: null });
app.listen(port, '127.0.0.1').then((p) => console.log(`QA server: http://localhost:${p}  (admin: #admin=qa-local-admin, YouTube giả)`));
const stop = () => { app.close().finally(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
