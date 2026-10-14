/* Announcements — admin posts to everyone or one team; pinned posts stay on top */

const AnnouncementsPage = {
  async render(el) {
    this.el = el;
    el.innerHTML = `
      <div class="page-head"><h1>Announcements</h1><div class="spacer"></div>
        ${State.isAdmin ? `<button class="btn btn-primary" id="newAnn">＋ New announcement</button>` : ''}
      </div>
      <div class="card" id="annList"><div class="loading">Loading…</div></div>`;
    if (State.isAdmin) $('#newAnn', el).onclick = () => this.modal();
    await this.load();
  },

  async load() {
    this.rows = must(await sb.from('hub_announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200));
    $('#annList', this.el).innerHTML = this.rows.map(a => `
      <div class="ann ${a.pinned ? 'pinned' : ''}">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1">
            <h3>${a.pinned ? '📌 ' : ''}${esc(a.title)}</h3>
            <div class="small muted" style="margin-top:4px">${a.team_id ? teamPill(a.team_id) : '<strong>Everyone</strong>'} · ${esc(State.userName(a.created_by))} · ${fmtWhen(a.created_at)}</div>
          </div>
          ${State.isAdmin ? `<button class="btn btn-sm" data-edit="${a.id}">Edit</button>` : ''}
        </div>
        ${a.body ? `<div class="body">${esc(a.body)}</div>` : ''}
      </div>`).join('') || '<div class="card-body"><div class="empty">No announcements yet.</div></div>';
    $$('[data-edit]', this.el).forEach(b => b.onclick = () => this.modal(this.rows.find(r => String(r.id) === b.dataset.edit)));
  },

  modal(a = null) {
    const m = openModal({
      title: a ? 'Edit announcement' : 'New announcement', wide: true,
      body: `
        <div class="field"><label>Title *</label><input class="input" name="title" value="${esc(a?.title || '')}"></div>
        <div class="field"><label>Message</label><textarea class="input" name="body" style="min-height:140px">${esc(a?.body || '')}</textarea></div>
        <div class="row">
          <div class="field"><label>Audience</label><select class="input" name="team_id">${teamOptions(a?.team_id || '', { includeAll: true, allLabel: 'Everyone (all teams)' })}</select></div>
          <div class="field" style="justify-content:flex-end"><label class="check"><input type="checkbox" name="pinned" ${a?.pinned ? 'checked' : ''}> Pin to top</label></div>
        </div>`,
      foot: `${a ? '<button class="btn btn-danger" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>${a ? 'Save' : 'Post'}</button>`,
    });
    $('[data-save]', m).onclick = e => busy(e.target, async () => {
      const f = formData(m);
      if (!f.title) throw new Error('Please add a title');
      must(a ? await sb.from('hub_announcements').update(f).eq('id', a.id) : await sb.from('hub_announcements').insert(f));
      closeModal(m); toast(a ? 'Announcement updated' : 'Announcement posted', 'success'); this.load();
    });
    if (a) $('[data-del]', m).onclick = async () => {
      if (!await confirmBox('Delete this announcement?')) return;
      try { must(await sb.from('hub_announcements').delete().eq('id', a.id)); closeModal(m); this.load(); }
      catch (e) { toast(e.message, 'error'); }
    };
  },
};
