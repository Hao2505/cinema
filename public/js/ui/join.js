// Màn vào rạp: đặt tên + chọn ngoại hình (dáng Nam / Nữ, da, kiểu tóc, màu tóc, áo, quần, phụ kiện, râu) có xem trước
// nhân vật động. Mở link phòng riêng (/#phong=p-…) → "chế độ phòng riêng": ẩn chọn rạp, thêm ô mật khẩu (form) / ô mật khẩu
// thay danh sách rạp (thẻ chào lại). Mọi kết quả hiện ngay trên thẻ (#join-err / #jq-err) — toast nằm dưới lớp phủ này.
// Dùng lại bộ chọn ngoại hình cho nút 🎨 sau khi đã vào rạp.
import {
  ACCESSORIES, BODIES, FACIALS, HAIR_COLORS, HAIR_STYLES, LIMITS, PANTS, SHIRTS, SKINS, VENUES, isPrivateRoomId, normalizeLook, randomLook,
} from '../shared/hall.js';
import { send } from '../net.js';
import { drawCharacter, portrait } from '../render/character.js';
import { actionPose } from '../render/anims.js';
import { el, lsGet, lsSet, setKids, setText, str } from '../util.js';
import { store } from '../store.js';

const $ = (id) => document.getElementById(id);
const LOOK_KEY = 'vc.look';
const NAME_KEY = 'vc.name';
const RETURNING_KEY = 'vc.returning'; // '1' sau lần vào rạp thành công đầu tiên
const LAST_ROOM_KEY = 'vc.room'; // phòng vào lần trước

export function savedLook() {
  try {
    const raw = lsGet(LOOK_KEY);
    if (raw) return normalizeLook(JSON.parse(raw));
  } catch { /* bỏ qua */ }
  return randomLook();
}
export function saveLook(look) {
  lsSet(LOOK_KEY, JSON.stringify(normalizeLook(look)));
}
export const savedName = () => str(lsGet(NAME_KEY, ''), 40);
export const saveName = (n) => lsSet(NAME_KEY, n);

/** vào rạp thành công: lần sau mở trang là vào thẳng (thẻ "Chào mừng quay lại"), nhớ phòng vừa vào (chỉ phòng chung —
 * phòng riêng vào lại bằng link + vé vc.rt) */
export function rememberJoin(roomId) {
  lsSet(RETURNING_KEY, '1');
  if (roomId && !isPrivateRoomId(roomId)) lsSet(LAST_ROOM_KEY, roomId);
}

/** mật khẩu phòng như server so: chuẩn hoá Unicode (NFC — gõ tiếng Việt / dán từ Zalo có thể ra NFD) + bỏ khoảng trắng hai đầu */
export const normPass = (s) => String(s ?? '').normalize('NFC').trim();
/** '' = hợp lệ */
export const passError = (p) => (p.length < 4 || p.length > 40 ? 'Mật khẩu phòng cần 4–40 ký tự.' : '');

// chế độ phòng riêng của màn vào rạp: { room, authorized } — authorized = đã có quyền vào (vé vc.rt / vừa nhập đúng mật
// khẩu / admin) nên không cần ô mật khẩu nữa. null = màn vào rạp thường
let priv = null;
let privBusy = false; // đang chờ server kiểm mật khẩu (thẻ chào lại)

/** đã từng vào rạp và còn tên hợp lệ trên máy này */
export function isReturning() {
  if (lsGet(RETURNING_KEY, '') !== '1') return false;
  const len = Array.from(savedName()).length;
  return len >= LIMITS.nameMin && len <= LIMITS.nameMax;
}

export const lastRoom = () => str(lsGet(LAST_ROOM_KEY, ''), 16);

const SKIN_LABEL = ['Rất sáng', 'Sáng', 'Sáng vừa', 'Trung bình', 'Ngăm', 'Nâu', 'Nâu đậm'];
const BODY_ICON = { nam: '👨', nu: '👩' };
// đổi dáng: kiểu tóc / phụ kiện đang chọn quá "đặc trưng" của dáng kia thì đổi sang kiểu hợp hơn (vẫn chọn lại được)
const SWAP_HAIR = { nam: { long: 'short', bob: 'short', ponytail: 'spiky', bun: 'short' }, nu: { short: 'long', spiky: 'bob', bald: 'long' } };

function switchBody(look, body) {
  if (look.body === body) return look;
  const next = { ...look, body, hairStyle: SWAP_HAIR[body][look.hairStyle] || look.hairStyle };
  if (body === 'nam' && next.accessory === 'bow') next.accessory = 'none';
  if (body === 'nu') next.facial = 'none';
  return next;
}

/** bộ chọn ngoại hình: trả về { node, get(), set(look) }; onChange(look) mỗi lần đổi */
export function lookEditor(initial, onChange) {
  let look = normalizeLook(initial);
  const rows = [];
  const swRow = (label, key, list, names) => {
    const opts = list.map((c, i) => el('button', {
      type: 'button', class: 'sw', style: { background: c }, 'aria-label': `${label}: ${names?.[i] || c}`, title: names?.[i] || '',
      dataset: { key, v: c },
      onclick: () => { look = { ...look, [key]: c }; refresh(); onChange?.(look); },
    }));
    rows.push({ key, opts });
    return el('div', { class: 'look-row' }, el('span', { text: label }), el('div', { class: 'look-opts', role: 'group', 'aria-label': label }, opts));
  };
  const chipRow = (label, key, list, opt = {}) => {
    const opts = list.map((o) => el('button', {
      type: 'button', class: opt.cls || 'chip', text: opt.icons ? `${opt.icons[o.id]} ${o.label}` : o.label, dataset: { key, v: o.id },
      onclick: () => { look = opt.pick ? opt.pick(look, o.id) : { ...look, [key]: o.id }; refresh(); onChange?.(look); },
    }));
    rows.push({ key, opts });
    return el('div', { class: 'look-row' }, el('span', { text: label }), el('div', { class: 'look-opts', role: 'group', 'aria-label': label }, opts));
  };
  const facialRow = chipRow('Râu', 'facial', FACIALS);
  const node = el('div', { class: 'looks' },
    chipRow('Dáng người', 'body', BODIES, { cls: 'chip seg', icons: BODY_ICON, pick: switchBody }),
    swRow('Màu da', 'skin', SKINS, SKIN_LABEL),
    chipRow('Kiểu tóc', 'hairStyle', HAIR_STYLES),
    swRow('Màu tóc', 'hair', HAIR_COLORS),
    swRow('Áo', 'shirt', SHIRTS),
    swRow('Quần', 'pants', PANTS),
    chipRow('Phụ kiện', 'accessory', ACCESSORIES),
    facialRow,
  );
  function refresh() {
    for (const r of rows) {
      for (const b of r.opts) {
        const on = b.dataset.v === look[r.key];
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    facialRow.hidden = look.body !== 'nam'; // râu chỉ cho dáng nam
  }
  refresh();
  return {
    node,
    get: () => look,
    set(l) { look = normalizeLook(l); refresh(); },
  };
}

/** nhân vật xem trước: xoay hướng, vẫy tay, nhảy — vẽ liên tục vào canvas nhỏ */
export function startPreview(canvas, getLook) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  const t0 = performance.now();
  const steps = [
    { dir: 'down', act: 'wave', ms: 2400 },
    { dir: 'left', walk: true, ms: 1100 },
    { dir: 'up', ms: 900 },
    { dir: 'right', walk: true, ms: 1100 },
    { dir: 'down', act: 'hiphop', ms: 2800 },
    { dir: 'down', act: 'heart', ms: 2200 },
  ];
  const total = steps.reduce((s, x) => s + x.ms, 0);
  function frame() {
    raf = requestAnimationFrame(frame);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (!r.width) return;
    const now = performance.now();
    let t = (now - t0) % total, i = 0;
    while (t > steps[i].ms) { t -= steps[i].ms; i++; }
    const st = steps[i];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const k = (h * 0.8) / 52;
    ctx.setTransform(k, 0, 0, k, w / 2, h * 0.9);
    const view = st.dir === 'left' || st.dir === 'right' ? 'left' : st.dir;
    const pose = st.act ? actionPose(st.act, t, view, false, st.dir) : null;
    drawCharacter(ctx, getLook(), {
      dir: st.dir, pose: 'stand', moving: !!st.walk, phase: st.walk ? (t / 1000) * 10 : 0, t: now, seed: 3,
      mood: st.act ? 'happy' : 'neutral', blink: now % 3800 < 120, anim: pose?.anim || null,
    });
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/**
 * màn vào rạp: lần đầu = đặt tên + chọn nhân vật (onSubmit(name, look, pass) — pass chỉ có khi mở link phòng riêng chưa có
 * quyền vào); đã từng vào = thẻ "Chào mừng quay lại" chọn rạp, bấm là vào luôn bằng tên + nhân vật đã nhớ (onQuick(roomId)),
 * link phòng riêng thì nhập mật khẩu (onQuickPass(pass)). onCreate(from: 'form' | 'quick') = "🔒 Tạo phòng riêng";
 * onPublic() = "Vào rạp chung thay thế" (bỏ link phòng riêng).
 */
export function initJoin({ onSubmit, onQuick, onQuickPass, onCreate, onPublic }) {
  const form = $('join-form');
  const quick = $('join-quick');
  const nameInput = $('join-name');
  const passInput = $('join-pass');
  nameInput.value = savedName();
  const editor = lookEditor(savedLook(), (l) => saveLook(l));
  setKids($('join-looks'), editor.node);
  let stopPreview = startPreview($('join-preview'), () => editor.get());
  // ---- thẻ "Chào mừng quay lại": danh sách rạp (số người + đang chiếu gì), rạp lần trước lên đầu
  let busyRoom = '';
  let quickNote = ''; // dòng thay cho "Chọn rạp để vào ngay:" (vd phòng riêng vừa đóng → mời vào rạp chung 👇)
  const renderQuick = () => {
    if (quick.hidden) return;
    setText($('jq-name'), savedName());
    renderPrivate();
    if (priv) return; // phòng riêng: ô mật khẩu thay cho danh sách rạp
    const last = lastRoom();
    // rạp đông lên đầu (ít người thì gặp được nhau), rồi rạp lần trước
    const rooms = [...store.rooms].sort((a, b) => (b.count - a.count) || ((b.id === last) - (a.id === last)));
    const top = rooms[0] && rooms[0].count > 0 ? rooms[0].id : '';
    if (!rooms.length) { setKids($('jq-rooms'), el('p', { class: 'jq-sub', text: 'Đang tải danh sách rạp…' })); return; }
    setKids($('jq-rooms'), rooms.map((r) => {
      const v = VENUES.find((x) => x.id === r.venue);
      const full = r.count >= r.cap;
      return el('button', {
        type: 'button', class: `jq-room${r.id === last ? ' last' : ''}`, role: 'listitem', disabled: full || !!busyRoom,
        onclick: () => { if (!busyRoom) onQuick?.(r.id); },
      },
      el('span', { class: 'e', 'aria-hidden': 'true', text: v?.emoji || '🎬' }),
      el('span', { class: 't' },
        el('b', null, r.name,
          r.id === top ? el('span', { class: 'jq-badge hot', text: '🔥 ĐÔNG NHẤT' }) : null,
          r.id === last ? el('span', { class: 'jq-badge', text: 'LẦN TRƯỚC' }) : null),
        el('small', { text: `${r.count}/${r.cap} người · ${r.now ? `Đang chiếu: ${r.now}` : v?.desc || 'Màn hình đang trống'}` })),
      el('span', { class: 'go', text: busyRoom === r.id ? 'Đang vào…' : full ? 'Đầy' : 'Vào ▸' }));
    }));
  };
  store.on('rooms', renderQuick);
  $('jq-edit').addEventListener('click', () => showForm(''));
  $('jq-create').addEventListener('click', () => onCreate?.('quick'));
  $('join-create').addEventListener('click', () => onCreate?.('form'));
  $('jq-public').addEventListener('click', () => onPublic?.());
  $('join-public').addEventListener('click', () => onPublic?.());
  $('jq-pass-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busyRoom || privBusy || !priv) return;
    let pass = '';
    if (!priv.authorized) {
      pass = normPass($('jq-pass').value);
      const err = passError(pass);
      if (err) { setText($('jq-err'), err); $('jq-pass').focus(); return; }
    }
    setText($('jq-err'), '');
    privBusy = true;
    renderPrivate();
    onQuickPass?.(pass);
  });
  $('jq-pass').addEventListener('input', () => setText($('jq-err'), ''));
  passInput.addEventListener('input', () => showJoinError(''));

  /** hiện / ẩn phần riêng của chế độ phòng riêng trên cả hai thẻ */
  function renderPrivate() {
    const on = !!priv;
    const needPass = on && !priv.authorized;
    $('join-venue-field').hidden = on;
    $('join-pass-field').hidden = !needPass;
    // chế độ phòng riêng: dòng lỗi ngay dưới tên / mật khẩu (form dài vì bộ chọn nhân vật — lỗi ở cuối thì không thấy);
    // thường: trên các nút như cũ
    const err = $('join-err');
    if (on) { if (err.previousElementSibling !== $('join-pass-field')) $('join-pass-field').after(err); }
    else if (err.nextElementSibling !== form.querySelector('.join-actions')) form.querySelector('.join-actions').before(err);
    $('join-create').hidden = on;
    $('join-public').hidden = !on;
    $('jq-create').hidden = on;
    $('jq-public').hidden = !on;
    $('jq-rooms').hidden = on;
    // thẻ chào lại: đang tự vào bằng vé (busyRoom) → chỉ hiện dòng "Đang vào phòng riêng…"
    $('jq-pass-form').hidden = !on || !!busyRoom;
    $('jq-pass').hidden = !needPass;
    const go = $('jq-pass-go');
    go.disabled = privBusy;
    setText(go, privBusy ? 'Đang vào…' : on && priv.authorized ? 'Vào phòng 🔒' : 'Vào phòng');
    const sub = $('jq-sub');
    sub.classList.toggle('note', !on && !!quickNote);
    setText(sub, on ? (busyRoom ? 'Đang vào phòng riêng…' : '🔒 Bạn được mời vào một phòng riêng') : quickNote || 'Chọn rạp để vào ngay:');
    setJoinBusy($('join-go').disabled);
    updateRoom();
  }
  function showQuick() {
    $('join').hidden = false;
    form.hidden = true;
    quick.hidden = false;
    setKids($('jq-avatar'), portrait(savedLook(), 64));
    setText($('jq-err'), '');
    renderQuick();
  }
  function showForm(err) {
    $('join').hidden = false;
    quick.hidden = true;
    form.hidden = false;
    busyRoom = '';
    privBusy = false;
    nameInput.value = savedName() || nameInput.value;
    if (!stopPreview) stopPreview = startPreview($('join-preview'), () => editor.get());
    showJoinError(err || '');
    setJoinBusy(false);
    renderPrivate();
  }
  /** tên trong form đã chuẩn hoá ('' = sai độ dài: đã báo lỗi + đặt con trỏ vào ô tên) */
  function validName() {
    const name = nameInput.value.replace(/\s+/g, ' ').trim();
    const len = Array.from(name).length;
    if (len < LIMITS.nameMin || len > LIMITS.nameMax) {
      showJoinError(`Tên cần ${LIMITS.nameMin}–${LIMITS.nameMax} ký tự.`);
      nameInput.focus();
      return '';
    }
    return name;
  }
  $('join-random').addEventListener('click', () => {
    const l = randomLook();
    editor.set(l);
    saveLook(l);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = validName();
    if (!name) return;
    let pass = '';
    if (priv && !priv.authorized) {
      pass = normPass(passInput.value);
      const err = passError(pass);
      if (err) { showJoinError(err); passInput.focus(); return; }
    }
    saveName(name);
    saveLook(editor.get());
    setJoinBusy(true);
    onSubmit(name, editor.get(), pass);
  });
  nameInput.addEventListener('input', () => showJoinError(''));
  // chọn rạp: xem trước rạp đó ngay sau lớp phủ (spec), bấm "Vào rạp" là vào đúng rạp đang xem
  const renderVenues = () => {
    const count = new Map();
    for (const r of store.rooms) count.set(r.venue, (count.get(r.venue) || 0) + (Number(r.count) || 0));
    setKids($('join-venues'), VENUES.map((v) => {
      const on = store.venue === v.id;
      return el('button', {
        type: 'button', class: `venue-card${on ? ' on' : ''}`, role: 'radio', 'aria-checked': on ? 'true' : 'false', title: v.desc,
        onclick: () => { if (store.venue !== v.id) send({ t: 'spec', room: v.id }); },
      }, el('span', { class: 'vc-emoji', 'aria-hidden': 'true', text: v.emoji }),
      el('span', { class: 'vc-name', text: v.name }),
      el('span', { class: 'vc-count', text: `${count.get(v.id) || 0} người` }));
    }));
  };
  store.on('rooms', renderVenues);
  store.on('venue', renderVenues);
  renderVenues();
  function updateRoom() {
    if (priv) {
      setText($('join-room'), priv.authorized
        ? '🔒 Bạn được mời vào một phòng riêng — đặt tên là vào.'
        : '🔒 Bạn được mời vào một phòng riêng — đặt tên, nhập mật khẩu là vào.');
      return;
    }
    const room = store.rooms.find((r) => r.id === store.roomId);
    const n = store.now;
    const parts = [];
    if (room) parts.push(el('b', { text: room.name }), ` · ${room.count} người trong rạp`);
    if (n) parts.push(' · Đang chiếu: ', el('b', { text: n.title }));
    else parts.push(' · Chưa có video, vào rạp rồi dán link để chiếu nhé.');
    setKids($('join-room'), parts);
  }
  store.on('rooms', updateRoom);
  store.on('now', updateRoom);
  store.on('hello', updateRoom);
  setTimeout(() => nameInput.focus({ preventScroll: true }), 50);
  return {
    hide() { $('join').hidden = true; busyRoom = ''; privBusy = false; quickNote = ''; if (stopPreview) { stopPreview(); stopPreview = null; } },
    /** màn đặt tên + chọn nhân vật (kèm lỗi nếu có) */
    show(err) { showForm(err); },
    showQuick,
    get isQuick() { return !$('join').hidden && !quick.hidden; },
    /** thẻ chào lại: đang vào phòng nào ('' = thôi) */
    setQuickBusy(roomId) { busyRoom = roomId || ''; privBusy = false; renderQuick(); },
    quickError(text) { busyRoom = ''; privBusy = false; setText($('jq-err'), text || ''); renderQuick(); },
    /** thẻ chào lại: dòng thay cho "Chọn rạp để vào ngay:" ('' = bỏ) */
    quickNote(text) { quickNote = text || ''; renderQuick(); },
    get look() { return editor.get(); },
    validName,
    /**
     * chế độ phòng riêng: { room, authorized } hoặc null. Giữ nguyên qua lỗi tên (server báo trùng tên… vẫn ở chế độ này);
     * chỉ đổi khi vào được / phòng đóng / bị mời ra / người xem chọn rạp chung
     */
    setPrivate(p) {
      const next = p && isPrivateRoomId(p.room) ? { room: p.room, authorized: !!p.authorized } : null;
      if (!next || !priv || next.room !== priv.room) { passInput.value = ''; $('jq-pass').value = ''; }
      priv = next;
      privBusy = false;
      if (next) quickNote = '';
      renderPrivate();
      renderQuick();
    },
    get privateRoom() { return priv ? priv.room : ''; },
    get privateAuthorized() { return !!priv && priv.authorized; },
    /** đặt con trỏ vào ô mật khẩu đang hiện */
    focusPass() {
      const i = !quick.hidden ? $('jq-pass') : passInput;
      if (!i.hidden && !i.closest('[hidden]')) setTimeout(() => i.focus({ preventScroll: true }), 30);
    },
  };
}

/** lỗi / ghi chú dưới form (note = dòng thông tin màu vàng, không phải lỗi) */
export function showJoinError(text, note = false) {
  const e = $('join-err');
  setText(e, text || '');
  e.classList.toggle('note', !!text && note);
  if (!text) return;
  setJoinBusy(false);
  // phòng riêng: vừa bấm nút cuối form → kéo lên cho thấy lỗi + ô mật khẩu
  if (priv && !$('join-form').hidden) e.scrollIntoView({ block: 'center' });
}

export function setJoinBusy(busy) {
  const b = $('join-go');
  b.disabled = !!busy;
  setText(b, busy ? 'Đang vào…' : priv ? 'Vào phòng 🔒' : 'Vào rạp 🍿');
}
