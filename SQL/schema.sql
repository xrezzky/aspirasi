-- =========================================================
--  Aspirasi Aqilah — Skema Supabase (Auth + Role + RLS)
--  Dibuat/diperbaiki oleh: xrezzky
--
--  CARA PAKAI:
--  1. Buka project Supabase kamu -> SQL Editor -> New query.
--  2. Tempel SELURUH isi file ini -> Run.
--  3. Aktifkan Email/Password di Authentication -> Providers.
--     (Kalau tidak mau verifikasi email dulu, matikan "Confirm email"
--      di Authentication -> Settings, karena verifikasi akun tetap
--      dipegang manual oleh OWNER lewat kolom status di bawah.)
--  4. Buka halaman admin.html -> daftar akun pertama kamu (ini akan
--     otomatis masuk sebagai role 'anggota' & status 'pending').
--  5. Jalankan BLOK BOOTSTRAP OWNER di paling bawah file ini (ganti
--     email-nya) supaya akun pertama kamu jadi 'owner' + 'approved'.
--     Setelah itu, owner bisa approve & atur role anggota lain lewat
--     tab "Kelola Akun" di admin.html — tidak perlu SQL manual lagi.
-- =========================================================

-- ---------------------------------------------------------
-- 1. TABEL PROFIL (akun staf: owner / admin / anggota)
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  email      text,
  role       text not null default 'anggota' check (role in ('owner','admin','anggota')),
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ---------------------------------------------------------
-- 2. TABEL ASPIRASI
-- ---------------------------------------------------------
create table if not exists public.aspirasi (
  id         bigint generated always as identity primary key,
  code       text unique not null,
  kategori   text not null,
  jenjang    text not null,
  kelas      text not null,
  pesan      text not null,
  solusi     text not null,
  nama       text default '',
  kontak     text default '',
  status     text not null default 'Diterima' check (status in ('Diterima','Diproses','Selesai')),
  balasan    text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.aspirasi enable row level security;

-- ---------------------------------------------------------
-- 3. GENERATOR KODE "DHEKA-XXXXXX" DI SISI DATABASE
--    (menghindari duplikat kode saat submit bersamaan)
-- ---------------------------------------------------------
create or replace function public.gen_dheka_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- tanpa I,O,0,1
  out_code text;
  i int;
begin
  loop
    out_code := 'DHEKA-';
    for i in 1..6 loop
      out_code := out_code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.aspirasi where code = out_code);
  end loop;
  return out_code;
end;
$$;

alter table public.aspirasi
  alter column code set default public.gen_dheka_code();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_aspirasi_updated_at on public.aspirasi;
create trigger trg_aspirasi_updated_at
  before update on public.aspirasi
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- 4. AUTO-BUAT PROFIL SAAT ADA YANG DAFTAR (signup)
--    role & status TIDAK bisa diatur dari client -> selalu
--    dipaksa 'anggota' / 'pending' di sini. Ini mencegah orang
--    daftar terus klaim jadi admin/owner sendiri.
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    'anggota',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------
-- 5. HELPER: cek role user yang sedang login (dipakai di RLS)
--    SECURITY DEFINER supaya tidak bentrok/rekursi dgn RLS
--    tabel profiles itu sendiri.
-- ---------------------------------------------------------
create or replace function public.is_approved_role(required text[])
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'approved'
      and role = any(required)
  );
$$;

-- ---------------------------------------------------------
-- 6. RLS: PROFILES
--    - siapapun yg login boleh lihat baris miliknya sendiri
--      (buat cek status pending/approved/rejected miliknya)
--    - OWNER boleh lihat & ubah SEMUA baris (approve, ganti
--      role, tolak akun) -> ini fitur "Kelola Akun"
--    - insert HANYA lewat trigger handle_new_user() di atas
--      (tidak ada policy insert utk client -> ditolak default)
-- ---------------------------------------------------------
drop policy if exists "profiles_select_self_or_owner" on public.profiles;
create policy "profiles_select_self_or_owner"
  on public.profiles for select
  using ( id = auth.uid() or public.is_approved_role(array['owner']) );

drop policy if exists "profiles_update_owner_only" on public.profiles;
create policy "profiles_update_owner_only"
  on public.profiles for update
  using ( public.is_approved_role(array['owner']) )
  with check ( public.is_approved_role(array['owner']) );

drop policy if exists "profiles_delete_owner_only" on public.profiles;
create policy "profiles_delete_owner_only"
  on public.profiles for delete
  using ( public.is_approved_role(array['owner']) );

-- ---------------------------------------------------------
-- 7. RLS: ASPIRASI
--    - publik (pengunjung situs, belum login) boleh INSERT
--      saja (kirim aspirasi) -> tidak bisa baca isi tabel
--    - owner & admin: boleh SELECT semua baris + UPDATE
--      (balas & ubah status)
--    - anggota: boleh SELECT semua baris (lihat saja),
--      TIDAK boleh UPDATE/DELETE
--    - hanya owner yang boleh DELETE
-- ---------------------------------------------------------
drop policy if exists "aspirasi_insert_public" on public.aspirasi;
create policy "aspirasi_insert_public"
  on public.aspirasi for insert
  to anon, authenticated
  with check ( true );

drop policy if exists "aspirasi_select_staff" on public.aspirasi;
create policy "aspirasi_select_staff"
  on public.aspirasi for select
  to authenticated
  using ( public.is_approved_role(array['owner','admin','anggota']) );

drop policy if exists "aspirasi_update_admin_owner" on public.aspirasi;
create policy "aspirasi_update_admin_owner"
  on public.aspirasi for update
  to authenticated
  using ( public.is_approved_role(array['owner','admin']) )
  with check ( public.is_approved_role(array['owner','admin']) );

drop policy if exists "aspirasi_delete_owner_only" on public.aspirasi;
create policy "aspirasi_delete_owner_only"
  on public.aspirasi for delete
  to authenticated
  using ( public.is_approved_role(array['owner']) );

-- Catatan soal role "anggota" & data kontak:
-- Anggota tetap bisa SELECT baris aspirasi (supaya bisa lihat
-- daftar & isi masukan), tapi di admin.html kolom "Nama" dan
-- "Kontak" sengaja DISEMBUNYIKAN dari tampilan untuk role
-- anggota (dibatasi di sisi aplikasi/UI, bukan di database),
-- dan anggota tidak diberi tombol balas/ubah status sama
-- sekali (itu DIKUNCI di database lewat RLS di atas, jadi
-- walau anggota coba lewat console/devtools, update akan
-- ditolak oleh Supabase).

-- ---------------------------------------------------------
-- 8. RPC PUBLIK: cek status aspirasi pakai kode DHEKA
--    (tanpa perlu login, tanpa bisa SELECT * ke seluruh tabel)
-- ---------------------------------------------------------
create or replace function public.cek_aspirasi(p_code text)
returns table (
  code text, kategori text, jenjang text, kelas text,
  pesan text, solusi text, status text, balasan text, created_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select code, kategori, jenjang, kelas, pesan, solusi, status, balasan, created_at
  from public.aspirasi
  where code = upper(p_code)
  limit 1;
$$;

grant execute on function public.cek_aspirasi(text) to anon, authenticated;

-- =========================================================
--  BOOTSTRAP OWNER (jalankan SEKALI, manual, setelah kamu
--  daftar akun pertama lewat admin.html)
-- =========================================================
-- update public.profiles
--   set role = 'owner', status = 'approved'
--   where id = (select id from auth.users where email = 'EMAIL_OWNER_KAMU@example.com');
