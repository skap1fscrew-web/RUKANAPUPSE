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

-- Атомарное добавление интеграции из Telegram. Вызывается только сервером.
create table if not exists public.telegram_blogger_requests (
  id uuid primary key, actor text not null, result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_blogger_requests enable row level security;
revoke all on public.telegram_blogger_requests from anon, authenticated;
grant all on public.telegram_blogger_requests to service_role;
create or replace function public.save_telegram_blogger(p_actor text, p_request uuid, p_product uuid, p_date date, p_entry jsonb, p_blogger jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare prior record; product jsonb; bloggers jsonb; blogger jsonb; entry jsonb; result jsonb; entries jsonb; daykey text;
begin
  if not exists (select 1 from public.settings s, jsonb_array_elements(s.value) x join public.allowed_emails a on lower(a.email)=lower(x->>'email') where s.key='profiles' and x->>'id'=p_actor) then raise exception 'Нет доступа'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into prior from public.telegram_blogger_requests where id=p_request;
  if found then
    if prior.actor<>p_actor then raise exception 'Недоступная запись'; end if;
    return prior.result;
  end if;
  insert into public.settings(key,value) values ('bloggerDB','[]') on conflict(key) do nothing;
  select value into bloggers from public.settings where key='bloggerDB' for update;
  if coalesce(p_blogger->>'id','')<>'' then
    select x into blogger from jsonb_array_elements(bloggers) x where x->>'id'=p_blogger->>'id' and coalesce(x->>'deletedAt','')='';
    if blogger is null then raise exception 'Блогер больше недоступен'; end if;
  else
    if length(trim(coalesce(p_blogger->>'name','')))=0 then raise exception 'Укажите блогера'; end if;
    select x into blogger from jsonb_array_elements(bloggers) x where lower(trim(x->>'name'))=lower(trim(p_blogger->>'name')) and coalesce(x->>'deletedAt','')='' limit 1;
    if blogger is null then
      blogger=p_blogger || jsonb_build_object('id',gen_random_uuid()::text,'name',trim(p_blogger->>'name'));
      update public.settings set value=bloggers || jsonb_build_array(blogger),updated_at=now() where key='bloggerDB';
    end if;
  end if;
  select data into product from public.products where id=p_product for update;
  if product is null or coalesce(product->>'deletedAt','')<>'' then raise exception 'Товар больше недоступен'; end if;
  if p_date is null then raise exception 'Укажите дату'; end if;
  entry=p_entry || jsonb_build_object('id',p_request::text,'who',blogger->>'name','done',false,'createdBy',p_actor,'createdAt',now(),'source','telegram');
  daykey='bloggers:'||p_date::text;
  entries=coalesce(product#>'{rnp,entries}','{}'::jsonb);
  entries=entries || jsonb_build_object(daykey,coalesce(entries->daykey,'[]'::jsonb) || jsonb_build_array(entry));
  update public.products set data=jsonb_set(product,'{rnp}',coalesce(product->'rnp','{}'::jsonb)||jsonb_build_object('entries',entries)),updated_at=now() where id=p_product;
  result=jsonb_build_object('entryId',p_request,'product',product->>'name','code',product->>'code','blogger',blogger->>'name','date',p_date);
  insert into public.telegram_blogger_requests(id,actor,result) values(p_request,p_actor,result);
  return result;
end;
$$;
revoke all on function public.save_telegram_blogger(text,uuid,uuid,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_telegram_blogger(text,uuid,uuid,date,jsonb,jsonb) to service_role;
