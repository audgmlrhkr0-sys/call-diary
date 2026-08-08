/**
 * 방명록 API
 * 우선순위: Supabase 설정됨 → 로컬 Express 서버 → localStorage
 */
const GuestbookAPI = (() => {
  const BASE_URL = 'api/entries';
  const LOCAL_KEY = 'phone-guestbook-entries';
  const MONTHS = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];

  // null = 미확인, 'supabase' | 'server' | 'local'
  let backend = null;
  let supabaseClient = null;

  function config() {
    return window.GuestbookConfig || {};
  }

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

  function hasSupabaseConfig() {
    const cfg = config();
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  }

  function getSupabase() {
    if (!hasSupabaseConfig()) return null;
    if (supabaseClient) return supabaseClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('Supabase SDK가 로드되지 않았습니다.');
      return null;
    }
    const cfg = config();
    supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  function extensionForMime(mime) {
    if (!mime) return 'webm';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('wav')) return 'wav';
    return 'webm';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('오디오 변환 실패'));
      reader.readAsDataURL(blob);
    });
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

  function mapSupabaseRow(row) {
    const cfg = config();
    let audioUrl = '';
    if (row.audio_path) {
      const { data } = getSupabase().storage.from(cfg.AUDIO_BUCKET || 'guestbook-audio').getPublicUrl(row.audio_path);
      audioUrl = data && data.publicUrl ? data.publicUrl : '';
    }
    return {
      id: row.id,
      name: row.name,
      message: row.message,
      date: row.date,
      audioUrl,
      audioPath: row.audio_path || '',
      createdAt: row.created_at,
    };
  }

  async function detectBackend() {
    if (backend) return backend;

    if (hasSupabaseConfig() && getSupabase()) {
      backend = 'supabase';
      return backend;
    }

    try {
      const res = await fetch(BASE_URL, { method: 'GET' });
      backend = res.ok ? 'server' : 'local';
    } catch (err) {
      backend = 'local';
    }
    return backend;
  }

  async function fetchEntries() {
    const mode = await detectBackend();

    if (mode === 'supabase') {
      const client = getSupabase();
      const { data, error } = await client
        .from('entries')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message || '방명록을 불러오지 못했습니다.');
      return (data || []).map(mapSupabaseRow);
    }

    if (mode === 'server') {
      const res = await fetch(BASE_URL);
      if (!res.ok) throw new Error('방명록을 불러오지 못했습니다.');
      return res.json();
    }

    const entries = readLocalEntries();
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return entries;
  }

  async function createEntry(name, message, audioBlob) {
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('등록할 메시지가 비어 있습니다.');
    }

    const mode = await detectBackend();
    const cleanName = (typeof name === 'string' && name.trim()) || '이름 없음';
    const cleanMessage = message.trim().slice(0, 500);
    const now = new Date();

    if (mode === 'supabase') {
      const client = getSupabase();
      const cfg = config();
      const id = makeId();
      let audioPath = null;

      if (audioBlob && audioBlob.size > 0) {
        const ext = extensionForMime(audioBlob.type);
        audioPath = `${id}.${ext}`;
        const { error: uploadError } = await client.storage
          .from(cfg.AUDIO_BUCKET || 'guestbook-audio')
          .upload(audioPath, audioBlob, {
            contentType: audioBlob.type || 'audio/webm',
            upsert: false,
          });
        if (uploadError) {
          throw new Error(uploadError.message || '음성 파일 업로드에 실패했습니다.');
        }
      }

      const { data, error } = await client
        .from('entries')
        .insert({
          id,
          name: cleanName,
          message: cleanMessage,
          date: formatPostmarkDate(now),
          audio_path: audioPath,
          created_at: now.toISOString(),
        })
        .select('*')
        .single();

      if (error) throw new Error(error.message || '저장 중 문제가 발생했습니다.');
      return mapSupabaseRow(data);
    }

    if (mode === 'server') {
      const payload = {
        name: cleanName,
        message: cleanMessage,
      };
      if (audioBlob && audioBlob.size > 0) {
        payload.audioBase64 = await blobToBase64(audioBlob);
        payload.audioMimeType = audioBlob.type || 'audio/webm';
      }

      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '저장 중 문제가 발생했습니다.');
      }
      return res.json();
    }

    const entry = {
      id: makeId(),
      name: cleanName,
      message: cleanMessage,
      date: formatPostmarkDate(now),
      createdAt: now.toISOString(),
      audioUrl: '',
    };

    // localStorage에는 용량 문제로 오디오를 넣지 않습니다.
    const entries = readLocalEntries();
    entries.push(entry);
    writeLocalEntries(entries);
    return entry;
  }

  function assertAdminPassword(password) {
    const expected = String(config().ADMIN_PASSWORD || '7978');
    if (String(password || '') !== expected) {
      throw new Error('관리자 비밀번호가 올바르지 않습니다.');
    }
  }

  async function deleteEntries(ids, password) {
    assertAdminPassword(password);
    if (!Array.isArray(ids) || !ids.length) {
      throw new Error('삭제할 항목을 선택해주세요.');
    }

    const mode = await detectBackend();

    if (mode === 'supabase') {
      const client = getSupabase();
      const cfg = config();

      const { data: rows, error: fetchError } = await client
        .from('entries')
        .select('id, audio_path')
        .in('id', ids);
      if (fetchError) throw new Error(fetchError.message || '삭제에 실패했습니다.');

      const paths = (rows || []).map((row) => row.audio_path).filter(Boolean);
      if (paths.length) {
        await client.storage.from(cfg.AUDIO_BUCKET || 'guestbook-audio').remove(paths);
      }

      const { error } = await client.from('entries').delete().in('id', ids);
      if (error) throw new Error(error.message || '삭제에 실패했습니다.');
      return { deleted: ids.length };
    }

    if (mode === 'server') {
      const res = await fetch(BASE_URL, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '삭제에 실패했습니다.');
      }
      return res.json();
    }

    const remaining = readLocalEntries().filter((entry) => !ids.includes(entry.id));
    writeLocalEntries(remaining);
    return { deleted: ids.length };
  }

  return {
    fetchEntries,
    createEntry,
    deleteEntries,
    get backendMode() {
      return backend;
    },
    get isUsingLocalStorage() {
      return backend === 'local';
    },
  };
})();
