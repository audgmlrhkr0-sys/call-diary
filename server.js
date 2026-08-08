/**
 * 전화기 방명록 - 로컬 서버
 * 정적 프론트엔드(public/)를 서빙하고, 방명록 항목을
 * data/entries.json / data/audio 에 저장합니다.
 * Supabase를 쓰면 프론트엔드가 직접 Supabase와 통신하므로
 * 이 서버는 로컬 개발/폴백용입니다.
 */
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4173;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '7978';
const DATA_DIR = path.join(__dirname, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DATA_FILE = path.join(DATA_DIR, 'entries.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

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

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]\n', 'utf-8');
  }
}

async function readEntries() {
  ensureDataFile();
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('방명록 데이터를 읽는 중 오류가 발생했습니다:', err);
    return [];
  }
}

async function writeEntries(entries) {
  ensureDataFile();
  await fsp.writeFile(DATA_FILE, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

function extensionForMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/audio', express.static(AUDIO_DIR));

// 벨소리(call.mp3), 전화기 사진(전화기.png) 등은 public/ 대신 프로젝트 루트 폴더에
// 바로 두는 경우가 많아서, 루트에 있는 미디어 파일 요청을 여기서 직접 서빙합니다.
const ROOT_ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.wav', '.m4a']);
app.get('/:filename', (req, res, next) => {
  const ext = path.extname(req.params.filename).toLowerCase();
  if (!ROOT_ASSET_EXTENSIONS.has(ext)) return next();
  res.sendFile(path.join(__dirname, req.params.filename), (err) => {
    if (err && !res.headersSent) {
      res.status(404).end();
    }
  });
});

app.get('/api/entries', async (req, res) => {
  const entries = await readEntries();
  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(entries);
});

app.post('/api/entries', async (req, res) => {
  const { name, message, question, audioBase64, audioMimeType } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '등록할 메시지가 비어 있습니다.' });
  }

  ensureDataFile();
  const now = new Date();
  const id = crypto.randomUUID();
  let audioUrl = '';

  if (typeof audioBase64 === 'string' && audioBase64.trim()) {
    try {
      const ext = extensionForMime(audioMimeType);
      const filename = `${id}.${ext}`;
      const filePath = path.join(AUDIO_DIR, filename);
      await fsp.writeFile(filePath, Buffer.from(audioBase64, 'base64'));
      audioUrl = `/audio/${filename}`;
    } catch (err) {
      console.error('음성 파일 저장 실패:', err);
      return res.status(500).json({ error: '음성 파일 저장에 실패했습니다.' });
    }
  }

  const entry = {
    id,
    name: (typeof name === 'string' && name.trim()) || '이름 없음',
    message: message.trim().slice(0, 500),
    question:
      typeof question === 'string' ? question.trim().slice(0, 200) : '',
    date: formatPostmarkDate(now),
    createdAt: now.toISOString(),
    audioUrl,
  };

  const entries = await readEntries();
  entries.push(entry);
  await writeEntries(entries);

  res.status(201).json(entry);
});

app.delete('/api/entries', async (req, res) => {
  const { ids, password } = req.body || {};

  if (String(password || '') !== String(ADMIN_PASSWORD)) {
    return res.status(403).json({ error: '관리자 비밀번호가 올바르지 않습니다.' });
  }

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: '삭제할 항목을 선택해주세요.' });
  }

  const idSet = new Set(ids.map(String));
  const entries = await readEntries();
  const remaining = [];
  let deleted = 0;

  for (const entry of entries) {
    if (!idSet.has(String(entry.id))) {
      remaining.push(entry);
      continue;
    }
    deleted += 1;
    if (entry.audioUrl && entry.audioUrl.startsWith('/audio/')) {
      const filename = path.basename(entry.audioUrl);
      const filePath = path.join(AUDIO_DIR, filename);
      try {
        await fsp.unlink(filePath);
      } catch (err) {
        // 파일이 없어도 삭제는 계속
      }
    }
  }

  await writeEntries(remaining);
  res.json({ deleted });
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`전화기 방명록 서버가 실행되었습니다: http://localhost:${PORT}`);
});
