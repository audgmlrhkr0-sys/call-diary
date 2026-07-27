/**
 * 서버의 /api/entries REST API와 통신하는 헬퍼 함수 모음.
 *
 * npm start 로 서버(server.js)를 켜서 접속했을 때는 서버 + data/entries.json 에 저장합니다.
 * GitHub Pages처럼 정적 파일만 호스팅되어 서버가 없는 환경에서는 자동으로 감지하여
 * 브라우저의 localStorage에 저장하는 방식으로 전환됩니다 (같은 브라우저에서만 보관됨).
 */
const GuestbookAPI = (() => {
  const BASE_URL = 'api/entries';
  const LOCAL_KEY = 'phone-guestbook-entries';

  // null = 아직 확인 전, true = 서버 사용 가능, false = 서버 없음(로컬 저장소 사용)
  let backendAvailable = null;

  const MONTHS = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];

  function formatPostmarkDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = MONTHS[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function readLocalEntries() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeLocalEntries(entries) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
    } catch (err) {
      console.warn('브라우저 저장소에 방명록을 저장하지 못했습니다.', err);
    }
  }

  async function checkBackend() {
    if (backendAvailable !== null) return backendAvailable;
    try {
      const res = await fetch(BASE_URL, { method: 'GET' });
      backendAvailable = res.ok;
    } catch (err) {
      backendAvailable = false;
    }
    return backendAvailable;
  }

  async function fetchEntries() {
    const useBackend = await checkBackend();

    if (useBackend) {
      const res = await fetch(BASE_URL);
      if (!res.ok) {
        throw new Error('방명록을 불러오지 못했습니다.');
      }
      return res.json();
    }

    const entries = readLocalEntries();
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return entries;
  }

  async function createEntry(name, message) {
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('등록할 메시지가 비어 있습니다.');
    }

    const useBackend = await checkBackend();

    if (useBackend) {
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

    const now = new Date();
    const entry = {
      id: makeId(),
      name: (typeof name === 'string' && name.trim()) || '이름 없음',
      message: message.trim().slice(0, 500),
      date: formatPostmarkDate(now),
      createdAt: now.toISOString(),
    };

    const entries = readLocalEntries();
    entries.push(entry);
    writeLocalEntries(entries);
    return entry;
  }

  return {
    fetchEntries,
    createEntry,
    get isUsingLocalStorage() {
      return backendAvailable === false;
    },
  };
})();
