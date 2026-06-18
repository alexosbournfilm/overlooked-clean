create index if not exists cities_lower_name_idx
  on public.cities (lower(name));

create index if not exists cities_lower_name_pattern_idx
  on public.cities (lower(name) text_pattern_ops);

create index if not exists cities_country_lower_name_idx
  on public.cities (country_code, lower(name));

create index if not exists cities_lower_ascii_name_idx
  on public.cities (lower(ascii_name))
  where ascii_name is not null;

create index if not exists cities_lower_ascii_name_pattern_idx
  on public.cities (lower(ascii_name) text_pattern_ops)
  where ascii_name is not null;

create or replace function public.search_cities(
  city_query text,
  country_code_filter text default null,
  result_limit integer default 80
)
returns table (
  id bigint,
  name text,
  country_code text,
  population bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  q text := lower(trim(coalesce(city_query, '')));
  cc text := nullif(upper(trim(coalesce(country_code_filter, ''))), '');
  max_rows integer := least(greatest(coalesce(result_limit, 80), 1), 120);
  emitted integer := 0;
  seen_ids bigint[] := '{}';
  row_record record;
begin
  if length(q) < 2 then
    return;
  end if;

  -- 1) Fast exact name/ascii-name matches. This catches searches like
  -- "Panama City" without touching the very large alternate-name text.
  for row_record in
    select c.id::bigint, c.name::text, upper(c.country_code)::text as country_code, c.population::bigint
    from public.cities c
    where (cc is null or upper(c.country_code) = cc)
      and (lower(c.name) = q or lower(coalesce(c.ascii_name, '')) = q)
    order by
      case when cc is not null and upper(c.country_code) = cc then 0 else 1 end,
      c.population desc nulls last,
      c.name asc,
      upper(c.country_code) asc
    limit max_rows
  loop
    id := row_record.id;
    name := row_record.name;
    country_code := row_record.country_code;
    population := row_record.population;
    seen_ids := array_append(seen_ids, row_record.id);
    emitted := emitted + 1;
    return next;
  end loop;

  if emitted >= max_rows then
    return;
  end if;

  -- 2) Fast prefix matches while the user is typing.
  for row_record in
    select c.id::bigint, c.name::text, upper(c.country_code)::text as country_code, c.population::bigint
    from public.cities c
    where (cc is null or upper(c.country_code) = cc)
      and c.id <> all(seen_ids)
      and (lower(c.name) like q || '%' or lower(coalesce(c.ascii_name, '')) like q || '%')
    order by
      case when cc is not null and upper(c.country_code) = cc then 0 else 1 end,
      c.population desc nulls last,
      c.name asc,
      upper(c.country_code) asc
    limit (max_rows - emitted)
  loop
    id := row_record.id;
    name := row_record.name;
    country_code := row_record.country_code;
    population := row_record.population;
    seen_ids := array_append(seen_ids, row_record.id);
    emitted := emitted + 1;
    return next;
  end loop;

  if emitted >= max_rows then
    return;
  end if;

  -- 3) Broader name contains search, still avoiding alternate names.
  for row_record in
    select c.id::bigint, c.name::text, upper(c.country_code)::text as country_code, c.population::bigint
    from public.cities c
    where (cc is null or upper(c.country_code) = cc)
      and c.id <> all(seen_ids)
      and (c.name ilike '%' || q || '%' or coalesce(c.ascii_name, '') ilike '%' || q || '%')
    order by
      case when cc is not null and upper(c.country_code) = cc then 0 else 1 end,
      c.population desc nulls last,
      c.name asc,
      upper(c.country_code) asc
    limit (max_rows - emitted)
  loop
    id := row_record.id;
    name := row_record.name;
    country_code := row_record.country_code;
    population := row_record.population;
    seen_ids := array_append(seen_ids, row_record.id);
    emitted := emitted + 1;
    return next;
  end loop;

  if emitted >= max_rows or length(q) < 4 then
    return;
  end if;

  -- 4) Alternate names are useful but expensive, so only touch them if
  -- name/ascii-name searches did not fill the result set.
  for row_record in
    select c.id::bigint, c.name::text, upper(c.country_code)::text as country_code, c.population::bigint
    from public.cities c
    where (cc is null or upper(c.country_code) = cc)
      and c.id <> all(seen_ids)
      and (
        coalesce(c.alternate_names, '') ilike '%' || q || '%'
        or coalesce(c.search_names, '') ilike '%' || q || '%'
      )
    order by
      case when cc is not null and upper(c.country_code) = cc then 0 else 1 end,
      c.population desc nulls last,
      c.name asc,
      upper(c.country_code) asc
    limit (max_rows - emitted)
  loop
    id := row_record.id;
    name := row_record.name;
    country_code := row_record.country_code;
    population := row_record.population;
    seen_ids := array_append(seen_ids, row_record.id);
    emitted := emitted + 1;
    return next;
  end loop;
end;
$$;

grant execute on function public.search_cities(text, text, integer) to anon, authenticated;

analyze public.cities;
