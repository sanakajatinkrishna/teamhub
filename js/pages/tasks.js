/* Tasks — admin assigns work to a team member; members track and update status */

const TasksPage = {
  tasks: [],
  view: 'board',
  f: { team: '', member: '', scope: 'mine', priority: '', q: '' },

  async render(el) {
    this.el = el;
    const p = hashParams();
    clearHashParams();
    try { this.view = localStorage.getItem('teamhub_task_view') || 'board'; } catch (e) { /* ignore */ }
    if (p.get('team')) { this.f.team = p.get('team'); this.f.member = ''; }
    if (!State.isAdmin && !State.me.team_id) this.f.scope = 'mine';

    el.innerHTML = `
      <div class="page-head">
        <h1>Tasks</h1><div class="spacer"></div>
        <div class="seg" id="viewSeg">
          <button data-v="board">Board</button><button data-v="list">List</button>
        </div>
        ${State.isAdmin ? `<button class="btn btn-primary" id="newTask">＋ Assign task</button>` : ''}
      </div>
      <div class="filters" style="margin-bottom:16px" id="filters">
        ${State.isAdmin ? `
          <select class="input" name="team">${teamOptions(this.f.team, { includeAll: true })}</select>
          <select class="input" name="member"></select>` : `
          <select class="input" name="scope">
            <option value="mine">My tasks</option>
            ${State.me.team_id ? `<option value="team">My team's tasks</option>` : ''}
          </select>`}
        <select class="input" name="priority">
          <option value="">Any priority</option>
          ${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
        <input class="input" name="q" placeholder="Search tasks…" style="min-width:200px">
      </div>
      <div id="taskArea"><div class="loading">Loading…</div></div>`;

    const fl = $('#filters', el);
    if (State.isAdmin) this.fillMemberFilter();
    $$('[name]', fl).forEach(inp => {
      if (inp.name in this.f && inp.name !== 'member') inp.value = this.f[inp.name];
      inp.addEventListener(inp.name === 'q' ? 'input' : 'change', () => {
        this.f[inp.name] = inp.value;
        if (inp.name === 'team') { this.f.member = ''; this.fillMemberFilter(); }
        inp.name === 'q' || inp.name === 'priority' ? this.draw() : this.load();
      });
    });
    $$('#viewSeg button', el).forEach(b => b.onclick = () => {
      this.view = b.dataset.v;
      try { localStorage.setItem('teamhub_task_view', this.view); } catch (e) { /* ignore */ }
      this.draw();
    });
    if (State.isAdmin) $('#newTask', el).onclick = () => this.editModal();

    await this.load();
    if (p.get('new') && State.isAdmin) this.editModal(null, { team: p.get('team'), member: p.get('member') });
    if (p.get('open')) this.detail(Number(p.get('open')));
  },

  fillMemberFilter() {
    const sel = $('[name=member]', this.el);
    sel.innerHTML = memberOptions(this.f.team, this.f.member, this.f.team ? 'All members' : 'Anyone');
  },

  async load() {
    let q = sb.from('hub_tasks').select('*').order('created_at', { ascending: false });
    if (State.isAdmin) {
      if (this.f.team) q = q.eq('team_id', this.f.team);
      if (this.f.member) q = q.eq('assigned_to', this.f.member);
    } else if (this.f.scope === 'mine') {
      q = q.eq('assigned_to', State.me.id);
    }
    this.tasks = must(await q);
    this.draw();
  },

  filtered() {
    const s = (this.f.q || '').toLowerCase();
    return this.tasks.filter(t =>
      (!this.f.priority || t.priority === this.f.priority) &&
      (!s || t.title.toLowerCase().includes(s) || (t.description || '').toLowerCase().includes(s) ||
        State.userName(t.assigned_to).toLowerCase().includes(s)));
  },

  canMove(t) { return State.isAdmin || t.assigned_to === State.me.id; },

  draw() {
    $$('#viewSeg button', this.el).forEach(b => b.classList.toggle('active', b.dataset.v === this.view));
    const area = $('#taskArea', this.el);
    const list = this.filtered();
    const today = ymd();
    if (this.view === 'list') {
      area.innerHTML = `<div class="card table-wrap"><table class="table">
        <thead><tr><th>Task</th><th>Assigned to</th><th>Team</th><th>Priority</th><th>Status</th><th>Due</th></tr></thead>
        <tbody>${list.map(t => `
          <tr style="cursor:pointer" data-id="${t.id}">
            <td style="font-weight:550;max-width:360px"><div class="ellipsis">${esc(t.title)}</div></td>
            <td><div style="display:flex;align-items:center;gap:8px">${avatar(State.user(t.assigned_to), 'sm')}${esc(State.userName(t.assigned_to))}</div></td>
            <td>${teamPill(t.team_id)}</td>
            <td>${badge(PRIORITY, t.priority)}</td>
            <td>${badge(STATUS, t.status)}</td>
            <td class="${t.status !== 'done' && t.due_date && t.due_date < today ? 'overdue' : ''}">${t.due_date ? fmtDate(t.due_date) : '—'}</td>
          </tr>`).join('') || `<tr><td colspan="6" class="empty">No tasks match.</td></tr>`}
        </tbody></table></div>`;
      $$('tr[data-id]', area).forEach(r => r.onclick = () => this.detail(Number(r.dataset.id)));
      return;
    }

    area.innerHTML = `<div class="board">${Object.entries(STATUS).map(([key, s]) => {
      const col = list.filter(t => t.status === key)
        .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);
      return `<div class="col" data-status="${key}">
        <div class="col-head">${badge(STATUS, key)}<span class="n">${col.length}</span></div>
        ${col.map(t => `
          <div class="tcard prio-${t.priority}" data-id="${t.id}" draggable="${this.canMove(t)}">
            <div class="t">${esc(t.title)}</div>
            <div class="meta">
              ${avatar(State.user(t.assigned_to), 'sm')}
              <span class="grow ellipsis">${esc(State.userName(t.assigned_to))}</span>
              ${t.due_date ? `<span class="${t.status !== 'done' && t.due_date < today ? 'overdue' : ''}">${fmtDate(t.due_date)}</span>` : ''}
            </div>
          </div>`).join('') || '<div class="empty small">Nothing here</div>'}
      </div>`;
    }).join('')}</div>`;

    $$('.tcard', area).forEach(c => {
      c.onclick = () => this.detail(Number(c.dataset.id));
      c.ondragstart = e => e.dataTransfer.setData('text/plain', c.dataset.id);
    });
    $$('.col', area).forEach(col => {
      col.ondragover = e => { e.preventDefault(); col.classList.add('drop'); };
      col.ondragleave = () => col.classList.remove('drop');
      col.ondrop = async e => {
        e.preventDefault(); col.classList.remove('drop');
        const t = this.tasks.find(x => x.id === Number(e.dataTransfer.getData('text/plain')));
        if (t && t.status !== col.dataset.status) await this.setStatus(t, col.dataset.status);
      };
    });
  },

  async setStatus(t, status) {
    try {
      const [row] = must(await sb.from('hub_tasks').update({ status }).eq('id', t.id).select());
      if (!row) throw new Error('You can only update tasks assigned to you');
      Object.assign(t, row);
      this.draw();
      refreshBadges();
      toast(`Moved to ${STATUS[status].label}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  async detail(id) {
    let t = this.tasks.find(x => x.id === id);
    if (!t) {
      const r = await sb.from('hub_tasks').select('*').eq('id', id).maybeSingle();
      t = r.data;
      if (!t) return toast('Task not found or not visible to you', 'error');
    }
    const comments = must(await sb.from('hub_task_comments').select('*').eq('task_id', id).order('created_at'));
    const today = ymd();
    const m = openModal({
      title: `Task #${t.id}`, wide: true,
      body: `
        <h2 style="margin-bottom:10px">${esc(t.title)}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${badge(PRIORITY, t.priority)} ${badge(STATUS, t.status)} ${teamPill(t.team_id)}</div>
        ${t.description ? `<p style="white-space:pre-wrap;line-height:1.55;margin-bottom:16px">${esc(t.description)}</p>` : ''}
        <div class="grid grid-2" style="gap:10px;margin-bottom:16px">
          <div><div class="small muted">Assigned to</div><div style="display:flex;gap:8px;align-items:center;margin-top:4px">${avatar(State.user(t.assigned_to), 'sm')}${esc(State.userName(t.assigned_to))}</div></div>
          <div><div class="small muted">Assigned by</div><div style="margin-top:4px">${esc(State.userName(t.assigned_by))} · ${fmtDate(t.created_at.slice(0, 10))}</div></div>
          <div><div class="small muted">Start</div><div style="margin-top:4px">${t.start_date ? fmtDate(t.start_date) : '—'}</div></div>
          <div><div class="small muted">Due</div><div style="margin-top:4px" class="${t.status !== 'done' && t.due_date && t.due_date < today ? 'overdue' : ''}">${t.due_date ? fmtDate(t.due_date, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</div></div>
        </div>
        ${this.canMove(t) ? `
          <div class="field" style="max-width:240px"><label>Update status</label>
            <select class="input" id="dStatus">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
          </div>` : ''}
        <h3 style="margin:18px 0 6px">Comments</h3>
        <div id="cList">${comments.map(c => this.commentHtml(c)).join('') || '<div class="muted small" id="noC">No comments yet.</div>'}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <textarea class="input" id="cText" placeholder="Write an update or question…" style="min-height:44px"></textarea>
          <button class="btn btn-primary" id="cSend">Post</button>
        </div>`,
      foot: State.isAdmin
        ? `<button class="btn btn-danger" data-del style="margin-right:auto">Delete</button><button class="btn" data-edit>Edit task</button><button class="btn btn-primary" data-close>Done</button>`
        : `<button class="btn btn-primary" data-close>Done</button>`,
    });

    const st = $('#dStatus', m);
    if (st) st.onchange = async () => { await this.setStatus(t, st.value); };
    $('#cSend', m).onclick = e => busy(e.target, async () => {
      const body = $('#cText', m).value.trim();
      if (!body) return;
      const [c] = must(await sb.from('hub_task_comments').insert({ task_id: t.id, body }).select());
      $('#noC', m)?.remove();
      $('#cList', m).insertAdjacentHTML('beforeend', this.commentHtml(c));
      $('#cText', m).value = '';
    });
    if (State.isAdmin) {
      $('[data-edit]', m).onclick = () => { closeModal(m); this.editModal(t); };
      $('[data-del]', m).onclick = async () => {
        if (!await confirmBox(`Delete task "${t.title}"? Its comments will be deleted too.`)) return;
        try {
          must(await sb.from('hub_tasks').delete().eq('id', t.id));
          this.tasks = this.tasks.filter(x => x.id !== t.id);
          closeModal(m); this.draw(); toast('Task deleted');
        } catch (e) { toast(e.message, 'error'); }
      };
    }
  },

  commentHtml(c) {
    const u = State.user(c.user_id);
    return `<div class="comment">${avatar(u, 'sm')}<div><div><strong>${esc(u?.display_name || 'Deleted user')}</strong> <span class="small muted">${fmtWhen(c.created_at)}</span></div><div class="body">${esc(c.body)}</div></div></div>`;
  },

  // Admin: create or edit. Team → member cascade, with a leave warning.
  editModal(t = null, preset = {}) {
    const team = t?.team_id || preset.team || this.f.team || '';
    const member = t?.assigned_to || preset.member || '';
    const m = openModal({
      title: t ? `Edit task #${t.id}` : 'Assign a task', wide: true,
      body: `
        <div class="field"><label>Title *</label><input class="input" name="title" value="${esc(t?.title || '')}" placeholder="What needs to be done?"></div>
        <div class="field"><label>Details</label><textarea class="input" name="description" placeholder="Context, links, acceptance criteria…">${esc(t?.description || '')}</textarea></div>
        <div class="row">
          <div class="field"><label>Team *</label><select class="input" name="team_id"><option value="">Select team</option>${teamOptions(team)}</select></div>
          <div class="field"><label>Team member *</label><select class="input" name="assigned_to"></select></div>
        </div>
        <div id="leaveWarn" class="small" style="color:var(--warn);margin:-6px 0 12px"></div>
        <div class="row">
          <div class="field"><label>Priority</label><select class="input" name="priority">
            ${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === (t?.priority || 'medium') ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
          <div class="field"><label>Start date</label><input class="input" type="date" name="start_date" value="${t?.start_date || ''}"></div>
          <div class="field"><label>Due date</label><input class="input" type="date" name="due_date" value="${t?.due_date || ''}"></div>
        </div>
        ${t ? `<div class="field" style="max-width:220px"><label>Status</label><select class="input" name="status">
          ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>` : ''}`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>${t ? 'Save changes' : 'Assign task'}</button>`,
    });

    const teamSel = $('[name=team_id]', m), memSel = $('[name=assigned_to]', m);
    const fillMembers = () => {
      memSel.innerHTML = teamSel.value ? memberOptions(teamSel.value, member) : '<option value="">Select a team first</option>';
      memSel.disabled = !teamSel.value;
      checkLeave();
    };
    const checkLeave = async () => {
      const warn = $('#leaveWarn', m); warn.textContent = '';
      const uid = memSel.value; if (!uid) return;
      const from = $('[name=start_date]', m).value || ymd();
      const to = $('[name=due_date]', m).value || addDays(from, 14);
      const r = await sb.from('hub_leave_requests').select('*').eq('user_id', uid).in('status', ['approved', 'pending'])
        .lte('start_date', to).gte('end_date', from);
      if (r.data?.length) warn.textContent = '⚠ ' + State.userName(uid) + ' has leave in this period: ' +
        r.data.map(l => `${fmtDateRange(l.start_date, l.end_date)} (${l.status})`).join(', ');
    };
    teamSel.onchange = fillMembers;
    memSel.onchange = checkLeave;
    $('[name=start_date]', m).onchange = checkLeave;
    $('[name=due_date]', m).onchange = checkLeave;
    fillMembers();

    $('[data-save]', m).onclick = e => busy(e.target, async () => {
      const f = formData(m);
      if (!f.title) throw new Error('Please enter a title');
      if (!f.team_id) throw new Error('Please choose a team');
      if (!f.assigned_to) throw new Error('Please choose a team member');
      if (f.start_date && f.due_date && f.due_date < f.start_date) throw new Error('Due date is before the start date');
      if (t) {
        const [row] = must(await sb.from('hub_tasks').update(f).eq('id', t.id).select());
        Object.assign(t, row);
        toast('Task updated', 'success');
      } else {
        const [row] = must(await sb.from('hub_tasks').insert(f).select());
        this.tasks.unshift(row);
        toast(`Task assigned to ${State.userName(row.assigned_to)}`, 'success');
      }
      closeModal(m);
      this.draw();
      refreshBadges();
    });
  },
};
