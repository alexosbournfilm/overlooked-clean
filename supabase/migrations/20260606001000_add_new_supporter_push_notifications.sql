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
    "challenge_results": true
  }'::jsonb;

update public.users
set notification_preferences =
  coalesce(notification_preferences, '{}'::jsonb) ||
  '{"new_supporters": true}'::jsonb
where not coalesce(notification_preferences, '{}'::jsonb) ? 'new_supporters';

do $$
begin
  if to_regclass('public.user_supports') is not null then
    drop trigger if exists user_supports_send_activity_push on public.user_supports;
    create trigger user_supports_send_activity_push
      after insert on public.user_supports
      for each row execute function private.handle_activity_push();
  end if;
end;
$$;
