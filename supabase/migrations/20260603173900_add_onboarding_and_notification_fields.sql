alter table public.users
  add column if not exists side_roles text[],
  add column if not exists portfolio_url text,
  add column if not exists youtube_url text,
  add column if not exists joining_reasons text[] not null default '{}',
  add column if not exists creative_goals text[] not null default '{}',
  add column if not exists expo_push_token text,
  add column if not exists push_token_updated_at timestamptz,
  add column if not exists notification_preferences jsonb not null default '{
    "direct_messages": true,
    "group_messages": true,
    "followed_submissions": true,
    "submission_comments": true,
    "submission_votes": true,
    "city_jobs": true,
    "city_creatives": true,
    "job_applications": true,
    "comment_replies": true,
    "challenge_reminders": true,
    "challenge_results": true
  }'::jsonb;

create index if not exists users_expo_push_token_idx
  on public.users (expo_push_token)
  where expo_push_token is not null;

create index if not exists users_city_push_idx
  on public.users (city_id)
  where expo_push_token is not null;
