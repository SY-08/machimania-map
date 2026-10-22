-- =====================================================================
--  まちマニアMAP データベース設定
--  Supabase の「SQL Editor」にこのファイルを全部貼りつけて「Run」を押してください。
--  何度実行しても大丈夫なように書いてあります。
-- =====================================================================

-- ---------------------------------------------------------------------
-- プロフィール（名前・アバターの見た目）
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 12),
  avatar      jsonb not null default '{}'::jsonb check (pg_column_size(avatar) < 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select"     on public.profiles for select to authenticated using (true);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- 利用停止にした人（運営者が Table Editor から1行追加すると、その人はチャットできなくなります）
-- ---------------------------------------------------------------------
create table if not exists public.banned_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now()
);
alter table public.banned_users enable row level security;
drop policy if exists "banned_select_self" on public.banned_users;
create policy "banned_select_self" on public.banned_users for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- チャット（履歴と、通報されたときの確認用）
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  room        text not null check (char_length(room) between 1 and 40),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 12),
  kind        text not null check (kind in ('text', 'stamp')),
  body        text not null check (char_length(body) between 1 and 100),
  created_at  timestamptz not null default now()
);
create index if not exists messages_room_time on public.messages (room, created_at desc);
alter table public.messages enable row level security;
drop policy if exists "messages_select" on public.messages;
drop policy if exists "messages_insert" on public.messages;
-- 読めるのは直近7日分だけ
create policy "messages_select" on public.messages for select to authenticated
  using (created_at > now() - interval '7 days');
-- 書けるのは自分の名前で、利用停止されていない人だけ
create policy "messages_insert" on public.messages for insert to authenticated
  with check (user_id = auth.uid()
              and not exists (select 1 from public.banned_users b where b.user_id = auth.uid()));

-- 連投制限：10秒に5回まで
create or replace function public.messages_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.messages
      where user_id = new.user_id and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'rate limit: too many messages';
  end if;
  return new;
end $$;
drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.messages_rate_limit();

-- ---------------------------------------------------------------------
-- 通報（運営者だけが Table Editor で見られます）
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  reporter    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target      uuid not null,
  message_id  bigint references public.messages(id) on delete set null,
  reason      text check (char_length(reason) <= 400),
  created_at  timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports for insert to authenticated with check (reporter = auth.uid());

-- ---------------------------------------------------------------------
-- リアルタイム（位置・チャットの配信）
-- 町のチャンネルは「ログインしている人だけ」が入れる private チャンネルにします
-- ---------------------------------------------------------------------
drop policy if exists "machitsuku_realtime_receive" on realtime.messages;
drop policy if exists "machitsuku_realtime_send" on realtime.messages;
-- 部屋は「lobby」（全国の人数を数える）と「room:area○_○」（地域ごと）
create policy "machitsuku_realtime_receive" on realtime.messages for select to authenticated
  using (realtime.topic() like 'room:%' or realtime.topic() = 'lobby');
create policy "machitsuku_realtime_send" on realtime.messages for insert to authenticated
  with check ((realtime.topic() like 'room:%' or realtime.topic() = 'lobby')
              and not exists (select 1 from public.banned_users b where b.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- （任意）30日より古いチャットを毎日自動で消す
-- Database → Extensions で「pg_cron」を有効にしてから、下の2行の先頭の -- を消して実行してください
-- ---------------------------------------------------------------------
-- select cron.schedule('machitsuku-delete-old-messages', '0 19 * * *',
--   $$delete from public.messages where created_at < now() - interval '30 days'$$);

-- =====================================================================
-- みんなでつくるMAP（参加者の投稿・青いお店）
-- =====================================================================

-- 運営者（あなた）。あとで作る「口コミの見回り・削除」の仕組みで使います
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins_select_self" on public.admins;
create policy "admins_select_self" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create table if not exists public.community_shops (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author      text not null check (char_length(author) between 1 and 12),
  name        text not null check (char_length(name) between 1 and 40),
  genre       text not null default 'other' check (char_length(genre) <= 20),
  lat         double precision not null check (lat between 20 and 46.5),
  lng         double precision not null check (lng between 122 and 154),
  comment     text check (char_length(comment) <= 200),
  sns_url     text check (sns_url is null or (char_length(sns_url) <= 300 and sns_url ~* '^https://([a-z0-9-]+\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|fb\.watch|threads\.net|threads\.com)/')),
  video_url   text check (video_url is null or (char_length(video_url) <= 300 and video_url ~ '^https://')),
  photo_path  text check (char_length(photo_path) <= 200),
  thumb_path  text check (char_length(thumb_path) <= 200),
  video_path  text check (char_length(video_path) <= 200),
  status      text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  -- SNS投稿のリンク（おすすめ）か、10文字以上の口コミのどちらかは必須
  constraint community_has_content check (sns_url is not null or photo_path is not null or video_url is not null or char_length(coalesce(comment, '')) >= 10)
);
-- 以前の版の schema.sql を実行していた場合の更新
alter table public.community_shops add column if not exists sns_url text;
alter table public.community_shops drop constraint if exists community_has_media;
alter table public.community_shops drop constraint if exists community_shops_comment_check;
alter table public.community_shops drop constraint if exists community_has_content;
alter table public.community_shops add constraint community_has_content
  check (sns_url is not null or photo_path is not null or video_url is not null or char_length(coalesce(comment, '')) >= 10);
alter table public.community_shops drop constraint if exists community_comment_len;
alter table public.community_shops add constraint community_comment_len check (char_length(comment) <= 200);
alter table public.community_shops alter column status set default 'approved';
update public.community_shops set status = 'approved' where status = 'pending';
create index if not exists community_status_time on public.community_shops (status, created_at desc);
alter table public.community_shops enable row level security;
drop policy if exists "community_select" on public.community_shops;
drop policy if exists "community_insert" on public.community_shops;
drop policy if exists "community_update_admin" on public.community_shops;
drop policy if exists "community_delete" on public.community_shops;
-- 投稿はすぐ公開（status = 'approved'）。運営者が消したいときは status を 'rejected' にするか行を削除
create policy "community_select" on public.community_shops for select to authenticated
  using (status = 'approved' or user_id = auth.uid() or public.is_admin());
-- 投稿できるのは自分の名前で、利用停止されていない人。ファイルは自分のフォルダのものだけ
create policy "community_insert" on public.community_shops for insert to authenticated
  with check (user_id = auth.uid()
              and not exists (select 1 from public.banned_users b where b.user_id = auth.uid())
              and (photo_path is null or photo_path like auth.uid()::text || '/%')
              and (thumb_path is null or thumb_path like auth.uid()::text || '/%')
              and (video_path is null or video_path like auth.uid()::text || '/%'));
-- 表示を止める（rejected にする）のは運営者だけ
create policy "community_update_admin" on public.community_shops for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "community_delete" on public.community_shops for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 新しい投稿はすぐ公開。投稿は1人1日10件まで（いたずらの大量投稿よけ）
create or replace function public.community_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.status := 'approved';
  new.reviewed_at := null;
  if (select count(*) from public.community_shops
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate limit: too many posts today';
  end if;
  return new;
end $$;
drop trigger if exists community_before_insert on public.community_shops;
create trigger community_before_insert before insert on public.community_shops
  for each row execute function public.community_before_insert();

-- （使わなくても大丈夫）写真の置き場所（Supabase Storage）。いまの投稿フォームはSNSリンクと口コミだけなので使いません。
-- あとで写真アップロードを戻すとき用に作っておきます。だれでも見られる・1枚2MBまで・写真の形式だけ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "community_files_upload" on storage.objects;
drop policy if exists "community_files_delete" on storage.objects;
create policy "community_files_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text
              and not exists (select 1 from public.banned_users b where b.user_id = auth.uid()));
create policy "community_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'community' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- （任意）動画ファイルも受け付けるとき：js/config.js の allowVideoUpload を true にして、下の文の先頭の -- を消して実行
-- update storage.buckets set file_size_limit = 15728640,
--   allowed_mime_types = array['image/webp', 'image/jpeg', 'video/mp4', 'video/quicktime', 'video/webm']
--   where id = 'community';

-- =====================================================================
-- 公式（本人）マーク：まちマニア横塚さん
-- Table Editor で official_users に自分の user_id を1行追加すると、町で ★ がつきます
-- =====================================================================
create table if not exists public.official_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  title       text default 'まちマニア横塚',
  created_at  timestamptz not null default now()
);
alter table public.official_users enable row level security;
drop policy if exists "official_select" on public.official_users;
create policy "official_select" on public.official_users for select to authenticated using (true);

-- 「まちマニア」「横塚」を含む名前は、本人（official_users）しか使えない（なりすまし防止）
create or replace function public.check_reserved_name() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  -- お店の投稿はニックネーム（author）だけを見る。お店の名前は自由
  if tg_table_name = 'community_shops' then n := coalesce(new.author, '');
  else n := coalesce(to_jsonb(new) ->> 'name', '');
  end if;
  if (n ilike '%まちマニア%' or n ilike '%横塚%' or n ilike '%マチマニア%')
     and not exists (select 1 from public.official_users o where o.user_id = auth.uid()) then
    raise exception 'reserved name';
  end if;
  return new;
end $$;
drop trigger if exists profiles_reserved_name on public.profiles;
create trigger profiles_reserved_name before insert or update on public.profiles
  for each row execute function public.check_reserved_name();
drop trigger if exists messages_reserved_name on public.messages;
create trigger messages_reserved_name before insert on public.messages
  for each row execute function public.check_reserved_name();
drop trigger if exists community_reserved_name on public.community_shops;
create trigger community_reserved_name before insert on public.community_shops
  for each row execute function public.check_reserved_name();

