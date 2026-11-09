create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists pairs (
  id text primary key,
  status text not null,
  purpose text not null default 'play',
  tv_id text,
  token text,
  token_expires_at timestamptz,
  expires_in integer,
  session_id text,
  error text,
  album_id text,
  album_name text,
  member_token text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists pairs_expires_idx on pairs (expires_at);

create table if not exists shared_albums (
  id text primary key,
  name text not null,
  owner_hash text not null,
  join_code text not null unique,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_albums_owner_idx on shared_albums (owner_hash);

create table if not exists shared_members (
  album_id text not null references shared_albums (id) on delete cascade,
  tv_id text not null,
  token_hash text not null,
  revoked_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (album_id, tv_id)
);

create table if not exists shared_photos (
  id text primary key,
  album_id text not null references shared_albums (id) on delete cascade,
  google_id text not null,
  filename text,
  mime text not null,
  taken bigint not null default 0,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

create unique index if not exists shared_photos_google_idx on shared_photos (album_id, google_id);
create index if not exists shared_photos_album_idx on shared_photos (album_id);

create table if not exists share_jobs (
  id text primary key,
  album_id text not null references shared_albums (id) on delete cascade,
  session_id text,
  token text,
  expires_at timestamptz,
  status text not null,
  cursor_at integer not null default 0,
  items_json text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists share_jobs_album_idx on share_jobs (album_id, created_at desc);
