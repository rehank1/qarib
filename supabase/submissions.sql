-- Qarib on Supabase · part 3: masjids added by hand (name, full address, pin on the map). Run after directory.sql.
-- A signed-in user submits; the owner approves in the dashboard; approval adds it to the directory (id "qarib/<n>")
-- and makes the submitter its approved imam. The weekly OpenStreetMap refresh never touches these.

-- ids: OpenStreetMap ("node/123") or added by hand ("qarib/45")
do $$ begin
  alter table public.masjids drop constraint if exists masjids_osm_id_check;
  alter table public.masjids add constraint masjids_osm_id_check check (osm_id ~ '^((node|way|relation)/[0-9]{1,12}|qarib/[0-9]{1,9})$');
  alter table public.masjid_admins drop constraint if exists masjid_admins_osm_id_check;
  alter table public.masjid_admins add constraint masjid_admins_osm_id_check check (osm_id ~ '^((node|way|relation)/[0-9]{1,12}|qarib/[0-9]{1,9})$');
  alter table public.prayer_times drop constraint if exists prayer_times_osm_id_check;
  alter table public.prayer_times add constraint prayer_times_osm_id_check check (osm_id ~ '^((node|way|relation)/[0-9]{1,12}|qarib/[0-9]{1,9})$');
end $$;

create table if not exists public.masjid_submissions (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 80),
  street     text not null check (char_length(street) between 2 and 120),
  area       text not null check (char_length(area) between 2 and 80),
  city       text not null check (char_length(city) between 2 and 60),
  state      text not null check (char_length(state) between 2 and 40),
  pincode    text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  lat        double precision not null check (lat between 6 and 37.5),   -- India
  lng        double precision not null check (lng between 68 and 97.5),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
alter table public.masjid_submissions enable row level security;
drop policy if exists "read own submissions" on public.masjid_submissions;
create policy "read own submissions" on public.masjid_submissions for select to authenticated using (user_id = auth.uid());

create or replace function private.clean_text(t text, max int) returns text language sql immutable as $$
  select nullif(left(trim(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''), '<[^<>]*>', '', 'g'), '[[:cntrl:]<>]', '', 'g'), '\s+', ' ', 'g')), max), '')
$$;

/** Add a masjid that is not on the map yet. Pending until the owner approves. */
create or replace function public.submit_masjid(p_name text, p_street text, p_area text, p_city text, p_state text, p_pincode text, p_lat double precision, p_lng double precision)
returns bigint language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_id bigint;
begin
  if auth.uid() is null then raise exception 'Please sign in to add a masjid.' using errcode = '28000'; end if;
  if (select count(*) from public.masjid_submissions where user_id = auth.uid() and status = 'pending') >= 3 then
    raise exception 'You have 3 masjids waiting for approval. Please wait for those first.' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null or p_lat not between 6 and 37.5 or p_lng not between 68 and 97.5 then
    raise exception 'Place the pin on the masjid (inside India).' using errcode = '22023';
  end if;
  insert into public.masjid_submissions (name, street, area, city, state, pincode, lat, lng)
    values (private.clean_text(p_name, 80), private.clean_text(p_street, 120), private.clean_text(p_area, 80), private.clean_text(p_city, 60),
            private.clean_text(p_state, 40), trim(coalesce(p_pincode, '')), p_lat, p_lng)
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_submissions() returns table (id bigint, email text, name text, address text, lat double precision, lng double precision, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_owner() then raise exception 'Owner only.' using errcode = '42501'; end if;
  return query select s.id, u.email::text, s.name, concat_ws(', ', s.street, s.area, s.city, s.state || ' ' || s.pincode), s.lat, s.lng, s.created_at
    from public.masjid_submissions s join auth.users u on u.id = s.user_id where s.status = 'pending' order by s.created_at limit 100;
end $$;

/** Approve → it joins the directory as qarib/<id> and its submitter becomes its approved imam. Reject → nothing is added. */
create or replace function public.decide_submission(p_id bigint, p_status text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare s record; v_osm text;
begin
  if not public.is_owner() then raise exception 'Owner only.' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Bad status.' using errcode = '22023'; end if;
  update public.masjid_submissions set status = p_status where id = p_id and status = 'pending' returning * into s;
  if not found then raise exception 'Not found or already decided.' using errcode = 'P0002'; end if;
  if p_status = 'rejected' then return null; end if;
  v_osm := 'qarib/' || s.id;
  insert into public.masjids (osm_id, name, address, location, tile, updated_at)
    values (v_osm, s.name, concat_ws(', ', s.street, s.area, s.city, s.state || ' ' || s.pincode),
            extensions.st_setsrid(extensions.st_makepoint(s.lng, s.lat), 4326)::extensions.geography, 'user', now())
    on conflict (osm_id) do nothing;
  insert into public.masjid_admins (user_id, osm_id, masjid_name, status) values (s.user_id, v_osm, s.name, 'approved')
    on conflict (user_id, osm_id) do update set status = 'approved';
  return v_osm;
end $$;

-- the OpenStreetMap refresh must never delete masjids added by hand (they use tile 'user'); belt and braces:
create or replace function private.protect_user_masjids() returns trigger language plpgsql as $$
begin
  if old.osm_id like 'qarib/%' and current_setting('qarib.allow_user_delete', true) is distinct from 'on' then return null; end if;
  return old;
end $$;
drop trigger if exists protect_user_masjids on public.masjids;
create trigger protect_user_masjids before delete on public.masjids for each row execute function private.protect_user_masjids();

revoke all on public.masjid_submissions from anon, authenticated;
grant select on public.masjid_submissions to authenticated;
revoke execute on function public.submit_masjid(text, text, text, text, text, text, double precision, double precision),
  public.admin_submissions(), public.decide_submission(bigint, text) from public, anon;
grant execute on function public.submit_masjid(text, text, text, text, text, text, double precision, double precision),
  public.admin_submissions(), public.decide_submission(bigint, text) to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
