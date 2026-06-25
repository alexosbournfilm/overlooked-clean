alter table public.users
  add column if not exists ai_policy_accepted_at timestamptz,
  add column if not exists ai_policy_version text;
