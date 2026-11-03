// Đang chiếu + hàng chờ: thẻ video đang chiếu (tiến độ theo đồng hồ phòng), ô dán link YouTube, danh sách chờ,
// bỏ phiếu bỏ qua, báo cáo video. Admin gắn thêm nút qua registerAdminHooks (ui/admin.js).
import { send } from '../net.js';
import { store } from '../store.js';
import { el, fmtTime, setKids, setText } from '../util.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './toasts.js';

const $ = (id) => document.getElementById(id);
let admin = null; // { nowActions(n) → Node[], itemTools(q) → Node[] }
const seenQ = new Set(); // qid đã hiện (video mới thêm mới có hiệu ứng trượt vào)

export function registerAdminHooks(h) {
  admin = h;
  renderNow();
  renderQueue();
}

function progress() {
  const n = store.now;
  if (!n) return { pos: 0, dur: 0 };
  const pos = n.paused ? n.pos : Math.max(0, (store.serverNow() - n.at) / 1000);
  return { pos, dur: n.dur };
}

function isMine(q) {
  return q && q.byId === store.myId && store.joined;
}

function renderNow() {
  const n = store.now;
  const votes = store.votes;
  setText($('now-badge'), n ? (n.paused ? 'TẠM DỪNG' : n.filler ? 'KÊNH MẶC ĐỊNH' : n.live ? 'TRỰC TIẾP' : 'ĐANG CHIẾU') : 'MÀN HÌNH TRỐNG');
  setText($('now-title'), n ? n.title : 'Chưa có video');
  setText($('now-meta'), !n ? 'Dán link YouTube bên dưới để chiếu cho cả rạp.'
    : n.filler ? `${n.ch ? `${n.ch} · ` : ''}phát khi hàng chờ trống — dán link để chiếu video của bạn, kênh này nhường ngay.`
      : [n.ch, `thêm bởi ${n.by}`].filter(Boolean).join(' · '));
  const acts = [];
  if (n && store.joined && !n.filler) {
    const mine = isMine(n);
    acts.push(el('button', {
      type: 'button', class: `btn${votes.mine ? ' on' : ''}`, onclick: () => vote(),
      text: mine ? '⏭ Bỏ qua video của mình' : `⏭ ${votes.mine ? 'Đã bỏ phiếu' : 'Bỏ qua'} (${votes.n}/${votes.need})`,
      title: mine ? 'Bạn thêm video này nên bỏ qua được ngay' : `Đủ ${votes.need} phiếu thì chuyển bài`,
    }));
    acts.push(el('button', { type: 'button', class: 'btn btn-ghost', text: '🚩 Báo cáo', onclick: () => openReport(), title: 'Báo cáo video vi phạm' }));
  }
  if (n && store.joined && n.filler) {
    acts.push(el('button', { type: 'button', class: 'btn btn-ghost', text: '🚩 Báo cáo', onclick: () => openReport(), title: 'Báo cáo video vi phạm' }));
  }
  if (admin && n) acts.push(...admin.nowActions(n));
  setKids($('now-actions'), acts);
  // nút dưới màn hình (kênh mặc định: không bỏ phiếu — có video mới là tự nhường)
  const showTools = !!n && store.joined;
  $('btn-vote').hidden = !showTools || !!n?.filler;
  $('btn-report').hidden = !showTools;
  $('btn-vote').classList.toggle('on', !!votes.mine);
  setText($('vote-count'), n && isMine(n) ? '' : `${votes.n}/${votes.need}`);
  $('btn-vote').title = n && isMine(n) ? 'Bỏ qua video của mình' : `Bỏ phiếu bỏ qua — đủ ${votes.need} phiếu thì chuyển bài`;
  setText($('screen-title'), n ? n.title : '');
  tick();
}

function tick() {
  const n = store.now;
  if (!n) { setText($('now-time'), ''); $('now-fill').style.width = '0%'; return; }
  if (n.live) { setText($('now-time'), '● TRỰC TIẾP'); $('now-fill').style.width = '100%'; return; }
  const { pos, dur } = progress();
  // chưa rõ thời lượng (rạp kiểm cơ bản, không có API key): chỉ hiện đã chiếu bao lâu tới khi trình phát đo xong
  if (n.unk || !dur) { setText($('now-time'), fmtTime(pos)); $('now-fill').style.width = '0%'; return; }
  const p = Math.min(pos, dur);
  setText($('now-time'), `${fmtTime(p)} / ${fmtTime(dur)}`);
  $('now-fill').style.width = `${dur ? Math.min(100, (p / dur) * 100) : 0}%`;
}

function vote() {
  if (!store.now) return;
  send({ t: 'vote', on: isMine(store.now) ? true : !store.votes.mine });
}

function renderQueue() {
  const q = store.queue;
  setText($('q-count'), String(q.length));
  setText($('q-badge'), q.length ? String(q.length) : '');
  $('q-lock').hidden = !store.locked;
  const input = $('add-input');
  const lockedForMe = store.locked && !store.admin;
  input.disabled = lockedForMe || !store.joined;
  $('add-btn').disabled = lockedForMe || !store.joined;
  input.placeholder = !store.joined ? 'Vào rạp để thêm video…' : lockedForMe ? 'Admin đang khoá hàng chờ' : 'Dán link YouTube…';
  const items = q.map((it, i) => {
    const tools = [];
    if (isMine(it) || store.admin) {
      // admin xoá bằng lệnh admin (chạy được cả khi admin chưa vào rạp); người thường xoá video của mình
      const del = () => (store.admin && !isMine(it) ? send({ t: 'adm', op: 'remove', qid: it.qid }) : send({ t: 'q_del', qid: it.qid }));
      tools.push(el('button', { type: 'button', text: '✕', 'aria-label': `Xoá "${it.title}"`, title: 'Xoá khỏi hàng chờ', onclick: del }));
    }
    if (admin) tools.unshift(...admin.itemTools(it, i));
    const fresh = seenQ.size > 0 && !seenQ.has(it.qid);
    return el('li', { class: `q-item${isMine(it) ? ' mine' : ''}${fresh ? ' new' : ''}` },
      el('span', { class: 'q-pos', text: String(i + 1) }),
      el('div', { style: { minWidth: '0' } },
        el('div', { class: 'q-title', text: it.title, title: it.title }),
        el('div', { class: 'q-meta', text: `${it.live ? 'Trực tiếp' : it.unk ? 'chưa rõ thời lượng' : fmtTime(it.dur)} · ${it.by}${it.ch ? ` · ${it.ch}` : ''}` }),
      ),
      el('div', { class: 'q-tools' }, tools),
    );
  });
  setKids($('queue-list'), items);
  if (!seenQ.size) seenQ.add(-1); // lần vẽ đầu: không hiệu ứng
  for (const it of q) seenQ.add(it.qid);
  if (seenQ.size > 500) { seenQ.clear(); seenQ.add(-1); for (const it of q) seenQ.add(it.qid); }
}

function openReport() {
  const n = store.now;
  if (!n) return;
  const reasons = [
    ['copyright', 'Vi phạm bản quyền (tôi là chủ nội dung / đại diện)'],
    ['inappropriate', 'Nội dung không phù hợp (bạo lực, khiêu dâm, thù ghét…)'],
    ['spam', 'Spam / quảng cáo / lừa đảo'],
    ['other', 'Lý do khác'],
  ];
  const note = el('textarea', { maxlength: '300', placeholder: 'Ghi chú thêm (không bắt buộc) — với khiếu nại bản quyền, ghi cách liên hệ với bạn' });
  const radios = reasons.map(([v, label], i) => el('label', { class: 'radio' },
    el('input', { type: 'radio', name: 'reason', value: v, checked: i === 0 }), el('span', { text: label })));
  const body = [
    el('p', null, 'Báo cáo video ', el('b', { text: `"${n.title}"` }), '. Admin sẽ xem và gỡ ngay nếu vi phạm; nhiều người cùng báo cáo thì rạp tự gỡ.'),
    ...radios,
    note,
    el('div', { class: 'row', style: { marginTop: '10px' } },
      el('button', {
        type: 'button', class: 'btn btn-accent', text: 'Gửi báo cáo',
        onclick: () => {
          const r = document.querySelector('#sheet-body input[name="reason"]:checked');
          send({ t: 'report', kind: 'video', target: n.v, reason: r ? r.value : 'other', note: note.value.slice(0, 300) });
          closeSheet();
        },
      }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Huỷ', onclick: () => closeSheet() }),
    ),
  ];
  openSheet('report', '🚩 Báo cáo video', body);
}

export function initQueue() {
  const form = $('add-form');
  const input = $('add-input');
  const msg = $('add-msg');
  let pending = 0;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) { input.focus(); return; }
    if (!send({ t: 'q_add', url })) { toast('Đang mất kết nối, thử lại sau nhé.', 'warn'); return; }
    msg.className = 'add-msg';
    setText(msg, 'Đang kiểm tra video với YouTube…');
    $('add-btn').disabled = true;
    clearTimeout(pending);
    pending = setTimeout(() => { $('add-btn').disabled = false; }, 8000);
  });
  let msgTimer = 0;
  store.on('queueResult', (r) => {
    clearTimeout(pending);
    $('add-btn').disabled = store.locked && !store.admin;
    msg.className = `add-msg ${r.ok ? 'ok' : 'err'}`;
    setText(msg, r.text);
    if (r.ok) input.value = '';
    // thông báo chỉ tạm thời: tự ẩn để trả chỗ cho danh sách chờ
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => setText(msg, ''), r.ok ? 4500 : 9000);
  });
  input.addEventListener('input', () => { if (msg.classList.contains('err')) setText(msg, ''); });
  $('btn-vote').addEventListener('click', () => vote());
  $('btn-report').addEventListener('click', () => openReport());
  store.on('now', renderNow);
  store.on('votes', renderNow);
  store.on('queue', () => { renderQueue(); renderNow(); });
  store.on('welcome', () => { renderQueue(); renderNow(); });
  setInterval(tick, 500);
  renderNow();
  renderQueue();
  return { openReport };
}
