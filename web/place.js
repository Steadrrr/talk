// 위치·장소 (네이버 지도): ＋ 메뉴, 내 위치 보내기, 장소 검색, 장소 말풍선, 누르면 네이버 지도 앱에서 보기·길찾기·주소 복사
//  메시지 본문: { lat, lng, name, addr, road, cat, here, map } (map 은 서버가 받아 둔 지도 사진 열쇠, 없으면 null)
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from './html.js';
import { state, placeLookup, placeSearch, sendPlace } from './store.js';
import { useLongPress, useBackdrop } from './gallery.js';

export function placeInfo(m) {
  try { return JSON.parse(m.body || '{}') || {}; } catch { return {}; }
}
const mapUrl = (key) => new URL('./api.php/map/' + key, location.href).href;
const addrOf = (p) => p.road || p.addr || '';

// 장소 말풍선: 지도 사진(없으면 핀 그림) + 이름 + 주소
export function PlaceBubble({ m, onOpen, onMenu }) {
  const p = placeInfo(m);
  const press = useLongPress(() => !m.pending && onMenu?.(), () => !m.pending && onOpen?.());
  return html`<${PlaceCard} p=${p} m=${m} press=${press} />`;
}

export function PlaceCard({ p, m, press = {} }) {
  const [broken, setBroken] = useState(false);
  const title = p.here ? '📍 내 위치' : p.name;
  const sub = p.here ? (p.name !== '내 위치' ? p.name : '') : addrOf(p);
  return html`
    <button class="place-card" ...${press} aria-label=${'장소 ' + (p.name || '')}>
      <span class="place-map">
        ${p.map && !broken ? html`<img src=${mapUrl(p.map)} alt="" loading="lazy" onError=${() => setBroken(true)} />` : html`<span class="place-pin">📍</span>`}
        ${m?.pending && !m.failed && html`<span class="media-progress"><span>보내는 중</span></span>`}
        ${m?.failed && html`<span class="media-progress err-box"><span>${m.error || '보내지 못했어요'}</span></span>`}
      </span>
      <span class="place-text">
        <b class="ellipsis">${title || '장소'}</b>
        ${sub && html`<span class="hint small ellipsis">${sub}</span>`}
        ${!p.here && p.cat && p.cat !== '주소' && html`<span class="hint small ellipsis">${p.cat}</span>`}
      </span>
    </button>`;
}

// 네이버 지도 앱 주소 (공식 URL Scheme). 앱이 없으면 웹 지도 검색으로
const APP = () => encodeURIComponent(location.origin + location.pathname);
const isAndroid = () => /Android/i.test(navigator.userAgent);
function webUrl(p) {
  const q = p.here ? (addrOf(p) || p.name || `${p.lat},${p.lng}`) : `${p.name} ${addrOf(p)}`.trim();
  return 'https://map.naver.com/p/search/' + encodeURIComponent(q);
}
function openNaver(path, query, p) {
  const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') + '&appname=' + APP();
  const web = webUrl(p);
  if (isAndroid()) {
    location.href = `intent://${path}?${qs}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;S.browser_fallback_url=${encodeURIComponent(web)};end`;
    return;
  }
  // 아이폰: 앱이 없으면 열리지 않음 → 시트 아래 "웹에서 보기" 링크로 (시간 지나 자동으로 여는 창은 사파리가 막음)
  location.href = `nmap://${path}?${qs}`;
}

// 말풍선을 누르면: 지도 크게 + 네이버 지도에서 보기·길찾기·주소 복사
export function PlaceSheet({ m, onClose }) {
  const p = placeInfo(m);
  const [done, setDone] = useState('');
  const backdrop = useBackdrop(onClose);
  const name = p.here ? (p.name || '보낸 위치') : p.name;
  const addr = addrOf(p);
  const copy = async () => {
    try { await navigator.clipboard.writeText(addr || `${p.lat}, ${p.lng}`); setDone('주소를 복사했어요.'); } catch { setDone('복사하지 못했어요.'); }
  };
  return html`
    <div class="sheet-bg" onClick=${backdrop}>
      <div class="sheet action-sheet place-sheet" role="dialog" aria-label="장소">
        ${p.map && html`<img class="place-big" src=${mapUrl(p.map)} alt="" />`}
        <div class="place-head">
          <b>${p.here ? '📍 ' : ''}${name}</b>
          ${addr && addr !== name && html`<span class="hint small">${addr}</span>`}
          ${p.road && p.addr && html`<span class="hint small">지번 ${p.addr}</span>`}
          ${!p.here && p.cat && p.cat !== '주소' && html`<span class="hint small">${p.cat}</span>`}
        </div>
        ${done && html`<p class="hint center">${done}</p>`}
        <button onClick=${() => openNaver('place', { lat: p.lat, lng: p.lng, name }, p)}>네이버 지도에서 보기</button>
        <div class="action-grid">
          <button onClick=${() => openNaver('route/public', { dlat: p.lat, dlng: p.lng, dname: name }, p)}>길찾기 (대중교통)</button>
          <button onClick=${() => openNaver('route/car', { dlat: p.lat, dlng: p.lng, dname: name }, p)}>길찾기 (자동차)</button>
          <button onClick=${() => openNaver('route/walk', { dlat: p.lat, dlng: p.lng, dname: name }, p)}>길찾기 (걷기)</button>
          <button onClick=${copy}>주소 복사</button>
        </div>
        <a class="place-web" href=${webUrl(p)} target="_blank" rel="noopener noreferrer">네이버 지도 앱이 없으면 웹에서 보기</a>
        <button class="cancel" onClick=${onClose}>닫기</button>
      </div>
    </div>`;
}

// ＋ 메뉴: 사진·영상 / 내 위치 / 장소 검색
//  사진 고르기는 label 안의 file input 으로 (아이폰은 누름 안에서 열어야 고르기 창이 뜸)
export function AttachSheet({ onFiles, onHere, onSearch, onClose }) {
  const backdrop = useBackdrop(onClose);
  return html`
    <div class="sheet-bg" onClick=${backdrop}>
      <div class="sheet action-sheet attach-sheet" role="menu">
        <div class="attach-grid">
          <label class="attach-item"><span class="attach-icon">🖼️</span>사진·영상
            <input type="file" accept="image/*,video/*" multiple hidden onChange=${(e) => { onFiles(e); onClose(); }} /></label>
          <button class="attach-item" onClick=${onHere}><span class="attach-icon">📍</span>내 위치</button>
          <button class="attach-item" onClick=${onSearch}><span class="attach-icon">🔎</span>장소 검색</button>
        </div>
        <button class="cancel" onClick=${onClose}>취소</button>
      </div>
    </div>`;
}

// 내 위치 보내기: GPS 로 지금 자리 → 동 이름 미리 보기 → 보내기
export function HereSheet({ roomId, onSent, onClose }) {
  const [pos, setPos] = useState(null);     // { lat, lng, acc }
  const [where, setWhere] = useState(null); // 서버가 찾은 주소
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  const backdrop = useBackdrop(onClose);
  function locate() {
    setErr(''); setBusy(true); setPos(null); setWhere(null);
    if (!navigator.geolocation) { setErr('이 기기에서는 위치를 쓸 수 없어요.'); setBusy(false); return; }
    navigator.geolocation.getCurrentPosition((g) => {
      const p = { lat: g.coords.latitude, lng: g.coords.longitude, acc: Math.round(g.coords.accuracy || 0) };
      setPos(p);
      setBusy(false);
      placeLookup(p.lat, p.lng).then(setWhere).catch(() => setWhere({ area: '' }));
    }, (e) => {
      setBusy(false);
      setErr(e.code === 1 ? '위치 권한이 꺼져 있어요. 휴대폰 설정에서 이 앱(또는 사파리·크롬)의 위치를 "허용"으로 바꿔 주세요.'
        : e.code === 3 ? '위치를 찾는 데 너무 오래 걸려요. 밖이나 창가에서 다시 해 보세요.' : '위치를 찾지 못했어요.');
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }
  useEffect(locate, []);
  function go() {
    sendPlace(roomId, { lat: pos.lat, lng: pos.lng, here: true, name: where?.area || '', addr: where?.addr || '', road: where?.road || '' });
    onSent();
  }
  return html`
    <div class="sheet-bg" onClick=${backdrop}>
      <div class="sheet action-sheet place-sheet" role="dialog" aria-label="내 위치 보내기">
        <div class="place-head">
          <b>📍 내 위치 보내기</b>
          ${busy && html`<span class="hint">위치를 찾는 중…</span>`}
          ${err && html`<span class="err">${err}</span>`}
          ${pos && html`<span>${where === null ? '주소를 찾는 중…' : where.area || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`}</span>
            ${where?.road && html`<span class="hint small">${where.road}</span>`}
            ${pos.acc > 0 && html`<span class="hint small">오차 약 ${pos.acc >= 1000 ? (pos.acc / 1000).toFixed(1) + 'km' : pos.acc + 'm'}${pos.acc > 300 ? ' · 조금 엇나갈 수 있어요' : ''}</span>`}`}
        </div>
        <button class="primary-btn" onClick=${go} disabled=${!pos}>보내기</button>
        ${(err || pos) && html`<button onClick=${locate}>다시 찾기</button>`}
        <button class="cancel" onClick=${onClose}>취소</button>
      </div>
    </div>`;
}

// 장소 검색: 가게·건물 이름이나 주소 → 누르면 그 장소를 보냄
export function PlaceSearch({ roomId, onSent, onClose }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const word = q.trim();
    if (word.length < 2) { setRes(null); setErr(''); return; }
    const n = ++seq.current;
    const t = setTimeout(() => {
      setBusy(true);
      placeSearch(word).then((r) => n === seq.current && (setRes(r), setErr(''))).catch((e) => n === seq.current && setErr(e.message))
        .finally(() => n === seq.current && setBusy(false));
    }, 450);
    return () => clearTimeout(t);
  }, [q]);
  function pick(p) {
    sendPlace(roomId, { ...p, here: false });
    onSent();
  }
  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button>
          <input class="grow search-input" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="장소·주소 검색 (예: 강남역 스타벅스)" autofocus enterkeyhint="search" /></header>
        <div class="scroll">
          ${!state.naver?.search && html`<p class="hint pad">관리 화면에 네이버 열쇠가 아직 없어서 찾을 수 없어요.</p>`}
          ${err && html`<p class="err pad">${err}</p>`}
          ${busy && !res && html`<p class="hint pad">찾는 중…</p>`}
          ${res && res.length === 0 && html`<p class="empty">찾는 장소가 없어요. 동네 이름을 붙여 보세요 (예: 분당 정자동 카페).</p>`}
          ${res && res.map((p) => html`
            <button class="search-hit" onClick=${() => pick(p)}>
              <span class="hit-top"><b>${p.name}</b>${p.cat && html`<span class="hint small">${p.cat}</span>`}</span>
              <span class="hint small">${p.road || p.addr}</span>
            </button>`)}
          ${res && res.length > 0 && html`<p class="hint pad small">누르면 이 방에 바로 보내요.</p>`}
        </div>
      </div>
    </div>`;
}
