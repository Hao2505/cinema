// Điểm vào production / dev: nạp .env, dựng app thật (gọi YouTube Data API thật), lắng nghe cổng, tắt êm khi nhận tín hiệu.
import { config as loadDotenv } from 'dotenv';
import { VENUES } from '../public/js/shared/hall.js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { setExtraBadWords } from './moderation.js';
import { createYouTubeClient } from './youtube.js';

loadDotenv({ quiet: true });
const cfg = loadConfig();
setExtraBadWords((process.env.BLOCK_WORDS ?? '').split(',').map((w) => w.trim()).filter(Boolean));
const youtube = createYouTubeClient(cfg.ytApiKey);
const app = createApp(cfg, { youtube, dataDir: cfg.persist ? cfg.dataDir : null });

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n👋 Nhận ${signal} — lưu hàng chờ và tắt server…`);
  app.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// rạp không được sập vì một lỗi lẻ: ghi log rồi chạy tiếp
process.on('uncaughtException', (e) => console.error('[server] Lỗi không bắt được:', e));
process.on('unhandledRejection', (e) => console.error('[server] Promise bị từ chối không xử lý:', e));

app.listen(cfg.port, cfg.host).then((port) => {
  console.log('');
  console.log('🎬 VibeCinema — rạp chiếu phim 2D xem YouTube chung');
  console.log(`👉 Mở trình duyệt: http://localhost:${port}`);
  console.log(cfg.ytApiKey
    ? `▶️  Kiểm tra video: YouTube Data API (vùng ${cfg.ytRegion}, tối đa ${cfg.maxVideoMinutes} phút / video${cfg.allowLive ? `, live ${cfg.liveMaxMinutes} phút` : ', không nhận live'})`
    : '⚠️  Chưa có YT_API_KEY trong .env — chưa ai thêm được video (xem README mục "Tạo YouTube API key")');
  console.log(`👥 ${cfg.roomCapacity} người / phòng, ${VENUES.length} rạp × tối đa ${cfg.maxRooms} phòng · mỗi người chờ ${cfg.maxQueuePerUser} video · bỏ qua khi ≥ ${Math.round(cfg.skipVoteRatio * 100)}% phiếu`);
  console.log(cfg.persist ? `💾 Lưu hàng chờ / lệnh cấm / báo cáo: ${cfg.dataDir}` : '💾 Không lưu gì ra đĩa (PERSIST=false)');
  // không bao giờ in ADMIN_TOKEN
  console.log(cfg.adminToken ? '🛠️  Admin: mở trang kèm #admin=<ADMIN_TOKEN> một lần (mã không in ra đây)' : '🛠️  Admin: tắt (chưa đặt ADMIN_TOKEN)');
  console.log('');
}).catch((e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`❌ Cổng ${cfg.port} đang bị chương trình khác dùng. Đổi PORT trong .env rồi chạy lại.`);
  else console.error('❌ Không khởi động được server:', e.message);
  process.exit(1);
});
