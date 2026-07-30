/**
 * 전화기 방명록 - 로컬 서버
 * 정적 프론트엔드(public/)를 서빙하고, 방명록 항목을
 * data/entries.json 파일에 저장/조회하는 REST API를 제공합니다.
 */
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4173;
const DATA_DIR = path.join(__dirname, 'data');
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

app.use(express.json({ limit: '200kb' }));
app.use(express.static(PUBLIC_DIR));

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

// 저장된 모든 방명록 항목을 최신순으로 반환
app.get('/api/entries', async (req, res) => {
  const entries = await readEntries();
  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(entries);
});

// 새 방명록 항목 등록 (이름, 메시지를 받아 id/날짜는 서버가 자동 생성)
app.post('/api/entries', async (req, res) => {
  const { name, message } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: '등록할 메시지가 비어 있습니다.' });
  }

  const now = new Date();
  const entry = {
    id: crypto.randomUUID(),
    name: (typeof name === 'string' && name.trim()) || '이름 없음',
    message: message.trim().slice(0, 500),
    date: formatPostmarkDate(now),
    createdAt: now.toISOString(),
  };

  const entries = await readEntries();
  entries.push(entry);
  await writeEntries(entries);

  res.status(201).json(entry);
});

app.listen(PORT, () => {
  console.log(`전화기 방명록 서버가 실행되었습니다: http://localhost:${PORT}`);
});
