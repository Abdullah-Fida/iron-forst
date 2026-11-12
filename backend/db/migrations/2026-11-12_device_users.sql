-- Users stored on the fingerprint machine, as the machine reports them.
--
-- Additive only: a new table, nothing existing is changed. The app works
-- without it (the device screen says the table is missing); scans and the door
-- never depend on it.
--
-- A row is one PIN (= the member's fingerprint ID) on one device. It is linked
-- to a member by matching members.fingerprint_id, never by a stored foreign
-- key, so editing a member's fingerprint ID re-links automatically.

create table if not exists public.device_users (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  device_sn     text not null,
  pin           text not null,
  name          text,                   -- name typed on the machine, if any
  privilege     integer,                -- 0 = normal user, 14 = admin
  card          text,
  fingers       integer,                -- fingerprints enrolled, when reported
  has_face      boolean,
  source        text not null default 'device_list',
                                        -- initial     = first full read of the machine
                                        -- device_list = appeared in a later full read
                                        -- enrolment   = machine reported a new enrolment
                                        -- scan        = scanned at the door with no member
  first_seen_at timestamptz not null default now(),
  enrolled_at   timestamptz,            -- when the machine says it was enrolled
  last_seen_at  timestamptz not null default now(),
  last_scan_at  timestamptz,
  on_device     boolean not null default true,
  removed_at    timestamptz,
  dismissed_at  timestamptz,            -- hidden from "New registrations" by the owner
  unique (gym_id, device_sn, pin)
);

create index if not exists idx_device_users_gym on public.device_users (gym_id, on_device);

-- Only the backend (service role) reads or writes this table.
alter table public.device_users enable row level security;
