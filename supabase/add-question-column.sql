-- Supabase Dashboard → SQL Editor 에서 이 두 줄만 실행하세요.
-- (question 열 추가 + API 스키마 캐시 새로고침)

alter table public.entries add column if not exists question text;
notify pgrst, 'reload schema';
