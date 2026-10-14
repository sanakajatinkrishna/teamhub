# TeamHub — internal team CRM

Plain HTML + JavaScript front end on a Supabase (Postgres) back end. No build step. Upload the folder to any static host, such as HostingRaja shared hosting.

## What it does

| Module | Admin | Team member |
|---|---|---|
| **Teams & people** | Creates teams at any time, adds people (username + password), moves them between teams, resets passwords, deactivates accounts | Browses the directory and sees who is on leave today |
| **Tasks** | Picks a **team, then a member of that team**, and assigns work with a priority, start date and due date. Gets a warning if the person has leave in that period. Board and list views, filters by team and member | Sees their own tasks and their team's tasks. Moves their own tasks between To do → In progress → In review → Done and comments on them |
| **Leaves** | Approves or rejects requests with a note, revokes an approval, records leave for someone, views all requests by team, member, status and year | Applies for leave (casual, sick, earned, unpaid, WFH, half day), sees how much of each allowance is used and left, cancels a request that is still pending, sees teammates' approved leave |
| **Calendar** | Adds holidays and events for everyone or for one team, imports a whole holiday list by pasting it, filters the month by team or member | Month view of holidays, events, teammates' leave and their own deadlines, plus a yearly holiday list |
| **Team chat** | Sees every channel | `#general` plus their own team's channel |
| **Announcements** | Posts to everyone or one team and pins important posts | Reads them, also shown on the dashboard |
| **Dashboard** | Pending approvals, open and overdue tasks per team, who is on leave | My tasks, deadlines, leave used, who is on leave, holidays |

## Setup (about 10 minutes)

1. **Create the database.** In Supabase, open **SQL Editor → New query**, paste all of `sql/schema.sql` and click **Run**. You can run it again safely.
2. **Connect the app.** In Supabase, open **Project Settings → API** and copy the Project URL and the publishable (anon) key into `js/config.js`:
   ```js
   const SB_URL = 'https://xxxx.supabase.co';
   const SB_KEY = 'sb_publishable_...';
   ```
   `config.js` is also where you set the weekly off days (`WEEKLY_OFF`), the leave types and yearly allowances (`LEAVE_TYPES`), and the app name.
3. **Upload** the whole folder (`index.html`, `app.html`, `css/`, `js/`) to your hosting, for example `public_html/teamhub/`.
4. **Sign in** as `admin` with the password `Admin@123`. **Change that password straight away** using the 🔑 button at the bottom of the sidebar.
5. Go to **Teams & people**, create your teams, then add people. Give each person their username and password yourself.

## How security works

- Passwords are stored as bcrypt hashes in `user_credentials`. The browser has no access to that table.
- `login()` checks the password inside the database and returns a random session token, valid for 30 days. Only a SHA-256 hash of the token is stored.
- The app sends the token on every request in an `x-session-token` header. Row Level Security reads it through `app_uid()`, so permissions are enforced by the database, not just by the screen. For example, a member cannot approve their own leave, edit task details, read another team's chat or make themselves admin, even by calling the API directly.
- Deactivating a user or resetting their password signs them out everywhere.

## Notes

- **Chat updates:** new messages show up immediately through Supabase Realtime broadcast. If Realtime is unavailable, the page checks for new messages every 5 seconds.
- **Leave day counting** skips the weekly off days and holidays. Allowances are shown to staff but not enforced, so admins can still approve leave beyond an allowance.
- **Deleting vs deactivating:** deleting a user removes their leave history and leaves their tasks unassigned. Unticking **Active** keeps all history.
- **Tables:** all prefixed `hub_`: hub_teams, hub_users, hub_credentials, hub_sessions, hub_tasks, hub_task_comments, hub_leave_requests, hub_calendar_events, hub_announcements, hub_messages. The prefix lets TeamHub share a Supabase project with other apps (for example an older `teams` / `app_users` issue tracker) without touching their tables.
