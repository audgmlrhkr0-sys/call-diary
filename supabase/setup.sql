-- 전화기 방명록 Supabase 설정
-- Supabase Dashboard → SQL Editor 에서 이 파일을 실행하세요.

-- 1) 방명록 테이블
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  name text not null default '이름 없음',
  message text not null,
  date text not null,
  audio_path text,
  created_at timestamptz not null default now()
);

alter table public.entries enable row level security;

-- 누구나 읽기 / 등록 가능 (전시용)
drop policy if exists "entries_select_public" on public.entries;
create policy "entries_select_public"
  on public.entries for select
  using (true);

drop policy if exists "entries_insert_public" on public.entries;
create policy "entries_insert_public"
  on public.entries for insert
  with check (true);

-- 삭제는 anon 키로도 가능하지만, 앱에서 관리자 비밀번호(7978)로 한 번 더 막습니다.
drop policy if exists "entries_delete_public" on public.entries;
create policy "entries_delete_public"
  on public.entries for delete
  using (true);

-- 2) 음성 파일 버킷
insert into storage.buckets (id, name, public)
values ('guestbook-audio', 'guestbook-audio', true)
on conflict (id) do update set public = true;

drop policy if exists "guestbook_audio_select" on storage.objects;
create policy "guestbook_audio_select"
  on storage.objects for select
  using (bucket_id = 'guestbook-audio');

drop policy if exists "guestbook_audio_insert" on storage.objects;
create policy "guestbook_audio_insert"
  on storage.objects for insert
  with check (bucket_id = 'guestbook-audio');

drop policy if exists "guestbook_audio_delete" on storage.objects;
create policy "guestbook_audio_delete"
  on storage.objects for delete
  using (bucket_id = 'guestbook-audio');
