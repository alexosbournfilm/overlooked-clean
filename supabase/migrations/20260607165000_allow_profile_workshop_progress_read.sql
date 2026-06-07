do $$
begin
  if to_regclass('public.workshop_progress') is not null then
    grant select on public.workshop_progress to authenticated;

    drop policy if exists "Workshop progress is viewable by signed-in users"
      on public.workshop_progress;

    create policy "Workshop progress is viewable by signed-in users"
      on public.workshop_progress
      for select
      to authenticated
      using (true);
  end if;
end $$;
