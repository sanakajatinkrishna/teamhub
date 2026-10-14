/* Calendar — holidays, events, approved leave and task due dates; admin manages holidays */

const CalendarPage = {
  month: null,          // 'YYYY-MM'
  tab: 'month',
  f: { team: '', member: '', tasks: true, leaves: true },
  holYear: String(new Date().getFullYear()),

  async render(el) {
    this.el = el;
    const p = hashParams();
    if (p.get('tab')) this.tab = p.get('tab');
    clearHashParams();
    if (!this.month) this.month = ymd().slice(0, 7);

    el.innerHTML = `
      <div class="page-head"><h1>Calendar</h1><div class="spacer"></div>
        ${State.isAdmin ? `<button class="btn" id="bulkBtn">Import holiday list</button><button class="btn btn-primary" id="addEv">＋ Add holiday / event</button>` : ''}
      </div>
      <div class="tabs" id="ctabs"><button class="tab" data-t="month">Month</button><button class="tab" data-t="holidays">Holiday list</button></div>
      <div id="calArea"></div>`;
    $$('#ctabs .tab', el).forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.draw(); });
    if (State.isAdmin) {
      $('#addEv', el).onclick = () => this.eventModal();
      $('#bulkBtn', el).onclick = () => this.bulkModal();
    }
    await this.draw();
  },

  async draw() {
    $$('#ctabs .tab', this.el).forEach(b => b.classList.toggle('active', b.dataset.t === this.tab));
    if (this.tab === 'holidays') return this.drawHolidays();
    return this.drawMonth();
  },

  async drawMonth() {
    const area = $('#calArea', this.el);
    const [y, mo] = this.month.split('-').map(Number);
    const first = new Date(y, mo - 1, 1);
    const gridStart = ymd(new Date(y, mo - 1, 1 - first.getDay()));
    const gridEnd = addDays(gridStart, 41);

    let tq = sb.from('hub_tasks').select('*').gte('due_date', gridStart).lte('due_date', gridEnd).neq('status', 'done');
    if (State.isAdmin) {
      if (this.f.member) tq = tq.eq('assigned_to', this.f.member);
      else if (this.f.team) tq = tq.eq('team_id', this.f.team);
    } else tq = tq.eq('assigned_to', State.me.id);
    const wantTasks = this.f.tasks && (!State.isAdmin || this.f.team || this.f.member);

    const [events, leaves, tasks] = await Promise.all([
      sb.from('hub_calendar_events').select('*').lte('event_date', gridEnd).order('event_date').then(must),
      sb.from('hub_leave_requests').select('*').eq('status', 'approved').lte('start_date', gridEnd).gte('end_date', gridStart).then(must),
      wantTasks ? tq.then(must) : [],
    ]);

    const byDay = {};
    const push = (d, item) => { (byDay[d] = byDay[d] || []).push(item); };
    events.filter(ev => (ev.end_date || ev.event_date) >= gridStart)
      .filter(ev => !State.isAdmin || !this.f.team || !ev.team_id || ev.team_id === this.f.team)
      .forEach(ev => eachDay(ev.event_date, ev.end_date || ev.event_date, d => push(d, { kind: ev.kind, title: ev.title, ev })));
    if (this.f.leaves) leaves
      .filter(l => (!this.f.team || State.user(l.user_id)?.team_id === this.f.team) && (!this.f.member || l.user_id === this.f.member))
      .forEach(l => eachDay(l.start_date, l.end_date, d => {
        if (WEEKLY_OFF.includes(parseYmd(d).getDay())) return;
        push(d, { kind: 'leave', title: `${State.userName(l.user_id)}${l.leave_type === 'wfh' ? ' (WFH)' : ''}${l.half_day ? ' ½' : ''}`, l });
      }));
    tasks.forEach(t => push(t.due_date, { kind: 'task', title: `Due: ${t.title}`, t }));
    this.byDay = byDay;

    const today = ymd(), order = { holiday: 0, event: 1, leave: 2, task: 3 };
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const items = (byDay[d] || []).sort((a, b) => order[a.kind] - order[b.kind]);
      const dow = parseYmd(d).getDay();
      days.push(`<div class="day ${d.slice(0, 7) !== this.month ? 'out' : ''} ${d === today ? 'today' : ''} ${WEEKLY_OFF.includes(dow) ? 'off' : ''}" data-d="${d}">
        <div class="num">${Number(d.slice(8))}</div>
        ${items.slice(0, 3).map(it => `<div class="chip ${it.kind}" title="${esc(it.title)}">${esc(it.title)}</div>`).join('')}
        ${items.length > 3 ? `<div class="chip more">+${items.length - 3} more</div>` : ''}
      </div>`);
    }

    area.innerHTML = `
      <div class="cal-head">
        <div class="seg"><button id="prevM">‹</button><button id="todayM">Today</button><button id="nextM">›</button></div>
        <h2 style="min-width:170px">${first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
        <div class="spacer" style="flex:1"></div>
        <div class="filters">
          ${State.isAdmin ? `
            <select class="input" id="cTeam">${teamOptions(this.f.team, { includeAll: true, allLabel: 'Everyone' })}</select>
            <select class="input" id="cMember">${memberOptions(this.f.team, this.f.member, 'All members')}</select>` : ''}
          <label class="check" style="margin:0"><input type="checkbox" id="cLeaves" ${this.f.leaves ? 'checked' : ''}> Leave</label>
          <label class="check" style="margin:0"><input type="checkbox" id="cTasks" ${this.f.tasks ? 'checked' : ''}> ${State.isAdmin ? 'Task deadlines' : 'My deadlines'}</label>
        </div>
      </div>
      <div class="card" style="overflow:hidden">
        <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('')}${days.join('')}</div>
      </div>
      <div class="legend" style="margin-top:10px">
        <span class="l-holiday">Holiday</span><span class="l-event">Event</span><span class="l-leave">On leave</span><span class="l-task">Task deadline</span>
        ${State.isAdmin && this.f.tasks && !this.f.team && !this.f.member ? '<span class="muted">· pick a team to see its task deadlines</span>' : ''}
      </div>`;

    const shift = n => { const d = new Date(y, mo - 1 + n, 1); this.month = ymd(d).slice(0, 7); this.drawMonth(); };
    $('#prevM', area).onclick = () => shift(-1);
    $('#nextM', area).onclick = () => shift(1);
    $('#todayM', area).onclick = () => { this.month = ymd().slice(0, 7); this.drawMonth(); };
    $('#cLeaves', area).onchange = e => { this.f.leaves = e.target.checked; this.drawMonth(); };
    $('#cTasks', area).onchange = e => { this.f.tasks = e.target.checked; this.drawMonth(); };
    if (State.isAdmin) {
      $('#cTeam', area).onchange = e => { this.f.team = e.target.value; this.f.member = ''; this.drawMonth(); };
      $('#cMember', area).onchange = e => { this.f.member = e.target.value; this.drawMonth(); };
    }
    $$('.day', area).forEach(c => c.onclick = () => this.dayModal(c.dataset.d));
  },

  dayModal(d) {
    const items = this.byDay[d] || [];
    const label = { holiday: 'Holiday', event: 'Event', leave: 'On leave', task: 'Task deadline' };
    const m = openModal({
      title: parseYmd(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      body: items.length ? `<div class="list">${items.map((it, i) => `
        <div class="list-item">
          <span class="chip ${it.kind}" style="margin:0">${label[it.kind]}</span>
          <div class="grow"><div style="font-weight:550">${esc(it.title)}</div>
            ${it.ev ? `<div class="small muted">${it.ev.team_id ? teamPill(it.ev.team_id) : 'Everyone'}${it.ev.description ? ' · ' + esc(it.ev.description) : ''}</div>` : ''}
            ${it.l ? `<div class="small muted">${esc(LEAVE_TYPES[it.l.leave_type]?.label || '')} · ${fmtDateRange(it.l.start_date, it.l.end_date)}</div>` : ''}
            ${it.t ? `<div class="small muted">${esc(State.userName(it.t.assigned_to))} · ${STATUS[it.t.status].label}</div>` : ''}
          </div>
          ${it.t ? `<a class="btn btn-sm" href="#/tasks?open=${it.t.id}" data-go>Open</a>` : ''}
          ${it.ev && State.isAdmin ? `<button class="btn btn-sm" data-edit="${i}">Edit</button>` : ''}
        </div>`).join('')}</div>` : '<div class="empty">Nothing on this day.</div>',
      foot: State.isAdmin ? `<button class="btn" data-close>Close</button><button class="btn btn-primary" data-add>＋ Add holiday / event</button>` : `<button class="btn" data-close>Close</button>`,
    });
    $$('[data-go]', m).forEach(a => a.addEventListener('click', () => closeModal(m)));
    $$('[data-edit]', m).forEach(b => b.onclick = () => { closeModal(m); this.eventModal(items[b.dataset.edit].ev); });
    if (State.isAdmin) $('[data-add]', m).onclick = () => { closeModal(m); this.eventModal(null, d); };
  },

  eventModal(ev = null, date = null) {
    const m = openModal({
      title: ev ? 'Edit calendar entry' : 'Add holiday / event',
      body: `
        <div class="field"><label>Title *</label><input class="input" name="title" value="${esc(ev?.title || '')}" placeholder="e.g. Diwali, Quarterly review"></div>
        <div class="row">
          <div class="field"><label>Type</label><select class="input" name="kind">
            <option value="holiday" ${ev?.kind !== 'event' ? 'selected' : ''}>Holiday (office closed)</option>
            <option value="event" ${ev?.kind === 'event' ? 'selected' : ''}>Event / meeting</option></select></div>
          <div class="field"><label>Who is it for?</label><select class="input" name="team_id">${teamOptions(ev?.team_id || '', { includeAll: true, allLabel: 'Everyone (all teams)' })}</select></div>
        </div>
        <div class="row">
          <div class="field"><label>Date *</label><input class="input" type="date" name="event_date" value="${ev?.event_date || date || ymd()}"></div>
          <div class="field"><label>End date (multi-day)</label><input class="input" type="date" name="end_date" value="${ev?.end_date || ''}"></div>
        </div>
        <div class="field"><label>Description</label><textarea class="input" name="description">${esc(ev?.description || '')}</textarea></div>`,
      foot: `${ev ? '<button class="btn btn-danger" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>`,
    });
    $('[data-save]', m).onclick = e => busy(e.target, async () => {
      const f = formData(m);
      if (!f.title || !f.event_date) throw new Error('Title and date are required');
      if (f.end_date && f.end_date < f.event_date) throw new Error('End date is before the start date');
      if (f.end_date === f.event_date) f.end_date = null;
      must(ev ? await sb.from('hub_calendar_events').update(f).eq('id', ev.id) : await sb.from('hub_calendar_events').insert(f));
      closeModal(m);
      toast('Calendar updated', 'success');
      await State.refresh();
      this.draw();
    });
    if (ev) $('[data-del]', m).onclick = async () => {
      if (!await confirmBox(`Delete "${ev.title}"?`)) return;
      try { must(await sb.from('hub_calendar_events').delete().eq('id', ev.id)); closeModal(m); await State.refresh(); this.draw(); toast('Deleted'); }
      catch (e) { toast(e.message, 'error'); }
    };
  },

  bulkModal() {
    const m = openModal({
      title: 'Import holiday list', wide: true,
      body: `
        <p class="muted" style="margin-bottom:12px">One holiday per line as <code>YYYY-MM-DD, Name</code> or <code>DD/MM/YYYY, Name</code>. You can paste straight from a spreadsheet.</p>
        <div class="field"><textarea class="input" name="lines" style="min-height:220px;font-family:ui-monospace,monospace" placeholder="2026-01-26, Republic Day&#10;2026-08-15, Independence Day&#10;02/10/2026, Gandhi Jayanti"></textarea></div>
        <div class="field" style="max-width:300px"><label>Applies to</label><select class="input" name="team_id">${teamOptions('', { includeAll: true, allLabel: 'Everyone (all teams)' })}</select></div>
        <div id="bulkPrev" class="small muted"></div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Import</button>`,
    });
    const parse = () => $('[name=lines]', m).value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const mt = line.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})\s*[,\t;|-]\s*(.+)$/);
      if (!mt) return { line, bad: true };
      let d = mt[1];
      if (!/^\d{4}/.test(d)) { const [dd, mm, yy] = d.split(/[\/.-]/); d = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`; }
      return isNaN(parseYmd(d)) ? { line, bad: true } : { event_date: d, title: mt[2].trim() };
    });
    $('[name=lines]', m).oninput = () => {
      const rows = parse(), bad = rows.filter(r => r.bad);
      $('#bulkPrev', m).innerHTML = `${rows.length - bad.length} holiday(s) ready` + (bad.length ? ` · <span style="color:var(--bad)">${bad.length} line(s) not understood: ${bad.map(b => esc(b.line)).join('; ')}</span>` : '');
    };
    $('[data-save]', m).onclick = e => busy(e.target, async () => {
      const rows = parse();
      if (!rows.length) throw new Error('Paste at least one line');
      if (rows.some(r => r.bad)) throw new Error('Fix the lines that were not understood first');
      const team_id = $('[name=team_id]', m).value || null;
      must(await sb.from('hub_calendar_events').insert(rows.map(r => ({ ...r, kind: 'holiday', team_id }))));
      closeModal(m);
      toast(`${rows.length} holidays added`, 'success');
      await State.refresh();
      this.draw();
    });
  },

  async drawHolidays() {
    const area = $('#calArea', this.el);
    const y = this.holYear;
    const rows = must(await sb.from('hub_calendar_events').select('*').gte('event_date', `${y}-01-01`).lte('event_date', `${y}-12-31`).order('event_date'));
    const today = ymd();
    area.innerHTML = `
      <div class="filters" style="margin-bottom:12px">
        <select class="input" id="hYear">${[-1, 0, 1].map(i => { const v = String(new Date().getFullYear() + i); return `<option ${v === y ? 'selected' : ''}>${v}</option>`; }).join('')}</select>
      </div>
      <div class="card table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Day</th><th>Name</th><th>Type</th><th>For</th>${State.isAdmin ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows.map(r => `
          <tr style="${(r.end_date || r.event_date) < today ? 'opacity:.55' : ''}">
            <td style="white-space:nowrap;font-weight:550">${fmtDateRange(r.event_date, r.end_date)}</td>
            <td>${parseYmd(r.event_date).toLocaleDateString('en-IN', { weekday: 'long' })}</td>
            <td>${esc(r.title)}</td>
            <td>${r.kind === 'holiday' ? '<span class="badge b-bad">Holiday</span>' : '<span class="badge b-info">Event</span>'}</td>
            <td>${r.team_id ? teamPill(r.team_id) : 'Everyone'}</td>
            ${State.isAdmin ? `<td style="text-align:right"><button class="btn btn-sm" data-edit="${r.id}">Edit</button></td>` : ''}
          </tr>`).join('') || `<tr><td colspan="6" class="empty">No holidays for ${y} yet.${State.isAdmin ? ' Use “Import holiday list” to add them in one go.' : ''}</td></tr>`}
        </tbody></table></div>`;
    $('#hYear', area).onchange = e => { this.holYear = e.target.value; this.drawHolidays(); };
    $$('[data-edit]', area).forEach(b => b.onclick = () => this.eventModal(rows.find(r => String(r.id) === b.dataset.edit)));
  },
};
