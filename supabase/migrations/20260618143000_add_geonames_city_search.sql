create extension if not exists pg_trgm;

create table if not exists public.cities (
  id bigserial primary key,
  name text not null,
  country_code text not null
);

alter table public.cities
  add column if not exists geoname_id integer,
  add column if not exists ascii_name text,
  add column if not exists alternate_names text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists admin1_code text,
  add column if not exists admin2_code text,
  add column if not exists feature_code text,
  add column if not exists population bigint,
  add column if not exists timezone text,
  add column if not exists geonames_modified_at date,
  add column if not exists search_names text;

create unique index if not exists cities_geoname_id_idx
  on public.cities (geoname_id);

create index if not exists cities_country_name_idx
  on public.cities (country_code, name);

create index if not exists cities_name_trgm_idx
  on public.cities using gin (name gin_trgm_ops);

create index if not exists cities_ascii_name_trgm_idx
  on public.cities using gin (ascii_name gin_trgm_ops)
  where ascii_name is not null;

create index if not exists cities_alternate_names_trgm_idx
  on public.cities using gin (alternate_names gin_trgm_ops)
  where alternate_names is not null;

create index if not exists cities_search_names_trgm_idx
  on public.cities using gin (search_names gin_trgm_ops)
  where search_names is not null;

create or replace function public.search_cities(
  city_query text,
  country_code_filter text default null,
  result_limit integer default 120
)
returns table (
  id bigint,
  name text,
  country_code text,
  population bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with input as (
    select
      trim(coalesce(city_query, '')) as q,
      nullif(upper(trim(coalesce(country_code_filter, ''))), '') as cc,
      least(greatest(coalesce(result_limit, 120), 1), 200) as max_rows
  )
  select
    c.id::bigint,
    c.name::text,
    upper(c.country_code)::text as country_code,
    c.population::bigint
  from public.cities c
  cross join input i
  where length(i.q) >= 2
    and (i.cc is null or upper(c.country_code) = i.cc)
    and (
      c.name ilike '%' || i.q || '%'
      or coalesce(c.ascii_name, '') ilike '%' || i.q || '%'
      or coalesce(c.alternate_names, '') ilike '%' || i.q || '%'
      or coalesce(c.search_names, '') ilike '%' || i.q || '%'
    )
  order by
    case
      when i.cc is not null and upper(c.country_code) = i.cc and lower(c.name) = lower(i.q) then 0
      when lower(c.name) = lower(i.q) then 1
      when i.cc is not null and upper(c.country_code) = i.cc and lower(coalesce(c.ascii_name, '')) = lower(i.q) then 2
      when lower(coalesce(c.ascii_name, '')) = lower(i.q) then 3
      when i.cc is not null and upper(c.country_code) = i.cc and c.name ilike i.q || '%' then 4
      when c.name ilike i.q || '%' then 5
      when i.cc is not null and upper(c.country_code) = i.cc and coalesce(c.search_names, '') ilike '%' || i.q || '%' then 6
      when coalesce(c.search_names, '') ilike '%' || i.q || '%' then 7
      else 8
    end,
    c.population desc nulls last,
    c.name asc,
    upper(c.country_code) asc
  limit (select max_rows from input);
$$;

grant select on public.cities to anon, authenticated;
grant execute on function public.search_cities(text, text, integer) to anon, authenticated;
