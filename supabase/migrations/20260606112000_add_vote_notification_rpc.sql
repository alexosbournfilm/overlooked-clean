create or replace function public.notify_submission_vote(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  target_submission record;
  target_preferences jsonb := '{}'::jsonb;
  actor_name text := 'Someone';
begin
  if actor_id is null or target_submission_id is null then
    return;
  end if;

  select s.id, s.title, s.user_id
  into target_submission
  from public.submissions s
  where s.id = target_submission_id;

  if not found then
    return;
  end if;

  if target_submission.user_id is null or target_submission.user_id = actor_id then
    return;
  end if;

  if not exists (
    select 1
    from public.user_votes uv
    where uv.submission_id = target_submission_id
      and uv.user_id = actor_id
  ) then
    return;
  end if;

  select coalesce(u.notification_preferences, '{}'::jsonb)
  into target_preferences
  from public.users u
  where u.id = target_submission.user_id;

  if target_preferences->>'submission_votes' = 'false' then
    return;
  end if;

  select coalesce(nullif(trim(u.full_name), ''), 'Someone')
  into actor_name
  from public.users u
  where u.id = actor_id;

  if exists (
    select 1
    from public.app_notifications n
    where n.user_id = target_submission.user_id
      and n.notification_type = 'submission_votes'
      and n.data->>'submissionId' = target_submission_id::text
      and n.data->>'voterId' = actor_id::text
  ) then
    return;
  end if;

  insert into public.app_notifications (
    user_id,
    title,
    body,
    notification_type,
    data
  )
  values (
    target_submission.user_id,
    'Your film received a vote',
    coalesce(nullif(trim(target_submission.title), ''), 'Someone voted for your submission'),
    'submission_votes',
    jsonb_build_object(
      'screen', 'Featured',
      'params', jsonb_build_object(
        'openSubmissionId', target_submission_id,
        'openSearchNonce', floor(extract(epoch from clock_timestamp()) * 1000)
      ),
      'notificationType', 'activity',
      'preferenceKey', 'submission_votes',
      'submissionId', target_submission_id,
      'voterId', actor_id,
      'voterName', actor_name
    )
  );
end;
$$;

revoke all on function public.notify_submission_vote(uuid) from public;
grant execute on function public.notify_submission_vote(uuid) to authenticated;
