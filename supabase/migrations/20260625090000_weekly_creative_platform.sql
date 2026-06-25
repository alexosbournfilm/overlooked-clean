create extension if not exists pgcrypto;

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

alter table public.users
  add column if not exists current_creative_streak integer not null default 0,
  add column if not exists best_creative_streak integer not null default 0,
  add column if not exists active_creative_weeks integer not null default 0,
  add column if not exists creative_momentum_score integer not null default 0,
  add column if not exists creative_momentum_level text not null default 'Getting Started',
  add column if not exists last_creative_action_at timestamptz,
  add column if not exists is_founding_creator boolean not null default false,
  add column if not exists founding_creator_at timestamptz,
  add column if not exists creator_commission_cents integer not null default 200,
  add column if not exists creator_discount_cents integer not null default 499;

create table if not exists public.weekly_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  challenge_type text not null,
  brief text not null,
  instructions text,
  as_if text,
  monologue text,
  theme_word text,
  runtime_limit_seconds integer not null default 60,
  submission_rules jsonb not null default '{}'::jsonb,
  submission_format text not null default 'video',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  voting_ends_at timestamptz not null,
  status text not null default 'live',
  submission_count integer not null default 0,
  vote_count integer not null default 0,
  winner_submission_id uuid references public.submissions(id) on delete set null,
  winner_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_challenges_type_check
    check (challenge_type in ('acting', 'short_film')),
  constraint weekly_challenges_status_check
    check (status in ('draft', 'live', 'voting', 'complete', 'archived')),
  constraint weekly_challenges_dates_check
    check (starts_at < ends_at and ends_at <= voting_ends_at)
);

drop index if exists public.weekly_challenges_starts_at_idx;
create unique index if not exists weekly_challenges_starts_at_type_idx
  on public.weekly_challenges (starts_at, challenge_type);

create index if not exists weekly_challenges_status_dates_idx
  on public.weekly_challenges (status, starts_at, ends_at);

drop trigger if exists weekly_challenges_set_updated_at on public.weekly_challenges;
create trigger weekly_challenges_set_updated_at
  before update on public.weekly_challenges
  for each row
  execute function public.set_updated_at();

alter table public.submissions
  add column if not exists weekly_challenge_id uuid references public.weekly_challenges(id) on delete set null,
  add column if not exists creator_challenge_status text not null default 'submitted',
  add column if not exists creator_challenge_status_updated_at timestamptz,
  add column if not exists viewed_by_creator_at timestamptz,
  add column if not exists shortlisted_at timestamptz,
  add column if not exists rank_snapshot integer,
  add column if not exists top_10_at timestamptz;

alter table public.submissions
  alter column submission_source set default 'weekly_challenge';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_creator_challenge_status_check'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_creator_challenge_status_check
      check (
        creator_challenge_status in (
          'submitted',
          'viewed_by_creator',
          'shortlisted',
          'creator_pick',
          'top_10',
          'winner'
        )
      );
  end if;
end;
$$;

create index if not exists submissions_weekly_challenge_id_idx
  on public.submissions (weekly_challenge_id);

create index if not exists submissions_creator_challenge_status_idx
  on public.submissions (creator_challenge_id, creator_challenge_status);

alter table public.creator_challenges
  add column if not exists reward_type text,
  add column if not exists reward_description text,
  add column if not exists selection_method text not null default 'votes',
  add column if not exists promo_code text,
  add column if not exists winner_submission_id uuid references public.submissions(id) on delete set null,
  add column if not exists winner_user_id uuid references public.users(id) on delete set null,
  add column if not exists creator_pick_submission_id uuid references public.submissions(id) on delete set null;

create table if not exists public.daily_creative_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_date date not null unique,
  category text not null,
  prompt text not null,
  points integer not null default 5,
  created_at timestamptz not null default now()
);

create table if not exists public.creative_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null,
  action_date date not null default current_date,
  source_type text,
  source_id uuid,
  points integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists creative_actions_user_date_idx
  on public.creative_actions (user_id, action_date desc, created_at desc);

create index if not exists creative_actions_type_date_idx
  on public.creative_actions (action_type, action_date desc);

create unique index if not exists creative_actions_user_source_once_idx
  on public.creative_actions (user_id, action_type, source_id)
  where source_id is not null;

create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  badge_key text not null,
  badge_label text not null,
  source_type text,
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  awarded_at timestamptz not null default now()
);

create index if not exists user_badges_user_awarded_idx
  on public.user_badges (user_id, awarded_at desc);

create unique index if not exists user_badges_user_key_source_idx
  on public.user_badges (user_id, badge_key, source_id)
  where source_id is not null;

create unique index if not exists user_badges_user_key_once_idx
  on public.user_badges (user_id, badge_key)
  where source_id is null;

create table if not exists public.creator_promo_codes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users(id) on delete cascade,
  code text not null unique,
  first_month_price_cents integer not null default 499,
  normal_price_cents integer not null default 999,
  recurring_commission_cents integer not null default 200,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists creator_promo_codes_set_updated_at on public.creator_promo_codes;
create trigger creator_promo_codes_set_updated_at
  before update on public.creator_promo_codes
  for each row
  execute function public.set_updated_at();

create table if not exists public.creator_referrals (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  promo_code_id uuid references public.creator_promo_codes(id) on delete set null,
  subscription_status text not null default 'active',
  commission_cents integer not null default 200,
  started_at timestamptz not null default now(),
  last_commission_at timestamptz,
  unique (referred_user_id)
);

create table if not exists public.live_activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  event_type text not null,
  city_id bigint,
  submission_id uuid references public.submissions(id) on delete set null,
  weekly_challenge_id uuid references public.weekly_challenges(id) on delete set null,
  creator_challenge_id uuid references public.creator_challenges(id) on delete set null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists live_activity_events_created_idx
  on public.live_activity_events (created_at desc);

create index if not exists live_activity_events_city_created_idx
  on public.live_activity_events (city_id, created_at desc);

create table if not exists public.submission_creator_status_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  creator_id uuid not null references public.users(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists submission_creator_status_events_submission_idx
  on public.submission_creator_status_events (submission_id, created_at desc);

create or replace function public.week_start_utc(p_at timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select date_trunc('week', p_at at time zone 'UTC') at time zone 'UTC';
$$;

create or replace function public.creative_momentum_level(p_score integer)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_score, 0) >= 1200 then 'Elite Momentum'
    when coalesce(p_score, 0) >= 800 then 'Serious Creator'
    when coalesce(p_score, 0) >= 500 then 'Rising Talent'
    when coalesce(p_score, 0) >= 260 then 'Consistent Creative'
    when coalesce(p_score, 0) >= 100 then 'Building Rhythm'
    else 'Getting Started'
  end;
$$;

create or replace function public.refresh_creative_consistency(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := current_date;
  week_start date := date_trunc('week', current_date::timestamp)::date;
  latest_action_date date;
  cursor_day date;
  action_day date;
  previous_day date;
  running_streak integer := 0;
  current_streak integer := 0;
  best_streak integer := 0;
  weekly_actions integer := 0;
  challenges_entered integer := 0;
  submissions_made integer := 0;
  active_weeks integer := 0;
  score integer := 0;
  level_name text := 'Getting Started';
  week_calendar jsonb := '[]'::jsonb;
  recent_actions jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    return '{}'::jsonb;
  end if;

  select max(action_date)
  into latest_action_date
  from public.creative_actions
  where user_id = p_user_id;

  if latest_action_date is not null and latest_action_date >= today - 1 then
    cursor_day := latest_action_date;

    loop
      exit when not exists (
        select 1
        from public.creative_actions
        where user_id = p_user_id
          and action_date = cursor_day
      );

      current_streak := current_streak + 1;
      cursor_day := cursor_day - 1;
    end loop;
  end if;

  for action_day in
    select distinct action_date
    from public.creative_actions
    where user_id = p_user_id
    order by action_date
  loop
    if previous_day is null or action_day = previous_day + 1 then
      running_streak := running_streak + 1;
    else
      running_streak := 1;
    end if;

    best_streak := greatest(best_streak, running_streak);
    previous_day := action_day;
  end loop;

  select
    count(*)::integer,
    coalesce(sum(points), 0)::integer
  into weekly_actions, score
  from public.creative_actions
  where user_id = p_user_id
    and action_date >= week_start
    and action_date < week_start + 7;

  select count(*)::integer
  into challenges_entered
  from public.creative_actions
  where user_id = p_user_id
    and action_type in ('weekly_challenge_submission', 'creator_challenge_submission');

  select count(*)::integer
  into submissions_made
  from public.creative_actions
  where user_id = p_user_id
    and action_type in (
      'weekly_challenge_submission',
      'creator_challenge_submission',
      'upload_monologue',
      'upload_short_film',
      'portfolio_updated'
    );

  select count(distinct date_trunc('week', action_date::timestamp))::integer
  into active_weeks
  from public.creative_actions
  where user_id = p_user_id;

  select coalesce(sum(points), 0)::integer
  into score
  from public.creative_actions
  where user_id = p_user_id;

  level_name := public.creative_momentum_level(score);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', d::date,
        'label', to_char(d, 'Dy'),
        'active', exists (
          select 1
          from public.creative_actions ca
          where ca.user_id = p_user_id
            and ca.action_date = d::date
        ),
        'actions', coalesce((
          select jsonb_agg(ca.action_type order by ca.created_at)
          from public.creative_actions ca
          where ca.user_id = p_user_id
            and ca.action_date = d::date
        ), '[]'::jsonb)
      )
      order by d
    ),
    '[]'::jsonb
  )
  into week_calendar
  from generate_series(week_start, week_start + 6, interval '1 day') d;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'action_type', action_type,
        'action_date', action_date,
        'points', points,
        'source_type', source_type,
        'source_id', source_id,
        'created_at', created_at,
        'metadata', metadata
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into recent_actions
  from (
    select *
    from public.creative_actions
    where user_id = p_user_id
    order by created_at desc
    limit 8
  ) recent;

  update public.users
  set
    current_creative_streak = current_streak,
    best_creative_streak = greatest(best_creative_streak, best_streak),
    active_creative_weeks = active_weeks,
    creative_momentum_score = score,
    creative_momentum_level = level_name,
    last_creative_action_at = (
      select max(created_at)
      from public.creative_actions
      where user_id = p_user_id
    )
  where id = p_user_id;

  return jsonb_build_object(
    'current_streak', current_streak,
    'best_streak', greatest(best_streak, (
      select coalesce(best_creative_streak, 0)
      from public.users
      where id = p_user_id
    )),
    'weekly_goal', 5,
    'weekly_actions', weekly_actions,
    'challenges_entered', challenges_entered,
    'submissions_made', submissions_made,
    'active_weeks', active_weeks,
    'momentum_score', score,
    'momentum_level', level_name,
    'week_calendar', week_calendar,
    'recent_actions', recent_actions
  );
end;
$$;

create or replace function public.record_creative_action(
  p_user_id uuid,
  p_action_type text,
  p_source_type text default null,
  p_source_id uuid default null,
  p_points integer default 0,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_action_type is null or btrim(p_action_type) = '' then
    return '{}'::jsonb;
  end if;

  if p_source_id is null then
    insert into public.creative_actions (
      user_id,
      action_type,
      source_type,
      source_id,
      points,
      metadata
    )
    values (
      p_user_id,
      p_action_type,
      p_source_type,
      p_source_id,
      greatest(coalesce(p_points, 0), 0),
      coalesce(p_metadata, '{}'::jsonb)
    );
  else
    insert into public.creative_actions (
      user_id,
      action_type,
      source_type,
      source_id,
      points,
      metadata
    )
    values (
      p_user_id,
      p_action_type,
      p_source_type,
      p_source_id,
      greatest(coalesce(p_points, 0), 0),
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (user_id, action_type, source_id)
    where source_id is not null
    do update
      set metadata = excluded.metadata;
  end if;

  return public.refresh_creative_consistency(p_user_id);
end;
$$;

create or replace function public.create_weekly_challenges_if_missing(p_weeks_ahead integer default 4)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  inserted_count integer := 0;
  start_at timestamptz;
  end_at timestamptz;
  voting_end timestamptz;
  week_number integer;
  prompt_index integer;
  challenge_type text;
  title text;
  brief text;
  instructions text;
  as_if text;
  monologue text;
  theme_word text;
  rules jsonb;
  inserted_challenge_id uuid;
begin
  for i in 0..greatest(coalesce(p_weeks_ahead, 4), 0) loop
    start_at := public.week_start_utc(now()) + (i || ' weeks')::interval;
    end_at := start_at + interval '6 days 23 hours 59 minutes 59 seconds';
    voting_end := end_at + interval '12 hours';
    week_number := floor(extract(epoch from start_at) / 604800)::integer;
    prompt_index := abs(week_number) % 4;

    foreach challenge_type in array array['acting', 'short_film']::text[] loop
    if challenge_type = 'acting' then
      if prompt_index = 0 then
        title := 'The Last Message';
        brief := 'Perform a monologue as if this is the final message you never had the courage to send.';
        as_if := 'As if you are finally saying the thing you should have said before it was too late.';
        monologue := 'I kept rewriting this because the truth looked different every time. But it was always the same truth. I was scared. Not of you. Of what my life would become if I said it out loud and nothing changed.';
        theme_word := 'Goodbye';
      elsif prompt_index = 1 then
        title := 'Do Not Leave';
        brief := 'Perform a one-take monologue where you are trying to stop someone from walking away.';
        as_if := 'As if you are pretending to stay calm while your world falls apart.';
        monologue := 'Wait. Just give me one minute where neither of us performs being fine. If you leave now, you get to keep the version where I never tried. I need you to know I am trying.';
        theme_word := 'Stay';
      elsif prompt_index = 2 then
        title := 'The Last Message';
        brief := 'Perform a grounded one-take monologue as if this is the final message you never had the courage to send.';
        as_if := 'As if the person you hurt is on the other side of the room, already reaching for the door, and this is the last honest thing you get to say before they leave.';
        monologue := 'I rehearsed this so many times that it stopped sounding like me. So I am done rehearsing. I was cruel because it was easier than being scared. I made you carry the silence and then acted surprised when it became heavy. If you need to go, I will not stand in the doorway. But before you do, I need one honest thing to exist between us: I loved you badly, and I am trying to learn how to love without defending myself.';
        theme_word := 'Confession';
      else
        title := 'I Was Wrong';
        brief := 'Perform an apology where the character has just realized they were the problem.';
        as_if := 'As if you have just realized you were the one who was wrong.';
        monologue := 'I thought admitting it would make me smaller. It does not. It only makes the room quiet enough to hear what I did. I am sorry. Not because I got caught in the aftermath. Because I finally understand it.';
        theme_word := 'Realisation';
      end if;

      instructions := 'Record yourself performing the monologue in one take. Start from stillness, play a clear objective, and let the thought change at least twice. Focus on emotional truth, playable stakes, and restraint.';
      rules := jsonb_build_object(
        'max_length_seconds', 60,
        'takes', 'one_take_preferred',
        'framing', 'shoulders_up_or_waist_up',
        'performance_objective', 'make_them_stay_forgive_believe_or_understand',
        'copyright', 'Use original or public-domain text only unless you own the rights.'
      );
    else
      if prompt_index = 0 then
        title := 'One Location, One Secret';
        brief := 'Make a short film set in one location. One character is hiding something, but they never say it directly.';
        theme_word := 'Secret';
        instructions := 'Use exactly one location and no more than two characters. Open on an ordinary action that becomes suspicious by the end. The secret must be suggested through blocking, an object, a repeated sound, or what a character avoids looking at. Do not explain the secret in dialogue. End on a final image that changes how we understand the first shot.';
        rules := jsonb_build_object('max_length_seconds', 60, 'locations', 1, 'max_characters', 2, 'dialogue_rule', 'no_direct_exposition');
      elsif prompt_index = 1 then
        title := 'No Dialogue';
        brief := 'Make a short film with no spoken dialogue. Tell the whole story through action, expression, sound, and visuals.';
        theme_word := 'Regret';
        instructions := 'No spoken words. Text on screen is allowed only if it exists inside the world of the film. Build the turn through a repeated action, a sound cue, and one clear visual choice that changes meaning by the end.';
        rules := jsonb_build_object('max_length_seconds', 60, 'spoken_dialogue', false, 'focus', 'visual_storytelling');
      elsif prompt_index = 2 then
        title := 'One Location, One Secret';
        brief := 'Make a short film in one location where one character is hiding something, but the audience understands it through behavior before anyone says it directly.';
        theme_word := 'Secret';
        instructions := 'Use exactly one location and no more than two characters. Open on an ordinary action that becomes suspicious by the end. The secret must be suggested through blocking, an object, a repeated sound, or what a character avoids looking at. Do not explain the secret in dialogue. End on a final image that changes how we understand the first shot.';
        rules := jsonb_build_object('max_length_seconds', 60, 'locations', 1, 'max_characters', 2, 'dialogue_rule', 'no_direct_exposition', 'required_visual_turn', true);
      else
        title := 'Scene Recreation';
        brief := 'Recreate the emotional structure of a famous film scene using your own characters, dialogue, and setting.';
        theme_word := 'Confrontation';
        instructions := 'Do not copy copyrighted dialogue. Reinterpret the feeling and structure in your own words.';
        rules := jsonb_build_object('max_length_seconds', 60, 'copyright', 'Do not copy copyrighted dialogue directly.');
      end if;

      as_if := null;
      monologue := null;
    end if;

    inserted_challenge_id := null;

    insert into public.weekly_challenges (
      title,
      challenge_type,
      brief,
      instructions,
      as_if,
      monologue,
      theme_word,
      runtime_limit_seconds,
      submission_rules,
      submission_format,
      starts_at,
      ends_at,
      voting_ends_at,
      status
    )
    values (
      title,
      challenge_type,
      brief,
      instructions,
      as_if,
      monologue,
      theme_word,
      60,
      rules,
      'video',
      start_at,
      end_at,
      voting_end,
      case when now() between start_at and end_at then 'live' else 'draft' end
    )
    on conflict (starts_at, challenge_type) do nothing
    returning id into inserted_challenge_id;

    if inserted_challenge_id is not null then
      inserted_count := inserted_count + 1;

      if now() between start_at and end_at then
        insert into public.live_activity_events (
          event_type,
          weekly_challenge_id,
          message,
          metadata
        )
        values (
          'weekly_challenge_started',
          inserted_challenge_id,
          case
            when challenge_type = 'acting' then 'New acting challenge is live.'
            else 'New short film challenge is live.'
          end,
          jsonb_build_object('title', title, 'challenge_type', challenge_type)
        );
      end if;
    end if;
    end loop;
  end loop;

  update public.weekly_challenges
  set status = case
    when winner_submission_id is not null then 'complete'
    when now() > ends_at and now() <= voting_ends_at then 'voting'
    when now() between starts_at and ends_at then 'live'
    when now() < starts_at then 'draft'
    else status
  end
  where status <> 'archived';

  return inserted_count;
end;
$$;

create or replace function public.create_daily_prompts_if_missing(p_days_ahead integer default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  inserted_count integer := 0;
  prompt_day date;
  prompt_index integer;
  prompt_category text;
  prompt_text text;
begin
  for i in 0..greatest(coalesce(p_days_ahead, 14), 0) loop
    prompt_day := current_date + i;
    prompt_index := abs(extract(doy from prompt_day)::integer) % 6;

    if prompt_index = 0 then
      prompt_category := 'Acting';
      prompt_text := 'Perform one line as if you are hiding something.';
    elsif prompt_index = 1 then
      prompt_category := 'Film';
      prompt_text := 'Shoot a 10-second scene with no dialogue.';
    elsif prompt_index = 2 then
      prompt_category := 'Writing';
      prompt_text := 'Write a scene starting with: "You should not be here."';
    elsif prompt_index = 3 then
      prompt_category := 'Photography';
      prompt_text := 'Capture one image that represents guilt.';
    elsif prompt_index = 4 then
      prompt_category := 'Comedy';
      prompt_text := 'Make a 15-second sketch about being late.';
    else
      prompt_category := 'Editing';
      prompt_text := 'Cut any clip to feel like a thriller.';
    end if;

    insert into public.daily_creative_prompts (prompt_date, category, prompt, points)
    values (prompt_day, prompt_category, prompt_text, 5)
    on conflict (prompt_date) do nothing;

    if found then
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return inserted_count;
end;
$$;

create or replace function public.refresh_weekly_challenge_submission_count(challenge_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.weekly_challenges wc
  set
    submission_count = (
      select count(*)::integer
      from public.submissions s
      where s.weekly_challenge_id = challenge_id
        and coalesce(s.is_removed, false) = false
    ),
    vote_count = (
      select coalesce(sum(coalesce(s.votes, 0)), 0)::integer
      from public.submissions s
      where s.weekly_challenge_id = challenge_id
        and coalesce(s.is_removed, false) = false
    )
  where wc.id = challenge_id;
$$;

create or replace function public.sync_weekly_challenge_submission_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.weekly_challenge_id is not null then
      perform public.refresh_weekly_challenge_submission_count(new.weekly_challenge_id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.weekly_challenge_id is distinct from new.weekly_challenge_id then
      if old.weekly_challenge_id is not null then
        perform public.refresh_weekly_challenge_submission_count(old.weekly_challenge_id);
      end if;
      if new.weekly_challenge_id is not null then
        perform public.refresh_weekly_challenge_submission_count(new.weekly_challenge_id);
      end if;
    elsif new.weekly_challenge_id is not null and (
      old.is_removed is distinct from new.is_removed
      or old.votes is distinct from new.votes
    ) then
      perform public.refresh_weekly_challenge_submission_count(new.weekly_challenge_id);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.weekly_challenge_id is not null then
      perform public.refresh_weekly_challenge_submission_count(old.weekly_challenge_id);
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists submissions_sync_weekly_challenge_count on public.submissions;
create trigger submissions_sync_weekly_challenge_count
  after insert or update of weekly_challenge_id, is_removed, votes or delete on public.submissions
  for each row
  execute function public.sync_weekly_challenge_submission_count();

create or replace function public.record_submission_creative_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action_kind text;
  action_points integer;
  actor_name text;
  actor_city_id bigint;
begin
  if new.user_id is null or coalesce(new.is_removed, false) then
    return new;
  end if;

  if new.creator_challenge_id is not null or new.submission_source = 'creator_challenge' then
    action_kind := 'creator_challenge_submission';
    action_points := 20;
  elsif new.weekly_challenge_id is not null or new.submission_source = 'weekly_challenge' then
    action_kind := 'weekly_challenge_submission';
    action_points := 20;
  elsif lower(coalesce(new.film_category, '')) like '%monologue%' then
    action_kind := 'upload_monologue';
    action_points := 10;
  else
    action_kind := 'upload_short_film';
    action_points := 10;
  end if;

  perform public.record_creative_action(
    new.user_id,
    action_kind,
    'submission',
    new.id,
    action_points,
    jsonb_build_object(
      'title', new.title,
      'weekly_challenge_id', new.weekly_challenge_id,
      'creator_challenge_id', new.creator_challenge_id
    )
  );

  select full_name, city_id
  into actor_name, actor_city_id
  from public.users
  where id = new.user_id;

  insert into public.live_activity_events (
    actor_id,
    event_type,
    city_id,
    submission_id,
    weekly_challenge_id,
    creator_challenge_id,
    message,
    metadata
  )
  values (
    new.user_id,
    action_kind,
    actor_city_id,
    new.id,
    new.weekly_challenge_id,
    new.creator_challenge_id,
    coalesce(actor_name, 'A creative') || ' submitted new work.',
    jsonb_build_object('title', new.title)
  );

  return new;
end;
$$;

drop trigger if exists submissions_record_creative_action on public.submissions;
create trigger submissions_record_creative_action
  after insert on public.submissions
  for each row
  execute function public.record_submission_creative_action();

create or replace function public.record_vote_creative_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null and new.submission_id is not null then
    perform public.record_creative_action(
      new.user_id,
      'vote_submitted',
      'submission',
      new.submission_id,
      2,
      jsonb_build_object('submission_id', new.submission_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists user_votes_record_creative_action on public.user_votes;
create trigger user_votes_record_creative_action
  after insert on public.user_votes
  for each row
  execute function public.record_vote_creative_action();

create or replace function public.finalize_last_week_winner_if_needed()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge record;
  selected_winner_submission_id uuid;
  selected_winner_user_id uuid;
  finalized_count integer := 0;
begin
  for challenge in
    select *
    from public.weekly_challenges
    where ends_at <= now()
      and winner_submission_id is null
      and status <> 'archived'
    order by ends_at asc
  loop
    selected_winner_submission_id := null;
    selected_winner_user_id := null;

    select s.id, s.user_id
    into selected_winner_submission_id, selected_winner_user_id
    from public.submissions s
    where s.weekly_challenge_id = challenge.id
      and coalesce(s.is_removed, false) = false
    order by coalesce(s.votes, 0) desc, s.submitted_at asc
    limit 1;

    if selected_winner_submission_id is not null then
      update public.weekly_challenges
      set
        winner_submission_id = selected_winner_submission_id,
        winner_user_id = selected_winner_user_id,
        status = 'complete'
      where id = challenge.id;

      update public.submissions
      set is_winner = true
      where id = selected_winner_submission_id;

      insert into public.user_badges (
        user_id,
        badge_key,
        badge_label,
        source_type,
        source_id,
        metadata
      )
      values (
        selected_winner_user_id,
        'weekly_winner',
        'Weekly Winner',
        'weekly_challenge',
        challenge.id,
        jsonb_build_object('challenge_title', challenge.title)
      )
      on conflict (user_id, badge_key, source_id)
      where source_id is not null
      do nothing;

      perform public.record_creative_action(
        selected_winner_user_id,
        'challenge_win',
        'submission',
        selected_winner_submission_id,
        100,
        jsonb_build_object('weekly_challenge_id', challenge.id, 'title', challenge.title)
      );

      insert into public.live_activity_events (
        actor_id,
        event_type,
        submission_id,
        weekly_challenge_id,
        message,
        metadata
      )
      values (
        selected_winner_user_id,
        'weekly_challenge_winner',
        selected_winner_submission_id,
        challenge.id,
        'Last Week''s Winner has been announced.',
        jsonb_build_object('challenge_title', challenge.title)
      );
    else
      update public.weekly_challenges
      set status = 'complete'
      where id = challenge.id;
    end if;

    finalized_count := finalized_count + 1;
  end loop;

  return finalized_count;
end;
$$;

create or replace function public.update_creator_challenge_submission_status(
  p_submission_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data record;
  normalized_status text := lower(coalesce(p_status, ''));
begin
  if normalized_status not in (
    'submitted',
    'viewed_by_creator',
    'shortlisted',
    'creator_pick',
    'top_10',
    'winner'
  ) then
    raise exception 'Unsupported creator challenge status: %', p_status;
  end if;

  select s.*, cc.creator_id as owning_creator_id
  into row_data
  from public.submissions s
  left join public.creator_challenges cc on cc.id = s.creator_challenge_id
  where s.id = p_submission_id;

  if not found then
    raise exception 'Submission not found';
  end if;

  if row_data.owning_creator_id is distinct from auth.uid() then
    raise exception 'Only the challenge creator can update this submission status';
  end if;

  update public.submissions
  set
    creator_challenge_status = normalized_status,
    creator_challenge_status_updated_at = now(),
    viewed_by_creator_at = case
      when normalized_status in ('viewed_by_creator', 'shortlisted', 'creator_pick', 'top_10', 'winner')
      then coalesce(viewed_by_creator_at, now())
      else viewed_by_creator_at
    end,
    shortlisted_at = case
      when normalized_status in ('shortlisted', 'creator_pick', 'winner')
      then coalesce(shortlisted_at, now())
      else shortlisted_at
    end,
    top_10_at = case
      when normalized_status in ('top_10', 'winner')
      then coalesce(top_10_at, now())
      else top_10_at
    end
  where id = p_submission_id;

  insert into public.submission_creator_status_events (
    submission_id,
    creator_id,
    status
  )
  values (
    p_submission_id,
    auth.uid(),
    normalized_status
  );

  if normalized_status = 'creator_pick' then
    update public.creator_challenges
    set creator_pick_submission_id = p_submission_id
    where id = row_data.creator_challenge_id;
  elsif normalized_status = 'winner' then
    update public.creator_challenges
    set
      winner_submission_id = p_submission_id,
      winner_user_id = row_data.user_id
    where id = row_data.creator_challenge_id;
  end if;
end;
$$;

create or replace view public.weekly_challenge_rankings as
select
  s.weekly_challenge_id,
  s.id as submission_id,
  s.user_id,
  s.title,
  coalesce(s.votes, 0) as votes,
  dense_rank() over (
    partition by s.weekly_challenge_id
    order by coalesce(s.votes, 0) desc, s.submitted_at asc
  ) as rank,
  s.submitted_at
from public.submissions s
where s.weekly_challenge_id is not null
  and coalesce(s.is_removed, false) = false;

create or replace view public.weekly_winners_archive as
select
  wc.id as weekly_challenge_id,
  wc.title as challenge_title,
  wc.challenge_type,
  wc.starts_at,
  wc.ends_at,
  wc.winner_submission_id,
  wc.winner_user_id,
  s.title as submission_title,
  u.full_name as winner_name,
  u.avatar_url as winner_avatar_url
from public.weekly_challenges wc
left join public.submissions s on s.id = wc.winner_submission_id
left join public.users u on u.id = wc.winner_user_id
where wc.winner_submission_id is not null
order by wc.ends_at desc;

create or replace view public.rising_creatives as
select
  u.id as user_id,
  u.full_name,
  u.avatar_url,
  u.city_id,
  u.creative_momentum_score,
  u.creative_momentum_level,
  count(ca.id) filter (where ca.created_at >= now() - interval '30 days')::integer as recent_actions,
  coalesce(sum(ca.points) filter (where ca.created_at >= now() - interval '30 days'), 0)::integer as recent_points,
  dense_rank() over (
    order by
      coalesce(sum(ca.points) filter (where ca.created_at >= now() - interval '30 days'), 0) desc,
      count(ca.id) filter (where ca.created_at >= now() - interval '30 days') desc,
      u.id
  ) as rank
from public.users u
left join public.creative_actions ca on ca.user_id = u.id
group by u.id, u.full_name, u.avatar_url, u.city_id, u.creative_momentum_score, u.creative_momentum_level;

create or replace function public.get_city_creative_pulse(p_city_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  week_start date := date_trunc('week', current_date::timestamp)::date;
  active_creatives integer := 0;
  jobs_posted integer := 0;
  active_challenges integer := 0;
  top_creatives jsonb := '[]'::jsonb;
begin
  select count(distinct ca.user_id)::integer
  into active_creatives
  from public.creative_actions ca
  join public.users u on u.id = ca.user_id
  where u.city_id = p_city_id
    and ca.action_date >= week_start;

  if to_regclass('public.jobs') is not null then
    execute
      'select count(*)::integer from public.jobs where city_id = $1 and created_at >= $2'
      into jobs_posted
      using p_city_id, week_start;
  end if;

  select count(*)::integer
  into active_challenges
  from public.weekly_challenges
  where now() between starts_at and ends_at;

  select coalesce(jsonb_agg(r order by (r->>'rank')::integer), '[]'::jsonb)
  into top_creatives
  from (
    select to_jsonb(rc) as r
    from public.rising_creatives rc
    where rc.city_id = p_city_id
    order by rc.rank
    limit 5
  ) ranked;

  return jsonb_build_object(
    'active_creatives_this_week', active_creatives,
    'jobs_posted_this_week', jobs_posted,
    'active_challenges', active_challenges,
    'top_creatives', top_creatives
  );
end;
$$;

create or replace function public.get_monthly_submission_streak(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cursor_month date := date_trunc('month', now())::date;
  streak_count integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  if not exists (
    select 1
    from public.submissions s
    left join public.monthly_challenges mc on mc.id = s.monthly_challenge_id
    where s.user_id = p_user_id
      and coalesce(s.is_removed, false) = false
      and (
        s.monthly_challenge_id is not null
        or s.submission_source = 'monthly_challenge'
      )
      and date_trunc('month', coalesce(mc.month_start::timestamptz, s.submitted_at))::date = cursor_month
  ) then
    cursor_month := (cursor_month - interval '1 month')::date;
  end if;

  loop
    exit when not exists (
      select 1
      from public.submissions s
      left join public.monthly_challenges mc on mc.id = s.monthly_challenge_id
      where s.user_id = p_user_id
        and coalesce(s.is_removed, false) = false
        and (
          s.monthly_challenge_id is not null
          or s.submission_source = 'monthly_challenge'
        )
        and date_trunc('month', coalesce(mc.month_start::timestamptz, s.submitted_at))::date = cursor_month
    );

    streak_count := streak_count + 1;
    cursor_month := (cursor_month - interval '1 month')::date;
  end loop;

  return streak_count;
end;
$$;

alter table public.weekly_challenges enable row level security;
alter table public.daily_creative_prompts enable row level security;
alter table public.creative_actions enable row level security;
alter table public.user_badges enable row level security;
alter table public.creator_promo_codes enable row level security;
alter table public.creator_referrals enable row level security;
alter table public.live_activity_events enable row level security;
alter table public.submission_creator_status_events enable row level security;

drop policy if exists "Weekly challenges are viewable" on public.weekly_challenges;
create policy "Weekly challenges are viewable"
  on public.weekly_challenges
  for select
  using (true);

drop policy if exists "Daily prompts are viewable" on public.daily_creative_prompts;
create policy "Daily prompts are viewable"
  on public.daily_creative_prompts
  for select
  using (true);

drop policy if exists "Users can view own creative actions" on public.creative_actions;
create policy "Users can view own creative actions"
  on public.creative_actions
  for select
  using (user_id = auth.uid());

drop policy if exists "Badges are public" on public.user_badges;
create policy "Badges are public"
  on public.user_badges
  for select
  using (true);

drop policy if exists "Active promo codes are viewable" on public.creator_promo_codes;
create policy "Active promo codes are viewable"
  on public.creator_promo_codes
  for select
  using (is_active or creator_id = auth.uid());

drop policy if exists "Creators can manage own promo codes" on public.creator_promo_codes;
create policy "Creators can manage own promo codes"
  on public.creator_promo_codes
  for all
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

drop policy if exists "Users can view own referrals" on public.creator_referrals;
create policy "Users can view own referrals"
  on public.creator_referrals
  for select
  using (creator_id = auth.uid() or referred_user_id = auth.uid());

drop policy if exists "Live activity is viewable" on public.live_activity_events;
create policy "Live activity is viewable"
  on public.live_activity_events
  for select
  using (true);

drop policy if exists "Creator status events are visible to owners" on public.submission_creator_status_events;
create policy "Creator status events are visible to owners"
  on public.submission_creator_status_events
  for select
  using (
    creator_id = auth.uid()
    or exists (
      select 1
      from public.submissions s
      where s.id = submission_id
        and s.user_id = auth.uid()
    )
  );

grant select on public.weekly_challenges to anon, authenticated;
grant select on public.weekly_challenge_rankings to anon, authenticated;
grant select on public.weekly_winners_archive to anon, authenticated;
grant select on public.rising_creatives to anon, authenticated;
grant select on public.daily_creative_prompts to anon, authenticated;
grant select on public.user_badges to anon, authenticated;
grant select on public.creator_promo_codes to anon, authenticated;
grant select on public.live_activity_events to anon, authenticated;
grant select on public.creative_actions to authenticated;
grant select on public.creator_referrals to authenticated;
grant select on public.submission_creator_status_events to authenticated;

grant execute on function public.create_weekly_challenges_if_missing(integer) to anon, authenticated;
grant execute on function public.create_daily_prompts_if_missing(integer) to anon, authenticated;
grant execute on function public.finalize_last_week_winner_if_needed() to anon, authenticated;
grant execute on function public.record_creative_action(uuid, text, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.refresh_creative_consistency(uuid) to authenticated;
grant execute on function public.get_monthly_submission_streak(uuid) to anon, authenticated;
grant execute on function public.update_creator_challenge_submission_status(uuid, text) to authenticated;
grant execute on function public.get_city_creative_pulse(bigint) to anon, authenticated;

do $$
begin
  if to_regprocedure('private.handle_activity_push()') is not null then
    drop trigger if exists weekly_challenges_send_activity_push on public.weekly_challenges;
    create trigger weekly_challenges_send_activity_push
      after insert or update of winner_submission_id on public.weekly_challenges
      for each row execute function private.handle_activity_push();
  end if;
end;
$$;

select public.create_weekly_challenges_if_missing(4);

update public.weekly_challenges
set
  title = 'The Last Message',
  challenge_type = 'acting',
  brief = 'Perform a grounded one-take monologue as if this is the final message you never had the courage to send.',
  instructions = 'Record yourself performing the monologue in one take. Frame yourself shoulders-up or waist-up. Begin after a long silence, as if the other person has just asked you for the truth. Play one clear objective: make them stay, forgive you, believe you, or finally understand you. Let the thought change at least twice. Keep your voice private, not theatrical.',
  as_if = 'As if the person you hurt is on the other side of the room, already reaching for the door, and this is the last honest thing you get to say before they leave.',
  monologue = 'I rehearsed this so many times that it stopped sounding like me. So I am done rehearsing. I was cruel because it was easier than being scared. I made you carry the silence and then acted surprised when it became heavy. If you need to go, I will not stand in the doorway. But before you do, I need one honest thing to exist between us: I loved you badly, and I am trying to learn how to love without defending myself.',
  theme_word = 'Confession',
  runtime_limit_seconds = 60,
  submission_rules = jsonb_build_object(
    'max_length_seconds', 60,
    'takes', 'one_take_preferred',
    'framing', 'shoulders_up_or_waist_up',
    'performance_objective', 'make_them_stay_forgive_believe_or_understand',
    'copyright', 'Use original or public-domain text only unless you own the rights.'
  ),
  submission_format = 'video',
  updated_at = now()
where starts_at = public.week_start_utc('2026-06-25T12:00:00Z'::timestamptz)
  and challenge_type = 'acting';

update public.weekly_challenges
set
  title = 'One Location, One Secret',
  challenge_type = 'short_film',
  brief = 'Make a short film in one location where one character is hiding something, but the audience understands it through behavior before anyone says it directly.',
  instructions = 'Use exactly one location and no more than two characters. Open on an ordinary action that becomes suspicious by the end. The secret must be suggested through blocking, an object, a repeated sound, or what a character avoids looking at. Do not explain the secret in dialogue. End on a final image that changes how we understand the first shot.',
  as_if = null,
  monologue = null,
  theme_word = 'Secret',
  runtime_limit_seconds = 60,
  submission_rules = jsonb_build_object(
    'max_length_seconds', 60,
    'locations', 1,
    'max_characters', 2,
    'dialogue_rule', 'no_direct_exposition',
    'required_visual_turn', true
  ),
  submission_format = 'short film video',
  updated_at = now()
where starts_at = public.week_start_utc('2026-06-25T12:00:00Z'::timestamptz)
  and challenge_type = 'short_film';

select public.create_daily_prompts_if_missing(14);
