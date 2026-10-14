-- ════════════════════════════════════════════════════════════════════
--  TeamHub — internal team CRM
--  Supabase / PostgreSQL schema
--
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  It is safe to re-run: tables use IF NOT EXISTS, functions/policies
--  are replaced.
--
--  Security model
--  • Users log in with username + password through the login() function.
--    Passwords are bcrypt-hashed in user_credentials, which the browser
--    can never read.
--  • login() returns a random session token. The app sends it on every
--    request as the "x-session-token" header.
--  • Row Level Security on every table reads that header (app_uid()) to
--    decide who the caller is and what they may see or change.
-- ════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────── TABLES ────────────────────────────────

create table if not exists public.hub_teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  color       text not null default '#4f46e5',
  created_at  timestamptz not null default now()
);

create table if not exists public.hub_users (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique check (username = lower(username) and username !~ '\s'),
  display_name text not null,
  email        text,
  phone        text,
  designation  text,
  team_id      uuid references public.hub_teams(id) on delete set null,
  role         text not null default 'member' check (role in ('admin','member')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Never readable from the browser
create table if not exists public.hub_credentials (
  user_id       uuid primary key references public.hub_users(id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

-- Never readable from the browser. Only a SHA-256 of the token is stored.
create table if not exists public.hub_sessions (
  token_hash text primary key,
  user_id    uuid not null references public.hub_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.hub_tasks (
  id           bigint generated always as identity primary key,
  title        text not null,
  description  text,
  team_id      uuid references public.hub_teams(id) on delete set null,
  assigned_to  uuid references public.hub_users(id) on delete set null,
  assigned_by  uuid references public.hub_users(id) on delete set null,
  priority     text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status       text not null default 'todo'   check (status in ('todo','in_progress','review','done')),
  start_date   date,
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.hub_task_comments (
  id         bigint generated always as identity primary key,
  task_id    bigint not null references public.hub_tasks(id) on delete cascade,
  user_id    uuid references public.hub_users(id) on delete set null,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.hub_leave_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.hub_users(id) on delete cascade,
  leave_type  text not null check (leave_type in ('casual','sick','earned','unpaid','wfh')),
  start_date  date not null,
  end_date    date not null,
  half_day    boolean not null default false,
  reason      text,
  status      text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.hub_users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  check (not half_day or start_date = end_date)
);

-- Holidays and company/team events. team_id NULL = everyone.
create table if not exists public.hub_calendar_events (
  id          bigint generated always as identity primary key,
  title       text not null,
  description text,
  kind        text not null default 'holiday' check (kind in ('holiday','event')),
  event_date  date not null,
  end_date    date,
  team_id     uuid references public.hub_teams(id) on delete cascade,
  created_by  uuid references public.hub_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= event_date)
);

-- team_id NULL = whole company
create table if not exists public.hub_announcements (
  id         bigint generated always as identity primary key,
  title      text not null,
  body       text,
  team_id    uuid references public.hub_teams(id) on delete cascade,
  pinned     boolean not null default false,
  created_by uuid references public.hub_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Chat. team_id NULL = the company-wide #general channel.
create table if not exists public.hub_messages (
  id         bigint generated always as identity primary key,
  team_id    uuid references public.hub_teams(id) on delete cascade,
  user_id    uuid references public.hub_users(id) on delete set null,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists tasks_assigned_idx   on public.hub_tasks(assigned_to);
create index if not exists tasks_team_idx       on public.hub_tasks(team_id);
create index if not exists comments_task_idx    on public.hub_task_comments(task_id);
create index if not exists leaves_user_idx      on public.hub_leave_requests(user_id);
create index if not exists leaves_dates_idx     on public.hub_leave_requests(start_date, end_date);
create index if not exists events_date_idx      on public.hub_calendar_events(event_date);
create index if not exists messages_channel_idx on public.hub_messages(team_id, created_at desc);
create index if not exists sessions_user_idx    on public.hub_sessions(user_id);

-- ─────────────────────── IDENTITY HELPERS ──────────────────────────

create or replace function public.app_token() returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-session-token', '')
$$;

create or replace function public.app_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select s.user_id
  from hub_sessions s join hub_users u on u.id = s.user_id
  where s.token_hash = encode(extensions.digest(app_token(), 'sha256'), 'hex')
    and s.expires_at > now()
    and u.is_active
  limit 1
$$;

create or replace function public.app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hub_users where id = app_uid() and role = 'admin')
$$;

create or replace function public.app_team() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from hub_users where id = app_uid()
$$;

-- ─────────────────────────── AUTH RPCs ─────────────────────────────

create or replace function public.login(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user  hub_users;
  v_hash  text;
  v_token text;
begin
  select * into v_user from hub_users where username = lower(trim(p_username));
  if found then
    select password_hash into v_hash from hub_credentials where user_id = v_user.id;
  end if;

  if v_hash is null or v_hash <> extensions.crypt(p_password, v_hash) then
    perform pg_sleep(0.5);                       -- slow down guessing
    raise exception 'Invalid username or password' using errcode = '28000';
  end if;
  if not v_user.is_active then
    raise exception 'Your account is disabled. Contact your administrator.' using errcode = '28000';
  end if;

  delete from hub_sessions where expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into hub_sessions (token_hash, user_id, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_user.id, now() + interval '30 days');

  return json_build_object('token', v_token, 'user', row_to_json(v_user));
end $$;

create or replace function public.logout() returns void
language sql security definer set search_path = public as $$
  delete from hub_sessions where token_hash = encode(extensions.digest(app_token(), 'sha256'), 'hex')
$$;

create or replace function public.me() returns json
language sql stable security definer set search_path = public as $$
  select row_to_json(u) from hub_users u where u.id = app_uid()
$$;

create or replace function public.change_password(p_old text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  if app_uid() is null then raise exception 'Not logged in' using errcode = '28000'; end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'New password must be at least 6 characters'; end if;
  select password_hash into v_hash from hub_credentials where user_id = app_uid();
  if v_hash <> extensions.crypt(p_old, v_hash) then raise exception 'Current password is incorrect'; end if;
  update hub_credentials set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
  where user_id = app_uid();
end $$;

create or replace function public.admin_create_user(
  p_username text, p_password text, p_display_name text,
  p_team_id uuid default null, p_role text default 'member',
  p_designation text default null, p_email text default null, p_phone text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_user hub_users;
begin
  if not app_is_admin() then raise exception 'Only admins can create users' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  insert into hub_users (username, display_name, team_id, role, designation, email, phone)
  values (lower(regexp_replace(trim(p_username), '\s+', '', 'g')), trim(p_display_name), p_team_id,
          coalesce(p_role, 'member'), p_designation, p_email, p_phone)
  returning * into v_user;
  insert into hub_credentials (user_id, password_hash)
  values (v_user.id, extensions.crypt(p_password, extensions.gen_salt('bf')));
  return row_to_json(v_user);
exception when unique_violation then
  raise exception 'Username "%" is already taken', p_username;
end $$;

create or replace function public.admin_set_password(p_user_id uuid, p_password text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_admin() then raise exception 'Only admins can reset passwords' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  insert into hub_credentials (user_id, password_hash)
  values (p_user_id, extensions.crypt(p_password, extensions.gen_salt('bf')))
  on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now();
  delete from hub_sessions where user_id = p_user_id;   -- force re-login
end $$;

-- ─────────────────────────── TRIGGERS ──────────────────────────────

create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.assigned_by := app_uid();
    new.created_at  := now();
  elsif not app_is_admin() then
    -- assignees may only move the status
    if (new.title, new.description, new.team_id, new.assigned_to, new.assigned_by,
        new.priority, new.start_date, new.due_date, new.created_at)
       is distinct from
       (old.title, old.description, old.team_id, old.assigned_to, old.assigned_by,
        old.priority, old.start_date, old.due_date, old.created_at) then
      raise exception 'Only an admin can edit task details. You can change the status.' using errcode = '42501';
    end if;
  end if;

  -- keep task team in sync with the assignee's team
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    new.team_id := coalesce((select team_id from hub_users where id = new.assigned_to), new.team_id);
  end if;

  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then new.completed_at := now(); end if;
  else
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tasks_before_write on public.hub_tasks;
create trigger tasks_before_write before insert or update on public.hub_tasks
for each row execute function public.tasks_before_write();

create or replace function public.leaves_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_admin boolean := app_is_admin();
begin
  if tg_op = 'INSERT' then
    if not v_admin or new.user_id is null then new.user_id := app_uid(); end if;
    if not v_admin then new.status := 'pending'; end if;
    new.reviewed_by := null; new.reviewed_at := null;
    if not v_admin then new.review_note := null; end if;

    if exists (select 1 from hub_leave_requests l
               where l.user_id = new.user_id and l.status in ('pending','approved')
                 and daterange(l.start_date, l.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
      raise exception 'There is already a leave request overlapping these dates';
    end if;
  else
    if not v_admin then
      if old.user_id <> app_uid() or old.status <> 'pending' or new.status <> 'cancelled'
         or (new.user_id, new.leave_type, new.start_date, new.end_date, new.half_day, new.reason, new.review_note)
            is distinct from
            (old.user_id, old.leave_type, old.start_date, old.end_date, old.half_day, old.reason, old.review_note) then
        raise exception 'You can only cancel your own pending request' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status in ('approved','rejected') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    new.reviewed_by := app_uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists leaves_before_write on public.hub_leave_requests;
create trigger leaves_before_write before insert or update on public.hub_leave_requests
for each row execute function public.leaves_before_write();

create or replace function public.set_user_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.user_id := app_uid(); new.created_at := now(); return new; end $$;

create or replace function public.set_created_by() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.created_by := app_uid(); new.created_at := now(); return new; end $$;

drop trigger if exists set_user_id on public.hub_messages;
create trigger set_user_id before insert on public.hub_messages for each row execute function public.set_user_id();
drop trigger if exists set_user_id on public.hub_task_comments;
create trigger set_user_id before insert on public.hub_task_comments for each row execute function public.set_user_id();
drop trigger if exists set_created_by on public.hub_calendar_events;
create trigger set_created_by before insert on public.hub_calendar_events for each row execute function public.set_created_by();
drop trigger if exists set_created_by on public.hub_announcements;
create trigger set_created_by before insert on public.hub_announcements for each row execute function public.set_created_by();

-- ───────────────────── ROW LEVEL SECURITY ──────────────────────────

alter table public.hub_teams            enable row level security;
alter table public.hub_users        enable row level security;
alter table public.hub_credentials enable row level security;
alter table public.hub_sessions         enable row level security;
alter table public.hub_tasks            enable row level security;
alter table public.hub_task_comments    enable row level security;
alter table public.hub_leave_requests   enable row level security;
alter table public.hub_calendar_events  enable row level security;
alter table public.hub_announcements    enable row level security;
alter table public.hub_messages         enable row level security;

-- teams: everyone logged in reads; admins write
drop policy if exists teams_read  on public.hub_teams;
drop policy if exists teams_write on public.hub_teams;
create policy teams_read  on public.hub_teams for select using ((select app_uid()) is not null);
create policy teams_write on public.hub_teams for all    using ((select app_is_admin())) with check ((select app_is_admin()));

-- users: everyone logged in reads the directory; admins update/delete (create via RPC)
drop policy if exists users_read   on public.hub_users;
drop policy if exists users_update on public.hub_users;
drop policy if exists users_delete on public.hub_users;
create policy users_read   on public.hub_users for select using ((select app_uid()) is not null);
create policy users_update on public.hub_users for update using ((select app_is_admin())) with check ((select app_is_admin()));
create policy users_delete on public.hub_users for delete using ((select app_is_admin()) and id <> (select app_uid()));

-- tasks: admin sees all; members see their team's tasks; assignee updates status
drop policy if exists tasks_read   on public.hub_tasks;
drop policy if exists tasks_insert on public.hub_tasks;
drop policy if exists tasks_update on public.hub_tasks;
drop policy if exists tasks_delete on public.hub_tasks;
create policy tasks_read on public.hub_tasks for select using (
  (select app_is_admin()) or assigned_to = (select app_uid()) or team_id = (select app_team()));
create policy tasks_insert on public.hub_tasks for insert with check ((select app_is_admin()));
create policy tasks_update on public.hub_tasks for update
  using ((select app_is_admin()) or assigned_to = (select app_uid()))
  with check ((select app_is_admin()) or assigned_to = (select app_uid()));
create policy tasks_delete on public.hub_tasks for delete using ((select app_is_admin()));

-- task comments: anyone who can see the task
drop policy if exists comments_read   on public.hub_task_comments;
drop policy if exists comments_insert on public.hub_task_comments;
drop policy if exists comments_delete on public.hub_task_comments;
create policy comments_read   on public.hub_task_comments for select using (exists (select 1 from public.hub_tasks t where t.id = task_id));
create policy comments_insert on public.hub_task_comments for insert with check (
  user_id = (select app_uid()) and exists (select 1 from public.hub_tasks t where t.id = task_id));
create policy comments_delete on public.hub_task_comments for delete using ((select app_is_admin()) or user_id = (select app_uid()));

-- leaves: own requests; teammates see approved leave; admin sees and approves all
drop policy if exists leaves_read   on public.hub_leave_requests;
drop policy if exists leaves_insert on public.hub_leave_requests;
drop policy if exists leaves_update on public.hub_leave_requests;
drop policy if exists leaves_delete on public.hub_leave_requests;
create policy leaves_read on public.hub_leave_requests for select using (
  (select app_is_admin()) or user_id = (select app_uid())
  or (status = 'approved' and user_id in (select id from public.hub_users where team_id = (select app_team()))));
create policy leaves_insert on public.hub_leave_requests for insert with check (
  (select app_is_admin()) or user_id = (select app_uid()));
create policy leaves_update on public.hub_leave_requests for update
  using ((select app_is_admin()) or (user_id = (select app_uid()) and status = 'pending'))
  with check ((select app_is_admin()) or user_id = (select app_uid()));
create policy leaves_delete on public.hub_leave_requests for delete using ((select app_is_admin()));

-- calendar events + announcements: company-wide or own team; admins write
drop policy if exists events_read  on public.hub_calendar_events;
drop policy if exists events_write on public.hub_calendar_events;
create policy events_read on public.hub_calendar_events for select using (
  (select app_uid()) is not null and (team_id is null or team_id = (select app_team()) or (select app_is_admin())));
create policy events_write on public.hub_calendar_events for all using ((select app_is_admin())) with check ((select app_is_admin()));

drop policy if exists ann_read  on public.hub_announcements;
drop policy if exists ann_write on public.hub_announcements;
create policy ann_read on public.hub_announcements for select using (
  (select app_uid()) is not null and (team_id is null or team_id = (select app_team()) or (select app_is_admin())));
create policy ann_write on public.hub_announcements for all using ((select app_is_admin())) with check ((select app_is_admin()));

-- chat: #general for all, team channel for its members; admins see every channel
drop policy if exists msg_read   on public.hub_messages;
drop policy if exists msg_insert on public.hub_messages;
drop policy if exists msg_delete on public.hub_messages;
create policy msg_read on public.hub_messages for select using (
  (select app_uid()) is not null and (team_id is null or team_id = (select app_team()) or (select app_is_admin())));
create policy msg_insert on public.hub_messages for insert with check (
  user_id = (select app_uid()) and (team_id is null or team_id = (select app_team()) or (select app_is_admin())));
create policy msg_delete on public.hub_messages for delete using ((select app_is_admin()) or user_id = (select app_uid()));

-- ─────────────────────────── GRANTS ────────────────────────────────

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.hub_teams, public.hub_tasks, public.hub_task_comments, public.hub_leave_requests,
  public.hub_calendar_events, public.hub_announcements, public.hub_messages
  to anon, authenticated;
grant select, update, delete on public.hub_users to anon, authenticated;
revoke insert on public.hub_users from anon, authenticated;
revoke all on public.hub_credentials, public.hub_sessions from anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on function
  public.login(text, text), public.logout(), public.me(), public.change_password(text, text),
  public.admin_create_user(text, text, text, uuid, text, text, text, text),
  public.admin_set_password(uuid, text)
  to anon, authenticated;

-- ─────────────────────────── SEED ──────────────────────────────────
-- First admin login:  admin / Admin@123   ← change it right after logging in

insert into public.hub_users (username, display_name, role, designation)
values ('admin', 'Administrator', 'admin', 'Administrator')
on conflict (username) do nothing;

insert into public.hub_credentials (user_id, password_hash)
select id, extensions.crypt('Admin@123', extensions.gen_salt('bf'))
from public.hub_users where username = 'admin'
on conflict (user_id) do nothing;
