-- الدخول بالبصمة أو الوجه (Passkeys / WebAuthn): المفتاح الخاص يبقى في الجهاز، والسيرفر يحفظ المفتاح العام فقط
create table if not exists user_passkeys (
  id            serial primary key,
  user_id       int not null references users(id) on delete cascade,
  credential_id text not null unique,          -- base64url
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  device_name   text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists user_passkeys_user on user_passkeys(user_id);

create table if not exists webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    int references users(id) on delete cascade,
  kind       text not null check (kind in ('register', 'login')),
  challenge  text not null,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
