create extension if not exists pgcrypto;

alter table public.users
  add column if not exists is_creator boolean not null default false,
  add column if not exists creator_approved_at timestamptz,
  add column if not exists creator_code text unique,
  add column if not exists creator_social_platform text,
  add column if not exists creator_social_url text;

create table if not exists public.creator_challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  challenge_code text not null unique,
  category text,
  description text,
  rules text,
  required_phrase text,
  submission_type text not null default 'youtube',
  prize_description text,
  reaction_platform text,
  reaction_url text,
  reaction_description text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active',
  submission_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_challenges_status_check
    check (status in ('draft', 'active', 'ended', 'archived'))
);

alter table public.submissions
  add column if not exists creator_challenge_id uuid references public.creator_challenges(id) on delete set null,
  add column if not exists challenge_code text,
  add column if not exists submission_source text not null default 'monthly_challenge',
  add column if not exists creator_id uuid references public.users(id) on delete set null;

create index if not exists users_creator_code_idx
  on public.users (creator_code)
  where creator_code is not null;

create index if not exists creator_challenges_creator_id_idx
  on public.creator_challenges (creator_id);

create index if not exists creator_challenges_status_ends_at_idx
  on public.creator_challenges (status, ends_at);

create index if not exists creator_challenges_code_idx
  on public.creator_challenges (challenge_code);

create index if not exists submissions_creator_challenge_id_idx
  on public.submissions (creator_challenge_id);

create index if not exists submissions_challenge_code_idx
  on public.submissions (challenge_code)
  where challenge_code is not null;

create index if not exists submissions_creator_id_idx
  on public.submissions (creator_id)
  where creator_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists creator_challenges_set_updated_at on public.creator_challenges;
create trigger creator_challenges_set_updated_at
  before update on public.creator_challenges
  for each row
  execute function public.set_updated_at();

create or replace function public.refresh_creator_challenge_submission_count(challenge_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.creator_challenges cc
  set submission_count = (
    select count(*)::integer
    from public.submissions s
    where s.creator_challenge_id = challenge_id
      and coalesce(s.is_removed, false) = false
  )
  where cc.id = challenge_id;
$$;

create or replace function public.sync_creator_challenge_submission_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.creator_challenge_id is not null then
      perform public.refresh_creator_challenge_submission_count(new.creator_challenge_id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.creator_challenge_id is distinct from new.creator_challenge_id then
      if old.creator_challenge_id is not null then
        perform public.refresh_creator_challenge_submission_count(old.creator_challenge_id);
      end if;
      if new.creator_challenge_id is not null then
        perform public.refresh_creator_challenge_submission_count(new.creator_challenge_id);
      end if;
    elsif new.creator_challenge_id is not null and old.is_removed is distinct from new.is_removed then
      perform public.refresh_creator_challenge_submission_count(new.creator_challenge_id);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.creator_challenge_id is not null then
      perform public.refresh_creator_challenge_submission_count(old.creator_challenge_id);
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists submissions_sync_creator_challenge_count on public.submissions;
create trigger submissions_sync_creator_challenge_count
  after insert or update of creator_challenge_id, is_removed or delete on public.submissions
  for each row
  execute function public.sync_creator_challenge_submission_count();

alter table public.creator_challenges enable row level security;

drop policy if exists "Creator challenges are viewable" on public.creator_challenges;
create policy "Creator challenges are viewable"
  on public.creator_challenges
  for select
  using (
    status in ('active', 'ended')
    or creator_id = auth.uid()
  );

drop policy if exists "Approved creators can create challenges" on public.creator_challenges;
create policy "Approved creators can create challenges"
  on public.creator_challenges
  for insert
  with check (
    creator_id = auth.uid()
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.is_creator = true
    )
  );

drop policy if exists "Creators can update their challenges" on public.creator_challenges;
create policy "Creators can update their challenges"
  on public.creator_challenges
  for update
  using (
    creator_id = auth.uid()
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.is_creator = true
    )
  )
  with check (
    creator_id = auth.uid()
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.is_creator = true
    )
  );

grant select on public.creator_challenges to anon, authenticated;
grant insert, update on public.creator_challenges to authenticated;
grant execute on function public.refresh_creator_challenge_submission_count(uuid) to authenticated;
