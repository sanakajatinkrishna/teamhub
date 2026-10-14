/* ═══════════════════════════════════════════════════════
   ui.js — formatting, dates, toasts, modals, small widgets
═══════════════════════════════════════════════════════ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
// Drop ?query from the hash without re-running the router
function clearHashParams() { const base = location.hash.split('?')[0]; if (base !== location.hash) history.replaceState(null, '', base); }
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ── Dates (local time; never use toISOString for plain dates) ──
function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function eachDay(from, to, fn) { for (let d = from; d <= to; d = addDays(d, 1)) fn(d); }
function fmtDate(s, opts = { day: 'numeric', month: 'short' }) {
  if (!s) return '';
  const d = s.length === 10 ? parseYmd(s) : new Date(s);
  const o = { ...opts };
  if (!o.year && d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('en-IN', o);
}
function fmtDateRange(a, b) { return !b || a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`; }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
function fmtWhen(ts) {
  const d = new Date(ts), today = ymd();
  if (ymd(d) === today) return fmtTime(ts);
  return `${fmtDate(ymd(d))}, ${fmtTime(ts)}`;
}
function relDue(due) {
  if (!due) return '';
  const today = ymd();
  if (due === today) return 'Due today';
  if (due === addDays(today, 1)) return 'Due tomorrow';
  if (due < today) return `Overdue · ${fmtDate(due)}`;
  return `Due ${fmtDate(due)}`;
}

// Working days in a leave, skipping weekly offs and holidays
function leaveDays(l, holidays = State.holidaySet()) {
  if (l.half_day) return 0.5;
  let n = 0;
  eachDay(l.start_date, l.end_date, d => {
    if (!WEEKLY_OFF.includes(parseYmd(d).getDay()) && !holidays.has(d)) n++;
  });
  return n;
}

// ── Widgets ──
function initials(name) { return (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
function colorFor(str) {
  let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}
function avatar(user, size = '') {
  const name = user?.display_name || 'Unknown';
  const team = user ? State.team(user.team_id) : null;
  return `<span class="avatar ${size}" style="background:${team?.color || colorFor(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
}
function teamPill(teamId, fallback = 'No team') {
  const t = State.team(teamId);
  if (!t) return `<span class="team-pill muted">${esc(fallback)}</span>`;
  return `<span class="team-pill"><span class="team-dot" style="background:${t.color}"></span>${esc(t.name)}</span>`;
}

const STATUS = {
  todo:        { label: 'To do',       cls: '' },
  in_progress: { label: 'In progress', cls: 'b-info' },
  review:      { label: 'In review',   cls: 'b-warn' },
  done:        { label: 'Done',        cls: 'b-ok' },
};
const PRIORITY = {
  urgent: { label: 'Urgent', cls: 'b-bad' },
  high:   { label: 'High',   cls: 'b-warn' },
  medium: { label: 'Medium', cls: 'b-info' },
  low:    { label: 'Low',    cls: '' },
};
const LEAVE_STATUS = {
  pending:   { label: 'Pending',   cls: 'b-warn' },
  approved:  { label: 'Approved',  cls: 'b-ok' },
  rejected:  { label: 'Rejected',  cls: 'b-bad' },
  cancelled: { label: 'Cancelled', cls: '' },
};
function badge(map, key) { const m = map[key] || { label: key, cls: '' }; return `<span class="badge ${m.cls}">${esc(m.label)}</span>`; }

function teamOptions(selected, { includeAll = false, allLabel = 'All teams', includeNone = false } = {}) {
  let h = includeAll ? `<option value="">${esc(allLabel)}</option>` : '';
  if (includeNone) h += `<option value="">— No team —</option>`;
  return h + State.teams.map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}
function memberOptions(teamId, selected, placeholder = 'Select member') {
  const list = teamId ? State.teamMembers(teamId) : State.users.filter(u => u.is_active);
  return `<option value="">${esc(placeholder)}</option>` +
    list.map(u => `<option value="${u.id}" ${u.id === selected ? 'selected' : ''}>${esc(u.display_name)}${u.designation ? ' · ' + esc(u.designation) : ''}</option>`).join('');
}

// ── Toast ──
function toast(msg, type = 'info') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ── Modal ──
// openModal({title, body, foot, wide}) → returns the modal element; close with closeModal(el)
function openModal({ title, body, foot = '', wide = false, onClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close" style="color:var(--muted)">✕</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  back._onClose = onClose;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(back); });
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(back)));
  document.body.appendChild(back);
  const first = back.querySelector('input:not([type=hidden]),select,textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return back;
}
function closeModal(el) { if (!el) return; el._onClose?.(); el.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal($$('.modal-back').pop()); });

function confirmBox(message, okLabel = 'Delete') {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title: 'Please confirm',
      body: `<p>${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>${esc(okLabel)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.querySelector('[data-ok]').onclick = () => { done = true; closeModal(m); resolve(true); };
  });
}

// Runs an async action with a busy button and error toast
async function busy(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = 'Saving…'; }
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'error'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}

function formData(root) {
  const o = {};
  $$('[name]', root).forEach(el => {
    o[el.name] = el.type === 'checkbox' ? el.checked : (el.value.trim() === '' ? null : el.value.trim());
  });
  return o;
}
