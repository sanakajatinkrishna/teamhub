/* Dashboard — personal overview + admin team overview */

const DashboardPage = {
  async render(el) {
    const me = State.me, today = ymd(), year = today.slice(0, 4);
    const weekEnd = addDays(today, 7);

    const [myTasks, onLeave, myLeaves, anns, allOpen, pending] = await Promise.all([
      sb.from('hub_tasks').select('*').eq('assigned_to', me.id).neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false }).then(must),
      sb.from('hub_leave_requests').select('*').eq('status', 'approved')
        .lte('start_date', today).gte('end_date', today).then(must),
      sb.from('hub_leave_requests').select('*').eq('user_id', me.id).eq('status', 'approved')
        .gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`).then(must),
      sb.from('hub_announcements').select('*').order('pinned', { ascending: false })
        .order('created_at', { ascending: false }).limit(3).then(must),
      State.isAdmin ? sb.from('hub_tasks').select('id,team_id,status,due_date').neq('status', 'done').then(must) : [],
      State.isAdmin ? sb.from('hub_leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : { count: 0 },
    ]);

    const overdue = myTasks.filter(t => t.due_date && t.due_date < today).length;
    const dueWeek = myTasks.filter(t => t.due_date && t.due_date >= today && t.due_date <= weekEnd).length;
    const usedDays = myLeaves.filter(l => l.leave_type !== 'wfh').reduce((s, l) => s + leaveDays(l), 0);
    const holidays = State.holidays.filter(h => (h.end_date || h.event_date) >= today).slice(0, 5);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    const stats = State.isAdmin ? [
      ['Pending leave requests', pending.count || 0, '<a href="#/leaves">Review →</a>'],
      ['Open tasks (all teams)', allOpen.length, `${allOpen.filter(t => t.due_date && t.due_date < today).length} overdue`],
      ['On leave today', onLeave.length, 'approved leave'],
      ['People', State.users.filter(u => u.is_active).length, `${State.teams.length} teams`],
    ] : [
      ['My open tasks', myTasks.length, overdue ? `<span class="overdue">${overdue} overdue</span>` : 'none overdue'],
      ['Due this week', dueWeek, 'next 7 days'],
      ['Leave taken this year', usedDays, 'working days'],
      ['Teammates on leave', onLeave.filter(l => l.user_id !== me.id).length, 'today'],
    ];

    el.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${greet}, ${esc(me.display_name.split(' ')[0])}</h1>
          <p class="muted" style="margin-top:4px">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div class="spacer"></div>
        ${State.isAdmin ? `<a class="btn btn-primary" href="#/tasks?new=1">＋ Assign task</a>` : `<a class="btn btn-primary" href="#/leaves?new=1">＋ Apply for leave</a>`}
      </div>

      <div class="grid grid-4" style="margin-bottom:16px">
        ${stats.map(([l, v, s]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('')}
      </div>

      ${State.isAdmin ? this.teamOverview(allOpen, onLeave, today) : ''}

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>My tasks</h3><a href="#/tasks" class="small">View all</a></div>
          <div class="card-body list">
            ${myTasks.slice(0, 6).map(t => `
              <a class="list-item" href="#/tasks?open=${t.id}" style="color:inherit">
                <div class="grow"><div class="ellipsis" style="font-weight:550">${esc(t.title)}</div>
                  <div class="small ${t.due_date && t.due_date < today ? 'overdue' : 'muted'}">${relDue(t.due_date) || 'No due date'}</div></div>
                ${badge(STATUS, t.status)}
              </a>`).join('') || '<div class="empty">No open tasks. Nice!</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>On leave today</h3><a href="#/calendar" class="small">Calendar</a></div>
          <div class="card-body list">
            ${onLeave.map(l => { const u = State.user(l.user_id); return `
              <div class="list-item">${avatar(u, 'sm')}
                <div class="grow"><div style="font-weight:550">${esc(u?.display_name || 'Unknown')}</div>
                  <div class="small muted">${esc(LEAVE_TYPES[l.leave_type]?.label || l.leave_type)} · ${fmtDateRange(l.start_date, l.end_date)}${l.half_day ? ' · half day' : ''}</div></div>
                ${teamPill(u?.team_id, '')}
              </div>`; }).join('') || '<div class="empty">Everyone is in today.</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Upcoming holidays</h3><a href="#/calendar?tab=holidays" class="small">Holiday list</a></div>
          <div class="card-body list">
            ${holidays.map(h => `
              <div class="list-item">
                <span class="badge b-bad">${fmtDate(h.event_date, { day: 'numeric', month: 'short' })}</span>
                <div class="grow ellipsis" style="font-weight:550">${esc(h.title)}</div>
                <span class="small muted">${parseYmd(h.event_date).toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              </div>`).join('') || '<div class="empty">No upcoming holidays added yet.</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Announcements</h3><a href="#/announcements" class="small">View all</a></div>
          <div>
            ${anns.map(a => `
              <div class="ann ${a.pinned ? 'pinned' : ''}">
                <div style="display:flex;gap:8px;align-items:center">${a.pinned ? '📌' : ''}<strong>${esc(a.title)}</strong></div>
                <div class="small muted" style="margin-top:3px">${a.team_id ? teamPill(a.team_id) : 'Everyone'} · ${fmtWhen(a.created_at)}</div>
                ${a.body ? `<div class="body ellipsis">${esc(a.body)}</div>` : ''}
              </div>`).join('') || '<div class="card-body"><div class="empty">No announcements yet.</div></div>'}
          </div>
        </div>
      </div>`;
  },

  teamOverview(openTasks, onLeave, today) {
    const rows = State.teams.map(t => {
      const members = State.teamMembers(t.id);
      const tasks = openTasks.filter(x => x.team_id === t.id);
      const away = onLeave.filter(l => State.user(l.user_id)?.team_id === t.id).length;
      return `<tr>
        <td>${teamPill(t.id)}</td><td>${members.length}</td><td>${tasks.length}</td>
        <td class="${tasks.some(x => x.due_date && x.due_date < today) ? 'overdue' : ''}">${tasks.filter(x => x.due_date && x.due_date < today).length}</td>
        <td>${away}</td>
        <td style="text-align:right"><a class="btn btn-sm" href="#/tasks?team=${t.id}">Tasks</a></td></tr>`;
    }).join('');
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>Team overview</h3><a class="small" href="#/teams">Manage teams</a></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Team</th><th>Members</th><th>Open tasks</th><th>Overdue</th><th>On leave today</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty">No teams yet — create one under Teams & people.</td></tr>'}</tbody>
        </table></div>
      </div>`;
  },
};
