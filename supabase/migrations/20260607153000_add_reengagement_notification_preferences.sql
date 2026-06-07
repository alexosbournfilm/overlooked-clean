alter table public.users
  alter column notification_preferences set default '{
    "direct_messages": true,
    "group_messages": true,
    "new_supporters": true,
    "followed_submissions": true,
    "submission_comments": true,
    "submission_votes": true,
    "city_jobs": true,
    "city_creatives": true,
    "job_applications": true,
    "comment_replies": true,
    "challenge_reminders": true,
    "challenge_results": true,
    "reengagement_reminders": true
  }'::jsonb;

update public.users
set notification_preferences =
  coalesce(notification_preferences, '{}'::jsonb) ||
  '{"reengagement_reminders": true}'::jsonb
where not coalesce(notification_preferences, '{}'::jsonb) ? 'reengagement_reminders';

do $$
begin
  if to_regclass('public.workshop_progress') is not null then
    alter table public.workshop_progress
      add column if not exists created_at timestamptz not null default now();

    create index if not exists workshop_progress_user_created_idx
      on public.workshop_progress (user_id, created_at desc);
  end if;
end $$;
