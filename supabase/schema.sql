-- Qarib on Supabase · part 1 of 2: accounts, jamaat times, approvals, usage counts, app-update notice.
-- Run in Supabase → SQL Editor (safe to re-run). Then run directory.sql (the India masjid directory).
-- Security model: the database decides. Anyone may read published times; only an imam the owner approved may write
-- that masjid's times; who wrote what is stamped by the server and audited; every write path is rate-limited.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;                      -- not exposed by the API
revoke all on schema private from public, anon, authenticated;

-- ---------- owner flag (one row per account, created automatically) ----------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  is_owner   boolean not null default false,            -- set once by hand: update profiles set is_owner = true where user_id = …
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (user_id = auth.uid());

create or replace function private.new_profile() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin insert into public.profiles (user_id) values (new.id) on conflict do nothing; return new; end $$;
drop trigger if exists qarib_new_profile on auth.users;
create trigger qarib_new_profile after insert on auth.users for each row execute function private.new_profile();
insert into public.profiles (user_id) select id from auth.users on conflict do nothing; -- accounts made before this ran

create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_owner from public.profiles where user_id = auth.uid()), false)
$$;

-- ---------- who manages which masjid ----------
create table if not exists public.masjid_admins (
  user_id     uuid not null references auth.users (id) on delete cascade,
  osm_id      text not null check (osm_id ~ '^((node|way|relation)/[0-9]{1,12}|qarib/[0-9]{1,9})$'),
  masjid_name text not null check (char_length(masjid_name) between 1 and 80),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  primary key (user_id, osm_id)
);
alter table public.masjid_admins enable row level security;
drop policy if exists "read own claims" on public.masjid_admins;
create policy "read own claims" on public.masjid_admins for select to authenticated using (user_id = auth.uid());
-- no insert/update/delete policies: requests go through request_masjid(), decisions through decide_claim()

create or replace function public.is_masjid_admin(p_osm text) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.masjid_admins where user_id = auth.uid() and osm_id = p_osm and status = 'approved')
$$;

/** Ask to manage a masjid. Pending until the owner approves (the owner is approved at once). A rejected request may be made again. */
create or replace function public.request_masjid(p_osm text, p_name text) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := left(trim(regexp_replace(regexp_replace(coalesce(p_name, ''), '<[^<>]*>', '', 'g'), '[[:cntrl:]<>]', '', 'g')), 80);
        v_status text := case when public.is_owner() then 'approved' else 'pending' end;
        v_existing text;
begin
  if auth.uid() is null then raise exception 'Please sign in.' using errcode = '28000'; end if;
  if coalesce(p_osm, '') !~ '^((node|way|relation)/[0-9]{1,12}|qarib/[0-9]{1,9})$' or char_length(v_name) = 0 then raise exception 'Choose a masjid from the list.' using errcode = '22023'; end if;
  if (select count(*) from public.masjid_admins where user_id = auth.uid() and status = 'pending') >= 5 then
    raise exception 'Too many pending requests. Wait for approval first.' using errcode = 'P0001';
  end if;
  select status into v_existing from public.masjid_admins where user_id = auth.uid() and osm_id = p_osm;
  if v_existing in ('pending', 'approved') then raise exception 'You already asked for this masjid.' using errcode = '23505'; end if;
  insert into public.masjid_admins (user_id, osm_id, masjid_name, status) values (auth.uid(), p_osm, v_name, v_status)
    on conflict (user_id, osm_id) do update set status = excluded.status, masjid_name = excluded.masjid_name, created_at = now();
  return v_status;
end $$;

-- ---------- published jamaat times ----------
create table if not exists public.prayer_times (
  osm_id     text primary key check (osm_id ~ '^((node|way|relation)/[0-9]{1,12}|qarib/[0-9]{1,9})$'),
  fajr time not null, dhuhr time not null, asr time not null, maghrib time not null, isha time not null, jumuah time,
  updated_by uuid not null default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint in_order check (fajr < dhuhr and dhuhr < asr and asr < maghrib and maghrib < isha)
);
alter table public.prayer_times enable row level security;
drop policy if exists "anyone reads times" on public.prayer_times;
create policy "anyone reads times" on public.prayer_times for select to anon, authenticated using (true);
drop policy if exists "approved admins insert" on public.prayer_times;
create policy "approved admins insert" on public.prayer_times for insert to authenticated with check (public.is_masjid_admin(osm_id));
drop policy if exists "approved admins update" on public.prayer_times;
create policy "approved admins update" on public.prayer_times for update to authenticated using (public.is_masjid_admin(osm_id)) with check (public.is_masjid_admin(osm_id));

create table if not exists private.prayer_times_history (
  id bigserial primary key, osm_id text not null, times jsonb not null, changed_by uuid not null, changed_at timestamptz not null default now()
);
create index if not exists history_by_user on private.prayer_times_history (changed_by, changed_at);

create or replace function private.stamp_and_audit() returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if (select count(*) from private.prayer_times_history where changed_by = auth.uid() and changed_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many changes in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  new.updated_by := auth.uid();  -- the server, not the client, says who changed it
  new.updated_at := now();
  insert into private.prayer_times_history (osm_id, times, changed_by)
    values (new.osm_id, jsonb_build_object('fajr', new.fajr, 'dhuhr', new.dhuhr, 'asr', new.asr, 'maghrib', new.maghrib, 'isha', new.isha, 'jumuah', new.jumuah), auth.uid());
  return new;
end $$;
drop trigger if exists stamp_and_audit on public.prayer_times;
create trigger stamp_and_audit before insert or update on public.prayer_times for each row execute function private.stamp_and_audit();

-- ---------- owner: approvals and removals ----------
create or replace function public.admin_claims() returns table (user_id uuid, email text, osm_id text, masjid_name text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_owner() then raise exception 'Owner only.' using errcode = '42501'; end if;
  return query select a.user_id, u.email::text, a.osm_id, a.masjid_name, a.status, a.created_at
    from public.masjid_admins a join auth.users u on u.id = a.user_id
    where a.status in ('pending', 'approved') order by a.status desc, a.created_at limit 200;
end $$;

/** Approve, reject, or remove an imam; "hide" also takes that masjid's published times down (history keeps them). */
create or replace function public.decide_claim(p_user uuid, p_osm text, p_status text, p_hide boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_owner() then raise exception 'Owner only.' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Bad status.' using errcode = '22023'; end if;
  update public.masjid_admins set status = p_status where user_id = p_user and osm_id = p_osm;
  if not found then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if p_status = 'rejected' and p_hide then delete from public.prayer_times where osm_id = p_osm; end if;
end $$;

-- ---------- anonymous usage counts ----------
create table if not exists private.settings (id int primary key default 1 check (id = 1), pepper text not null);
insert into private.settings (pepper) values (encode(extensions.gen_random_bytes(32), 'hex')) on conflict do nothing;
create table if not exists private.metrics (day date not null, kind text not null, key text not null default '', count int not null default 0, primary key (day, kind, key));
create table if not exists private.actives (day date not null, id text not null, primary key (day, id));
create table if not exists private.hits (key text primary key, count int not null, reset_at timestamptz not null);

create or replace function private.client_ip() returns text language sql stable as $$
  select coalesce(nullif(trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown')
$$;
create or replace function private.under_limit(p_key text, p_max int, p_window interval) returns boolean language plpgsql security definer set search_path = private, pg_temp as $$
declare n int;
begin
  insert into private.hits (key, count, reset_at) values (p_key, 1, now() + p_window)
    on conflict (key) do update set count = case when hits.reset_at <= now() then 1 else hits.count + 1 end,
                                    reset_at = case when hits.reset_at <= now() then now() + p_window else hits.reset_at end
    returning count into n;
  return n <= p_max;
end $$;

/** One batch of anonymous events: { k: 'open' } | { k: 'view' | 'directions', id: 'node/123' }. No user ids, no location. */
create or replace function public.log_events(p_install uuid, p_events jsonb) returns void language plpgsql security definer set search_path = private, public, pg_temp as $$
declare e jsonb; d date := (now() at time zone 'Asia/Kolkata')::date; v_key text;
begin
  if p_install is null or jsonb_typeof(p_events) is distinct from 'array' then return; end if;
  if not private.under_limit('ev:' || private.client_ip(), 60, interval '1 hour') then return; end if;
  insert into private.actives (day, id)
    values (d, left(encode(extensions.digest(d::text || '|' || p_install::text || '|' || (select pepper from private.settings), 'sha256'), 'hex'), 22))
    on conflict do nothing;  -- a daily-rotating hash: the install id itself is never stored
  for e in select value from jsonb_array_elements(p_events) limit 20 loop
    if e ->> 'k' = 'open' then v_key := '';
    elsif e ->> 'k' in ('view', 'directions') and coalesce(e ->> 'id', '') ~ '^((node|way|relation)/[0-9]{1,12}|qarib/[0-9]{1,9})$' then v_key := e ->> 'id';
    else continue; end if;
    insert into private.metrics (day, kind, key, count) values (d, e ->> 'k', v_key, 1)
      on conflict (day, kind, key) do update set count = metrics.count + 1;
  end loop;
end $$;

-- ---------- "a new version is available": pushed from here, shown in the app ----------
create table if not exists public.app_config (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.app_config enable row level security;
drop policy if exists "anyone reads app config" on public.app_config;
create policy "anyone reads app config" on public.app_config for select to anon, authenticated using (true);

/** Owner announces a release: every installed app shows an update notice on its next open. */
create or replace function public.set_update_notice(p_version text, p_message text, p_url text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_owner() then raise exception 'Owner only.' using errcode = '42501'; end if;
  if coalesce(p_version, '') !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' then raise exception 'Version must look like 1.0.1.' using errcode = '22023'; end if;
  if coalesce(p_url, '') !~ '^https://github\.com/rehank1/qarib/releases/' then raise exception 'The link must be a Qarib GitHub release.' using errcode = '22023'; end if;
  insert into public.app_config (key, value, updated_at)
    values ('android_latest', jsonb_build_object('version', p_version, 'message', left(regexp_replace(coalesce(p_message, ''), '[<>]', '', 'g'), 300), 'url', p_url), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------- housekeeping (scheduled in directory.sql) ----------
create or replace function private.housekeeping() returns void language sql security definer set search_path = private, pg_temp as $$
  delete from private.hits where reset_at < now();
  delete from private.actives where day < current_date - 30;
  delete from private.metrics where day < current_date - 90;
$$;

-- ---------- least privilege ----------
revoke all on public.profiles, public.masjid_admins, public.prayer_times, public.app_config from anon, authenticated;
grant select on public.profiles, public.masjid_admins to authenticated;
grant select (osm_id, fajr, dhuhr, asr, maghrib, isha, jumuah, updated_at) on public.prayer_times to anon, authenticated; -- never who edited
-- update includes osm_id because PostgREST's upsert sets every sent column; RLS still requires approval for that osm_id
grant insert (osm_id, fajr, dhuhr, asr, maghrib, isha, jumuah), update (osm_id, fajr, dhuhr, asr, maghrib, isha, jumuah) on public.prayer_times to authenticated;
grant select on public.app_config to anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.is_owner(), public.is_masjid_admin(text), public.request_masjid(text, text),
  public.decide_claim(uuid, text, text, boolean), public.log_events(uuid, jsonb), public.set_update_notice(text, text, text), public.admin_claims() from public, anon;
grant execute on function public.is_owner(), public.is_masjid_admin(text), public.request_masjid(text, text),
  public.decide_claim(uuid, text, text, boolean), public.set_update_notice(text, text, text), public.admin_claims() to authenticated;
grant execute on function public.log_events(uuid, jsonb) to anon, authenticated;

-- ---------- hardening: nothing is reachable unless granted above ----------
-- the GraphQL endpoint is not used by the app: remove it (one less way in)
drop extension if exists pg_graphql;
-- anything created later in public starts closed: no table, function or sequence is visible to the app's keys until granted
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
