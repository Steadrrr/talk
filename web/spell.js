// 한글 맞춤법: 아이폰은 웹 화면의 한글 맞춤법을 안 봐 줘서, 입력칸에서 잠깐 멈추면 서버(다음·네이버 검사기)에 묻고
// 고칠 곳이 있으면 입력칸 위에 "틀린 말 → 고칠 말" 단추 줄을 띄운다. 하나씩 또는 모두 고치기, ✕ 는 이 글에서는 그만
import { html } from './html.js';
import { api } from './api.js';

const KEY = 'talk.spell';
export const SPELL_WAIT = 1200;   // 이만큼 멈추면 검사 (ms)
export function spellOn() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } }
export function setSpellOn(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 이번만 */ } }

// 검사할 만한 글: 한글이 있고 두 글자 이상
export const worthCheck = (t) => t.trim().length >= 2 && /[가-힣]/.test(t);

const cache = new Map();   // 글 → 조각 목록 (이 기기에서 한 번 물은 글은 다시 안 물음)
const skipped = new Set();  // ✕ 로 넘긴 "틀린 말 → 고칠 말" (이 기기에서 다시 안 띄움)
export async function checkSpell(text) {
  let segs = cache.get(text);
  if (!segs) {
    segs = (await api('spell', { text })).segs || [];
    // 서버는 앞 500자만 보므로 나머지는 그대로 붙임. 이어 붙여 원래 글이 안 되면 버림
    const head = joinSegs(segs, (s) => s.from);
    segs = text.startsWith(head) ? (head.length < text.length ? [...segs, { t: text.slice(head.length) }] : segs) : [{ t: text }];
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    cache.set(text, segs);
  }
  return segs.map((s) => ('from' in s && skipped.has(s.from + '\0' + s.to) ? { t: s.from } : s));
}
export function skipSpell(segs) { for (const s of segs) if ('from' in s) skipped.add(s.from + '\0' + s.to); }

export const joinSegs = (segs, pick) => segs.map((s) => ('t' in s ? s.t : pick(s))).join('');
export const hasFix = (segs) => !!segs?.some((s) => 'from' in s);

// 입력칸 위 줄. 단추를 눌러도 입력칸 커서(키보드)가 그대로 있게 누름을 막는다
export function SpellBar({ segs, onApply, onClose }) {
  const fixes = segs.map((s, i) => ['from' in s, s, i]).filter(([f]) => f);
  const keep = (e) => e.preventDefault();
  const one = (i) => onApply(segs.map((s, j) => (j === i ? { t: s.to } : s)));
  const all = () => onApply([{ t: joinSegs(segs, (s) => s.to) }]);
  return html`
    <div class="spell-bar" onPointerDown=${keep}>
      <span class="spell-tag">맞춤법</span>
      <div class="spell-list">
        ${fixes.map(([, s, i]) => html`<button type="button" class="spell-fix" onClick=${() => one(i)}><del>${show(s.from)}</del> → <b>${show(s.to)}</b></button>`)}
      </div>
      ${fixes.length > 1 && html`<button type="button" class="spell-all" onClick=${all}>모두</button>`}
      <button type="button" class="icon" onClick=${onClose} aria-label="맞춤법 그만 보기">✕</button>
    </div>`;
}
// 띄어쓰기만 다른 것도 보이게 빈칸을 ∨ 로
const show = (s) => s.replace(/ /g, '∨').replace(/\n/g, '↵');
