// 채팅방 관리: 채팅방 공지(누르면 상단 공지·일정 공지 화면) → 채팅방 설정(방 사진·방 이름·알림·위에 고정) → 사진·영상(모아보기) → 사키 설정 → 대화 상대(초대) → 나가기
import { useState, useEffect } from 'preact/hooks';
import { html, Avatar, openImage, PhotoViewer, PhotoCrop } from './html.js';
import { nickOf } from './names.js';
import { state, photoOf, roomTitle, roomPrefs, renameRoom, inviteToRoom, leaveRoom, showProfile, setRoomPhoto, createRoom, openRoom, setSaki, setSakiRelation, sakiMemory, setNotice } from './store.js';
import { ScheduleItem, ScheduleSheet, upcoming } from './schedule.js';
import { PlaceSheet } from './place.js';

export function RoomSettings({ room, onClose, onLeft, onPhotos }) {
  const [name, setName] = useState(room.name || '');
  const [inviting, setInviting] = useState(false);
  const [picked, setPicked] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false); // 채팅방 공지 화면 (상단 공지·일정 공지)
  const [sakiOpen, setSakiOpen] = useState(false); // 사키 설정 화면
  const schedules = upcoming(room.schedules);
  const isGroup = room.kind === 'group';
  const showSaki = isGroup && (state.sakiReady || room.saki?.ready || room.saki?.on > 0);
  const inRoom = new Set(room.members.map((m) => m.id));
  const group = state.groups.find((g) => g.id === room.group_id);
  const candidates = (group?.members || []).filter((m) => !inRoom.has(m.id));

  const run = async (fn, done = '') => {
    setErr(''); setMsg('');
    try { await fn(); if (done) setMsg(done); } catch (e) { setErr(e.message); }
  };
  // 여럿 방: 그 방에 초대. 1:1 방: 두 사람 + 고른 사람으로 새 단체방을 만들고 그 방으로
  async function invite() {
    if (isGroup) { await inviteToRoom(room.id, picked); setInviting(false); return; }
    const id = await createRoom(room.group_id, [...room.members.map((m) => m.id).filter((i) => i !== state.me.id), ...picked], '');
    onClose();
    openRoom(id);
  }
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  // 사진이 이미 있으면 "현재 사진은 삭제됩니다" 를 먼저 보여 주고, 거기서 사진 고르기
  // (확인 창을 띄운 뒤 파일 고르기를 열면 아이폰이 막을 수 있어서 화면 안에서 묻는다)
  const [warn, setWarn] = useState(false);
  const [draft, setDraft] = useState(null); // 고른 사진 (확인 전)
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setWarn(false);
    try { setDraft(await openImage(file)); } catch (e2) { await run(() => { throw e2; }); }
  }
  async function confirmPhoto(data) {
    setBusy(true);
    await run(async () => setRoomPhoto(room.id, data), '채팅방 사진을 바꿨어요.');
    setBusy(false); setDraft(null);
  }
  async function removePhoto() {
    if (!confirm('채팅방 사진을 지울까요? 모두에게서 사라져요.')) return;
    setBusy(true);
    await run(() => setRoomPhoto(room.id, null), '채팅방 사진을 지웠어요.');
    setBusy(false);
  }
  async function leave() {
    if (!confirm(leaveQuestion(room))) return;
    await run(async () => { await leaveRoom(room.id); onLeft(); });
  }

  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button><h2 class="ellipsis">채팅방 관리</h2></header>
        <div class="scroll">
          ${err && html`<p class="err pad">${err}</p>`}
          ${msg && html`<p class="ok pad">${msg}</p>`}
          <h2 class="manage-head">채팅방 공지</h2>
          <button class="person notice-open" onClick=${() => setNoticeOpen(true)}><span class="avatar multi" style="width:52px;height:52px;font-size:24px">📢</span>
            <span class="grow"><b>채팅방 공지</b><br /><span class="hint small">${[room.notice ? '상단 공지 있음' : '상단 공지 없음', schedules.length ? `일정 ${schedules.length}개` : '일정 없음'].join(' · ')}</span></span><span class="hint">›</span></button>
          <h2 class="manage-head">채팅방 설정</h2>
          <div class="section room-photo">
            ${room.photo
              ? html`<button class="tap" onClick=${() => setViewing(true)} aria-label="사진 크게 보기"><${Avatar} photo=${room.photo} size=${88} /></button>
                     <p class="hint">${room.photo_by}님이 게시한 사진</p>`
              : html`<span class="avatar multi" style="width:88px;height:88px;font-size:30px">📷</span><p class="hint">채팅방 사진이 없어요. 대화 상대 누구나 넣을 수 있어요.</p>`}
            ${room.photo && !warn && html`
              <div class="photo-btns">
                <button class="text" onClick=${() => setWarn(true)} disabled=${busy}>${busy ? '올리는 중…' : '사진 바꾸기'}</button>
                <button class="text dim" onClick=${removePhoto} disabled=${busy}>사진 지우기</button>
              </div>`}
            ${room.photo && warn && html`
              <div class="warn-box">
                <p>현재 사진은 삭제됩니다.</p>
                <div class="photo-btns">
                  <button class="text dim" onClick=${() => setWarn(false)}>그만두기</button>
                  <label class="text tap">새 사진 고르기<input type="file" accept="image/*" hidden onChange=${pick} /></label>
                </div>
              </div>`}
            ${!room.photo && html`
              <div class="photo-btns"><label class="text tap">${busy ? '올리는 중…' : '사진 넣기'}<input type="file" accept="image/*" hidden onChange=${pick} disabled=${busy} /></label></div>`}
          </div>
          ${isGroup && html`
            <form class="section" onSubmit=${(e) => { e.preventDefault(); run(() => renameRoom(room.id, name.trim()), '방 이름을 바꿨어요.'); }}>
              <h3>방 이름 <span class="hint">(모두에게 보여요, 비우면 사람 이름으로)</span></h3>
              <div class="inline"><input value=${name} onInput=${(e) => setName(e.target.value)} maxlength="40" placeholder=${roomTitle({ ...room, name: '' })} /><button class="primary" type="submit" disabled=${name.trim() === (room.name || '')}>저장</button></div>
            </form>`}
          <div class="section">
            <h3>나에게만</h3>
            <label class="switch-row"><span class="grow">새 메시지 알림</span>
              <input type="checkbox" class="switch" checked=${!room.muted} onChange=${(e) => run(() => roomPrefs(room.id, { muted: !e.target.checked }))} /></label>
            <label class="switch-row"><span class="grow">대화 목록 위에 고정</span>
              <input type="checkbox" class="switch" checked=${!!room.pinned} onChange=${(e) => run(() => roomPrefs(room.id, { pinned: e.target.checked }))} /></label>
          </div>
          <h2 class="manage-head">사진·영상</h2>
          <button class="person photos-open" onClick=${onPhotos}><span class="avatar multi" style="width:52px;height:52px;font-size:24px">🖼️</span><span class="grow">채팅방 사진 보기</span><span class="hint">›</span></button>
          ${showSaki && html`
            <h2 class="manage-head">사키</h2>
            <button class="person saki-open" onClick=${() => setSakiOpen(true)}><span class="avatar multi" style="width:52px;height:52px;font-size:24px">🤖</span>
              <span class="grow"><b>사키 설정</b><br /><span class="hint small">${sakiSummary(room.saki)}</span></span><span class="hint">›</span></button>`}
          <h2 class="manage-head">대화 상대 ${room.members.length}</h2>
          ${room.members.map((m) => html`
            <button class="person" onClick=${() => showProfile(m.id)}><${Avatar} name=${nickOf(m)} id=${m.id} photo=${photoOf(m)} size=${60} /><span>${nickOf(m)}${m.id === state.me.id ? ' (나)' : ''}</span></button>`)}
          ${!inviting && html`<button class="person" onClick=${() => { setInviting(true); setPicked([]); }} disabled=${!candidates.length}><span class="avatar multi" style="width:60px;height:60px">＋</span><span>${candidates.length ? '초대하기' : '같은 그룹에 초대할 사람이 없어요'}</span></button>`}
          ${inviting && html`
            <div class="section"><h3>초대할 사람 (${group?.name || ''} 그룹)</h3>
              ${!isGroup && html`<p class="hint">1:1 대화는 그대로 두고, 고른 사람과 함께하는 새 단체방이 만들어져요.</p>`}</div>
            ${candidates.map((m) => html`
              <label class="person check"><input type="checkbox" checked=${picked.includes(m.id)} onChange=${() => toggle(m.id)} /><${Avatar} name=${nickOf(m)} id=${m.id} photo=${photoOf(m)} size=${60} /><span>${nickOf(m)}</span></label>`)}
            <div class="section inline"><button class="text" onClick=${() => setInviting(false)}>그만두기</button><span class="grow"></span>
              <button class="primary" disabled=${!picked.length} onClick=${() => run(invite, isGroup ? '초대했어요.' : '')}>${isGroup ? '초대' : '단체방 만들기'}</button></div>`}
          <div class="section"><button class="danger" onClick=${leave}>${isGroup ? '채팅방 나가기' : '대화방 지우기'}</button></div>
        </div>
      </div>
      ${draft && html`<${PhotoCrop} img=${draft} size=${640} title=${room.photo ? '이 사진으로 바꿀까요? 현재 사진은 삭제됩니다.' : '채팅방 사진으로 할까요?'} busy=${busy} onCancel=${() => setDraft(null)} onOk=${confirmPhoto} />`}
      ${sakiOpen && html`<${SakiPage} room=${room} onClose=${() => setSakiOpen(false)} />`}
      ${noticeOpen && html`<${NoticePage} room=${room} onClose=${() => setNoticeOpen(false)} />`}
      ${viewing && room.photo && html`<${PhotoViewer} photo=${room.photo} caption=${`${room.photo_by}님이 게시한 사진입니다.`} onClose=${() => setViewing(false)} />`}
    </div>
  `;
}

const PERSONALITIES = [['calm', '차분'], ['lively', '활발'], ['quiet', '조용'], ['tsundere', '츤데레']];
// 채팅방 공지 화면: 채팅방 관리에서 눌러 들어감. 상단 공지(내리기)와 일정 공지(추가·고치기·내리기)
function NoticePage({ room, onClose }) {
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [sched, setSched] = useState(null); // 일정 올리기({}) ·고치기(일정)
  const [place, setPlace] = useState(null); // 일정 장소 누르면 지도 시트
  const schedules = upcoming(room.schedules);
  const run = async (fn, done = '') => {
    setErr(''); setMsg('');
    try { await fn(); if (done) setMsg(done); } catch (e) { setErr(e.message); }
  };
  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet notice-page">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="뒤로">‹</button><h2 class="ellipsis">채팅방 공지</h2></header>
        <div class="scroll">
          ${err && html`<p class="err pad">${err}</p>`}
          ${msg && html`<p class="ok pad">${msg}</p>`}
          <div class="section">
            <h3>상단 공지</h3>
            ${room.notice
              ? html`<div class="manage-card manage-notice"><div class="notice-full-text">📢 ${room.notice.body}</div>
                  <div class="manage-btns"><span class="hint small grow">${room.notice.by}님이 올린 공지</span>
                    <button class="text dim" onClick=${() => confirm('공지를 내릴까요? 모두에게서 사라져요.') && run(() => setNotice(room.id, 0), '공지를 내렸어요.')}>공지 내리기</button></div></div>`
              : html`<p class="hint">메시지를 길게 눌러 "공지 설정"을 고르면 방 위쪽에 걸려요.</p>`}
          </div>
          <div class="section">
            <h3>일정 공지 ${schedules.length || ''}</h3>
            ${schedules.length > 0 && html`<div class="manage-card"><ul class="schedule-list">
              ${schedules.map((x) => html`<${ScheduleItem} s=${x} onPlace=${setPlace}>
                <div class="manage-btns"><button class="text" onClick=${() => setSched(x)}>고치기</button></div></${ScheduleItem}>`)}
            </ul></div>`}
            <button class="text left" onClick=${() => setSched({})}>＋ 일정 추가</button>
          </div>
        </div>
      </div>
      ${sched && html`<${ScheduleSheet} roomId=${room.id} edit=${sched.id ? sched : null} onClose=${() => setSched(null)} />`}
      ${place && html`<${PlaceSheet} m=${{ body: JSON.stringify(place) }} onClose=${() => setPlace(null)} />`}
    </div>`;
}

// 채팅방 관리의 "사키 설정" 줄에 보이는 지금 상태
function sakiSummary(s) {
  if (!s?.on) return '꺼짐 · 눌러서 초대하기';
  const p = PERSONALITIES.find(([v]) => v === s.personality)?.[1] || '';
  return ['켜짐', p, s.polite ? '존댓말' : '', s.freq === 'chime' ? '가끔 끼어들기' : '부를 때만', s.noignore ? '읽씹 방지' : '', s.memory ? '기억 켬' : ''].filter(Boolean).join(' · ');
}

// 사키 설정 화면: 채팅방 관리에서 눌러 들어가는 따로 된 화면 (초대·성격·말투·빈도·반응·기억·관계)
function SakiPage({ room, onClose }) {
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const run = async (fn, done = '') => {
    setErr(''); setMsg('');
    try { await fn(); if (done) setMsg(done); } catch (e) { setErr(e.message); }
  };
  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet saki-page">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="뒤로">‹</button><h2 class="ellipsis">사키 설정</h2></header>
        <div class="scroll">
          ${err && html`<p class="err pad">${err}</p>`}
          ${msg && html`<p class="ok pad">${msg}</p>`}
          <${SakiSection} room=${room} run=${run} />
        </div>
      </div>
    </div>`;
}

// 사키(SAKi Lite 봇): 단체방에서 방장·관리자가 초대하고 성격·말투·대답 빈도를 정함. 다른 사람은 보기만
function SakiSection({ room, run }) {
  // 사키가 생기기 전에 받아 둔 방 정보에는 saki 가 없음: 기본값(끔)으로
  const s = room.saki || { on: 0, personality: 'lively', polite: 0, freq: 'called', gap: 10, react: 1 };
  const can = room.created_by === state.me.id || !!state.me.is_admin;
  const set = (changes) => run(() => setSaki(room.id, changes));
  // 기억을 끌 때: 기억도 지울지 묻는다 (아니요면 남겨 두고, 다시 켜면 이어서)
  const setMemory = (on) => set(on ? { memory: true } : { memory: false, forget: confirm('사키 기억을 껐어요. 기억한 것과 일기도 지울까요?\n[확인] 지우기 · [취소] 남겨 두기') });
  const seg = (items, value, key) => html`
    <div class="seg">${items.map(([v, label]) => html`<button type="button" class=${value === v ? 'on' : ''} disabled=${!can} onClick=${() => value !== v && set({ [key]: v })}>${label}</button>`)}</div>`;
  return html`
    <div class="section saki-section">
      <h3>사키 <span class="hint">${can ? '(방장·관리자만 바꿔요)' : '(방장이나 관리자가 바꿔요)'}</span></h3>
      <label class="switch-row"><span class="grow">사키 초대<br /><span class="hint">글에 "사키"를 넣거나 사키 말에 답장하면 대답해요</span></span>
        <input type="checkbox" class="switch" checked=${!!s.on} disabled=${!can} onChange=${(e) => set({ on: e.target.checked })} /></label>
      ${s.on > 0 && html`
        <p class="hint">성격</p>
        ${seg(PERSONALITIES, s.personality, 'personality')}
        <label class="switch-row"><span class="grow">존댓말<br /><span class="hint">어른이 있는 방이면 켜 주세요</span></span>
          <input type="checkbox" class="switch" checked=${!!s.polite} disabled=${!can} onChange=${(e) => set({ polite: e.target.checked })} /></label>
        <p class="hint">대답 빈도</p>
        ${seg([['called', '부를 때만'], ['chime', '가끔 끼어들기']], s.freq, 'freq')}
        ${s.freq === 'chime' && html`<p class="hint">대화가 쌓이면 가끔 먼저 끼어들어요.</p>`}
        <label class="switch-row"><span class="grow">읽씹 방지<br /><span class="hint">누가 글을 올렸는데 5분 동안 아무도 대답이 없으면 사키가 대답해요</span></span>
          <input type="checkbox" class="switch" checked=${!!s.noignore} disabled=${!can} onChange=${(e) => set({ noignore: e.target.checked })} /></label>
        ${(s.freq === 'chime' || s.noignore > 0) && html`
          <label class="switch-row"><span class="grow">사키가 먼저 말하는 최소 간격<br /><span class="hint">끼어들기·읽씹 방지는 사키가 마지막으로 말한 뒤 이만큼 지나야 해요 (부르면 언제든 대답)</span></span>
            <select value=${s.gap} disabled=${!can} onChange=${(e) => set({ gap: Number(e.target.value) })}>
              ${[5, 10, 20, 30, 60, 120].map((m) => html`<option value=${m}>${m < 60 ? `${m}분` : `${m / 60}시간`}</option>`)}
            </select></label>`}
        <label class="switch-row"><span class="grow">반응 달기<br /><span class="hint">사키를 부른 메시지에 표정 이모지</span></span>
          <input type="checkbox" class="switch" checked=${!!s.react} disabled=${!can} onChange=${(e) => set({ react: e.target.checked })} /></label>
        <label class="switch-row"><span class="grow">사키 기억<br /><span class="hint">켜면 최근 대화 100개로 바로 시작하고, 그 뒤로 대화를 조금씩 기억해 다음에 알아봐요. 기억한 것은 방 사람 누구나 고치거나 지울 수 있어요</span></span>
          <input type="checkbox" class="switch" checked=${!!s.memory} disabled=${!can} onChange=${(e) => setMemory(e.target.checked)} /></label>
        ${s.memory > 0 && html`<${SakiMemory} room=${room} run=${run} />`}
        <p class="hint">사키에게 알려 줄 관계 <span class="hint">(예: 엄마, 일래의 동생. 내 것은 내가, 다른 사람 것은 방장·관리자가 적어요)</span></p>
        ${room.members.filter((p) => !p.bot).map((p) => html`<${RelationRow} key=${p.id} room=${room} p=${p} edit=${can || p.id === state.me.id} run=${run} />`)}`}
    </div>`;
}

// 사키가 기억하는 것(글 통째로)과 방 일기: 방 사람 누구나 고치고 지움 (사키가 틀리게 기억하면 바로잡는 곳)
function SakiMemory({ room, run }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState('');  // 고치는 중인 일기 날짜
  const [draft, setDraft] = useState('');
  const load = (r) => { setData(r); setText(r.memory); };
  useEffect(() => { sakiMemory(room.id).then(load).catch(() => {}); }, [room.id]);
  if (!data) return html`<p class="hint">사키 기억을 불러오는 중…</p>`;
  const save = (changes, ok) => run(async () => { load(await sakiMemory(room.id, changes)); setEditing(''); }, ok);
  const label = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
  return html`
    <div class="saki-memory">
      <p class="hint">사키가 기억하는 것 <span class="hint">(대화가 40개쯤 쌓이거나 날이 바뀌면 사키가 고쳐 써요)</span></p>
      <textarea rows="6" maxlength="2000" autocomplete="off" placeholder="아직 기억한 게 없어요" value=${text} onInput=${(e) => setText(e.target.value)} />
      ${text !== data.memory && html`<div class="inline"><button class="text" onClick=${() => setText(data.memory)}>되돌리기</button><span class="grow"></span>
        <button class="primary" onClick=${() => save({ memory: text }, '사키 기억을 고쳤어요.')}>저장</button></div>`}
      ${data.memory && text === data.memory && html`<div class="inline"><span class="grow"></span>
        <button class="text danger-text" onClick=${() => confirm('사키가 기억한 것을 모두 지울까요?') && save({ memory: '' }, '사키 기억을 지웠어요.')}>모두 지우기</button></div>`}
      <p class="hint">사키 일기</p>
      ${!data.diary.length && html`<p class="hint">아직 일기가 없어요. 날이 바뀌면 그날 일을 두세 줄로 써요.</p>`}
      ${data.diary.map((d) => html`
        <div class="diary" key=${d.day}>
          <b>${label(d.day)}</b>
          ${editing === d.day
            ? html`<textarea rows="3" maxlength="300" autocomplete="off" value=${draft} onInput=${(e) => setDraft(e.target.value)} />
              <div class="inline"><button class="text" onClick=${() => setEditing('')}>그만두기</button><span class="grow"></span>
                <button class="primary" onClick=${() => save({ diary_day: d.day, diary_text: draft }, draft.trim() ? '일기를 고쳤어요.' : '일기를 지웠어요.')}>저장</button></div>`
            : html`<p>${d.text}</p>
              <div class="inline"><span class="grow"></span><button class="text" onClick=${() => { setEditing(d.day); setDraft(d.text); }}>고치기</button>
                <button class="text danger-text" onClick=${() => confirm(`${label(d.day)} 일기를 지울까요?`) && save({ diary_day: d.day, diary_text: '' }, '일기를 지웠어요.')}>지우기</button></div>`}
        </div>`)}
    </div>`;
}

function RelationRow({ room, p, edit, run }) {
  const [text, setText] = useState(p.relation || '');
  const save = () => { if (text.trim() !== (p.relation || '')) run(() => setSakiRelation(room.id, p.id, text.trim())); };
  return html`
    <label class="switch-row relation-row"><span class="grow ellipsis">${nickOf(p)}</span>
      <input type="text" maxlength="40" placeholder=${edit ? '관계 적기' : ''} value=${text} disabled=${!edit}
        onInput=${(e) => setText(e.target.value)} onBlur=${save} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} /></label>`;
}

// 나가기 전에 묻는 말: 1:1 은 두 사람 모두에게서 사라지고, 여럿 방은 나만 나감 (한 명만 남으면 방이 지워짐)
export function leaveQuestion(room) {
  return room.kind === 'dm'
    ? '이 대화방을 지울까요?\n상대방 채팅 목록에서도 사라지고, 대화 내용은 되돌릴 수 없어요.'
    : room.members.length <= 2
      ? '이 채팅방에서 나갈까요?\n한 명만 남게 되어 방이 지워지고, 대화 내용은 되돌릴 수 없어요.'
      : '이 채팅방에서 나갈까요?\n나만 나가고, 다른 사람들은 그대로 대화해요.';
}
