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
  where coalesce(
    ends_at + interval '48 hours',
    created_at + interval '12 days'
  ) <= now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.delete_expired_creator_challenges() to anon, authenticated;
