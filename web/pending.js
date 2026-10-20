// 보내는 중인 사진·영상을 IndexedDB 에 잠깐 보관: 아이폰은 사진 고르는 창을 다녀오는 사이 앱을 새로 여는 일이 있어서,
// 그러면 화면의 "보내는 중" 이 사라졌다. 다시 열면 "재전송" 로 되살린다. 다 보내거나 지우면 뺀다.
const DB = 'talk-pending', STORE = 'media';
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((ok, no) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'client_id' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
async function run(mode, fn) {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => ok(req?.result);
    t.onerror = () => no(t.error);
  });
}
export const keepPending = (m) => run('readwrite', (s) => s.put({ client_id: m.client_id, room_id: m.room_id, kind: m.kind, at: m.at, file: m.file, files: m.files })).catch(() => {});
export const dropPending = (clientId) => run('readwrite', (s) => s.delete(clientId)).catch(() => {});
export const listPending = () => run('readonly', (s) => s.getAll()).catch(() => []);
export const clearPending = () => run('readwrite', (s) => s.clear()).catch(() => {});
