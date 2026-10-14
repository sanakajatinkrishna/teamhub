/* Teams & people — directory for everyone; admin creates teams and users */

const TeamsPage = {
  tab: 'teams',

  async render(el) {
    this.el = el;
    await State.refresh();
    const today = ymd();
    this.onLeave = new Set(must(await sb.from('hub_leave_requests').select('user_id').eq('status', 'approved')
      .lte('start_date', today).gte('end_date', today)).map(l => l.user_id));

    el.innerHTML = `
      <div class="page-head"><h1>Teams & people</h1><div class="spacer"></div>
        ${State.isAdmin ? `<button class="btn" id="newTeam">＋ New team</button><button class="btn btn-primary" id="newUser">＋ Add person</button>` : ''}
      </div>
      ${State.isAdmin ? `<div class="tabs" id="ttabs"><button class="tab" data-t="teams">Teams</button><button class="tab" data-t="users">All users</button></div>` : ''}
      <div id="teamArea"></div>`;
    if (State.isAdmin) {
      $('#newTeam', el).onclick = () => this.teamModal();
      $('#newUser', el).onclick = () => this.userModal();
      $$('#ttabs .tab', el).forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.draw(); });
    }
    this.draw();
  },

  draw() {
    $$('#ttabs .tab', this.el).forEach(b => b.classList.toggle('active', b.dataset.t === this.tab));
    const area = $('#teamArea', this.el);
    if (State.isAdmin && this.tab === 'users') return this.drawUsers(area);

    const groups = State.teams.map(t => ({ t, members: State.teamMembers(t.id, { activeOnly: !State.isAdmin }) }));
    const loose = State.users.filter(u => !u.team_id && (State.isAdmin || u.is_active));
    area.innerHTML = `<div class="grid grid-2">
      ${groups.map(({ t, members }) => this.teamCard(t, members)).join('')}
      ${loose.length ? this.teamCard(null, loose) : ''}
    </div>
    ${!State.teams.length ? `<div class="card card-pad" style="margin-top:16px"><div class="empty">No teams yet.${State.isAdmin ? ' Click “New team” to create the first one.' : ''}</div></div>` : ''}`;

    $$('[data-eteam]', area).forEach(b => b.onclick = () => this.teamModal(State.team(b.dataset.eteam)));
    $$('[data-euser]', area).forEach(b => b.onclick = () => this.userModal(State.user(b.dataset.euser)));
  },

  teamCard(t, members) {
    const me = State.me;
    return `<div class="card">
      <div class="card-head" style="border-left:4px solid ${t?.color || '#c3c8d4'};border-top-left-radius:var(--radius)">
        <div style="min-width:0"><h3>${esc(t?.name || 'Not in a team')}${t && t.id === me.team_id ? ' <span class="badge b-brand">Your team</span>' : ''}</h3>
          ${t?.description ? `<div class="small muted ellipsis">${esc(t.description)}</div>` : ''}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="small muted">${members.length} ${members.length === 1 ? 'person' : 'people'}</span>
          ${State.isAdmin && t ? `<a class="btn btn-sm" href="#/tasks?team=${t.id}">Tasks</a><button class="btn btn-sm" data-eteam="${t.id}">Edit</button>` : ''}
        </div>
      </div>
      <div class="card-body list">
        ${members.map(u => `
          <div class="list-item" style="${u.is_active ? '' : 'opacity:.5'}">
            ${avatar(u)}
            <div class="grow"><div style="font-weight:550">${esc(u.display_name)} ${u.role === 'admin' ? '<span class="badge b-brand">Admin</span>' : ''} ${u.is_active ? '' : '<span class="badge">Inactive</span>'}</div>
              <div class="small muted ellipsis">${esc(u.designation || '')}${u.designation && (u.email || u.phone) ? ' · ' : ''}${esc(u.email || u.phone || '')}</div></div>
            ${this.onLeave.has(u.id) ? '<span class="badge b-warn">On leave</span>' : ''}
            ${State.isAdmin && t && u.is_active ? `<a class="btn btn-sm" href="#/tasks?new=1&team=${t.id}&member=${u.id}" title="Assign a task">＋ Task</a>` : ''}
            ${State.isAdmin ? `<button class="btn btn-sm" data-euser="${u.id}">Edit</button>` : ''}
          </div>`).join('') || '<div class="empty">No members yet.</div>'}
      </div>
    </div>`;
  },

  drawUsers(area) {
    area.innerHTML = `<div class="card table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Username</th><th>Team</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${State.users.map(u => `
        <tr>
          <td><div style="display:flex;gap:8px;align-items:center">${avatar(u, 'sm')}<div><div style="font-weight:550">${esc(u.display_name)}</div><div class="small muted">${esc(u.designation || '')}</div></div></div></td>
          <td><code>${esc(u.username)}</code></td>
          <td>${teamPill(u.team_id)}</td>
          <td>${u.role === 'admin' ? '<span class="badge b-brand">Admin</span>' : 'Member'}</td>
          <td>${u.is_active ? '<span class="badge b-ok">Active</span>' : '<span class="badge">Inactive</span>'}</td>
          <td style="text-align:right"><button class="btn btn-sm" data-euser="${u.id}">Edit</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    $$('[data-euser]', area).forEach(b => b.onclick = () => this.userModal(State.user(b.dataset.euser)));
  },

  teamModal(t = null) {
    let color = t?.color || TEAM_COLORS[State.teams.length % TEAM_COLORS.length];
    const m = openModal({
      title: t ? `Edit team — ${t.name}` : 'Create a new team',
      body: `
        <div class="field"><label>Team name *</label><input class="input" name="name" value="${esc(t?.name || '')}" placeholder="e.g. Design, Support, Field Sales"></div>
        <div class="field"><label>Description</label><input class="input" name="description" value="${esc(t?.description || '')}" placeholder="What this team does"></div>
        <div class="field"><label>Colour</label><div id="swatches" style="display:flex;gap:8px;flex-wrap:wrap">
          ${TEAM_COLORS.map(c => `<button type="button" data-c="${c}" style="width:28px;height:28px;border-radius:50%;border:3px solid ${c === color ? '#1b2130' : 'transparent'};background:${c};cursor:pointer" aria-label="${c}"></button>`).join('')}
        </div></div>
        ${t ? `<p class="small muted">${State.teamMembers(t.id, { activeOnly: false }).length} member(s). A team can only be deleted when it has no members.</p>` : ''}`,
      foot: `${t ? '<button class="btn btn-danger" data-del style="margin-right:auto">Delete team</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>${t ? 'Save' : 'Create team'}</button>`,
    });
    $$('#swatches button', m).forEach(b => b.onclick = () => {
      color = b.dataset.c;
      $$('#swatches button', m).forEach(x => x.style.borderColor = x.dataset.c === color ? '#1b2130' : 'transparent');
    });
    $('[data-save]', m).onclick = e => busy(e.target, async () => {
      const f = formData(m);
      if (!f.name) throw new Error('Please enter a team name');
      const row = { name: f.name, description: f.description, color };
      const r = t ? await sb.from('hub_teams').update(row).eq('id', t.id) : await sb.from('hub_teams').insert(row);
      if (r.error?.code === '23505') throw new Error('A team with this name already exists');
      must(r);
      closeModal(m);
      toast(t ? 'Team updated' : `Team “${f.name}” created`, 'success');
      await State.refresh(); renderSidebar(); this.draw();
    });
    if (t) $('[data-del]', m).onclick = async () => {
      if (State.teamMembers(t.id, { activeOnly: false }).length) return toast('Move or remove the members first', 'error');
      if (!await confirmBox(`Delete team “${t.name}”? Its chat channel, team announcements and team events are deleted too.`)) return;
      try { must(await sb.from('hub_teams').delete().eq('id', t.id)); closeModal(m); await State.refresh(); this.draw(); toast('Team deleted'); }
      catch (e) { toast(e.message, 'error'); }
    };
  },

  userModal(u = null) {
    const isSelf = u?.id === State.me.id;
    const m = openModal({
      title: u ? `Edit — ${u.display_name}` : 'Add a person', wide: true,
      body: `
        <div class="row">
          <div class="field"><label>Full name *</label><input class="input" name="display_name" value="${esc(u?.display_name || '')}"></div>
          <div class="field"><label>Username * <span class="muted">(used to sign in)</span></label><input class="input" name="username" value="${esc(u?.username || '')}" autocapitalize="none"></div>
        </div>
        <div class="row">
          <div class="field"><label>Team</label><select class="input" name="team_id">${teamOptions(u?.team_id || '', { includeNone: true })}</select></div>
          <div class="field"><label>Designation</label><input class="input" name="designation" value="${esc(u?.designation || '')}" placeholder="e.g. Flutter Developer"></div>
        </div>
        <div class="row">
          <div class="field"><label>Email</label><input class="input" type="email" name="email" value="${esc(u?.email || '')}"></div>
          <div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(u?.phone || '')}"></div>
        </div>
        <div class="row">
          <div class="field"><label>Role</label><select class="input" name="role" ${isSelf ? 'disabled' : ''}>
            <option value="member" ${u?.role !== 'admin' ? 'selected' : ''}>Member</option>
            <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin (full access)</option></select></div>
          <div class="field"><label>${u ? 'New password (leave blank to keep)' : 'Password * (min 6)'}</label><input class="input" type="text" name="password" autocomplete="off" placeholder="${u ? '••••••' : ''}"></div>
        </div>
        ${u && !isSelf ? `<label class="check"><input type="checkbox" name="is_active" ${u.is_active ? 'checked' : ''}> Active (can sign in)</label>` : ''}`,
      foot: `${u && !isSelf ? '<button class="btn btn-danger" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>${u ? 'Save' : 'Add person'}</button>`,
    });

    $('[data-save]', m).onclick = e => busy(e.target, async () => {
      const f = formData(m);
      if (!f.display_name || !f.username) throw new Error('Name and username are required');
      f.username = f.username.toLowerCase().replace(/\s+/g, '');
      if (!u) {
        if (!f.password || f.password.length < 6) throw new Error('Password must be at least 6 characters');
        must(await sb.rpc('admin_create_user', {
          p_username: f.username, p_password: f.password, p_display_name: f.display_name,
          p_team_id: f.team_id, p_role: f.role || 'member', p_designation: f.designation, p_email: f.email, p_phone: f.phone,
        }));
        toast(`${f.display_name} added. Share the username and password with them.`, 'success');
      } else {
        const patch = { display_name: f.display_name, username: f.username, team_id: f.team_id, designation: f.designation, email: f.email, phone: f.phone };
        if (!isSelf) { patch.role = f.role; patch.is_active = f.is_active; }
        const r = await sb.from('hub_users').update(patch).eq('id', u.id);
        if (r.error?.code === '23505') throw new Error('That username is already taken');
        must(r);
        if (f.password) {
          if (f.password.length < 6) throw new Error('Password must be at least 6 characters');
          must(await sb.rpc('admin_set_password', { p_user_id: u.id, p_password: f.password }));
        }
        toast('Saved', 'success');
      }
      closeModal(m);
      await State.refresh(); this.draw();
      if (isSelf) renderSidebar();
    });
    if (u && !isSelf) $('[data-del]', m).onclick = async () => {
      if (!await confirmBox(`Permanently delete ${u.display_name}? Their leave history is deleted and their tasks become unassigned. Tip: untick “Active” instead to keep history.`)) return;
      try { must(await sb.from('hub_users').delete().eq('id', u.id)); closeModal(m); await State.refresh(); this.draw(); toast('User deleted'); }
      catch (e) { toast(e.message, 'error'); }
    };
  },
};
