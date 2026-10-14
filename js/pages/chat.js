/* Team chat — #general for everyone, one channel per team. Near-real-time via
   a Supabase broadcast "ping" plus polling as a fallback. Message content is
   always fetched through the database, so row-level security applies. */

const ChatPage = {
  channel: null,     // null = general, else team id
  lastId: 0,
  timer: null,
  rt: null,

  channels() {
    const teams = State.isAdmin ? State.teams : State.teams.filter(t => t.id === State.me.team_id);
    return [{ id: null, name: 'general', color: '#6b7385', sub: 'Everyone' }, ...teams.map(t => ({ id: t.id, name: t.name, color: t.color, sub: 'Team' }))];
  },

  async render(el) {
    this.el = el;
    const chans = this.channels();
    if (!chans.some(c => c.id === this.channel)) this.channel = State.isAdmin ? null : (State.me.team_id || null);

    el.innerHTML = `
      <div class="page-head"><h1>Team chat</h1></div>
      <div class="card chat">
        <div class="channels" id="chans">
          <div class="h">Channels</div>
          ${chans.map(c => `<div class="channel" data-c="${c.id || ''}"><span class="team-dot" style="background:${c.color}"></span># ${esc(c.name)}</div>`).join('')}
        </div>
        <div class="chat-main">
          <div class="chat-head" id="chatHead"></div>
          <div class="msgs" id="msgs"></div>
          <div class="composer">
            <textarea class="input" id="msgText" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" rows="1"></textarea>
            <button class="btn btn-primary" id="sendBtn">Send</button>
          </div>
        </div>
      </div>`;

    $$('.channel', el).forEach(c => c.onclick = () => { this.channel = c.dataset.c || null; this.open(); });
    const ta = $('#msgText', el);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
    $('#sendBtn', el).onclick = () => this.send();

    try {
      this.rt = sb.channel('teamhub-chat')
        .on('broadcast', { event: 'msg' }, ({ payload }) => { if ((payload?.team_id || null) === this.channel) this.poll(); })
        .subscribe();
    } catch (e) { this.rt = null; }
    this.timer = setInterval(() => this.poll(), 5000);
    await this.open();
  },

  destroy() {
    clearInterval(this.timer);
    if (this.rt) { try { sb.removeChannel(this.rt); } catch (e) { /* ignore */ } this.rt = null; }
  },

  query() {
    let q = sb.from('hub_messages').select('*');
    return this.channel ? q.eq('team_id', this.channel) : q.is('team_id', null);
  },

  async open() {
    const c = this.channels().find(x => x.id === this.channel);
    $$('.channel', this.el).forEach(x => x.classList.toggle('active', (x.dataset.c || null) === this.channel));
    $('#chatHead', this.el).innerHTML = `<h3># ${esc(c.name)}</h3><div class="small muted">${c.id ? `${State.teamMembers(c.id).length} members · only this team${State.isAdmin ? ' and admins' : ''} can see it` : 'Company-wide channel'}</div>`;
    const box = $('#msgs', this.el);
    box.innerHTML = '<div class="loading">Loading…</div>';
    const rows = must(await this.query().order('id', { ascending: false }).limit(100)).reverse();
    this.lastId = rows.length ? rows[rows.length - 1].id : 0;
    this.lastDay = null;
    box.innerHTML = rows.length ? '' : '<div class="empty" id="noMsg">No messages yet — say hello 👋</div>';
    this.append(rows);
    $('#msgText', this.el).focus();
  },

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const chan = this.channel;
      const { data } = await this.query().gt('id', this.lastId).order('id');
      if (data?.length && chan === this.channel) {
        this.lastId = data[data.length - 1].id;
        this.append(data);
      }
    } finally { this.polling = false; }
  },

  append(rows) {
    const box = $('#msgs', this.el);
    if (!box || !rows.length) return;
    $('#noMsg', box)?.remove();
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const html = rows.map(r => {
      const day = ymd(new Date(r.created_at));
      let sep = '';
      if (day !== this.lastDay) { this.lastDay = day; sep = `<div class="day-sep">${day === ymd() ? 'Today' : fmtDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}</div>`; }
      const u = State.user(r.user_id);
      const mine = r.user_id === State.me.id;
      return `${sep}<div class="msg" data-id="${r.id}">${avatar(u)}
        <div style="min-width:0;flex:1"><div class="who">${esc(u?.display_name || 'Deleted user')}<span class="when">${fmtTime(r.created_at)}</span></div>
        <div class="body">${esc(r.body)}</div></div>
        ${mine || State.isAdmin ? `<button class="icon-btn del" title="Delete" style="color:var(--muted)" data-del="${r.id}">🗑</button>` : ''}</div>`;
    }).join('');
    box.insertAdjacentHTML('beforeend', html);
    $$('[data-del]', box).forEach(b => b.onclick = async () => {
      if (!await confirmBox('Delete this message?')) return;
      try { must(await sb.from('hub_messages').delete().eq('id', b.dataset.del)); b.closest('.msg').remove(); }
      catch (e) { toast(e.message, 'error'); }
    });
    if (nearBottom || rows.some(r => r.user_id === State.me.id)) box.scrollTop = box.scrollHeight;
  },

  async send() {
    const ta = $('#msgText', this.el);
    const body = ta.value.trim();
    if (!body) return;
    ta.value = ''; ta.style.height = 'auto';
    try {
      must(await sb.from('hub_messages').insert({ body, team_id: this.channel }));
      await this.poll();
      this.rt?.send({ type: 'broadcast', event: 'msg', payload: { team_id: this.channel } });
    } catch (e) { ta.value = body; toast(e.message, 'error'); }
  },
};
