/* ═══════════════════════════════════════════════════════
   api.js — Supabase client, session, shared data cache
═══════════════════════════════════════════════════════ */

const TOKEN_KEY = 'teamhub_token';
const USER_KEY  = 'teamhub_user';

function store(key, val) {
  try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch (e) { /* storage blocked */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function makeClient(token) {
  return supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: token ? { 'x-session-token': token } : {} },
  });
}

let sb = makeClient(load(TOKEN_KEY));

const Auth = {
  token() { return load(TOKEN_KEY); },

  async login(username, password) {
    const { data, error } = await makeClient(null).rpc('login', { p_username: username, p_password: password });
    if (error) throw new Error(error.message);
    store(TOKEN_KEY, data.token);
    store(USER_KEY, JSON.stringify(data.user));
    sb = makeClient(data.token);
    return data.user;
  },

  async logout() {
    try { await sb.rpc('logout'); } catch (e) { /* ignore */ }
    store(TOKEN_KEY, null);
    store(USER_KEY, null);
    location.href = 'index.html';
  },

  // Validates the stored token with the server. Returns the user or null.
  async me() {
    if (!this.token()) return null;
    const { data, error } = await sb.rpc('me');
    if (error || !data) { store(TOKEN_KEY, null); store(USER_KEY, null); return null; }
    store(USER_KEY, JSON.stringify(data));
    return data;
  },

  async changePassword(oldPw, newPw) {
    const { error } = await sb.rpc('change_password', { p_old: oldPw, p_new: newPw });
    if (error) throw new Error(error.message);
  },
};

// Shared reference data, loaded once at boot and refreshed after admin edits
const State = {
  me: null,
  teams: [],
  users: [],
  holidays: [],      // calendar_events where kind = holiday (visible to me)
  get isAdmin() { return this.me?.role === 'admin'; },

  async refresh() {
    const [t, u, h] = await Promise.all([
      sb.from('hub_teams').select('*').order('name'),
      sb.from('hub_users').select('*').order('display_name'),
      sb.from('hub_calendar_events').select('*').eq('kind', 'holiday').order('event_date'),
    ]);
    if (t.error) throw t.error;
    this.teams = t.data || [];
    this.users = u.data || [];
    this.holidays = h.data || [];
    const fresh = this.users.find(x => x.id === this.me?.id);
    if (fresh) this.me = fresh;
  },

  team(id) { return this.teams.find(t => t.id === id) || null; },
  user(id) { return this.users.find(u => u.id === id) || null; },
  userName(id) { return this.user(id)?.display_name || 'Unknown'; },
  teamMembers(teamId, { activeOnly = true } = {}) {
    return this.users.filter(u => u.team_id === teamId && (!activeOnly || u.is_active));
  },
  holidaySet() {
    const s = new Set();
    this.holidays.forEach(h => eachDay(h.event_date, h.end_date || h.event_date, d => s.add(d)));
    return s;
  },
};

// Throws a readable Error on Supabase errors; returns data otherwise
function must({ data, error }) {
  if (error) throw new Error(error.message || 'Something went wrong');
  return data;
}
