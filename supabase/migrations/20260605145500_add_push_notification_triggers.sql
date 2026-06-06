create extension if not exists pg_net with schema extensions;

create schema if not exists private;

create or replace function private.invoke_push_edge_function(
  function_name text,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  project_url text := 'https://sdatmuzzsebvckfmnqsv.supabase.co';
  request_id bigint;
begin
  select net.http_post(
    url := project_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := payload,
    timeout_milliseconds := 5000
  )
  into request_id;
exception
  when others then
    raise warning 'Push notification webhook failed for %: %', function_name, sqlerrm;
end;
$$;

create or replace function private.handle_message_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
begin
  perform private.invoke_push_edge_function(
    'send-chat-push',
    jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

create or replace function private.handle_activity_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
begin
  perform private.invoke_push_edge_function(
    'send-activity-push',
    jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    )
  );

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.messages') is not null then
    drop trigger if exists messages_send_push on public.messages;
    create trigger messages_send_push
      after insert on public.messages
      for each row execute function private.handle_message_push();
  end if;

  if to_regclass('public.submissions') is not null then
    drop trigger if exists submissions_send_activity_push on public.submissions;
    create trigger submissions_send_activity_push
      after insert on public.submissions
      for each row execute function private.handle_activity_push();
  end if;

  if to_regclass('public.submission_comments') is not null then
    drop trigger if exists submission_comments_send_activity_push on public.submission_comments;
    create trigger submission_comments_send_activity_push
      after insert on public.submission_comments
      for each row execute function private.handle_activity_push();
  end if;

  if to_regclass('public.user_votes') is not null then
    drop trigger if exists user_votes_send_activity_push on public.user_votes;
    create trigger user_votes_send_activity_push
      after insert on public.user_votes
      for each row execute function private.handle_activity_push();
  end if;

  if to_regclass('public.jobs') is not null then
    drop trigger if exists jobs_send_activity_push on public.jobs;
    create trigger jobs_send_activity_push
      after insert on public.jobs
      for each row execute function private.handle_activity_push();
  end if;

  if to_regclass('public.applications') is not null then
    drop trigger if exists applications_send_activity_push on public.applications;
    create trigger applications_send_activity_push
      after insert on public.applications
      for each row execute function private.handle_activity_push();
  end if;

  if to_regclass('public.users') is not null then
    drop trigger if exists users_send_activity_push on public.users;
    create trigger users_send_activity_push
      after insert on public.users
      for each row execute function private.handle_activity_push();
  end if;

  if to_regclass('public.monthly_challenges') is not null then
    drop trigger if exists monthly_challenges_send_activity_push on public.monthly_challenges;
    create trigger monthly_challenges_send_activity_push
      after insert or update of winner_submission_id on public.monthly_challenges
      for each row execute function private.handle_activity_push();
  end if;
end;
$$;
