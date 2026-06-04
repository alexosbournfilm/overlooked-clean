create table if not exists public.submission_collaborators (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (submission_id, user_id, role)
);

create index if not exists submission_collaborators_submission_id_idx
  on public.submission_collaborators(submission_id);

create index if not exists submission_collaborators_user_id_idx
  on public.submission_collaborators(user_id);

alter table public.submission_collaborators enable row level security;

drop policy if exists "Submission collaborators are viewable" on public.submission_collaborators;
create policy "Submission collaborators are viewable"
  on public.submission_collaborators
  for select
  using (true);

drop policy if exists "Submission owners can insert collaborators" on public.submission_collaborators;
create policy "Submission owners can insert collaborators"
  on public.submission_collaborators
  for insert
  with check (
    exists (
      select 1
      from public.submissions s
      where s.id = submission_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Submission owners can update collaborators" on public.submission_collaborators;
create policy "Submission owners can update collaborators"
  on public.submission_collaborators
  for update
  using (
    exists (
      select 1
      from public.submissions s
      where s.id = submission_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.submissions s
      where s.id = submission_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Submission owners can delete collaborators" on public.submission_collaborators;
create policy "Submission owners can delete collaborators"
  on public.submission_collaborators
  for delete
  using (
    exists (
      select 1
      from public.submissions s
      where s.id = submission_id
        and s.user_id = auth.uid()
    )
  );
