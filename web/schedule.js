// 일정 공지 (D-Day): 방 위쪽 공지 밑 한 줄(가까운 일정, 누르면 전부 펼침·숨기기), ＋ 메뉴·채팅방 관리에서 올리기·고치기
//  일정: { id, day: 'YYYY-MM-DD', title, place: { name, addr, road, cat, lat, lng } | null, by, updated }
import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';
import { saveSchedule, deleteSchedule } from './store.js';
import { PlaceSearch } from './place.js';
import { useBackdrop } from './gallery.js';

const pad = (n) => String(n).padStart(2, '0');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
export function ddayOf(day) {
  const n = dayNum(day) - dayNum(today());
  return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`;
}
export function dateText(day) {
  const w = '일월화수목금토'[new Date(dayNum(day) * 86400000).getUTCDay()];
  return `${+day.slice(5, 7)}월 ${+day.slice(8, 10)}일 (${w})`;
}
// 서버가 지난 일정을 다음 날부터 빼 주지만, 앱을 켜 둔 채 날이 바뀔 수 있어서 여기서도 거름
export const upcoming = (list) => (list || []).filter((s) => s.day >= today());

// 공지 밑 D-Day 줄: 평소엔 가장 가까운 일정 한 줄(넘치면 …, 더 있으면 "외 N개"), 누르면 전부 가까운 순으로.
// "숨기기"는 이 기기에서만, 그때 본 것보다 새로 올라오거나 고친 일정이 생기면 다시 보임
export function ScheduleBar({ schedules, roomId, onPlace }) {
  const list = upcoming(schedules);
  const key = 'talk.scheduleHide.' + roomId;
  const latest = list.reduce((a, s) => (s.updated > a ? s.updated : a), '');
  const isHidden = () => { try { const v = localStorage.getItem(key); return !!v && v >= latest; } catch { return false; } };
  const [hidden, setHidden] = useState(isHidden);
  const [open, setOpen] = useState(false);
  useEffect(() => { setHidden(isHidden()); }, [latest]);
  if (!list.length || hidden) return null;
  const hide = () => { setHidden(true); setOpen(false); try { localStorage.setItem(key, latest); } catch { /* 무시 */ } };
  const s = list[0];
  return html`
    <div class=${'notice-bar schedule-bar' + (open ? ' open' : '')}>
      <button class="notice-body" onClick=${() => setOpen(!open)} aria-expanded=${open} aria-label=${open ? '일정 접기' : '일정 펼치기'}>
        <span class="notice-icon">📅</span>
        ${open ? html`<span class="notice-text"><b>일정 ${list.length}개</b></span>`
          : html`<span class="notice-text"><b class="dday">${ddayOf(s.day)}</b> ${s.title}${s.place ? ` · 📍 ${s.place.name}` : ''}</span>
            ${list.length > 1 && html`<span class="hint small more">외 ${list.length - 1}개</span>`}`}
        <span class="notice-caret">${open ? '⌃' : '⌄'}</span>
      </button>
      ${open && html`
      <ul class="schedule-list">
        ${list.map((x) => html`<${ScheduleItem} s=${x} onPlace=${onPlace} />`)}
      </ul>
      <div class="notice-foot">
        <span class="hint small"></span>
        <button class="notice-hide" onClick=${hide}>숨기기</button>
      </div>`}
    </div>`;
}

// 일정 한 줄: D-Day · 날짜 · 내용, 장소(누르면 네이버 지도 시트)
export function ScheduleItem({ s, onPlace, children }) {
  return html`
    <li class="schedule-item">
      <span class="dday">${ddayOf(s.day)}</span>
      <span class="schedule-main">
        <span class="hint small">${dateText(s.day)}${s.by ? ` · ${s.by}` : ''}</span>
        <span class="schedule-title">${s.title}</span>
        ${s.place && html`<button class="schedule-place" onClick=${() => onPlace?.(s.place)}>📍 ${s.place.name}<span class="hint small">${s.place.road || s.place.addr || ''}</span></button>`}
        ${children}
      </span>
    </li>`;
}

// 일정 올리기·고치기: 날짜를 고르면 내용·장소 칸과 "일정 등록" 단추
export function ScheduleSheet({ roomId, edit, onDone, onClose }) {
  const [day, setDay] = useState(edit?.day || '');
  const [title, setTitle] = useState(edit?.title || '');
  const [place, setPlace] = useState(edit?.place || null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const backdrop = useBackdrop(onClose);
  async function save() {
    setErr(''); setBusy(true);
    try { await saveSchedule(roomId, { id: edit?.id, day, title: title.trim(), place }); onDone?.(); onClose(); }
    catch (e) { setErr(e.message || '올리지 못했어요.'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm(`"${edit.title}" 일정을 내릴까요? 모두에게서 사라져요.`)) return;
    setErr(''); setBusy(true);
    try { await deleteSchedule(roomId, edit.id); onDone?.(); onClose(); } catch (e) { setErr(e.message || '내리지 못했어요.'); } finally { setBusy(false); }
  }
  return html`
    <div class="sheet-bg" onClick=${backdrop}>
      <div class="sheet action-sheet schedule-sheet" role="dialog" aria-label=${edit ? '일정 고치기' : '일정 등록'}>
        <div class="place-head"><b>📅 ${edit ? '일정 고치기' : '일정 등록'}</b>
          <span class="hint small">방 위쪽 공지 밑에 D-Day 로 보여요. 대화 상대 누구나 고칠 수 있어요.</span></div>
        <label class="field">날짜<input type="date" class="schedule-day" value=${day} min=${today()} onInput=${(e) => setDay(e.target.value)} /></label>
        ${day && html`
          <p class="hint center"><b class="dday">${ddayOf(day)}</b> ${dateText(day)}</p>
          <label class="field">내용<input class="schedule-title-input" value=${title} maxlength="100" placeholder="예: 가족 여행" onInput=${(e) => setTitle(e.target.value)} /></label>
          <div class="field">장소 <span class="hint small">(없어도 돼요)</span>
            ${place
              ? html`<div class="schedule-picked"><span class="grow">📍 ${place.name}<span class="hint small">${place.road || place.addr || ''}</span></span>
                  <button class="icon" onClick=${() => setPlace(null)} aria-label="장소 빼기">✕</button></div>`
              : html`<button class="schedule-pick" onClick=${() => setSearching(true)}>🔎 장소 검색</button>`}
          </div>
          ${err && html`<p class="err">${err}</p>`}
          <button class="primary-btn" onClick=${save} disabled=${busy || !title.trim() || day < today()}>${busy ? '올리는 중…' : edit ? '저장' : '일정 등록'}</button>`}
        ${edit && html`<button class="danger" onClick=${remove} disabled=${busy}>일정 내리기</button>`}
        <button class="cancel" onClick=${onClose}>취소</button>
      </div>
      ${searching && html`<${PlaceSearch} roomId=${roomId} onPick=${(p) => { setPlace(p); setSearching(false); }} onClose=${() => setSearching(false)} />`}
    </div>`;
}
