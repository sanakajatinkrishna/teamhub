/* Leaves — apply, track balance, cancel; admin approves/rejects and records leave */

const LeavesPage = {
  tab: null,
  f: { team: '', member: '', status: '', year: String(new Date().getFullYear()) },

  async render(el) {
    this.el = el;
    const p = hashParams();
    clearHashParams();
    if (!this.tab) this.tab = State.isAdmin ? 'pending' : 'mine';
    const tabs = State.isAdmin
      ? [['pending', 'Pending approvals'], ['all', 'All requests'], ['mine', 'My leave']]
      : [['mine', 'My leave'], ['team', 'Team leave']];

    el.innerHTML = `
      <div class="page-head"><h1>Leaves</h1><div class="spacer"></div>
        ${State.isAdmin ? `<button class="btn" id="recordBtn">Record leave for someone</button>` : ''}
        <button class="btn btn-primary" id="applyBtn">＋ Apply for leave</button>
      </div>
      <div id="balance"></div>
      <div class="tabs" id="tabs">${tabs.map(([k, l]) => `<button class="tab" data-t="${k}">${l}<span data-tc="${k}"></span></button>`).join('')}</div>
      <div id="leaveArea"><div class="loading">Loading…</div></div>`;

    $('#applyBtn', el).onclick = () => this.applyModal();
    if (State.isAdmin) $('#recordBtn', el).onclick = () => this.applyModal({ forOther: true });
    $$('#tabs .tab', el).forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.draw(); });

    await this.load();
    if (p.get('new')) this.applyModal();
  },

  async load() {
    const year = this.f.year;
    const [mine, others] = await Promise.all([
      sb.from('hub_leave_requests').select('*').eq('user_id', State.me.id).order('start_date', { ascending: false }).then(must),
      sb.from('hub_leave_requests').select('*').neq('user_id', State.me.id)
        .gte('end_date', `${year}-01-01`).lte('start_date', `${year}-12-31`)
        .order('start_date', { ascending: false }).then(must),
    ]);
    this.mine = mine;
    this.others = others;
    if (State.isAdmin) {
      // pending requests from any year
      this.pending = must(await sb.from('hub_leave_requests').select('*').eq('status', 'pending').order('start_date'));
    }
    this.drawBalance();
    this.draw();
  },

  drawBalance() {
    const year = String(new Date().getFullYear());
    const thisYear = this.mine.filter(l => l.start_date.startsWith(year));
    const tiles = Object.entries(LEAVE_TYPES).map(([k, v]) => {
      const used = thisYear.filter(l => l.leave_type === k && l.status === 'approved').reduce((s, l) => s + leaveDays(l), 0);
      const pend = thisYear.filter(l => l.leave_type === k && l.status === 'pending').reduce((s, l) => s + leaveDays(l), 0);
      return `<div class="card stat"><div class="label">${esc(v.label)}</div>
        <div class="value">${used}${v.quota != null ? `<span class="muted" style="font-size:15px;font-weight:500"> / ${v.quota}</span>` : ''}</div>
        <div class="sub">${v.quota != null ? `${Math.max(v.quota - used, 0)} left` : 'days taken'}${pend ? ` · ${pend} pending` : ''}</div></div>`;
    });
    $('#balance', this.el).innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:18px">${tiles.join('')}</div>`;
  },

  draw() {
    $$('#tabs .tab', this.el).forEach(b => b.classList.toggle('active', b.dataset.t === this.tab));
    const pc = $('[data-tc=pending]', this.el);
    if (pc) pc.textContent = this.pending?.length ? ` (${this.pending.length})` : '';
    const area = $('#leaveArea', this.el);

    if (this.tab === 'mine') {
      area.innerHTML = this.table(this.mine, { showUser: false, ownActions: true });
    } else if (this.tab === 'team') {
      const today = ymd();
      const upcoming = this.others.filter(l => l.status === 'approved' && l.end_date >= today).reverse();
      area.innerHTML = `<p class="muted small" style="margin-bottom:10px">Approved leave of your teammates, from today onward.</p>` +
        this.table(upcoming, { showUser: true });
    } else if (this.tab === 'pending') {
      area.innerHTML = this.table(this.pending, { showUser: true, review: true, empty: 'No requests waiting. 🎉' });
    } else {
      area.innerHTML = `
        <div class="filters" style="margin-bottom:12px" id="lf">
          <select class="input" name="team">${teamOptions(this.f.team, { includeAll: true })}</select>
          <select class="input" name="member">${memberOptions(this.f.team, this.f.member, 'All members')}</select>
          <select class="input" name="status"><option value="">Any status</option>${Object.entries(LEAVE_STATUS).map(([k, v]) => `<option value="${k}" ${k === this.f.status ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
          <select class="input" name="year">${[0, 1, 2].map(i => { const y = String(new Date().getFullYear() + 1 - i); return `<option ${y === this.f.year ? 'selected' : ''}>${y}</option>`; }).join('')}</select>
        </div>
        <div id="allTable"></div>`;
      const drawAll = () => {
        const rows = [...this.others, ...this.mine.filter(l => l.start_date.startsWith(this.f.year) || l.end_date.startsWith(this.f.year))]
          .filter(l => (!this.f.team || State.user(l.user_id)?.team_id === this.f.team)
            && (!this.f.member || l.user_id === this.f.member)
            && (!this.f.status || l.status === this.f.status))
          .sort((a, b) => a.start_date < b.start_date ? 1 : -1);
        $('#allTable', area).innerHTML = this.table(rows, { showUser: true, review: true });
        this.bindRows(area);
      };
      $$('#lf [name]', area).forEach(s => s.onchange = async () => {
        this.f[s.name] = s.value;
        if (s.name === 'team') { this.f.member = ''; $('[name=member]', area).innerHTML = memberOptions(this.f.team, '', 'All members'); }
        if (s.name === 'year') { await this.load(); return; }
        drawAll();
      });
      drawAll();
      return;
    }
    this.bindRows(area);
  },

  table(rows, { showUser, ownActions, review, empty = 'No leave requests.' }) {
    if (!rows?.length) return `<div class="card card-pad"><div class="empty">${empty}</div></div>`;
    return `<div class="card table-wrap"><table class="table">
      <thead><tr>${showUser ? '<th>Person</th>' : ''}<th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(l => {
        const u = State.user(l.user_id);
        let actions = '';
        if (ownActions && l.status === 'pending') actions = `<button class="btn btn-sm btn-danger" data-cancel="${l.id}">Cancel</button>`;
        if (review && State.isAdmin && l.status === 'pending') actions = `<button class="btn btn-sm btn-ok" data-approve="${l.id}">Approve</button> <button class="btn btn-sm btn-danger" data-reject="${l.id}">Reject</button>`;
        else if (review && State.isAdmin && l.status === 'approved') actions = `<button class="btn btn-sm" data-revoke="${l.id}">Revoke</button>`;
        return `<tr>
          ${showUser ? `<td><div style="display:flex;gap:8px;align-items:center">${avatar(u, 'sm')}<div><div style="font-weight:550">${esc(u?.display_name || 'Unknown')}</div><div class="small">${teamPill(u?.team_id)}</div></div></div></td>` : ''}
          <td>${esc(LEAVE_TYPES[l.leave_type]?.label || l.leave_type)}</td>
          <td style="white-space:nowrap">${fmtDateRange(l.start_date, l.end_date)}${l.half_day ? ' <span class="badge">½ day</span>' : ''}</td>
          <td>${leaveDays(l)}</td>
          <td style="max-width:260px"><div class="ellipsis" title="${esc(l.reason || '')}">${esc(l.reason || '—')}</div>
            ${l.review_note ? `<div class="small muted ellipsis" title="${esc(l.review_note)}">Note: ${esc(l.review_note)}</div>` : ''}</td>
          <td>${badge(LEAVE_STATUS, l.status)}${l.reviewed_by && l.status !== 'pending' ? `<div class="small muted">by ${esc(State.userName(l.reviewed_by))}</div>` : ''}</td>
          <td style="text-align:right;white-space:nowrap">${actions}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  },

  bindRows(area) {
    $$('[data-cancel]', area).forEach(b => b.onclick = async () => {
      if (!await confirmBox('Cancel this leave request?', 'Cancel request')) return;
      await this.update(b.dataset.cancel, { status: 'cancelled' }, 'Request cancelled');
    });
    $$('[data-approve]', area).forEach(b => b.onclick = () => this.reviewModal(b.dataset.approve, 'approved'));
    $$('[data-reject]', area).forEach(b => b.onclick = () => this.reviewModal(b.dataset.reject, 'rejected'));
    $$('[data-revoke]', area).forEach(b => b.onclick = () => this.reviewModal(b.dataset.revoke, 'rejected', true));
  },

  reviewModal(id, status, revoke = false) {
    const all = [...(this.pending || []), ...this.others, ...this.mine];
    const l = all.find(x => String(x.id) === String(id));
    const u = State.user(l?.user_id);
    const m = openModal({
      title: revoke ? 'Revoke approved leave' : status === 'approved' ? 'Approve leave' : 'Reject leave',
      body: `
        <p style="margin-bottom:14px"><strong>${esc(u?.display_name || '')}</strong> · ${esc(LEAVE_TYPES[l.leave_type]?.label || '')} · ${fmtDateRange(l.start_date, l.end_date)} (${leaveDays(l)} day${leaveDays(l) === 1 ? '' : 's'})</p>
        ${l.reason ? `<p class="muted" style="margin-bottom:14px">“${esc(l.reason)}”</p>` : ''}
        <div class="field"><label>Note to ${esc(u?.display_name?.split(' ')[0] || 'them')} (optional)</label><textarea class="input" name="review_note"></textarea></div>`,
      foot: `<button class="btn" data-close>Back</button><button class="btn btn-primary" data-ok>${revoke ? 'Revoke' : status === 'approved' ? 'Approve' : 'Reject'}</button>`,
    });
    $('[data-ok]', m).onclick = e => busy(e.target, async () => {
      await this.update(id, { status, review_note: formData(m).review_note }, status === 'approved' ? 'Leave approved' : 'Leave rejected');
      closeModal(m);
    });
  },

  async update(id, patch, msg) {
    try {
      const [row] = must(await sb.from('hub_leave_requests').update(patch).eq('id', id).select());
      if (!row) throw new Error('Not allowed');
      toast(msg, 'success');
      await this.load();
      refreshBadges();
    } catch (e) { toast(e.message, 'error'); }
  },

  applyModal({ forOther = false } = {}) {
    const m = openModal({
      title: forOther ? 'Record leave for a team member' : 'Apply for leave',
      body: `
        ${forOther ? `<div class="row">
          <div class="field"><label>Team</label><select class="input" id="aTeam"><option value="">Select team</option>${teamOptions('')}</select></div>
          <div class="field"><label>Team member *</label><select class="input" name="user_id"><option value="">Select a team first</option></select></div>
        </div>` : ''}
        <div class="field"><label>Leave type</label><select class="input" name="leave_type">
          ${Object.entries(LEAVE_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
        <div class="row">
          <div class="field"><label>From *</label><input class="input" type="date" name="start_date" value="${ymd()}"></div>
          <div class="field"><label>To *</label><input class="input" type="date" name="end_date" value="${ymd()}"></div>
        </div>
        <label class="check"><input type="checkbox" name="half_day"> Half day (single date only)</label>
        <div class="field"><label>Reason</label><textarea class="input" name="reason" placeholder="Optional"></textarea></div>
        <div id="dayCount" class="small muted"></div>
        ${forOther ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="preApprove" checked> Mark as approved straight away</label>` : ''}`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>${forOther ? 'Save leave' : 'Submit request'}</button>`,
    });

    const s = $('[name=start_date]', m), e = $('[name=end_date]', m), h = $('[name=half_day]', m);
    const recount = () => {
      if (e.value < s.value) e.value = s.value;
      h.disabled = s.value !== e.value; if (h.disabled) h.checked = false;
      const n = leaveDays({ start_date: s.value, end_date: e.value, half_day: h.checked });
      $('#dayCount', m).textContent = `${n} working day${n === 1 ? '' : 's'} (weekly offs and holidays are not counted)`;
    };
    [s, e, h].forEach(x => x.onchange = recount);
    recount();
    if (forOther) $('#aTeam', m).onchange = ev => { $('[name=user_id]', m).innerHTML = memberOptions(ev.target.value, ''); };

    $('[data-save]', m).onclick = ev => busy(ev.target, async () => {
      const f = formData(m);
      if (!f.start_date || !f.end_date) throw new Error('Please choose the dates');
      if (forOther && !f.user_id) throw new Error('Please choose a team member');
      if (leaveDays(f) === 0) throw new Error('These dates fall entirely on weekly offs or holidays');
      if (forOther && $('#preApprove', m).checked) f.status = 'approved';
      must(await sb.from('hub_leave_requests').insert(f).select());
      closeModal(m);
      toast(forOther ? 'Leave recorded' : 'Leave request sent to admin', 'success');
      this.tab = forOther ? 'all' : 'mine';
      await this.load();
      refreshBadges();
    });
  },
};
