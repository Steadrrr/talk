// 앱 상태 + 서버와 맞추기(동기화).
// 서버에 "변경 번호(cursor)"가 있어서, 앱은 sync?since=<번호> 로 그 뒤에 바뀐 방·새 메시지만 받는다.
// 받은 것은 이 기기(localStorage)에 남겨서, 다음에 열 때 서버를 기다리지 않고 바로 보여 준다.
import { api, AuthError, setToken } from './api.js';
import { nickOf } from './names.js';
import { prepPhoto, prepVideo, upload } from './media.js';
import { keepPending, dropPending, listPending, clearPending } from './pending.js';

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
  online: true,
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
    localStorage.setItem(SAVE_KEY, JSON.stringify({ me: state.me, groups: state.groups, groupsRev: state.groupsRev, rooms: state.rooms, messages, cursor: state.cursor }));
  } catch { /* 저장 공간이 없거나 막혀도 앱은 그대로 동작 */ }
}
let saveTimer = 0;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }

export function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && s.me) Object.assign(state, { me: s.me, groups: s.groups || [], groupsRev: s.groupsRev || 0, rooms: s.rooms || {}, messages: s.messages || {}, cursor: s.cursor || 0 });
  } catch { /* 망가진 저장은 무시하고 서버에서 새로 받음 */ }
  restorePending();
}

// 앱이 새로 열리면서 끊긴 사진·영상: "재전송" 로 되살림
async function restorePending() {
  for (const p of await listPending()) {
    if (!p.file || !state.rooms[p.room_id]) { dropPending(p.client_id); continue; }
    const arr = state.messages[p.room_id] || (state.messages[p.room_id] = []);
    if (arr.some((m) => m.client_id === p.client_id)) continue;
    arr.push({ id: 0, room_id: p.room_id, user_id: state.me?.id, kind: p.kind, body: '{}', client_id: p.client_id, at: p.at, pending: true,
      file: p.file, local: p.kind === 'photo' ? URL.createObjectURL(p.file) : '', failed: true, error: '보내다가 멈췄어요', progress: 0, stage: '' });
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
    try {
      let more = true;
      while (more) {
        const r = await api('sync?since=' + state.cursor + (document.hidden ? '' : '&active=1&room=' + (state.openRoom || 0)));
        if (r.full) state.messages = Object.fromEntries(Object.entries(state.messages).map(([k, v]) => [k, v.filter((m) => m.pending)]));
        mergeRooms(r.rooms, r.full);
        mergeMessages(r.messages);
        if (r.room_ids) dropRooms(r.room_ids);
        state.cursor = r.cursor;
        more = r.more;
        if (r.groups_rev !== undefined && r.groups_rev !== state.groupsRev) await loadMe();
      }
      state.online = true;
      markReadIfOpen();
      saveSoon();
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

// 방을 보고 있으면 2초, 목록이면 5초, 앱이 뒤로 가면 멈춤 (그동안 새 메시지는 웹 푸시 알림으로)
function schedule() {
  clearTimeout(timer);
  if (stopped || document.hidden) return;
  timer = setTimeout(async () => { await syncNow(); schedule(); }, state.openRoom ? 2000 : 5000);
}

export function startSync() {
  stopped = false;
  syncNow().then(schedule);
}
export function stopSync() { stopped = true; clearTimeout(timer); }

document.addEventListener('visibilitychange', () => {
  if (stopped) return;
  if (document.hidden) {
    clearTimeout(timer);
    // 서버에 "앱을 안 보고 있음" → 이제부터 새 메시지는 알림으로 (앱이 닫혀도 보내지도록 keepalive)
    api('me/away', {}, { keepalive: true }).catch(() => {});
  } else syncNow().then(schedule);
});
window.addEventListener('online', () => { if (!stopped) syncNow().then(schedule); });

// ───── 내 정보·그룹 ─────
export async function loadMe() {
  const r = await api('me');
  state.me = r.me;
  state.groups = r.groups;
  state.groupsRev = r.groups_rev || 0;
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
  await api('rooms/photo', { room_id: roomId, data: data || '' });
  await syncNow();
}

// 프로필 사진: data = base64 (JPEG) 또는 null(지우기)
export async function setPhoto(data) {
  await api('me/photo', { data: data || '' });
  await loadMe();
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
  const others = room.members.filter((m) => m.id !== state.me?.id).map(nickOf);
  return others.join(', ') || '나';
}

export function sortedRooms() {
  return Object.values(state.rooms).sort((a, b) =>
    (b.pinned - a.pinned) || ((b.last?.id || 0) - (a.last?.id || 0)) || (b.id - a.id));
}

export function openRoom(id) {
  state.openRoom = id;
  if (state.rooms[id]) state.rooms[id].unread = 0;
  notify();
  markReadIfOpen();
  schedule();
}

export function closeRoom() {
  state.openRoom = null;
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

// reply: 답장할 원래 메시지 (없으면 null)
export async function send(roomId, body, retry, reply = null) {
  const msg = retry || { id: 0, room_id: roomId, user_id: state.me.id, kind: 'text', body, client_id: newClientId(), at: new Date().toISOString(), pending: true,
    reply_to: reply?.id || null, reply: reply ? { id: reply.id, user_id: reply.user_id, kind: reply.kind, body: reply.kind === 'text' ? reply.body.slice(0, 80) : '' } : undefined };
  msg.failed = false;
  const arr = state.messages[roomId] || (state.messages[roomId] = []);
  if (!retry) arr.push(msg);
  notify();
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
  if (msg.file) dropPending(msg.client_id);
  state.messages[roomId] = (state.messages[roomId] || []).filter((m) => m !== msg);
  notify();
}
