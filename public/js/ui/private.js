// Phòng riêng (có mật khẩu, luôn miễn phí): tấm "🔒 Tạo phòng riêng", thẻ mời bạn bè (lời mời để sao chép / gửi), phần
// "phòng riêng" đầu bảng chọn rạp (thành viên + công cụ chủ phòng: mời ra, đổi mật khẩu, số người tối đa, đóng phòng),
// xác nhận mời ra từ thẻ người xem. Mọi xác nhận nằm TRONG tấm (không dùng window.confirm — hộp thoại của trình duyệt có
// thể nằm đè trình phát YouTube và làm đứng vòng đồng bộ).
// Mật khẩu chỉ giữ trong bộ nhớ trang ngay sau khi tạo / đổi (để in vào lời mời) — không bao giờ lưu xuống máy.
import { DEFAULT_VENUE, VENUES, isPrivateRoomId, venueById } from '../shared/hall.js';
import { send } from '../net.js';
import { store } from '../store.js';
import { el, setKids, setText } from '../util.js';
import { normPass, passError } from './join.js';
import { closeSheet, openSheet, sheetOpen } from './sheet.js';
import { toast } from './toasts.js';

const CAP_CHOICES = [2, 4, 6, 10, 20];
const WAIT_MS = 12_000; // server chưa trả lời sau chừng này → mở lại nút, báo thử lại
const NO_REPLY = 'Máy chủ chưa trả lời — thử lại nhé.';
const OFFLINE = 'Đang mất kết nối, thử lại sau nhé.';

let H = null; // móc từ main.js: { ck, createName(), enterRoom(room), leavePrivate(), switchRoom(id) }
let passMem = null; // { room, pass } — mật khẩu vừa tạo / vừa đổi, chỉ trong bộ nhớ trang
let creating = null; // { pass, err, setBusy, owned } — tấm tạo phòng đang chờ server
let shareAfter = ''; // phòng vừa tạo: vào xong (welcome) thì mở thẻ mời
let closeOnWelcome = false; // [Vào lại] phòng của mình: vào xong thì đóng tấm tạo phòng
let op = null; // { op, at, status?, pass? } — lệnh chủ phòng đang chờ kết quả (proom_res)

/** chữ của dấu 🛡 thường trực (ô phòng, đầu bảng phòng riêng) khi quản trị viên rạp đang xem phòng */
export const ADMIN_WATCHING = 'Quản trị viên rạp đang xem phòng này';

// id phòng riêng nằm SAU dấu # — trình duyệt không bao giờ gửi phần này tới máy chủ (nhật ký truy cập, Referer) hay YouTube
const inviteLink = (room) => `${location.origin}/#phong=${room}`;
const emptyMin = () => Math.max(1, Math.round(Number(store.cfg.privEmptyMin) || 3));
/** độ dài video tối đa của phòng riêng (mặc định 720 phút → "12 giờ") */
const privLen = () => {
  const min = Math.max(1, Math.round(Number(store.cfg.privMaxMin) || 720));
  return min % 60 === 0 ? `${min / 60} giờ` : `${min} phút`;
};
const capChoices = (cur = 0) => {
  const max = Math.max(2, Number(store.cfg.privMax) || 20);
  const list = CAP_CHOICES.filter((n) => n <= max);
  if (cur >= 2 && cur <= max && !list.includes(cur)) list.push(cur);
  return list.sort((a, b) => a - b);
};

export function initPrivate(hooks) {
  H = hooks;
  store.on('welcome', () => {
    // mở thẻ mời SAU khi main.js xử lý xong welcome (ẩn màn vào rạp) — kẻo tấm hiện thoáng ở chỗ "nổi trên màn vào rạp"
    if (shareAfter && store.roomId === shareAfter) { shareAfter = ''; closeOnWelcome = false; queueMicrotask(() => openShareCard()); return; }
    if (closeOnWelcome) { closeOnWelcome = false; if (sheetOpen('create')) closeSheet(); }
  });
}

/** server tạo phòng / nhận mật khẩu (main.js chuyển tiếp proom_ok) */
export function privateOk(o) {
  if (!o.created || !creating) return;
  const c = creating;
  creating = null;
  passMem = { room: o.room, pass: c.pass };
  shareAfter = o.room;
  c.setBusy(true, 'Đã tạo phòng — đang vào…');
  // vào phòng không được (hiếm) → mở lại nút; lỗi vào rạp hiện trên màn vào rạp (main.js đóng tấm này)
  setTimeout(() => { if (sheetOpen('create')) c.setBusy(false); }, WAIT_MS);
}

/** kết quả proom_res thuộc tấm tạo phòng / công cụ chủ phòng → hiện ngay trong tấm. false = không phải của mình */
export function privateResult(r) {
  if (creating) {
    const c = creating;
    creating = null;
    c.setBusy(false);
    if (r.code === 'owned' && r.room) c.owned(r.text || 'Bạn đang có một phòng riêng.', r.room);
    else setText(c.err, r.text || 'Chưa tạo được phòng, thử lại nhé.');
    return true;
  }
  if (op && performance.now() - op.at < WAIT_MS) {
    const o = op;
    op = null;
    if (o.op === 'pass' && r.ok) {
      passMem = { room: store.roomId, pass: o.pass };
      openShareCard(r.text || 'Đã đổi mật khẩu. Người đang trong phòng vẫn ở lại; ai vào sau cần mật khẩu mới.');
      return true;
    }
    if (o.status?.isConnected) { o.status.classList.toggle('err', !r.ok); setText(o.status, r.text); }
    // tấm trên điện thoại che chỗ hiện toast → toast chỉ khi không có tấm nào mở
    if (!sheetOpen() && r.text) toast(r.text, r.ok ? 'ok' : 'warn', 6000);
    return true;
  }
  return false;
}

/** bị đưa ra khỏi phòng / phòng đóng: quên mật khẩu trong bộ nhớ, thôi chờ */
export function privateReset() {
  passMem = null;
  shareAfter = '';
  op = null;
}

function sendOp(o, extra = {}) {
  if (!send({ t: 'proom_op', op: o.op, ...extra })) {
    if (o.status) { o.status.classList.add('err'); setText(o.status, OFFLINE); }
    return false;
  }
  op = { ...o, at: performance.now() };
  return true;
}

// ---------------------------------------------------------------- ô chọn nhỏ (số người, rạp)
function chipGroup(label, items, value, onPick) {
  const btns = items.map((it) => el('button', {
    type: 'button', class: `chip${it.v === value ? ' on' : ''}`, text: it.text, title: it.title || null,
    'aria-label': it.title || null, 'aria-pressed': it.v === value ? 'true' : 'false', dataset: { v: String(it.v) },
    onclick: () => {
      for (const b of btns) {
        const on = b.dataset.v === String(it.v);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      onPick(it.v);
    },
  }));
  return el('div', { class: 'pr-chips', role: 'group', 'aria-label': label }, btns);
}

// ---------------------------------------------------------------- tấm tạo phòng
/** tấm "🔒 Tạo phòng riêng" — chưa vào rạp thì main.js đã kiểm tên trước (createName) */
export function openCreateSheet() {
  let cap = capChoices()[0] || 2;
  let venue = venueById(store.venue)?.id || DEFAULT_VENUE;
  const pass = el('input', {
    type: 'text', class: 'pr-input', id: 'pr-pass', maxlength: '64', placeholder: 'Bạn bè cần mật khẩu này để vào',
    autocapitalize: 'none', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go',
    'aria-describedby': 'pr-pass-hint',
  });
  const venueName = el('span', { class: 'pr-sub', text: venueById(venue)?.name || '' });
  const err = el('div', { class: 'pr-err', role: 'alert' });
  const ownedBox = el('div', { class: 'pr-owned', hidden: true });
  const go = el('button', { type: 'submit', class: 'btn btn-accent pr-go', id: 'pr-go', text: 'Tạo phòng & lấy link' });
  let timer = 0;
  const setBusy = (busy, text) => {
    clearTimeout(timer);
    go.disabled = busy;
    setText(go, busy ? text || 'Đang tạo phòng…' : 'Tạo phòng & lấy link');
  };
  const owned = (text, room) => {
    setText(err, '');
    setKids(ownedBox,
      el('span', { text }),
      el('button', {
        type: 'button', class: 'btn btn-accent', text: 'Vào lại',
        onclick: () => { closeOnWelcome = true; setBusy(true, 'Đang vào…'); H?.enterRoom(room); timer = setTimeout(() => setBusy(false), WAIT_MS); },
      }));
    ownedBox.hidden = false;
  };
  const submit = () => {
    if (creating) return;
    const p = normPass(pass.value);
    const e = passError(p);
    ownedBox.hidden = true;
    if (e) { setText(err, e); pass.focus(); return; }
    const name = H?.createName() || '';
    if (!name) { setText(err, 'Cần đặt tên trước khi tạo phòng.'); return; }
    setText(err, '');
    if (!send({ t: 'proom_new', pass: p, cap, venue, name, ck: H?.ck || '' })) { setText(err, OFFLINE); return; }
    creating = { pass: p, err, setBusy, owned };
    setBusy(true);
    timer = setTimeout(() => { if (creating) { creating = null; setBusy(false); setText(err, NO_REPLY); } }, WAIT_MS);
  };
  pass.addEventListener('input', () => { setText(err, ''); ownedBox.hidden = true; });
  const form = el('form', { class: 'pr-form', autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); submit(); } },
    el('label', { class: 'pr-label', for: 'pr-pass', text: 'Mật khẩu phòng (4–40 ký tự)' }),
    pass,
    el('p', { class: 'pr-hint', id: 'pr-pass-hint', text: 'Đặt mật khẩu riêng cho phòng — đừng dùng mật khẩu tài khoản thật (sẽ gửi kèm link cho bạn bè).' }),
    el('div', { class: 'pr-label', text: 'Số người tối đa' }),
    chipGroup('Số người tối đa', capChoices().map((n) => ({ v: n, text: String(n), title: `Tối đa ${n} người` })), cap, (v) => { cap = v; }),
    el('div', { class: 'pr-label' }, 'Khung cảnh ', venueName),
    chipGroup('Khung cảnh', VENUES.map((v) => ({ v: v.id, text: v.emoji, title: v.name })), venue, (v) => { venue = v; setText(venueName, venueById(v)?.name || ''); }),
    el('ul', { class: 'pr-notes' },
      // 12 giờ chỉ với video rạp kiểm đủ được qua YouTube Data API; rạp chưa có khoá API (cfg.ytReady = false) thì mọi video
      // chỉ qua kiểm cơ bản → giới hạn như rạp chung — không hứa 12 giờ
      el('li', { text: `${store.cfg.ytReady ? `Video dài tới ${privLen()}` : `Video tối đa ${Math.max(1, Math.round(Number(store.cfg.maxVideoMin) || 30))} phút như rạp chung`} · Phòng tự đóng khi không còn ai trong ${emptyMin()} phút.` }),
      el('li', { text: 'Vẫn chỉ chiếu video YouTube cho phép nhúng, kiểm như rạp chung.' }),
      el('li', { text: 'Quản trị viên rạp có thể vào phòng khi xử lý báo cáo.' })),
    err,
    ownedBox,
    go,
  );
  openSheet('create', '🔒 Tạo phòng riêng', form, () => { clearTimeout(timer); creating = null; });
}

// ---------------------------------------------------------------- thẻ mời bạn bè
function inviteText(room, pass) {
  const passLine = pass || (store.isOwner() ? '(bạn đã đặt lúc tạo phòng)' : '(mật khẩu của phòng)');
  return `Vào xem chung với mình trên VibeCinema 🎬\n${inviteLink(room)}\n🔑 Mật khẩu: ${passLine}`;
}

/** chọn toàn bộ chữ trong khung (để giữ ngón tay sao chép khi trình duyệt không cho tự sao chép) */
function selectBox(box) {
  try {
    const r = document.createRange();
    r.selectNodeContents(box);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch { /* bỏ qua */ }
}

/** sao chép chữ: Clipboard API (https) → dự phòng execCommand trên khung đã chọn (WebView cũ). false = không được */
async function copyText(text, box) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* WebView của Zalo / Messenger hay chặn — thử cách dưới */ }
  if (box) {
    selectBox(box);
    try { if (document.execCommand('copy')) return true; } catch { /* bỏ qua */ }
  }
  return false;
}

/** thẻ mời (sau khi tạo phòng / đổi mật khẩu, hoặc khi không tự sao chép link được) */
export function openShareCard(lead = '') {
  const room = store.roomId;
  if (!isPrivateRoomId(room)) return;
  const pass = passMem && passMem.room === room ? passMem.pass : '';
  const text = inviteText(room, pass);
  const box = el('div', { class: 'invite-box', text });
  const status = el('p', { class: 'pr-status', role: 'status' });
  const copyBtn = el('button', {
    type: 'button', class: 'btn btn-accent', id: 'pr-copy', text: '📋 Sao chép lời mời',
    onclick: async () => {
      if (await copyText(text, box)) {
        status.classList.remove('err');
        setText(status, 'Đã sao chép lời mời ✓ — dán vào Zalo / Messenger gửi bạn bè nhé.');
        toast('Đã sao chép lời mời ✓', 'ok', 3000);
      } else {
        selectBox(box);
        status.classList.add('err');
        setText(status, 'Không tự sao chép được — giữ ngón tay lên khung trên để sao chép.');
      }
    },
  });
  const shareBtn = typeof navigator.share === 'function'
    ? el('button', { type: 'button', class: 'btn', text: '📤 Gửi…', onclick: () => { navigator.share({ text }).catch(() => { /* người xem huỷ */ }); } })
    : null;
  openSheet('share', '🔒 Mời bạn bè xem cùng', [
    el('p', { class: 'pr-lead', text: lead || (pass ? 'Phòng riêng đã sẵn sàng! Gửi lời mời này cho người bạn muốn xem cùng:' : 'Gửi link phòng cho người bạn muốn xem cùng:') }),
    box,
    el('div', { class: 'row pr-share-btns' }, copyBtn, shareBtn),
    status,
    el('p', { class: 'pr-note', text: `Chỉ ai có link + mật khẩu mới vào được (và quản trị viên rạp khi xử lý báo cáo). Phòng tự đóng khi không còn ai trong ${emptyMin()} phút.` }),
  ]);
}

/** [📋 Sao chép link] trong bảng phòng: chép link ngay; trình duyệt không cho thì mở thẻ mời (khung chọn được) */
async function copyLink(btn, status) {
  const room = store.roomId;
  if (!isPrivateRoomId(room)) return;
  if (await copyText(inviteLink(room), null)) {
    setText(btn, '✓ Đã chép');
    setTimeout(() => { if (btn.isConnected) setText(btn, '📋 Sao chép link'); }, 2000);
    status.classList.remove('err');
    setText(status, 'Đã sao chép link phòng ✓ — gửi kèm mật khẩu cho bạn bè nhé.');
    toast('Đã sao chép link ✓', 'ok', 2500);
  } else openShareCard();
}

// ---------------------------------------------------------------- xác nhận mời ra (từ thẻ người xem)
export function confirmKick(pid, name) {
  if (!store.isOwner()) return;
  const status = el('p', { class: 'pr-status', role: 'status' });
  openSheet('kick', '🚪 Mời ra khỏi phòng', [
    el('p', null, 'Mời ', el('b', { text: name }), ' ra khỏi phòng riêng?'),
    el('p', { class: 'pr-note', text: 'Họ vẫn biết mật khẩu — đổi mật khẩu nếu không muốn họ vào lại.' }),
    el('div', { class: 'row' },
      el('button', {
        type: 'button', class: 'btn btn-danger', text: 'Mời ra',
        onclick: () => { if (sendOp({ op: 'kick', status }, { pid })) closeSheet(); },
      }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Huỷ', onclick: () => closeSheet() })),
    status,
  ]);
}

// ---------------------------------------------------------------- phần "phòng riêng" đầu bảng chọn rạp
/** { node, dispose } — tự cập nhật theo thông tin phòng (priv) tới khi tấm đóng (dispose) */
export function privateSection() {
  const head = el('div', { class: 'pr-head' });
  const status = el('p', { class: 'pr-status', role: 'status' });
  const copyBtn = el('button', { type: 'button', class: 'btn', text: '📋 Sao chép link', onclick: () => copyLink(copyBtn, status) });
  const leaveBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: '🚪 Rời phòng riêng', onclick: () => H?.leavePrivate() });
  const members = el('ul', { class: 'pr-members', 'aria-label': 'Người trong phòng' });
  let kickAsk = 0; // đang hỏi lại "mời ra?" cho người này
  let closeAsk = false;
  // đổi mật khẩu: ô nhập + nút Lưu dựng MỘT lần trong khung cố định (passBox) — vẽ lại khi có người vào / ra / ẩn / mất mạng
  // (tin 'priv') chỉ đụng tới phần thay đổi (ownerDyn), không bao giờ gỡ ô đang gõ khỏi trang (gỡ ra là mất con trỏ, điện
  // thoại cụp bàn phím, phím gõ tiếp rơi mất)
  const passIn = el('input', {
    type: 'text', class: 'pr-input', maxlength: '64', placeholder: 'Mật khẩu mới', 'aria-label': 'Mật khẩu mới (4–40 ký tự)',
    autocapitalize: 'none', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
  });
  const passForm = el('form', {
    class: 'pr-passrow', autocomplete: 'off',
    onsubmit: (e) => {
      e.preventDefault();
      const p = normPass(passIn.value);
      const err = passError(p);
      status.classList.toggle('err', !!err);
      if (err) { setText(status, err); passIn.focus(); return; }
      setText(status, 'Đang đổi mật khẩu…');
      if (sendOp({ op: 'pass', pass: p, status }, { pass: p })) passIn.value = '';
    },
  }, passIn, el('button', { type: 'submit', class: 'btn', text: 'Lưu' }));
  const passBox = el('div', { class: 'pr-passbox', hidden: true }, el('div', { class: 'pr-label', text: 'Đổi mật khẩu (4–40 ký tự)' }), passForm);
  const ownerDyn = el('div', { class: 'pr-owner-dyn' }); // số người tối đa + đóng phòng (vẽ lại mỗi lần)
  const owner = el('div', { class: 'pr-owner' }, passBox, ownerDyn);
  const node = el('section', { class: 'pr-sec', 'aria-label': 'Phòng riêng' },
    head,
    el('div', { class: 'row pr-actions' }, copyBtn, leaveBtn),
    status,
    el('div', { class: 'pr-label', text: 'Trong phòng' }),
    members,
    owner);

  /** nút có khoá data-fk (fk) — để chọn lại đúng nút sau khi vẽ lại (người dùng bàn phím không bị mất chỗ) */
  const fk = (key) => ({ fk: key });
  function draw() {
    const p = store.priv;
    if (!p || !store.inPrivate()) {
      setKids(head, el('b', { text: `🔒 ${store.roomName}` }));
      setKids(members);
      passBox.hidden = true;
      setKids(ownerDyn);
      return;
    }
    if (op?.op === 'cap' && op.cap === p.cap) op = null; // đổi số người xong (server chỉ gửi lại thông tin phòng)
    const mine = store.isOwner();
    const list = p.members;
    const count = store.memberCount(); // quản trị viên rạp không chiếm chỗ
    // tên phòng một dòng, số người (+ "bạn là chủ phòng") dòng dưới — tên dài không đẩy chữ khác xuống giữa chừng;
    // quản trị viên rạp đang xem phòng (đứng xem / có nhân vật) → dòng 🛡 thường trực
    setKids(head,
      el('b', { class: 'pr-name', text: `🔒 ${p.name || store.roomName}`, title: p.name || store.roomName }),
      el('span', { class: 'pr-sub', text: `${count}/${p.cap} người${mine ? ' · 👑 bạn là chủ phòng' : ''}` }),
      store.adminWatching() ? el('span', { class: 'pr-adm', title: ADMIN_WATCHING, text: `🛡 ${ADMIN_WATCHING}` }) : null);
    if (kickAsk && !list.some((m) => m.id === kickAsk)) kickAsk = 0;
    setKids(members, list.map((m) => {
      const me = m.id === store.myId;
      const isOwnerRow = m.id === p.ownerId;
      const state = m.ghost ? '📵 mất mạng' : m.away ? '💤 đang ẩn' : m.adm ? '🛡 quản trị viên rạp' : '';
      // quản trị viên rạp: server không cho mời ra → không hiện nút bấm vào chỉ bị từ chối
      const canKick = mine && !me && !isOwnerRow && !m.adm;
      return el('li', { class: 'pr-member' },
        el('div', { class: 'pr-mrow' },
          el('span', { class: 'pr-mname' }, el('b', { text: m.name }), me ? ' (bạn)' : '', isOwnerRow ? ' 👑' : ''),
          state ? el('span', { class: 'pr-mstate', text: state }) : null,
          canKick && kickAsk !== m.id
            ? el('button', { type: 'button', class: 'btn btn-ghost pr-kick', text: 'Mời ra', dataset: fk(`kick-${m.id}`), onclick: () => { kickAsk = m.id; render(); } })
            : null),
        canKick && kickAsk === m.id
          ? el('div', { class: 'pr-confirm' },
            el('span', null, 'Mời ', el('b', { text: m.name }), ' ra?'),
            el('button', {
              type: 'button', class: 'btn btn-danger', text: 'Mời ra', dataset: fk(`kickyes-${m.id}`),
              onclick: () => { kickAsk = 0; setText(status, ''); sendOp({ op: 'kick', status }, { pid: m.id }); render(); },
            }),
            el('button', { type: 'button', class: 'btn btn-ghost', text: 'Huỷ', dataset: fk(`kickno-${m.id}`), onclick: () => { kickAsk = 0; render(); } }))
          : null);
    }));
    if (!mine) { passBox.hidden = true; setKids(ownerDyn); return; }
    passBox.hidden = false;
    const caps = capChoices(p.cap);
    setKids(ownerDyn,
      el('div', { class: 'pr-label', text: 'Số người tối đa' }),
      el('div', { class: 'pr-chips', role: 'group', 'aria-label': 'Số người tối đa' }, caps.map((n) => el('button', {
        type: 'button', class: `chip${n === p.cap ? ' on' : ''}`, text: String(n), 'aria-pressed': n === p.cap ? 'true' : 'false',
        dataset: fk(`cap-${n}`),
        disabled: n < count || null, title: n < count ? 'Ít hơn số người đang ở trong phòng' : `Tối đa ${n} người`,
        onclick: () => { if (n !== p.cap) { setText(status, ''); sendOp({ op: 'cap', cap: n, status }, { cap: n }); } },
      }))),
      closeAsk
        ? el('div', { class: 'pr-confirm pr-close' },
          el('span', { text: 'Đóng phòng? Mọi người sẽ về rạp chung.' }),
          el('button', { type: 'button', class: 'btn btn-danger', text: 'Đóng phòng', dataset: fk('closeyes'), onclick: () => { closeAsk = false; sendOp({ op: 'close', status }); render(); } }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Huỷ', dataset: fk('closeno'), onclick: () => { closeAsk = false; render(); } }))
        : el('div', { class: 'row pr-close' },
          el('button', { type: 'button', class: 'btn btn-danger', text: 'Đóng phòng', dataset: fk('close'), onclick: () => { closeAsk = true; render(); } })));
  }
  /** vẽ lại; nút đang được chọn (bàn phím) mà bị thay bằng nút mới cùng khoá → chọn lại nút mới */
  function render() {
    const a = document.activeElement;
    const key = a && a !== passIn && node.contains(a) ? a.dataset?.fk || '' : '';
    draw();
    if (!key || node.contains(document.activeElement)) return;
    const again = [...node.querySelectorAll('[data-fk]')].find((b) => b.dataset.fk === key && !b.disabled);
    again?.focus({ preventScroll: true });
  }
  render();
  const off = store.on('priv', render);
  return { node, dispose: off };
}

/** hàng đầu bảng chọn rạp (đang ở phòng chung): mở tấm tạo phòng */
export function createRow() {
  return el('button', { type: 'button', class: 'room-item pr-create-row', onclick: () => openCreateSheet() },
    el('span', { class: 'ri-emoji', 'aria-hidden': 'true', text: '🔒' }),
    el('span', { class: 'ri-body' },
      el('b', { text: 'Tạo phòng riêng' }),
      el('span', { class: 'now-meta', text: 'Xem chung với người yêu / bạn bè ở xa — có mật khẩu, không hiện trong danh sách' })),
    el('span', { class: 'pr-go-arrow', 'aria-hidden': 'true', text: '›' }));
}
