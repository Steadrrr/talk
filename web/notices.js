// 공지사항: 채팅 목록 맨 위에 최신 글 한 줄 → 누르면 게시판 (글을 눌러 펼쳐 보기, 닫기)
// 관리자가 관리 화면에서 쓴 글 + 배포 때마다 저절로 올라오는 "바뀐 점"
import { useEffect, useState } from 'preact/hooks';
import { html, listTime } from './html.js';
import { api } from './api.js';
import { state, showNotices } from './store.js';

const SEEN = 'talk.noticeSeen';
const seen = () => { try { return localStorage.getItem(SEEN) || ''; } catch { return ''; } };
const markSeen = (v) => { try { localStorage.setItem(SEEN, v); } catch { /* 무시 */ } };

export function NoticeStrip() {
  const n = state.notice;
  if (!n) return null;
  const fresh = n.updated > seen();
  return html`
    <button class=${'notice-strip' + (fresh ? ' fresh' : '')} onClick=${() => showNotices(true)}>
      <span class="notice-icon">📢</span><span class="ellipsis">${n.title}</span>${fresh && html`<span class="dot"></span>`}<span class="hint">›</span>
    </button>`;
}

export function NoticeBoard() {
  const [list, setList] = useState(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(0);
  const [err, setErr] = useState('');
  const close = () => showNotices(false);

  async function load(before = 0) {
    setErr('');
    try {
      const r = await api('notices' + (before ? '?before=' + before : ''));
      setList((l) => (before && l ? [...l, ...r.notices] : r.notices));
      setMore(r.more);
      if (!before && r.notices[0]) { setOpen((o) => o || r.notices[0].id); markSeen(r.notices[0].updated); }
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [state.notice?.updated]);

  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && close()}>
      <div class="sheet">
        <header class="bar"><h2>공지사항</h2><span class="grow"></span><button class="text" onClick=${close}>닫기</button></header>
        <div class="scroll">
          ${list === null && !err && html`<p class="empty">불러오는 중…</p>`}
          ${list?.length === 0 && html`<p class="empty">아직 공지가 없어요.</p>`}
          ${list?.map((n) => html`
            <div class=${'notice-item' + (open === n.id ? ' open' : '')}>
              <button class="notice-head" onClick=${() => setOpen(open === n.id ? 0 : n.id)}>
                <b class=${open === n.id ? '' : 'ellipsis'}>${n.title}</b>
                <span class="hint small">${n.kind === 'auto' ? '자동 · ' : ''}${listTime(n.updated)}</span>
              </button>
              ${open === n.id && n.body && html`<p class="notice-full">${n.body}</p>`}
            </div>`)}
          ${more && html`<button class="text pad" onClick=${() => load(list[list.length - 1].id)}>더 보기</button>`}
          ${err && html`<p class="err pad">${err}</p>`}
        </div>
      </div>
    </div>`;
}
