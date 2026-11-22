-- РНП — схема базы для Supabase
-- Выполните целиком в Supabase → SQL Editor → New query → Run.

create table if not exists public.products (
  id         uuid primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.allowed_emails (
  email text primary key
);

-- ЗАМЕНИТЕ на ваши три e-mail:
insert into public.allowed_emails (email) values
  ('user1@example.com'),
  ('user2@example.com'),
  ('user3@example.com')
on conflict (email) do nothing;

create or replace function public.is_allowed()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.allowed_emails where email = (auth.jwt() ->> 'email'));
$$;

alter table public.products       enable row level security;
alter table public.settings       enable row level security;
alter table public.allowed_emails enable row level security;

drop policy if exists "products_select" on public.products;
drop policy if exists "products_write"  on public.products;
create policy "products_select" on public.products for select using (public.is_allowed());
create policy "products_write"  on public.products for all using (public.is_allowed()) with check (public.is_allowed());

drop policy if exists "settings_select" on public.settings;
drop policy if exists "settings_write"  on public.settings;
create policy "settings_select" on public.settings for select using (public.is_allowed());
create policy "settings_write"  on public.settings for all using (public.is_allowed()) with check (public.is_allowed());

alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.settings;

-- Droprise: отдельные данные электроники в той же базе.
-- Профили пользователей остаются общими в settings.profiles.
create table if not exists public.droprise_products (
  id uuid primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
create table if not exists public.droprise_jobs (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
create table if not exists public.droprise_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
alter table public.droprise_products enable row level security;
alter table public.droprise_jobs enable row level security;
alter table public.droprise_settings enable row level security;
drop policy if exists droprise_products_allowed on public.droprise_products;
drop policy if exists droprise_jobs_allowed on public.droprise_jobs;
drop policy if exists droprise_settings_allowed on public.droprise_settings;
create policy droprise_products_allowed on public.droprise_products for all to authenticated using(public.is_allowed()) with check(public.is_allowed());
create policy droprise_jobs_allowed on public.droprise_jobs for all to authenticated using(public.is_allowed()) with check(public.is_allowed());
create policy droprise_settings_allowed on public.droprise_settings for all to authenticated using(public.is_allowed()) with check(public.is_allowed());
grant select,insert,update,delete on public.droprise_products, public.droprise_jobs, public.droprise_settings to authenticated;
insert into public.droprise_settings(key,value) values
  ('agents','[]'), ('duties','{"areas":[],"people":[],"functions":[]}'),
  ('strategy','{"maps":[],"activeId":null}')
on conflict(key) do nothing;
do $$
declare table_name text;
begin
  foreach table_name in array array['droprise_products','droprise_jobs','droprise_settings'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end $$;
