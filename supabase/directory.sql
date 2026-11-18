-- Qarib on Supabase · part 2 of 2: the India masjid directory (from OpenStreetMap), nearest-masjid search, the owner
-- dashboard numbers and scheduled jobs. Run after schema.sql (safe to re-run).
-- The directory fills itself: one 1°x1° tile per minute, big cities first, every tile refreshed weekly. A tile that
-- someone opens before it is loaded jumps to the front of the queue. Map data © OpenStreetMap contributors (ODbL).

create extension if not exists postgis with schema extensions;
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.masjids (
  osm_id     text primary key check (osm_id ~ '^(node|way|relation)/[0-9]{1,12}$'),
  name       text not null check (char_length(name) between 1 and 80),
  name_ar    text,
  address    text,
  location   extensions.geography(Point, 4326) not null,
  tile       text not null,
  updated_at timestamptz not null default now()
);
create index if not exists masjids_location_gix on public.masjids using gist (location);
create index if not exists masjids_tile_idx on public.masjids (tile);
alter table public.masjids enable row level security; -- read only through nearest_masjids(); written only by the importer
revoke all on public.masjids from anon, authenticated;

create table if not exists private.import_tiles (
  tile text primary key, s double precision not null, w double precision not null, n double precision not null, e double precision not null,
  priority int not null default 0, refreshed_at timestamptz, status text, found int
);
-- India and its surroundings in 1° tiles (sea tiles cost one quick empty query a week)
insert into private.import_tiles (tile, s, w, n, e)
  select la || ':' || lo, la, lo, la + 1, lo + 1 from generate_series(6, 36) la, generate_series(68, 97) lo
  on conflict do nothing;
-- big cities first (Pune first of all)
update private.import_tiles set priority = 100 where tile in ('18:73', '19:72', '28:77', '17:78', '12:77', '13:80', '22:88', '26:80', '23:72', '21:79', '26:75', '25:85', '27:78', '21:72', '25:82', '19:73', '28:76', '11:76', '9:76', '15:74');
update private.import_tiles set priority = 200 where tile = '18:73';

create or replace function private.clean(t text, max int) returns text language sql immutable as $$
  select nullif(left(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''), '<[^<>]*>', '', 'g'), '[[:cntrl:]<>]', '', 'g'), '\s+', ' ', 'g')), max), '')
$$;

/** Load one tile from OpenStreetMap (two mirrors), upsert its masjids, drop ones that were deleted from the map. */
create or replace function private.refresh_tile(p_tile text) returns int language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare t record; q text; st int := 0; body text; started timestamptz := now(); n int := 0; url text;
begin
  select * into t from private.import_tiles where tile = p_tile;
  if not found then return -1; end if;
  q := format('[out:json][timeout:90];(nwr["amenity"="place_of_worship"]["religion"="muslim"](%1$s,%2$s,%3$s,%4$s);nwr["building"="mosque"](%1$s,%2$s,%3$s,%4$s););out center tags;', t.s, t.w, t.n, t.e);
  perform set_config('http.timeout_msec', '120000', true); -- public Overpass servers can take 30-60 s; the default is 5 s
  foreach url in array array['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'] loop
    begin
      select r.status, r.content into st, body from extensions.http_post(url, 'data=' || extensions.urlencode(q), 'application/x-www-form-urlencoded') r;
      exit when st = 200;
    exception when others then st := 0;
    end;
  end loop;
  if st is distinct from 200 or body is null or left(ltrim(body), 1) <> '{' then
    update private.import_tiles set status = 'failed ' || coalesce(st, 0), refreshed_at = now() - interval '6 days 23 hours' where tile = p_tile; -- retry in ~1 h
    return -1;
  end if;
  insert into public.masjids (osm_id, name, name_ar, address, location, tile, updated_at)
    select distinct on (id) id, coalesce(private.clean(nm, 80), 'Masjid (name not listed)'), private.clean(ar, 80), private.clean(addr, 120),
           extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography, p_tile, now()
    from (
      select (el ->> 'type') || '/' || (el ->> 'id') as id,
             coalesce(el -> 'tags' ->> 'name:en', el -> 'tags' ->> 'name', el -> 'tags' ->> 'name:ar') as nm,
             el -> 'tags' ->> 'name:ar' as ar,
             concat_ws(', ', nullif(concat_ws(' ', el -> 'tags' ->> 'addr:housenumber', el -> 'tags' ->> 'addr:street'), ''),
                       coalesce(el -> 'tags' ->> 'addr:suburb', el -> 'tags' ->> 'addr:neighbourhood'), el -> 'tags' ->> 'addr:city') as addr,
             coalesce((el ->> 'lat')::float8, (el -> 'center' ->> 'lat')::float8) as lat,
             coalesce((el ->> 'lon')::float8, (el -> 'center' ->> 'lon')::float8) as lng
      from jsonb_array_elements(coalesce(body::jsonb -> 'elements', '[]'::jsonb)) el
    ) x
    where id ~ '^(node|way|relation)/[0-9]{1,12}$' and lat between -90 and 90 and lng between -180 and 180
    on conflict (osm_id) do update set name = excluded.name, name_ar = excluded.name_ar, address = excluded.address,
      location = excluded.location, tile = excluded.tile, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  delete from public.masjids where tile = p_tile and updated_at < started; -- no longer on the map
  update private.import_tiles set status = 'ok', found = n, refreshed_at = now(), priority = least(priority, 100) where tile = p_tile;
  return n;
end $$;

/** Called every minute by pg_cron: refresh the most important tile that is missing or older than a week. */
create or replace function private.refresh_next_tile() returns int language plpgsql security definer set search_path = private, pg_temp as $$
declare v text;
begin
  if not pg_try_advisory_xact_lock(424242) then return 0; end if; -- never two at once
  select tile into v from private.import_tiles
    where refreshed_at is null or refreshed_at < now() - interval '7 days'
    order by priority desc, refreshed_at nulls first limit 1;
  if v is null then return 0; end if;
  return private.refresh_tile(v);
end $$;

/** The masjids nearest to a point, nearest first. If the area isn't loaded yet, it is queued next (the app falls back to OpenStreetMap meanwhile). */
create or replace function public.nearest_masjids(p_lat double precision, p_lng double precision, p_limit int default 25)
returns table (osm_id text, name text, name_ar text, address text, lat double precision, lng double precision, km double precision)
language plpgsql security definer set search_path = public, private, extensions, pg_temp as $$
declare p extensions.geography; nearest float8;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Bad location.' using errcode = '22023'; end if;
  if not private.under_limit('mq:' || private.client_ip(), 300, interval '1 hour') then raise exception 'Too many requests. Try again later.' using errcode = 'P0001'; end if;
  p := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  return query
    select m.osm_id, m.name, m.name_ar, m.address, extensions.st_y(m.location::extensions.geometry), extensions.st_x(m.location::extensions.geometry),
           extensions.st_distance(m.location, p) / 1000
    from public.masjids m order by m.location operator(extensions.<->) p limit least(greatest(coalesce(p_limit, 25), 1), 50);
  select extensions.st_distance(m.location, p) / 1000 into nearest from public.masjids m order by m.location operator(extensions.<->) p limit 1;
  if nearest is null or nearest > 30 then
    update private.import_tiles set priority = 1000 where tile = floor(p_lat)::int || ':' || floor(p_lng)::int and (refreshed_at is null or status <> 'ok');
  end if;
end $$;

/** Owner dashboard numbers (anonymous counts only). */
create or replace function public.admin_stats() returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_owner() then raise exception 'Owner only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'generatedAt', now(),
    'today', jsonb_build_object(
      'active', (select count(*) from private.actives where day = d),
      'opens', coalesce((select sum(count) from private.metrics where day = d and kind = 'open'), 0),
      'views', coalesce((select sum(count) from private.metrics where day = d and kind = 'view'), 0),
      'directions', coalesce((select sum(count) from private.metrics where day = d and kind = 'directions'), 0)),
    'activeByDay', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day) from (select day, count(*) n from private.actives where day > d - 14 group by day) x), '[]'),
    'topMasjids', coalesce((select jsonb_agg(t) from (
        select m.key as osm_id, coalesce(max(x.name), m.key) as name,
               sum(case when m.kind = 'directions' then m.count else 0 end) as directions,
               sum(case when m.kind = 'view' then m.count else 0 end) as views
        from private.metrics m left join public.masjids x on x.osm_id = m.key
        where m.kind in ('view', 'directions') and m.day > d - 7 group by m.key order by 3 desc, 4 desc limit 10) t), '[]'),
    'totals', jsonb_build_object(
      'authorities', (select count(*) from public.profiles where not is_owner),
      'pending', (select count(*) from public.masjid_admins where status = 'pending'),
      'published', (select count(*) from public.prayer_times),
      'updates7d', (select count(*) from private.prayer_times_history where changed_at > now() - interval '7 days'),
      'masjidsInDirectory', (select count(*) from public.masjids),
      'tilesLoaded', (select count(*) from private.import_tiles where status = 'ok'),
      'tilesTotal', (select count(*) from private.import_tiles)));
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.nearest_masjids(double precision, double precision, int), public.admin_stats() from public;
grant execute on function public.nearest_masjids(double precision, double precision, int) to anon, authenticated;
grant execute on function public.admin_stats() to authenticated;

-- scheduled jobs (pg_cron runs as the database owner)
select cron.schedule('qarib-directory', '* * * * *', 'select private.refresh_next_tile()');
select cron.schedule('qarib-housekeeping', '17 3 * * *', 'select private.housekeeping()');

-- tiles that failed before the timeout fix (or during a server outage) go back to the front of the queue
update private.import_tiles set refreshed_at = null, status = null where status like 'failed%';
