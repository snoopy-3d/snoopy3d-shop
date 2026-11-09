-- Начальная схема для нового проекта Supabase. Учётная запись владельца создаётся через Auth Dashboard.
create extension if not exists pgcrypto;
create table if not exists public.products(id uuid primary key default gen_random_uuid(),name text not null,category text not null default 'Другое',description text not null default '',price numeric(12,2) not null check(price>=0),image_url text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.orders(id uuid primary key default gen_random_uuid(),order_number text unique not null default ('S3D-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),email text not null,name text,phone text,telegram text,comment text,service text,task text,file_link text,items jsonb not null default '[]'::jsonb,total numeric(12,2) not null default 0,status text not null default 'Новый',created_at timestamptz not null default now());
create table if not exists public.admins(user_id uuid primary key references auth.users(id) on delete cascade);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.admins where user_id=auth.uid())$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
alter table public.products add column if not exists images jsonb not null default '[]'::jsonb;

revoke all privileges on public.products, public.orders, public.admins from anon, authenticated, service_role;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select (id, name, price, active) on public.products to service_role;
grant select, update on public.orders to authenticated;
grant select, insert on public.orders to service_role;
grant select on public.admins to authenticated;

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.admins enable row level security;
create policy "public visible products" on public.products for select to anon, authenticated using (active);
create policy "admins view all products" on public.products for select to authenticated using ((select public.is_admin()));
create policy "admin insert products" on public.products for insert to authenticated with check(public.is_admin());
create policy "admin update products" on public.products for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin delete products" on public.products for delete to authenticated using(public.is_admin());
create policy "admin view orders" on public.orders for select to authenticated using(public.is_admin());
create policy "admin update orders" on public.orders for update to authenticated using(public.is_admin()) with check(public.is_admin());
-- Нет политики на публичную вставку заказов: только серверная функция с service_role.
-- После создания и подтверждения учётной записи snoopy_3d@bk.ru в Auth -> Users:
-- Указать UID этой учётной записи, а не адрес или пароль.
-- insert into public.admins(user_id) values ('UUID-АДМИНИСТРАТОРА');

-- Администратор может проверить только собственное членство.
create policy "admin own membership" on public.admins for select to authenticated using(user_id=auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "snoopy admin upload images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));
create policy "snoopy admin delete images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
