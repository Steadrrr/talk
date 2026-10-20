// 앱 상태 + 서버와 맞추기(동기화).
// 서버에 "변경 번호(cursor)"가 있어서, 앱은 sync?since=<번호> 로 그 뒤에 바뀐 방·새 메시지만 받는다.
// 받은 것은 이 기기(localStorage)에 남겨서, 다음에 열 때 서버를 기다리지 않고 바로 보여 준다.
import { api, b64Blob, AuthError, setToken } from './api.js';
import { nickOf } from './names.js';
import { prepPhoto, prepVideo, upload, uploadFile, finishAlbum } from './media.js';
import { keepPending, dropPending, listPending, clearPending } from './pending.js';
import { checkUpdate } from './update.js';
import { syncMyBubble } from './chattheme.js';

const SAVE_KEY = 'talk.state.v1';
const KEEP_PER_ROOM = 100; // 기기에 남기는 방별 최근 메시지 수

export const state = {
  me: null,        // { id, name(본명·로그인 아이디), nick(채팅에 보이는 이름, 없으면 본명), is_admin }
  groups: [],      // [{ id, name, members: [{ id, name, nick }] }]
  rooms: {},       // id → { id, group_id, kind, name, members, last, unread, muted, pinned }
  messages: {},    // roomId → [메시지] (id 순서, 보내는 중인 것은 뒤에 pending: true)
  cursor: 0,
  groupsRev: 0,    // 서버의 그룹 변경 번호. 동기화 때 달라지면 친구 목록을 다시 받는다
  openRoom: null,  // 지금 보고 있는 방 번호
  profile: null,   // 프로필 창으로 보고 있는 사람 번호
  typing: [],      // 보고 있는 방에서 지금 입력 중인 다른 사람 번호
  online: true,
  notice: null,    // 공지사항 최신 글 { id, title, updated } (채팅 목록 맨 위 한 줄)
  notices: false,  // 공지사항 게시판을 열어 둠
  sakiReady: false, // 관리자가 SAKi Lite 열쇠를 넣어 사키를 부를 수 있음
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let notifyQueued = false;
function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; for (const fn of listeners) fn(state); });
}

// ───── 기기에 저장 ─────
function save() {
  try {
    const messages = {};
    for (const [rid, list] of Object.entries(state.messages)) messages[rid] = list.filter((m) => !m.pending).slice(-KEEP_PER_ROOM);
    localStorage.setItem(SAVE_KEY, JSON.stringify({ me: state.me, groups: state.groups, groupsRev: state.groupsRev, rooms: state.rooms, messages, cursor: state.cursor, notice: state.notice }));
  } catch { /* 저장 공간이 없거나 막혀도 앱은 그대로 동작 */ }
}
let saveTimer = 0;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }

export function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && s.me) Object.assign(state, { me: s.me, groups: s.groups || [], groupsRev: s.groupsRev || 0, rooms: s.rooms || {}, messages: s.messages || {}, cursor: s.cursor || 0, notice: s.notice || null });
  } catch { /* 망가진 저장은 무시하고 서버에서 새로 받음 */ }
  restorePending();
}

// 앱이 새로 열리면서 끊긴 사진·영상: "재전송" 로 되살림
async function restorePending() {
  for (const p of await listPending()) {
    if (!(p.file || p.files?.length) || !state.rooms[p.room_id]) { dropPending(p.client_id); continue; }
    const arr = state.messages[p.room_id] || (state.messages[p.room_id] = []);
    if (arr.some((m) => m.client_id === p.client_id)) continue;
    const base = { id: 0, room_id: p.room_id, user_id: state.me?.id, kind: p.kind, body: '{}', client_id: p.client_id, at: p.at, pending: true,
      failed: true, error: '보내다가 멈췄어요', progress: 0, stage: '' };
    if (p.files?.length) arr.push({ ...base, album: true, files: p.files, keys: [], locals: p.files.map((f) => URL.createObjectURL(f)), local: '' });
    else arr.push({ ...base, file: p.file, local: p.kind === 'photo' ? URL.createObjectURL(p.file) : '' });
  }
  notify();
}

export function clearAll() {
  stopSync();
  setToken('');
  try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('talk.token'); localStorage.removeItem('talk.pushAsked'); localStorage.removeItem(HIDDEN_KEY); } catch { /* 무시 */ }
  hidden = new Set();
  clearPending();
  Object.assign(state, { me: null, groups: [], rooms: {}, messages: {}, cursor: 0, openRoom: null, profile: null });
  notify();
}

// ───── 받은 것 합치기 ─────
function mergeMessages(list) {
  const touched = new Set();
  for (const m of list) {
    const arr = state.messages[m.room_id] || (state.messages[m.room_id] = []);
    // 내가 보낸 "보내는 중" 메시지가 서버에 도착한 것: 바꿔 끼운다
    const pi = m.client_id ? arr.findIndex((x) => x.pending && x.client_id === m.client_id) : -1;
    if (pi >= 0) arr.splice(pi, 1);
    const ei = arr.findIndex((x) => x.id === m.id);
    if (ei >= 0) arr[ei] = m;                    // 이미 있는 것이 바뀜 (모두에게 삭제 등)
    else { arr.push(m); touched.add(m.room_id); }
  }
  for (const rid of touched) {
    state.messages[rid].sort((a, b) => (a.pending - b.pending) || (a.id - b.id));
  }
}

function mergeRooms(rooms, full) {
  if (full) state.rooms = {};
  for (const r of rooms) state.rooms[r.id] = r;
  // 방을 보고 있는 동안 새로 온 것은 안 읽은 수에 넣지 않는다 (곧 읽음 처리됨)
  if (state.openRoom && state.rooms[state.openRoom] && !document.hidden) state.rooms[state.openRoom].unread = 0;
}

// 나간 방·닫힌 그룹의 방: 기기에서도 지운다
function dropRooms(ids) {
  const keep = new Set(ids);
  for (const id of Object.keys(state.rooms).map(Number)) {
    if (keep.has(id)) continue;
    delete state.rooms[id];
    delete state.messages[id];
    if (state.openRoom === id) state.openRoom = null;
  }
}

// ───── 동기화 ─────
let syncing = null;
let timer = 0;
let stopped = true;

export async function syncNow() {
  if (syncing) return syncing;
  syncing = (async () => {
    let app = null;
    try {
      let more = true;
      while (more) {
        const asked = document.hidden ? 0 : state.openRoom || 0;
        const r = await api('sync?since=' + state.cursor + (document.hidden ? '' : '&active=1&room=' + asked));
        state.typing = asked && asked === state.openRoom ? r.typing || [] : [];
        if (r.full) state.messages = Object.fromEntries(Object.entries(state.messages).map(([k, v]) => [k, v.filter((m) => m.pending)]));
        mergeRooms(r.rooms, r.full);
        mergeMessages(r.messages);
        if (r.room_ids) dropRooms(r.room_ids);
        state.cursor = r.cursor;
        more = r.more;
        if (r.groups_rev !== undefined && r.groups_rev !== state.groupsRev) await loadMe();
        if (r.notice !== undefined) state.notice = r.notice;
        if (r.saki_ready !== undefined) state.sakiReady = r.saki_ready;
        app = r.app;
      }
      state.online = true;
      markReadIfOpen();
      saveSoon();
      checkUpdate(app, state);
    } catch (e) {
      if (e instanceof AuthError) { clearAll(); return; }
      state.online = false;
    } finally {
      syncing = null;
      notify();
    }
  })();
  return syncing;
}

// 방을 보고 있으면 2초(누가 입력 중이면 곧 글이 오니 1초), 목록이면 5초, 앱이 뒤로 가면 멈춤 (그동안 새 메시지는 웹 푸시 알림으로)
function schedule() {
  clearTimeout(timer);
  if (stopped || document.hidden) return;
  timer = setTimeout(async () => { await syncNow(); schedule(); }, state.openRoom ? (state.typing.length ? 1000 : 2000) : 5000);
}

export function showNotices(on) { state.notices = on; notify(); }

export function startSync() {
  stopped = false;
  syncNow().then(schedule);
}
export function stopSync() { stopped = true; clearTimeout(timer); }

document.addEventListener('visibilitychange', () => {
  if (stopped) return;
  if (document.hidden) {
    clearTimeout(timer);
    typingSent = { room: 0, at: 0 };
    // 서버에 "앱을 안 보고 있음" → 이제부터 새 메시지는 알림으로 (앱이 닫혀도 보내지도록 keepalive)
    api('me/away', {}, { keepalive: true }).catch(() => {});
  } else syncNow().then(schedule);
});
window.addEventListener('online', () => { if (!stopped) syncNow().then(schedule); });

// ───── 내 정보·그룹 ─────
export async function loadMe() {
  const r = await api('me');
  state.me = r.me;
  syncMyBubble(r.me.bubble);
  state.groups = r.groups;
  state.groupsRev = r.groups_rev || 0;
  saveSoon();
  notify();
}

// 개인 설정: 정신병 방지(연속알림 차단)
export async function setPushQuiet(on) {
  await api('me/prefs', { push_quiet: on });
  if (state.me) state.me.push_quiet = on ? 1 : 0;
  saveSoon();
  notify();
}

// 사람 찾기: 같은 그룹 친구 목록에서, 없으면 방 사람 목록에서 (그룹에서 빠진 사람도 방에는 남아 있을 수 있음)
export function person(id) {
  if (state.me?.id === id) return state.me;
  for (const g of state.groups) { const m = g.members.find((x) => x.id === id); if (m) return m; }
  for (const r of Object.values(state.rooms)) { const m = r.members.find((x) => x.id === id); if (m) return m; }
  return null;
}

// 프로필 창 (사람 번호, 없으면 닫힘)
export function showProfile(id) { state.profile = id; notify(); }

// 방 설정
export async function roomPrefs(roomId, prefs) {
  const room = state.rooms[roomId];
  if (room) { Object.assign(room, Object.fromEntries(Object.entries(prefs).map(([k, v]) => [k, v ? 1 : 0]))); notify(); }
  await api('rooms/prefs', { room_id: roomId, ...prefs });
  await syncNow();
}
export async function renameRoom(roomId, name) {
  await api('rooms/rename', { room_id: roomId, name });
  await syncNow();
}
export async function inviteToRoom(roomId, userIds) {
  await api('rooms/invite', { room_id: roomId, user_ids: userIds });
  await syncNow();
}
export async function leaveRoom(roomId) {
  await api('rooms/leave', { room_id: roomId });
  if (state.openRoom === roomId) state.openRoom = null;
  delete state.rooms[roomId];
  delete state.messages[roomId];
  notify();
  syncNow();
}

// 채팅방 사진: 방 사람 누구나, 새로 올리면 예전 것은 지워짐
export async function setRoomPhoto(roomId, data) {
  await api(data ? `rooms/photo?room_id=${roomId}` : 'rooms/photo', data ? b64Blob(data) : { room_id: roomId, data: '' });
  await syncNow();
}

// 사키(SAKi Lite 봇) 설정: 방장·관리자만. on·personality·polite·freq·gap·react 중 바꿀 것만
export async function setSaki(roomId, changes) {
  const room = state.rooms[roomId];
  if (room?.saki) { Object.assign(room.saki, changes); notify(); }
  try { await api('rooms/saki', { room_id: roomId, ...changes }); } finally { await syncNow(); }
}

// 사키에게 알려 줄 관계 (예: "엄마"): 내 것은 나, 다른 사람 것은 방장·관리자
export async function setSakiRelation(roomId, userId, relation) {
  const m = state.rooms[roomId]?.members.find((p) => p.id === userId);
  if (m) { m.relation = relation; notify(); }
  try { await api('rooms/saki', { room_id: roomId, relation_user: userId, relation }); } finally { await syncNow(); }
}

// 공지 올리기(메시지 번호)·내리기(0)
export async function setNotice(roomId, msgId) {
  await api('rooms/notice', { room_id: roomId, message_id: msgId || 0 });
  await syncNow();
}

// 프로필 사진: data = base64 (JPEG) 또는 null(지우기)
export async function setPhoto(data) {
  await api('me/photo', data ? b64Blob(data) : { data: '' });
  await loadMe();
  await syncNow();
}

// 사키 프로필 사진 (내 화면에서만). data = base64 (JPEG) 또는 null(기본으로)
export async function setSakiPhoto(data) {
  await api('me/saki-photo', data ? b64Blob(data) : { data: '' });
  await loadMe();
}

// 얼굴 사진: 사키는 내가 정한 사진이 있으면 그것 (나만 보임)
export const photoOf = (p) => (p?.bot && state.me?.saki_photo ? state.me.saki_photo : p?.photo);

// 내 말풍선 색 (다른 사람 화면에도 이 색). null 이면 기본
export async function setBubble(color) {
  await api('me/bubble', { color: color || '' });
  if (state.me) state.me.bubble = color || null;
  await syncNow();
}

export async function setNick(nick) {
  await api('me/nick', { nick });
  await loadMe();
  await syncNow();
}

// ───── 방 ─────
export function roomTitle(room) {
  if (!room) return '';
  if (room.name) return room.name;
  const others = room.members.filter((m) => m.id !== state.me?.id && !m.bot).map(nickOf);
  return others.join(', ') || '나';
}

export function sortedRooms() {
  return Object.values(state.rooms).sort((a, b) =>
    (b.pinned - a.pinned) || ((b.last?.id || 0) - (a.last?.id || 0)) || (b.id - a.id));
}

export function openRoom(id) {
  state.openRoom = id;
  state.typing = [];
  if (state.rooms[id]) state.rooms[id].unread = 0;
  notify();
  markReadIfOpen();
  schedule();
}

export function closeRoom() {
  if (state.openRoom) setTyping(state.openRoom, false);
  state.openRoom = null;
  state.typing = [];
  notify();
  schedule();
}

let lastReadSent = {};
function markReadIfOpen() {
  const rid = state.openRoom;
  if (!rid || document.hidden) return;
  const list = (state.messages[rid] || []).filter((m) => !m.pending);
  const last = list.length ? list[list.length - 1].id : 0;
  const room = state.rooms[rid];
  const mine = room?.members.find((m) => m.id === state.me?.id);
  if (!last || (mine && mine.last_read_id >= last) || lastReadSent[rid] >= last) return;
  lastReadSent[rid] = last;
  if (mine) mine.last_read_id = last;
  api('rooms/read', { room_id: rid, last_id: last }).catch(() => { lastReadSent[rid] = 0; });
}

export async function openDm(userId) {
  const r = await api('rooms/dm', { user_id: userId });
  state.rooms[r.room.id] = r.room;
  if (!state.messages[r.room.id]) await loadOlder(r.room.id);
  return r.room.id;
}

export async function createRoom(groupId, memberIds, name) {
  const r = await api('rooms/create', { group_id: groupId, member_ids: memberIds, name });
  state.rooms[r.room.id] = r.room;
  state.messages[r.room.id] = state.messages[r.room.id] || [];
  notify();
  return r.room.id;
}

// 예전 대화 50개 더. 더 없으면 false
// 방 안 글 검색 (서버)
export async function searchRoom(roomId, q) {
  return (await api(`messages/search?room_id=${roomId}&q=${encodeURIComponent(q)}`)).messages;
}

// 그 메시지가 기기에 올 때까지 예전 대화를 더 받기 (검색 결과로 갈 때)
export async function loadUntil(roomId, msgId) {
  for (let i = 0; i < 40; i++) {
    const first = (state.messages[roomId] || []).find((m) => !m.pending);
    if (first && first.id <= msgId) return true;
    if (!(await loadOlder(roomId))) return false;
  }
  return false;
}

export async function loadOlder(roomId) {
  const list = state.messages[roomId] || [];
  const first = list.find((m) => !m.pending);
  const r = await api(`messages/history?room_id=${roomId}&before=${first ? first.id : 0}`);
  mergeMessages(r.messages);
  if (!state.messages[roomId]) state.messages[roomId] = [];
  notify();
  return r.messages.length > 0;
}

// ───── 보내기 ─────
function newClientId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// 입력 중: 3초에 한 번만 서버에 알림 (입력칸에 글자가 있으면 방 화면이 3초마다 다시 부름, 서버는 8초 소식이 없으면 끔), 다 지우거나 방을 나가면 바로 끔
let typingSent = { room: 0, at: 0 };
export function setTyping(roomId, on) {
  const now = Date.now();
  if (on ? typingSent.room === roomId && now - typingSent.at < 3000 : typingSent.room !== roomId) return;
  typingSent = on ? { room: roomId, at: now } : { room: 0, at: 0 };
  api('rooms/typing', { room_id: roomId, on }).catch(() => {});
}

// reply: 답장할 원래 메시지 (없으면 null)
export async function send(roomId, body, retry, reply = null) {
  const msg = retry || { id: 0, room_id: roomId, user_id: state.me.id, kind: 'text', body, client_id: newClientId(), at: new Date().toISOString(), pending: true,
    reply_to: reply?.id || null, reply: reply ? { id: reply.id, user_id: reply.user_id, kind: reply.kind, body: reply.kind === 'text' ? reply.body.slice(0, 80) : '' } : undefined };
  msg.failed = false;
  const arr = state.messages[roomId] || (state.messages[roomId] = []);
  if (!retry) arr.push(msg);
  notify();
  typingSent = { room: 0, at: 0 }; // 보내면 서버가 입력 중을 끔
  try {
    const r = await api('messages/send', { room_id: roomId, body: msg.body, client_id: msg.client_id, reply_to: msg.reply_to || 0 });
    mergeMessages([r.message]);
    const room = state.rooms[roomId];
    if (room) {
      room.last = r.message;
      const mine = room.members.find((m) => m.id === state.me.id);
      if (mine) mine.last_read_id = Math.max(mine.last_read_id, r.message.id);
    }
    saveSoon();
  } catch (e) {
    if (e instanceof AuthError) { clearAll(); return; }
    msg.failed = true;
  }
  notify();
}

// 사진·영상 보내기: 보내는 중 메시지(휴대폰의 미리보기 + 진행률)를 먼저 보이고, 줄이기 → 올리기
// 사진·영상은 한 번에 하나씩 준비·전송 (영상 줄이기 중에 다른 것을 같이 하면 휴대폰이 버거워함)
let mediaQueue = Promise.resolve();

export function sendMedia(roomId, file, retry) {
  const isVideo = retry ? retry.kind === 'video' : file.type.startsWith('video/');
  const msg = retry || { id: 0, room_id: roomId, user_id: state.me.id, kind: isVideo ? 'video' : 'photo', body: '{}',
    client_id: newClientId(), at: new Date().toISOString(), pending: true, file, local: isVideo ? '' : URL.createObjectURL(file) };
  Object.assign(msg, { failed: false, error: '', progress: 0, stage: '기다리는 중' });
  const arr = state.messages[roomId] || (state.messages[roomId] = []);
  if (!retry) { arr.push(msg); keepPending(msg); }
  notify();
  mediaQueue = mediaQueue.then(() => sendMediaNow(roomId, msg, isVideo));
  return mediaQueue;
}

async function sendMediaNow(roomId, msg, isVideo) {
  if (!state.me || !(state.messages[roomId] || []).includes(msg)) return; // 그 사이 지웠거나 로그아웃
  msg.stage = isVideo ? '영상 준비 중' : '사진 줄이는 중';
  notify();
  try {
    const p = isVideo
      ? await prepVideo(msg.file, (f) => { msg.stage = '영상 줄이는 중'; msg.progress = f; notify(); })
      : await prepPhoto(msg.file);
    if (p.thumb && !msg.local) msg.local = 'data:image/jpeg;base64,' + p.thumb;
    msg.body = JSON.stringify({ w: p.w, h: p.h, dur: p.dur });
    msg.stage = '보내는 중';
    msg.progress = 0;
    notify();
    const m = await upload(roomId, p, msg.client_id, (f) => { msg.progress = f; notify(); });
    if (msg.local.startsWith('blob:')) URL.revokeObjectURL(msg.local);
    dropPending(msg.client_id);
    mergeMessages([m]);
    const room = state.rooms[roomId];
    if (room) {
      room.last = m;
      const mine = room.members.find((x) => x.id === state.me.id);
      if (mine) mine.last_read_id = Math.max(mine.last_read_id, m.id);
    }
    saveSoon();
  } catch (e) {
    if (e instanceof AuthError) { clearAll(); return; }
    msg.failed = true;
    msg.error = e.message;
  }
  notify();
}

// 사진 묶음: 여러 장을 메시지 하나로. 한 장씩 줄여 올린 뒤(열쇠를 기억해 재전송 때는 남은 것만) 묶음으로 끝냄
export function sendAlbum(roomId, files, retry) {
  const msg = retry || { id: 0, room_id: roomId, user_id: state.me.id, kind: 'photo', body: '{}', album: true, client_id: newClientId(),
    at: new Date().toISOString(), pending: true, files, keys: [], locals: files.map((f) => URL.createObjectURL(f)), local: '' };
  Object.assign(msg, { failed: false, error: '', progress: 0, stage: '기다리는 중' });
  const arr = state.messages[roomId] || (state.messages[roomId] = []);
  if (!retry) { arr.push(msg); keepPending(msg); }
  notify();
  mediaQueue = mediaQueue.then(() => sendAlbumNow(roomId, msg));
  return mediaQueue;
}

async function sendAlbumNow(roomId, msg) {
  if (!state.me || !(state.messages[roomId] || []).includes(msg)) return;
  const n = msg.files.length;
  try {
    for (let i = 0; i < n; i++) {
      if (msg.keys[i]) continue;
      msg.stage = `사진 ${i + 1}/${n}`;
      msg.progress = i / n;
      notify();
      const p = await prepPhoto(msg.files[i]);
      msg.keys[i] = await uploadFile(roomId, p, (f) => { msg.progress = (i + f) / n; notify(); });
    }
    msg.stage = '보내는 중';
    notify();
    let m;
    // 서버가 올린 사진을 못 찾으면(하루 넘게 지나 지워짐) 다음 재전송은 처음부터. 연결이 끊긴 것이면 열쇠를 그대로 두고 묶기만 다시
    try { m = await finishAlbum(msg.keys, msg.client_id); } catch (e) { if (e.status === 404) msg.keys = []; throw e; }
    for (const u of msg.locals) URL.revokeObjectURL(u);
    dropPending(msg.client_id);
    mergeMessages([m]);
    const room = state.rooms[roomId];
    if (room) {
      room.last = m;
      const mine = room.members.find((x) => x.id === state.me.id);
      if (mine) mine.last_read_id = Math.max(mine.last_read_id, m.id);
    }
    saveSoon();
  } catch (e) {
    if (e instanceof AuthError) { clearAll(); return; }
    msg.failed = true;
    msg.error = e.message;
  }
  notify();
}

// 전달: 같은 그룹의 방(roomIds)·친구(userIds)에게. index 가 있으면 묶음의 그 한 장만. 사진은 서버의 같은 파일을 씀
export async function forward(m, index, roomIds, userIds) {
  const r = await api('messages/forward', { id: m.id, index: index ?? null, room_ids: roomIds, user_ids: userIds });
  mergeMessages(r.messages);
  await syncNow();
}

// 채팅방 사진 모아보기: 이 방의 사진 메시지 (최근 것부터)
export async function roomPhotos(roomId) {
  return (await api(`rooms/photos?room_id=${roomId}`)).messages;
}

// ───── 길게 누르기: 나에게서 삭제(이 기기에서만 숨김)·모두에게 삭제 ─────
const HIDDEN_KEY = 'talk.hidden';
let hidden = new Set();
try { hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch { /* 무시 */ }
export const isHidden = (id) => hidden.has(id);
export function hideMessage(id) {
  hidden.add(id);
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden].slice(-2000))); } catch { /* 무시 */ }
  notify();
}
export async function deleteForAll(m) {
  await api('messages/delete', { id: m.id });
  mergeMessages([{ ...m, kind: 'deleted', body: '' }]);
  const room = state.rooms[m.room_id];
  if (room?.last?.id === m.id) room.last = { ...room.last, kind: 'deleted', body: '' };
  saveSoon();
  notify();
}

export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
// 반응: 바로 화면에 바꾸고 서버에 (같은 것을 다시 누르면 뺌). 실패하면 다음 동기화에서 바로잡힘
export async function react(m, emoji) {
  const mineIdx = (m.reactions || []).findIndex(([u]) => u === state.me.id);
  const had = mineIdx >= 0 ? m.reactions[mineIdx][1] : null;
  const next = (m.reactions || []).filter(([u]) => u !== state.me.id);
  if (had !== emoji) next.push([state.me.id, emoji]);
  mergeMessages([{ ...m, reactions: next }]);
  notify();
  await api('messages/react', { id: m.id, emoji });
  saveSoon();
}

export function discard(roomId, msg) {
  if (msg.local?.startsWith('blob:')) URL.revokeObjectURL(msg.local);
  for (const u of msg.locals || []) URL.revokeObjectURL(u);
  if (msg.file || msg.files) dropPending(msg.client_id);
  state.messages[roomId] = (state.messages[roomId] || []).filter((m) => m !== msg);
  notify();
}
