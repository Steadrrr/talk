// 사진·영상 보내기: 휴대폰에서 줄인 뒤 2MB 조각으로 올린다 (서버 용량이 작아서)
//  - 사진: 긴 쪽 1600px, WebP(안 되면 JPEG). 위치 정보 같은 EXIF 는 다시 그리면서 빠진다
//  - 영상: 60초까지. 8MB 이하 mp4·mov 는 그대로, 크면 480p·약 1Mbps 로 다시 만듦 (재생하면서 녹화라 영상 길이만큼 걸림)
import { api, getToken, b64Blob } from './api.js';

const BASE = new URL('./api.php/', location.href).href;
const CHUNK = 2 * 1024 * 1024;
export const VIDEO_MAX_SEC = 60;
const KEEP_AS_IS = 8 * 1024 * 1024;
const SEND_MAX = 40 * 1024 * 1024;

export const mediaUrl = (key, thumb = false) => BASE + 'media/' + key + (thumb ? '/thumb' : '');

// 메시지 본문(JSON) 읽기
export function mediaInfo(m) {
  try { return JSON.parse(m.body) || {}; } catch { return {}; }
}

// 사진·영상 메시지의 파일들: 묶음이면 items, 아니면 본문 하나. gone 은 보관 기간이 지나 지워진 것
export function mediaItems(m) {
  const info = mediaInfo(m);
  return Array.isArray(info.items) ? info.items : info.key ? [info] : [];
}

// 목록·알림에 보일 한 줄
export function preview(m) {
  if (!m) return '';
  if (m.kind === 'photo') { const n = mediaItems(m).length; return n > 1 ? `사진 ${n}장` : '사진'; }
  if (m.kind === 'video') return '동영상';
  if (m.kind === 'place') { try { const p = JSON.parse(m.body || '{}'); return p.here ? '📍 위치: ' + (p.name || '') : '📍 ' + (p.name || '장소'); } catch { return '📍 장소'; } }
  if (m.kind === 'deleted') return '삭제된 메시지';
  return m.body;
}

const loadImage = (url) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => no(new Error('사진을 열지 못했어요.'));
  i.src = url;
});
const toBlob = (canvas, type, q) => new Promise((ok) => canvas.toBlob(ok, type, q));

export async function prepPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    let blob = await toBlob(c, 'image/webp', 0.8);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(c, 'image/jpeg', 0.82);
    return { kind: 'photo', blob, mime: blob.type, w, h, dur: 0, thumb: null };
  } finally { URL.revokeObjectURL(url); }
}

function videoEl(url) {
  const v = document.createElement('video');
  v.playsInline = true;
  v.muted = true;            // 아이폰: 소리 켠 채로는 손가락 누름 없이 재생·장면 읽기를 안 해 줘서 멈춰 있었음
  v.preload = 'auto';
  v.src = url;
  // 아이폰은 화면(문서)에 붙어 있지 않은 영상은 장면을 안 읽어 주기도 해서, 안 보이게 붙여 둔다
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  v.load();
  return v;
}
// 이벤트 기다리기. ms 가 있으면 그 시간 안에 안 오면 실패 (아이폰이 이벤트를 안 주고 멈추는 일이 있어서)
const once = (el, ev, ms = 0) => new Promise((ok, no) => {
  const t = ms ? setTimeout(() => no(new Error('timeout')), ms) : 0;
  el.addEventListener(ev, () => { clearTimeout(t); ok(); }, { once: true });
  el.addEventListener('error', () => { clearTimeout(t); no(new Error('영상을 열지 못했어요.')); }, { once: true });
});

// 미리보기 그림 (첫 장면, 긴 쪽 480px JPEG)
async function poster(v) {
  if (v.readyState < 2) await once(v, 'loadeddata', 8000);
  v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
  await once(v, 'seeked', 5000);
  const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const b = await toBlob(c, 'image/jpeg', 0.7);
  return b ? b64(new Uint8Array(await b.arrayBuffer())) : null;
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function recorderType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return '';
  for (const t of ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

// 480p 로 다시 만들기: 영상을 재생하면서 캔버스에 그리고 녹화 (소리는 Web Audio 로 같이)
async function reencode(v, onProgress) {
  const type = recorderType();
  if (!type) return null;
  const scale = Math.min(1, 480 / Math.min(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale / 2) * 2; c.height = Math.round(v.videoHeight * scale / 2) * 2;
  const g = c.getContext('2d');
  const stream = c.captureStream(30);
  let ac = null;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ac.createMediaStreamDestination();
    ac.createMediaElementSource(v).connect(dest);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  } catch { /* 소리 없이 */ }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 64_000 });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise((ok) => { rec.onstop = ok; });
  if (v.currentTime > 0) { v.currentTime = 0; await once(v, 'seeked', 5000).catch(() => {}); }
  let raf = 0;
  const draw = () => {
    g.drawImage(v, 0, 0, c.width, c.height);
    onProgress?.(Math.min(0.99, v.currentTime / v.duration));
    raf = requestAnimationFrame(draw);
  };
  rec.start(1000);
  draw();
  v.muted = false;                         // 소리도 같이 녹화하려고 켜 봄
  try { await v.play(); } catch {
    v.muted = true;                        // 소리 있는 재생을 막는 브라우저(아이폰): 소리 없이
    await v.play();
  }
  // 화면을 떠나면(사진 고르는 창 등) 휴대폰이 재생을 멈춘다: 녹화도 쉬었다가 돌아오면 이어서
  const onVis = () => {
    if (document.hidden) { if (rec.state === 'recording') rec.pause(); return; }
    if (rec.state === 'paused') rec.resume();
    if (v.paused && !v.ended) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  };
  document.addEventListener('visibilitychange', onVis);
  // 재생이 안 끝나고 멈춰 버리면(시간이 안 흐름) 포기하고 원본으로
  let last = -1, still = 0;
  const watch = setInterval(() => {
    if (document.hidden) return;
    still = v.currentTime === last ? still + 1 : 0;
    last = v.currentTime;
    if (still >= 8) v.dispatchEvent(new Event('error'));
  }, 1000);
  try { await once(v, 'ended'); } catch (e) {
    rec.stop(); ac?.close(); v.pause();
    throw e;
  } finally {
    clearInterval(watch);
    document.removeEventListener('visibilitychange', onVis);
    cancelAnimationFrame(raf);
  }
  rec.stop();
  await stopped;
  ac?.close();
  const blob = new Blob(parts, { type: type.split(';')[0] });
  return { blob, mime: blob.type, w: c.width, h: c.height };
}

export async function prepVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  const v = videoEl(url);
  try {
    if (v.readyState < 1) await once(v, 'loadedmetadata', 15000).catch(() => { throw new Error('영상을 열지 못했어요. 다른 영상으로 해 보세요.'); });
    if (v.duration > VIDEO_MAX_SEC + 1) throw new Error(`${VIDEO_MAX_SEC}초 이하 영상만 보낼 수 있어요.`);
    const thumb = await poster(v).catch(() => null);
    const base = { kind: 'video', dur: Math.round(v.duration), thumb };
    const plainOk = ['video/mp4', 'video/quicktime'].includes(file.type);
    if (plainOk && file.size <= KEEP_AS_IS) return { ...base, blob: file, mime: file.type, w: v.videoWidth, h: v.videoHeight };
    const re = await reencode(v, onProgress).catch(() => null);
    if (re && re.blob.size > 0 && re.blob.size <= SEND_MAX) return { ...base, ...re };
    if (plainOk && file.size <= SEND_MAX) return { ...base, blob: file, mime: file.type, w: v.videoWidth, h: v.videoHeight };
    throw new Error('영상이 너무 커서 보낼 수 없어요. 더 짧게 잘라서 보내 주세요.');
  } finally { v.pause(); v.remove(); URL.revokeObjectURL(url); }
}

async function putChunk(key, offset, blob) {
  const res = await fetch(`${BASE}media/chunk?key=${key}&offset=${offset}`, {
    method: 'POST', headers: { 'X-Talk-Token': getToken(), 'Content-Type': 'application/octet-stream' }, body: blob,
  });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`서버 응답이 이상해요 (HTTP ${res.status}, media/chunk)`);
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data.received;
}

// 올리기 → 메시지. onProgress(0~1)
export async function upload(roomId, p, clientId, onProgress) {
  const key = await uploadFile(roomId, p, onProgress);
  return (await api('media/finish', { key, client_id: clientId })).message;
}

// 사진 묶음: 따로 올린 열쇠들을 메시지 하나로
export async function finishAlbum(keys, clientId) {
  return (await api('media/album', { keys, client_id: clientId })).message;
}

// 파일만 올리기 (메시지는 아직). 끊기면 조각마다 3번까지 다시. 열쇠를 돌려줌
export async function uploadFile(roomId, p, onProgress) {
  const { key } = await api('media/start', { room_id: roomId, kind: p.kind, mime: p.mime, size: p.blob.size, w: p.w, h: p.h, dur: p.dur });
  // 미리보기는 따로 그대로 보낸다 (JSON 안 base64 는 카페24 웹 방화벽이 막을 수 있어서). 실패해도 영상은 보냄
  if (p.thumb) await api(`media/thumb?key=${key}`, b64Blob(p.thumb)).catch(() => {});
  let off = 0;
  while (off < p.blob.size) {
    let tries = 0;
    for (;;) {
      try { off = await putChunk(key, off, p.blob.slice(off, off + CHUNK)); break; } catch (e) {
        if (++tries >= 3) throw e;
        await new Promise((ok) => setTimeout(ok, 1000 * tries));
      }
    }
    onProgress?.(off / p.blob.size);
  }
  return key;
}

// 저장: 휴대폰은 공유 창(→ "이미지 저장"/"비디오 저장")으로, 컴퓨터는 내려받기로. 묶음은 index 가 없으면 전부
export async function saveMedia(m, index = null) {
  const items = mediaItems(m).map((it, i) => ({ it, i })).filter(({ it, i }) => !it.gone && (index === null || i === index));
  if (!items.length) throw new Error('보관 기간이 지나 지워졌어요.');
  const files = [];
  for (const { it, i } of items) {
    const res = await fetch(mediaUrl(it.key));
    if (!res.ok) throw new Error('파일을 받지 못했어요.');
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || (m.kind === 'photo' ? 'jpg' : 'mp4')).replace('quicktime', 'mov').replace('jpeg', 'jpg');
    files.push(new File([blob], `SAKiTalk-${m.id}${items.length > 1 || index !== null ? '-' + (i + 1) : ''}.${ext}`, { type: blob.type }));
  }
  if (navigator.canShare?.({ files }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  for (const file of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
}
