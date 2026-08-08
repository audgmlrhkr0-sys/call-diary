/**
 * 방명록 설정
 *
 * Supabase를 쓰려면 아래 URL / anon key를 채우세요.
 * 비워 두면 로컬 서버(data/entries.json + data/audio) 또는 localStorage로 동작합니다.
 *
 * Supabase 준비: supabase/setup.sql 을 SQL Editor에서 실행하세요.
 */
window.GuestbookConfig = {
  SUPABASE_URL: 'https://zlfnhaxdujeurhnarhmk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsZm5oYXhkdWpldXJobmFyaG1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDI5MjIsImV4cCI6MjA5NzM3ODkyMn0.t1Q3yZknSANgXrwyEPQKMFSJE-pfccGeKmSxjTviDcM',
  ADMIN_PASSWORD: '7978',
  AUDIO_BUCKET: 'guestbook-audio',
};
