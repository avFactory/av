-- أرقام عمال صرف الألماس: 116 و 117 و 118 و 119
insert into settings(key, value) values ('diamond_worker_nos', '["116","117","118","119"]')
  on conflict (key) do update set value = excluded.value, updated_at = now();
