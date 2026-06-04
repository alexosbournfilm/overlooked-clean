alter table public.submissions
  add column if not exists collaborator_credits jsonb not null default '[]'::jsonb;
