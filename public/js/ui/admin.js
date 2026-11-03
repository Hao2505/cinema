// Công cụ admin — chỉ nạp khi server xác nhận trình duyệt này là admin (cookie HttpOnly đặt qua #admin=<mã>).
// Bỏ qua / tạm dừng / chiếu tiếp, đưa bài lên đầu, xoá bài, khoá hàng chờ, tắt tiếng / mời ra / cấm, xem báo cáo,
// bỏ cấm, bỏ chặn video, xoá chat, danh sách phòng riêng + đóng phòng, thoát admin. Người thường không tải file này và không
// thấy gì.
import { adminLogout, send } from '../net.js';
import { store } from '../store.js';
import { el, setKids } from '../util.js';
import { isPrivateRoomId, roomName, venueById } from '../shared/hall.js';
import { registerAdminHooks } from './queue.js';
import { registerUserAdmin } from './usercard.js';
import { openSheet, sheetOpen } from './sheet.js';
import { toast } from './toasts.js';

const $ = (id) => document.getElementById(id);
const adm = (op, extra = {}) => send({ t: 'adm', op, ...extra });

let state = null;
let tab = 'players';
let closeAsk = ''; // phòng riêng đang hỏi lại "đóng phòng?" (xác nhận ngay trong tấm, không dùng window.confirm)

/** tên phòng trong báo cáo: phòng riêng chỉ ghi id (tên phòng riêng không cần lộ ra danh sách) */
const roomLabel = (id) => (isPrivateRoomId(id) ? `🔒 ${id}` : roomName(id));

function fmtAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return new Date(ms).toLocaleString('vi-VN');
}

const ago = (ms) => (Number.isFinite(ms) && ms > 0 ? fmtAgo(ms) : '?');

function userButtons(p, after) {
  const b = (text, fn, cls = 'btn') => el('button', { type: 'button', class: cls, text, onclick: () => { fn(); after?.(); } });
  return [
    b('🔇 10 phút', () => adm('mute', { pid: p.id, minutes: 10 })),
    b('🔇 1 giờ', () => adm('mute', { pid: p.id, minutes: 60 })),
    b('🔊 Bật tiếng', () => adm('unmute', { pid: p.id })),
    b('👢 Mời ra', () => adm('kick', { pid: p.id }), 'btn btn-danger'),
    b('⛔ Cấm 1 ngày', () => { if (confirm(`Cấm ${p.name} 1 ngày?`)) adm('ban', { pid: p.id, hours: 24 }); }, 'btn btn-danger'),
    b('⛔ Cấm hẳn', () => { if (confirm(`Cấm ${p.name} vĩnh viễn?`)) adm('ban', { pid: p.id, hours: 0 }); }, 'btn btn-danger'),
  ];
}

function renderSheet() {
  if (!sheetOpen('admin')) return;
  const s = state;
  const tabs = [['players', '👥 Người xem'], ['reports', '🚩 Báo cáo'], ['priv', '🔒 Phòng riêng'], ['bans', '⛔ Bị cấm'], ['blocked', '🚫 Video bị gỡ']];
  const head = el('div', { class: 'adm-tabs' }, tabs.map(([id, label]) => el('button', {
    type: 'button', class: `btn${tab === id ? ' on' : ''}`, text: label,
    onclick: () => { tab = id; closeAsk = ''; renderSheet(); if (id === 'priv') adm('state'); }, // phòng riêng đổi liên tục: lấy mới
  })));
  const controls = el('div', { class: 'row' },
    el('button', { type: 'button', class: `btn${store.locked ? ' on' : ''}`, text: store.locked ? '🔓 Mở hàng chờ' : '🔒 Khoá hàng chờ', onclick: () => adm('lock', { on: !store.locked }) }),
    el('button', { type: 'button', class: 'btn', text: '⏭ Bỏ qua video', onclick: () => adm('skip'), disabled: !store.now }),
    store.now?.paused
      ? el('button', { type: 'button', class: 'btn', text: '▶ Chiếu tiếp', onclick: () => adm('resume') })
      : el('button', { type: 'button', class: 'btn', text: '⏸ Tạm dừng', onclick: () => adm('pause'), disabled: !store.now || store.now.live }),
    el('button', { type: 'button', class: 'btn btn-ghost', text: '🧹 Xoá chat', onclick: () => { if (confirm('Xoá toàn bộ khung chat của phòng?')) adm('clear_chat'); } }),
  );
  let list;
  if (!s) list = el('p', { class: 'adm-empty', text: 'Đang tải…' });
  else if (tab === 'players') {
    const items = s.players.filter((p) => !p.me).map((p) => el('li', null,
      el('div', null, el('span', { class: 't', text: p.name }), el('span', { class: 'm', text: ` · vào ${fmtAgo(p.joinedAt)}${p.ghost ? ' · đang kết nối lại' : ''}${p.muted ? ' · 🔇 đang tắt tiếng' : ''}` })),
      el('div', { class: 'row' }, userButtons(p, () => setTimeout(() => adm('state'), 300))),
    ));
    list = items.length ? el('ul', { class: 'adm-list' }, items) : el('p', { class: 'adm-empty', text: 'Chưa có ai khác trong phòng.' });
  } else if (tab === 'reports') {
    const items = (s.reports || []).map((r) => el('li', null,
      el('div', { class: 't', text: `${r.kind === 'video' ? '🎬' : '👤'} ${r.what}` }),
      el('div', { class: 'm', text: `${r.reason}${r.note ? ` — "${r.note}"` : ''} · ${r.by} · ${roomLabel(r.room)} · ${fmtAgo(r.at)}` }),
    ));
    list = items.length ? el('ul', { class: 'adm-list' }, items) : el('p', { class: 'adm-empty', text: 'Chưa có báo cáo nào. (Báo cáo cũ lưu trong data/reports.jsonl trên server.)' });
  } else if (tab === 'priv') {
    // phòng riêng đang mở (thao tác gần nhất lên đầu): đóng phòng khi xử lý báo cáo / vi phạm — mọi người về rạp chung
    const rooms = Array.isArray(s.privRooms) ? s.privRooms : [];
    const items = rooms.map((r) => el('li', null,
      el('div', { class: 't', text: `${venueById(r.venue)?.emoji || '🔒'} ${r.name}` }),
      el('div', { class: 'm', text: `🔒 ${r.id} · ${r.count}/${r.cap} người · ${r.now ? `Đang chiếu: ${r.now}` : 'Màn hình trống'}` }),
      el('div', { class: 'm', text: `Tạo ${ago(r.createdAt)} · thao tác gần nhất ${ago(r.lastInput)}` }),
      closeAsk === r.id
        ? el('div', { class: 'row' },
          el('span', { class: 'm', text: 'Đóng phòng này? Mọi người sẽ về rạp chung.' }),
          el('button', {
            type: 'button', class: 'btn btn-danger', text: 'Đóng phòng',
            onclick: () => { closeAsk = ''; adm('close_room', { room: r.id }); setTimeout(() => adm('state'), 400); renderSheet(); },
          }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Huỷ', onclick: () => { closeAsk = ''; renderSheet(); } }))
        : el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn btn-danger', text: 'Đóng phòng', onclick: () => { closeAsk = r.id; renderSheet(); } })),
    ));
    list = items.length ? el('ul', { class: 'adm-list' }, items) : el('p', { class: 'adm-empty', text: 'Chưa có phòng riêng nào đang mở.' });
  } else if (tab === 'bans') {
    const items = (s.bans || []).map((b) => el('li', null,
      el('div', null, el('span', { class: 't', text: b.name }), el('span', { class: 'm', text: ` · ${b.until ? `tới ${new Date(b.until).toLocaleString('vi-VN')}` : 'vĩnh viễn'} · ${fmtAgo(b.at)}` })),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Bỏ cấm', onclick: () => adm('unban', { id: b.id }) })),
    ));
    list = items.length ? el('ul', { class: 'adm-list' }, items) : el('p', { class: 'adm-empty', text: 'Không ai bị cấm.' });
  } else {
    const items = (s.blocked || []).map((b) => el('li', null,
      el('div', { class: 't', text: b.title }),
      el('div', { class: 'm', text: `${b.v} · ${b.reason} · ${fmtAgo(b.at)}` }),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Bỏ chặn', onclick: () => adm('unblock', { v: b.v }) })),
    ));
    list = items.length ? el('ul', { class: 'adm-list' }, items) : el('p', { class: 'adm-empty', text: 'Chưa gỡ video nào.' });
  }
  const warn = s && !s.ytReady ? el('p', { style: { color: 'var(--warn)' }, text: '⚠️ Chưa có YT_API_KEY — rạp đang kiểm video cơ bản (oEmbed): vẫn thêm được video, nhưng video 18+ / chặn ở VN chỉ bị bỏ qua lúc tới lượt và chưa biết trước độ dài (chiếu tối đa giới hạn phút). Xem README mục "Tạo YouTube API key".' }) : null;
  setKids($('sheet-body'), warn, controls, head, list,
    el('h3', { text: 'Phiên admin' }),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn btn-ghost', text: '🚪 Thoát admin trên máy này', onclick: () => adminLogout() })),
  );
}

export function initAdmin() {
  const btn = $('btn-admin');
  btn.hidden = false;
  btn.addEventListener('click', () => {
    openSheet('admin', '🛠 Quản trị rạp', [el('p', { text: 'Đang tải…' })]);
    adm('state');
    renderSheet();
  });
  store.on('admin', (msg) => {
    if (msg.kind === 'state') { state = msg; renderSheet(); }
    else if (msg.kind === 'note' && typeof msg.text === 'string') toast(msg.text, 'warn', 6000);
  });
  store.on('queue', renderSheet);
  store.on('now', renderSheet);
  registerAdminHooks({
    nowActions(n) {
      const b = (icon, label, fn, cls = 'btn btn-icon') => el('button', { type: 'button', class: cls, text: icon, title: label, 'aria-label': label, onclick: fn });
      return [el('span', { class: 'adm-group', role: 'group', 'aria-label': 'Quản trị video' },
        b('⏭', 'Admin bỏ qua video này', () => adm('skip'), 'btn btn-icon btn-danger'),
        n.paused ? b('▶', 'Chiếu tiếp cả phòng', () => adm('resume')) : b('⏸', n.live ? 'Video trực tiếp không dừng được' : 'Dừng cả phòng', () => { if (!n.live) adm('pause'); }),
        b(store.locked ? '🔓' : '🔒', store.locked ? 'Mở hàng chờ' : 'Khoá hàng chờ (chỉ admin thêm video)', () => adm('lock', { on: !store.locked }), `btn btn-icon${store.locked ? ' on' : ''}`),
        b('🚫', 'Gỡ hẳn video (khiếu nại bản quyền) — không ai thêm lại được', () => { if (confirm(`Gỡ hẳn "${n.title}" khỏi rạp? (bỏ chặn được trong bảng quản trị)`)) adm('block', { v: n.v }); }, 'btn btn-icon btn-danger'),
      )];
    },
    itemTools(q, i) {
      return i > 0 ? [el('button', { type: 'button', text: '⬆', 'aria-label': 'Đưa lên đầu', title: 'Đưa lên đầu hàng chờ', onclick: () => adm('top', { qid: q.qid }) })] : [];
    },
  });
  registerUserAdmin((a, close) => userButtons(a, close));
}
