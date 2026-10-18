// 사진·영상 보내기: 휴대폰에서 줄인 뒤 2MB 조각으로 올린다 (서버 용량이 작아서)
//  - 사진: 긴 쪽 1600px, WebP(안 되면 JPEG). 위치 정보 같은 EXIF 는 다시 그리면서 빠진다
//  - 영상: 60초까지. 8MB 이하 mp4·mov 는 그대로, 크면 480p·약 1Mbps 로 다시 만듦 (재생하면서 녹화라 영상 길이만큼 걸림)
import { api, getToken } from './api.js';

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

// 목록·알림에 보일 한 줄
export function preview(m) {
  if (!m) return '';
  if (m.kind === 'photo') return '사진';
  if (m.kind === 'video') return '동영상';
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
  v.preload = 'auto';
  v.src = url;
  return v;
}
const once = (el, ev) => new Promise((ok, no) => {
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', () => no(new Error('영상을 열지 못했어요.')), { once: true });
});

// 미리보기 그림 (첫 장면, 긴 쪽 480px JPEG)
async function poster(v) {
  v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
  await once(v, 'seeked');
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
  v.currentTime = 0;
  await once(v, 'seeked');
  let raf = 0;
  const draw = () => {
    g.drawImage(v, 0, 0, c.width, c.height);
    onProgress?.(Math.min(0.99, v.currentTime / v.duration));
    raf = requestAnimationFrame(draw);
  };
  rec.start(1000);
  draw();
  try { await v.play(); } catch {
    v.muted = true;                        // 소리 있는 재생을 막는 브라우저: 소리 없이
    await v.play();
  }
  // 화면을 떠나면(사진 고르는 창 등) 휴대폰이 재생을 멈춘다: 녹화도 쉬었다가 돌아오면 이어서
  const onVis = () => {
    if (document.hidden) { if (rec.state === 'recording') rec.pause(); return; }
    if (rec.state === 'paused') rec.resume();
    if (v.paused && !v.ended) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  };
  document.addEventListener('visibilitychange', onVis);
  try { await once(v, 'ended'); } finally { document.removeEventListener('visibilitychange', onVis); }
  cancelAnimationFrame(raf);
  rec.stop();
  await stopped;
  ac?.close();
  const blob = new Blob(parts, { type: type.split(';')[0] });
  return { blob, mime: blob.type, w: c.width, h: c.height };
}

export async function prepVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const v = videoEl(url);
    await once(v, 'loadedmetadata');
    if (v.duration > VIDEO_MAX_SEC + 1) throw new Error(`${VIDEO_MAX_SEC}초 이하 영상만 보낼 수 있어요.`);
    const thumb = await poster(v).catch(() => null);
    const base = { kind: 'video', dur: Math.round(v.duration), thumb };
    const plainOk = ['video/mp4', 'video/quicktime'].includes(file.type);
    if (plainOk && file.size <= KEEP_AS_IS) return { ...base, blob: file, mime: file.type, w: v.videoWidth, h: v.videoHeight };
    const re = await reencode(v, onProgress).catch(() => null);
    if (re && re.blob.size > 0 && re.blob.size <= SEND_MAX) return { ...base, ...re };
    if (plainOk && file.size <= SEND_MAX) return { ...base, blob: file, mime: file.type, w: v.videoWidth, h: v.videoHeight };
    throw new Error('영상이 너무 커서 보낼 수 없어요. 더 짧게 잘라서 보내 주세요.');
  } finally { URL.revokeObjectURL(url); }
}

async function putChunk(key, offset, blob) {
  const res = await fetch(`${BASE}media/chunk?key=${key}&offset=${offset}`, {
    method: 'POST', headers: { 'X-Talk-Token': getToken(), 'Content-Type': 'application/octet-stream' }, body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data.received;
}

// 올리기 → 메시지. onProgress(0~1). 끊기면 조각마다 3번까지 다시
export async function upload(roomId, p, clientId, onProgress) {
  const { key } = await api('media/start', { room_id: roomId, kind: p.kind, mime: p.mime, size: p.blob.size, w: p.w, h: p.h, dur: p.dur, thumb: p.thumb || '' });
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
  return (await api('media/finish', { key, client_id: clientId })).message;
}
