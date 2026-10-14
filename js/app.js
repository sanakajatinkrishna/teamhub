/* ═══════════════════════════════════════════════════════
   app.js — boot, navigation, hash router
═══════════════════════════════════════════════════════ */

const ROUTES = {
  dashboard:     { label: 'Dashboard',     ico: '▦',  page: () => DashboardPage },
  tasks:         { label: 'Tasks',         ico: '✓',  page: () => TasksPage },
  leaves:        { label: 'Leaves',        ico: '✈',  page: () => LeavesPage },
  calendar:      { label: 'Calendar',      ico: '▤',  page: () => CalendarPage },
  chat:          { label: 'Team chat',     ico: '💬', page: () => ChatPage },
  announcements: { label: 'Announcements', ico: '📣', page: () => AnnouncementsPage },
  teams:         { label: 'Teams & people', ico: '👥', page: () => TeamsPage },
};

let currentPage = null;

async function boot() {
  $$('.app-name').forEach(e => e.textContent = APP_NAME);
  document.title = APP_NAME;

  const me = await Auth.me();
  if (!me) { location.replace('index.html'); return; }
  State.me = me;
  try { await State.refresh(); }
  catch (e) { $('#page').innerHTML = `<div class="empty">Could not load data: ${esc(e.message)}</div>`; return; }

  renderSidebar();
  window.addEventListener('hashchange', route);
  $('#menuBtn').onclick = () => $('#app').classList.toggle('nav-open');
  $('#app').addEventListener('click', e => {
    if (e.target.id === 'app' || e.target.closest('.nav a')) $('#app').classList.remove('nav-open');
  });
  route();
  refreshBadges();
  setInterval(refreshBadges, 60000);
}

function renderSidebar() {
  $('#nav').innerHTML = Object.entries(ROUTES).map(([key, r]) =>
    `<a href="#/${key}" data-route="${key}"><span class="ico">${r.ico}</span>${esc(r.label)}<span class="count hidden" data-count="${key}"></span></a>`
  ).join('');
  const me = State.me;
  $('#sideUser').innerHTML = `
    ${avatar(me)}
    <div style="min-width:0">
      <div class="name ellipsis">${esc(me.display_name)}</div>
      <div class="role ellipsis">${me.role === 'admin' ? 'Admin' : esc(State.team(me.team_id)?.name || 'Member')}</div>
    </div>
    <div class="actions">
      <button class="icon-btn" id="pwBtn" title="Change password">🔑</button>
      <button class="icon-btn" id="logoutBtn" title="Sign out">⎋</button>
    </div>`;
  $('#logoutBtn').onclick = () => Auth.logout();
  $('#pwBtn').onclick = changePasswordModal;
}

// Small counters in the sidebar: my open tasks; pending leave approvals for admin
async function refreshBadges() {
  try {
    const tasks = await sb.from('hub_tasks').select('id', { count: 'exact', head: true })
      .eq('assigned_to', State.me.id).neq('status', 'done');
    setCount('tasks', tasks.count);
    if (State.isAdmin) {
      const lv = await sb.from('hub_leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      setCount('leaves', lv.count);
    }
  } catch (e) { /* non-critical */ }
}
function setCount(key, n) {
  const el = $(`[data-count="${key}"]`);
  if (!el) return;
  el.textContent = n || '';
  el.classList.toggle('hidden', !n);
}

async function route() {
  const key = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
  const r = ROUTES[key] || ROUTES.dashboard;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key));
  if (currentPage?.destroy) currentPage.destroy();
  currentPage = r.page();
  // Fresh container per visit: a slow request from the previous page can only
  // touch its own (now detached) container, never the page now on screen.
  const el = document.createElement('div');
  el.innerHTML = '<div class="loading">Loading…</div>';
  $('#page').replaceChildren(el);
  try { await currentPage.render(el); }
  catch (e) { console.error(e); if (el.isConnected) el.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`; }
}

function changePasswordModal() {
  const m = openModal({
    title: 'Change password',
    body: `
      <div class="field"><label>Current password</label><input class="input" type="password" name="old" autocomplete="current-password"></div>
      <div class="field"><label>New password (min 6 characters)</label><input class="input" type="password" name="new" autocomplete="new-password"></div>
      <div class="field"><label>Repeat new password</label><input class="input" type="password" name="again" autocomplete="new-password"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Update password</button>`,
  });
  m.querySelector('[data-save]').onclick = e => busy(e.target, async () => {
    const f = formData(m);
    if (!f.new || f.new.length < 6) throw new Error('New password must be at least 6 characters');
    if (f.new !== f.again) throw new Error('The new passwords do not match');
    await Auth.changePassword(f.old || '', f.new);
    closeModal(m);
    toast('Password updated', 'success');
  });
}

boot();
