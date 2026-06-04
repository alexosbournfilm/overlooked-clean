alter table public.submissions
  add column if not exists hidden_on_profile boolean not null default false;

create index if not exists submissions_visible_profile_idx
  on public.submissions (user_id, submitted_at desc)
  where hidden_on_profile = false;
