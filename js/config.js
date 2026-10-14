/* ═══════════════════════════════════════════════════════
   config.js — edit these values for your installation
═══════════════════════════════════════════════════════ */

// Supabase → Project Settings → API
const SB_URL = 'https://qsnnoncjqvqpjkfbobcb.supabase.co';
const SB_KEY = 'sb_publishable_TGm4xC2knWAUTGqSSiib-Q_6fIzNx50';

const APP_NAME = 'TeamHub';

// Days that are not working days (0 = Sunday … 6 = Saturday).
// Used to count leave days. Example for a 5-day week: [0, 6]
const WEEKLY_OFF = [0];

// Leave types and yearly allowance (null = no limit, not tracked).
// Allowances are shown to staff as "used / allowed"; they are not hard limits.
const LEAVE_TYPES = {
  casual: { label: 'Casual leave', quota: 12 },
  sick:   { label: 'Sick leave',   quota: 10 },
  earned: { label: 'Earned leave', quota: 15 },
  unpaid: { label: 'Unpaid leave', quota: null },
  wfh:    { label: 'Work from home', quota: null },
};

// Colours offered when creating a team
const TEAM_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#2563eb', '#65a30d', '#0f766e'];