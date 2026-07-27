/**
 * 서버의 /api/entries REST API와 통신하는 헬퍼 함수 모음
 */
const GuestbookAPI = (() => {
  const BASE_URL = '/api/entries';

  async function fetchEntries() {
    const res = await fetch(BASE_URL);
    if (!res.ok) {
      throw new Error('방명록을 불러오지 못했습니다.');
    }
    return res.json();
  }

  async function createEntry(name, message) {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, message }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || '저장 중 문제가 발생했습니다.');
    }

    return res.json();
  }

  return { fetchEntries, createEntry };
})();
