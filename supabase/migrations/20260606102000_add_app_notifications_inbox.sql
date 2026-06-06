create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  body text,
  notification_type text not null default 'activity',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists app_notifications_user_unread_created_idx
  on public.app_notifications (user_id, read_at, created_at desc);

create index if not exists app_notifications_user_created_idx
  on public.app_notifications (user_id, created_at desc);

alter table public.app_notifications enable row level security;

drop policy if exists "Users can read their own notifications" on public.app_notifications;
create policy "Users can read their own notifications"
  on public.app_notifications
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can mark their own notifications read" on public.app_notifications;
create policy "Users can mark their own notifications read"
  on public.app_notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own notifications" on public.app_notifications;
create policy "Users can delete their own notifications"
  on public.app_notifications
  for delete
  using (auth.uid() = user_id);
