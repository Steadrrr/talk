// 앱 상태 + 서버와 맞추기(동기화).
// 서버에 "변경 번호(cursor)"가 있어서, 앱은 sync?since=<번호> 로 그 뒤에 바뀐 방·새 메시지만 받는다.
// 받은 것은 이 기기(localStorage)에 남겨서, 다음에 열 때 서버를 기다리지 않고 바로 보여 준다.
import { api, AuthError, setToken } from './api.js';

const SAVE_KEY = 'talk.state.v1';
const KEEP_PER_ROOM = 100; // 기기에 남기는 방별 최근 메시지 수

export const state = {
  me: null,        // { id, name, is_admin }
  groups: [],      // [{ id, name, members: [{ id, name }] }]
  rooms: {},       // id → { id, group_id, kind, name, members, last, unread, muted, pinned }
  messages: {},    // roomId → [메시지] (id 순서, 보내는 중인 것은 뒤에 pending: true)
  cursor: 0,
  groupsRev: 0,    // 서버의 그룹 변경 번호. 동기화 때 달라지면 친구 목록을 다시 받는다
  openRoom: null,  // 지금 보고 있는 방 번호
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
}

export function clearAll() {
  stopSync();
  setToken('');
  try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('talk.token'); } catch { /* 무시 */ }
  Object.assign(state, { me: null, groups: [], rooms: {}, messages: {}, cursor: 0, openRoom: null });
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
    if (!arr.some((x) => x.id === m.id)) { arr.push(m); touched.add(m.room_id); }
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
        const r = await api('sync?since=' + state.cursor);
        if (r.full) state.messages = Object.fromEntries(Object.entries(state.messages).map(([k, v]) => [k, v.filter((m) => m.pending)]));
        mergeRooms(r.rooms, r.full);
        mergeMessages(r.messages);
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

// 방을 보고 있으면 2초, 목록이면 5초, 앱이 뒤로 가면 멈춤 (알림은 2단계의 웹 푸시)
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
  if (document.hidden) clearTimeout(timer);
  else syncNow().then(schedule);
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

export function people() {
  const map = new Map();
  for (const g of state.groups) for (const m of g.members) map.set(m.id, m.name);
  return map;
}

// ───── 방 ─────
export function roomTitle(room) {
  if (!room) return '';
  if (room.name) return room.name;
  const others = room.members.filter((m) => m.id !== state.me?.id).map((m) => m.name);
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

export async function send(roomId, body, retry) {
  const msg = retry || { id: 0, room_id: roomId, user_id: state.me.id, kind: 'text', body, client_id: newClientId(), at: new Date().toISOString(), pending: true };
  msg.failed = false;
  const arr = state.messages[roomId] || (state.messages[roomId] = []);
  if (!retry) arr.push(msg);
  notify();
  try {
    const r = await api('messages/send', { room_id: roomId, body: msg.body, client_id: msg.client_id });
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

export function discard(roomId, msg) {
  state.messages[roomId] = (state.messages[roomId] || []).filter((m) => m !== msg);
  notify();
}
