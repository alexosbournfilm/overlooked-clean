create extension if not exists pgcrypto;

create table if not exists public.user_lifetime_submission_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  first_submission_id uuid,
  first_uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.user_lifetime_submission_usage enable row level security;

drop policy if exists "Users can view own lifetime upload usage" on public.user_lifetime_submission_usage;
create policy "Users can view own lifetime upload usage"
  on public.user_lifetime_submission_usage
  for select
  using (user_id = auth.uid());

grant select on public.user_lifetime_submission_usage to authenticated;

insert into public.user_lifetime_submission_usage (
  user_id,
  first_submission_id,
  first_uploaded_at
)
select distinct on (s.user_id)
  s.user_id,
  s.id,
  coalesce(s.submitted_at, now())
from public.submissions s
where s.user_id is not null
order by s.user_id, coalesce(s.submitted_at, now()) asc
on conflict (user_id)
do update
set
  first_submission_id = coalesce(public.user_lifetime_submission_usage.first_submission_id, excluded.first_submission_id),
  first_uploaded_at = least(public.user_lifetime_submission_usage.first_uploaded_at, excluded.first_uploaded_at);

do $$
begin
  if to_regclass('public.user_submission_history') is not null then
    execute $sql$
      insert into public.user_lifetime_submission_usage (
        user_id,
        first_submission_id,
        first_uploaded_at
      )
      select distinct on (h.user_id)
        h.user_id,
        h.submission_id,
        coalesce(h.created_at, now())
      from public.user_submission_history h
      where h.user_id is not null
      order by h.user_id, coalesce(h.created_at, now()) asc
      on conflict (user_id)
      do update
      set
        first_submission_id = coalesce(public.user_lifetime_submission_usage.first_submission_id, excluded.first_submission_id),
        first_uploaded_at = least(public.user_lifetime_submission_usage.first_uploaded_at, excluded.first_uploaded_at)
    $sql$;
  end if;
end;
$$;

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
      from public.user_lifetime_submission_usage ulu
      where ulu.user_id = p_user_id
    )
    and not exists (
      select 1
      from public.user_submission_history h
      where h.user_id = p_user_id
    )
    and not exists (
      select 1
      from public.submissions s
      where s.user_id = p_user_id
    );
end;
$$;

grant execute on function public.can_insert_lifetime_submission(uuid) to authenticated;

create or replace function public.get_lifetime_submission_limit_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  user_tier text;
  has_used_upload boolean;
begin
  if p_user_id is null or auth.uid() is distinct from p_user_id then
    return jsonb_build_object(
      'allowed', false,
      'tier', 'free',
      'used', 1,
      'remaining', 0,
      'reason', 'not_logged_in'
    );
  end if;

  select lower(coalesce(u.tier::text, 'free'))
  into user_tier
  from public.users u
  where u.id = p_user_id;

  user_tier := coalesce(user_tier, 'free');

  has_used_upload := exists (
      select 1
      from public.user_lifetime_submission_usage ulu
      where ulu.user_id = p_user_id
    )
    or exists (
      select 1
      from public.user_submission_history h
      where h.user_id = p_user_id
    )
    or exists (
      select 1
      from public.submissions s
      where s.user_id = p_user_id
    );

  if user_tier = 'pro' then
    return jsonb_build_object(
      'allowed', true,
      'tier', 'pro',
      'used', case when has_used_upload then 1 else 0 end,
      'remaining', 999999,
      'reason', null
    );
  end if;

  return jsonb_build_object(
    'allowed', not has_used_upload,
    'tier', 'free',
    'used', case when has_used_upload then 1 else 0 end,
    'remaining', case when has_used_upload then 0 else 1 end,
    'reason', case when has_used_upload then 'no_free_uploads_left' else null end
  );
end;
$$;

grant execute on function public.get_lifetime_submission_limit_status(uuid) to authenticated;

create or replace function public.record_lifetime_submission_usage_from_row(
  p_user_id uuid,
  p_submission_id uuid,
  p_uploaded_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.user_lifetime_submission_usage (
    user_id,
    first_submission_id,
    first_uploaded_at
  )
  values (
    p_user_id,
    p_submission_id,
    coalesce(p_uploaded_at, now())
  )
  on conflict (user_id)
  do update
  set
    first_submission_id = coalesce(public.user_lifetime_submission_usage.first_submission_id, excluded.first_submission_id),
    first_uploaded_at = least(public.user_lifetime_submission_usage.first_uploaded_at, excluded.first_uploaded_at);
end;
$$;

create or replace function public.enforce_lifetime_free_submission_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_tier text;
  inserted_marker_id uuid;
begin
  if new.user_id is null then
    return new;
  end if;

  select lower(coalesce(u.tier::text, 'free'))
  into user_tier
  from public.users u
  where u.id = new.user_id;

  if user_tier = 'pro' then
    perform public.record_lifetime_submission_usage_from_row(
      new.user_id,
      new.id,
      coalesce(new.submitted_at, now())
    );

    return new;
  end if;

  insert into public.user_lifetime_submission_usage (
    user_id,
    first_submission_id,
    first_uploaded_at
  )
  values (
    new.user_id,
    new.id,
    coalesce(new.submitted_at, now())
  )
  on conflict (user_id) do nothing
  returning id into inserted_marker_id;

  if inserted_marker_id is null then
    raise exception 'FREE_LIFETIME_UPLOAD_USED: Free accounts include one lifetime film upload. Upgrade to Pro to upload more films.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists submissions_enforce_lifetime_free_upload on public.submissions;
create trigger submissions_enforce_lifetime_free_upload
  before insert on public.submissions
  for each row
  execute function public.enforce_lifetime_free_submission_upload();

create or replace function public.record_lifetime_submission_usage_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_lifetime_submission_usage_from_row(
    old.user_id,
    old.id,
    coalesce(old.submitted_at, now())
  );

  return old;
end;
$$;

drop trigger if exists submissions_record_lifetime_usage_before_delete on public.submissions;
create trigger submissions_record_lifetime_usage_before_delete
  before delete on public.submissions
  for each row
  execute function public.record_lifetime_submission_usage_before_delete();

create or replace function public.record_lifetime_submission_usage_before_remove()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_lifetime_submission_usage_from_row(
    new.user_id,
    new.id,
    coalesce(new.submitted_at, now())
  );

  return new;
end;
$$;

drop trigger if exists submissions_record_lifetime_usage_before_remove on public.submissions;
create trigger submissions_record_lifetime_usage_before_remove
  before update of is_removed on public.submissions
  for each row
  when (new.is_removed is true and coalesce(old.is_removed, false) is false)
  execute function public.record_lifetime_submission_usage_before_remove();
