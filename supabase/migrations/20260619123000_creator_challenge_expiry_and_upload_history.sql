create extension if not exists pgcrypto;

create table if not exists public.user_submission_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  submission_id uuid,
  submission_source text,
  category text,
  created_at timestamptz not null default now()
);

create unique index if not exists user_submission_history_submission_id_idx
  on public.user_submission_history (submission_id);

create index if not exists user_submission_history_user_id_idx
  on public.user_submission_history (user_id, created_at);

alter table public.user_submission_history enable row level security;

drop policy if exists "Users can view own submission history" on public.user_submission_history;
create policy "Users can view own submission history"
  on public.user_submission_history
  for select
  using (user_id = auth.uid());

grant select on public.user_submission_history to authenticated;

create or replace function public.record_user_submission_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    return new;
  end if;

  insert into public.user_submission_history (
    user_id,
    submission_id,
    submission_source,
    category,
    created_at
  )
  values (
    new.user_id,
    new.id,
    new.submission_source,
    new.category,
    coalesce(new.submitted_at, now())
  )
  on conflict (submission_id)
  do update
  set
    user_id = excluded.user_id,
    submission_source = excluded.submission_source,
    category = excluded.category;

  return new;
end;
$$;

drop trigger if exists submissions_record_user_submission_history on public.submissions;
create trigger submissions_record_user_submission_history
  after insert on public.submissions
  for each row
  execute function public.record_user_submission_history();

insert into public.user_submission_history (
  user_id,
  submission_id,
  submission_source,
  category,
  created_at
)
select
  s.user_id,
  s.id,
  s.submission_source,
  s.category,
  coalesce(s.submitted_at, now())
from public.submissions s
where s.user_id is not null
on conflict (submission_id)
do update
set
  user_id = excluded.user_id,
  submission_source = excluded.submission_source,
  category = excluded.category;

create or replace function public.can_insert_lifetime_submission(p_user_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  user_tier text;
begin
  if p_user_id is null or auth.uid() is distinct from p_user_id then
    return false;
  end if;

  select lower(coalesce(u.tier::text, 'free'))
  into user_tier
  from public.users u
  where u.id = p_user_id;

  if user_tier = 'pro' then
    return true;
  end if;

  return not exists (
    select 1
    from public.user_submission_history h
    where h.user_id = p_user_id
  );
end;
$$;

grant execute on function public.can_insert_lifetime_submission(uuid) to authenticated;

create or replace function public.refresh_creator_challenge_submission_count(challenge_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.creator_challenges cc
  set submission_count = (
    select count(distinct s.id)::integer
    from public.submissions s
    where (
        s.creator_challenge_id = cc.id
        or (
          s.creator_challenge_id is null
          and s.challenge_code is not null
          and s.challenge_code = cc.challenge_code
        )
      )
      and coalesce(s.is_removed, false) = false
  )
  where cc.id = challenge_id;
$$;

grant execute on function public.refresh_creator_challenge_submission_count(uuid) to authenticated;

do $$
declare
  challenge record;
begin
  for challenge in select id from public.creator_challenges loop
    perform public.refresh_creator_challenge_submission_count(challenge.id);
  end loop;
end;
$$;

create or replace function public.enforce_creator_challenge_max_duration()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  max_duration constant interval := interval '10 days';
begin
  if new.starts_at is null then
    new.starts_at := now();
  end if;

  if new.ends_at is null then
    new.ends_at := new.starts_at + max_duration;
  end if;

  if new.ends_at <= new.starts_at then
    raise exception 'Creator challenge deadline must be after the start time.';
  end if;

  if new.ends_at > new.starts_at + max_duration then
    raise exception 'Creator challenges can run for up to 10 days.';
  end if;

  return new;
end;
$$;

drop trigger if exists creator_challenges_enforce_max_duration on public.creator_challenges;
create trigger creator_challenges_enforce_max_duration
  before insert or update of starts_at, ends_at on public.creator_challenges
  for each row
  execute function public.enforce_creator_challenge_max_duration();

create or replace function public.delete_expired_creator_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.creator_challenges
  where coalesce(ends_at, created_at + interval '10 days') <= now()
    or created_at <= now() - interval '10 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.delete_expired_creator_challenges() to anon, authenticated;

drop policy if exists "Creators can delete their challenges" on public.creator_challenges;
create policy "Creators can delete their challenges"
  on public.creator_challenges
  for delete
  using (
    creator_id = auth.uid()
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.is_creator = true
    )
  );

grant delete on public.creator_challenges to authenticated;
