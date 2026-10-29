-- InPhoto Ore — schema del database
-- Persone (profili), clienti, progetti e fasce orarie compilate.
-- Gli account si creano solo dalla funzione admin-users (chiave di servizio):
-- nessuna policy permette di inserire o modificare i profili dal browser.

create schema if not exists private;

-- ---------- Profili ----------
create table public.profiles (
  id          uuid primary key,  -- stesso id dell'account di accesso; resta anche se l'account viene eliminato
  full_name   text not null check (char_length(full_name) between 1 and 80),
  email       text not null,
  role        text not null default 'operatore' check (role in ('admin', 'operatore')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz            -- account eliminato: nome e ore restano nei resoconti
);

-- Funzioni di controllo usate dalle policy (schema privato, non esposto dalle API)
create or replace function private.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active);
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and p.role = 'admin');
$$;

revoke all on function private.is_member(), private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_member(), private.is_admin() to authenticated;

-- ---------- Clienti ----------
create table public.clients (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  archived    boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index clients_name_unique on public.clients (lower(btrim(name)));

-- ---------- Progetti (sempre legati a un cliente) ----------
create table public.projects (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references public.clients (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  archived    boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (id, client_id)
);
create unique index projects_name_unique on public.projects (client_id, lower(btrim(name)));
create index projects_client_idx on public.projects (client_id);

-- ---------- Fasce compilate (una riga = 30 minuti di una persona) ----------
create table public.entries (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day          date not null,
  slot         smallint not null check (slot between 0 and 47),   -- 0 = 00:00, 18 = 09:00, 47 = 23:30
  description  text not null default '' check (char_length(description) <= 500),
  client_id    bigint references public.clients (id) on delete restrict,
  project_id   bigint,
  is_lunch     boolean not null default false,
  updated_at   timestamptz not null default now(),
  unique (user_id, day, slot),
  -- il progetto deve appartenere al cliente scelto
  foreign key (project_id, client_id) references public.projects (id, client_id) on delete restrict,
  check (project_id is null or client_id is not null)
);
create index entries_day_idx on public.entries (day);
create index entries_client_idx on public.entries (client_id);
create index entries_project_idx on public.entries (project_id);

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
create trigger entries_touch before update on public.entries
  for each row execute function private.touch_updated_at();

-- ---------- Permessi ----------
revoke all on public.profiles, public.clients, public.projects, public.entries from anon;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.clients, public.projects to authenticated;
grant update (name, archived) on public.clients, public.projects to authenticated;  -- solo nome e archiviazione
grant select, insert, update, delete on public.entries to authenticated;

alter table public.profiles enable row level security;
alter table public.clients  enable row level security;
alter table public.projects enable row level security;
alter table public.entries  enable row level security;

-- Profili: ogni membro attivo vede l'elenco del team (nomi), nessuno lo modifica dal browser
create policy "membri leggono il team" on public.profiles
  for select to authenticated using ((select private.is_member()));

-- Clienti e progetti: tutti i membri leggono, aggiungono, rinominano e archiviano; solo l'admin elimina
create policy "membri leggono clienti" on public.clients
  for select to authenticated using ((select private.is_member()));
create policy "membri aggiungono clienti" on public.clients
  for insert to authenticated with check ((select private.is_member()) and created_by = (select auth.uid()));
create policy "membri modificano clienti" on public.clients
  for update to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy "admin elimina clienti" on public.clients
  for delete to authenticated using ((select private.is_admin()));

create policy "membri leggono progetti" on public.projects
  for select to authenticated using ((select private.is_member()));
create policy "membri aggiungono progetti" on public.projects
  for insert to authenticated with check ((select private.is_member()) and created_by = (select auth.uid()));
create policy "membri modificano progetti" on public.projects
  for update to authenticated using ((select private.is_member())) with check ((select private.is_member()));
create policy "admin elimina progetti" on public.projects
  for delete to authenticated using ((select private.is_admin()));

-- Fasce: ognuno vede e scrive solo le proprie; l'admin le legge tutte
create policy "leggo le mie fasce, admin tutte" on public.entries
  for select to authenticated
  using ((select private.is_member()) and (user_id = (select auth.uid()) or (select private.is_admin())));
create policy "scrivo le mie fasce" on public.entries
  for insert to authenticated
  with check ((select private.is_member()) and user_id = (select auth.uid()));
create policy "modifico le mie fasce" on public.entries
  for update to authenticated
  using ((select private.is_member()) and user_id = (select auth.uid()))
  with check ((select private.is_member()) and user_id = (select auth.uid()));
create policy "cancello le mie fasce" on public.entries
  for delete to authenticated
  using ((select private.is_member()) and user_id = (select auth.uid()));

-- ---------- Tipologie dei progetti (vedi anche lo script di aggiornamento) ----------

create table if not exists public.project_types (
  id        bigint generated always as identity primary key,
  name      text not null check (char_length(btrim(name)) between 1 and 40),
  sort      int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists project_types_name_unique on public.project_types (lower(btrim(name)));

create table if not exists public.project_type_links (
  project_id bigint not null references public.projects (id) on delete cascade,
  type_id    bigint not null references public.project_types (id) on delete cascade,
  primary key (project_id, type_id)
);
create index if not exists project_type_links_type_idx on public.project_type_links (type_id);

revoke all on public.project_types, public.project_type_links from anon;
grant select, insert, update, delete on public.project_types to authenticated;
grant select, insert, delete on public.project_type_links to authenticated;

alter table public.project_types enable row level security;
alter table public.project_type_links enable row level security;

drop policy if exists "membri leggono tipologie" on public.project_types;
drop policy if exists "admin aggiunge tipologie" on public.project_types;
drop policy if exists "admin modifica tipologie" on public.project_types;
drop policy if exists "admin elimina tipologie" on public.project_types;
create policy "membri leggono tipologie" on public.project_types for select to authenticated using ((select private.is_member()));
create policy "admin aggiunge tipologie" on public.project_types for insert to authenticated with check ((select private.is_admin()));
create policy "admin modifica tipologie" on public.project_types for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin elimina tipologie" on public.project_types for delete to authenticated using ((select private.is_admin()));

drop policy if exists "membri leggono assegnazioni" on public.project_type_links;
drop policy if exists "membri assegnano tipologie" on public.project_type_links;
drop policy if exists "membri tolgono tipologie" on public.project_type_links;
create policy "membri leggono assegnazioni" on public.project_type_links for select to authenticated using ((select private.is_member()));
create policy "membri assegnano tipologie" on public.project_type_links for insert to authenticated with check ((select private.is_member()));
create policy "membri tolgono tipologie" on public.project_type_links for delete to authenticated using ((select private.is_member()));

alter table public.entries add column if not exists type_id bigint references public.project_types (id) on delete set null;
create index if not exists entries_type_idx on public.entries (type_id);

insert into public.project_types (name, sort)
select v.name, v.sort from (values ('Foto', 1), ('Video', 2), ('Social e Web', 3), ('Grafica', 4)) as v(name, sort)
where not exists (select 1 from public.project_types);

-- ---------- Tipo di cliente ----------
alter table public.clients add column if not exists kind text check (kind in ('commerciale', 'privato'));
grant update (kind) on public.clients to authenticated;
