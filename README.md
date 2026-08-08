# 전화기 방명록 (Phone Guestbook)

옛날 유럽풍 다이얼 전화기 컨셉의 레트로 방명록 웹앱입니다.
"전화 걸기" 버튼을 누르면 수화기가 떨리며 벨이 울리고, 실물 USB 수화기로
음성을 녹음(약 10초)하여 하나의 문장으로 방명록에 이름과 함께 등록합니다.

## 사용 흐름

1. 화면의 **전화 걸기** 버튼을 누른다 → 수화기가 떨리며 벨이 울린다.
2. 실물 USB 수화기를 들고, 화면의 **수화기를 들고 통화 시작** 버튼을 누른다.
3. 약 10초 동안 이야기를 하면 자동으로 인식되어 한 문장으로 표시된다.
4. 제대로 인식되지 않았다면 **다시 말하기**로 재시도할 수 있다.
5. 문장이 맞다면 **이 문장으로 등록**을 누르고, 이름을 적는다. 날짜는 자동으로 표시된다.
6. **방명록에 새기기**를 누르면 저장되고, 상단의 **방명록 보기**에서 카드 형태로 열람할 수 있다.

## 실행 방법 (Windows)

```powershell
npm install
npm start
```

서버가 뜨면 **Chrome 또는 Edge** 브라우저로 아래 주소에 접속합니다.

```
http://localhost:4173
```

(만약 이 포트도 다른 프로그램이 사용 중이라면, `$env:PORT=4000; npm start` 처럼 원하는 포트 번호를 지정해서 실행할 수 있습니다.)

전체 화면(키오스크 느낌)으로 보려면 브라우저에서 `F11`을 눌러 전체화면 모드로 전환하세요.

## 꼭 확인할 것: USB 수화기를 기본 마이크로 설정

브라우저의 음성 인식(Web Speech API)은 특정 마이크 장치를 코드로 지정할 수 없고,
**Windows에서 지정한 기본 녹음 장치**를 그대로 사용합니다. 따라서 실행 전에:

1. Windows 설정 → 시스템 → 소리 → 입력에서 **USB 수화기(핸드셋)** 를 기본 장치로 선택합니다.
2. 브라우저에서 이 페이지를 처음 열면 마이크 권한 팝업이 뜨는데 **허용**을 눌러야 합니다.
3. 스피커(벨소리, 안내음)도 USB 수화기로 들으려면 같은 방식으로 기본 출력 장치도 맞춰주세요.

## 아이패드에서 사용할 때 참고할 것 (오디오 라우팅)

아이패드(Safari)는 마이크를 사용하는 동안 오디오 출력 경로가 예기치 않게 바뀌는 경우가 있어,
이 앱은 iPadOS 17 이상의 Safari에서 지원하는 **AudioSession API**로 상황에 맞게 세션을
전환합니다 (`public/js/app.js`의 `setAudioSessionType`).

- 벨이 울릴 때(`ringing`): 세션을 `playback`으로 설정 → 벨소리가 **스피커**로 재생됩니다.
- 통화(음성 인식) 중(`listening`): 세션을 `play-and-record`로 설정 → **마이크**로만 음성을
  캡처하도록 합니다.

이 API를 지원하지 않는 브라우저(Chrome, Edge, 구형 Safari 등)에서는 아무 동작도 하지 않고
기존처럼 동작하므로 다른 환경에서도 그대로 사용할 수 있습니다.

## 참고 사항 및 제약

- 음성 인식은 **Chrome 또는 Edge** 에서만 동작하며, 구글 서버를 사용하므로 **인터넷 연결이 필요**합니다.
- 인터넷이 없는 환경에서 완전 오프라인으로 운영하려면 별도의 로컬 STT 엔진(Whisper 등)으로 교체하는
  추가 작업이 필요합니다 (현재 버전은 포함되어 있지 않습니다).
- 방명록 데이터는 `data/entries.json` 파일에 저장됩니다. 백업하려면 이 파일만 복사하면 됩니다.

## 저장 방식: 서버 모드 vs 브라우저 저장 모드

이 앱은 실행 환경을 자동으로 감지해서 두 가지 방식으로 동작합니다.

- **서버 모드** (`npm start` 로 실행했을 때): `server.js`가 켜져 있으면 방명록이
  `data/entries.json` 파일에 저장됩니다. 같은 기기(키오스크 PC)에서 여러 번 방문해도
  모두 하나의 방명록에 누적됩니다. **실제 전화기 설치물 용도로는 이 방식을 사용하세요.**
- **브라우저 저장 모드** (GitHub Pages 등 정적 호스팅): 서버가 없으면 자동으로
  브라우저의 `localStorage`에 저장하도록 전환됩니다. 이 경우 방명록은 **그 브라우저/기기에만**
  남고, 다른 사람이 접속해도 서로의 글이 보이지 않습니다 (데모/체험용).

## GitHub Pages로 배포하기

이 저장소를 그대로 GitHub Pages에 올리면 됩니다.

1. GitHub 저장소 → **Settings → Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main`, 폴더는 `/ (root)` 선택 후 저장

저장소 루트의 [index.html](index.html)이 `public/index.html`로 자동 연결해주기 때문에
루트를 그대로 배포해도 전화기 화면이 정상적으로 뜹니다. (루트에 `index.html`이 없으면
GitHub가 `README.md`를 대신 보여주는데, 이 파일이 그 문제를 막아줍니다.)

GitHub Pages는 정적 파일만 제공하고 `server.js`를 실행해주지 않으므로, 배포된 사이트에서는
자동으로 위의 **브라우저 저장 모드**로 동작합니다 (방명록 화면 상단에 안내 문구가 표시됩니다).

## 이미지/사운드 넣는 방법 (중요)

프로젝트 루트 (`전화 방명록/` 폴더 바로 안, `server.js`와 같은 위치)

| 파일명 | 용도 |
|---|---|
| `전화기.png` | 메인 화면 정중앙에 보여지는 전화기 사진 |
| `call.mp3` (선택) | 전화 벨소리. 없으면 합성음이 자동 재생됩니다 |

이 두 파일은 `public/` 폴더가 아니라 **프로젝트 루트**에 그대로 두면 됩니다.
`server.js`가 루트에 있는 이미지/사운드 파일 요청(`/전화기.png`, `/call.mp3` 등)을
자동으로 서빙하고, `public/index.html`도 상대경로(`../전화기.png`, `../call.mp3`)로
같은 위치를 가리키고 있어서 별도 설정 없이 바로 반영됩니다.

## Supabase 연동 (음성 저장 / 방명록 공유)

1. Supabase 프로젝트를 만들고, `supabase/setup.sql`을 SQL Editor에서 실행합니다.
2. `public/js/config.js`에 프로젝트 URL과 anon key를 넣습니다.

```js
window.GuestbookConfig = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  ADMIN_PASSWORD: '7978',
  AUDIO_BUCKET: 'guestbook-audio',
};
```

3. 설정이 있으면 앱이 Supabase에 글+음성을 저장합니다.
   비어 있으면 로컬 서버(`data/entries.json`, `data/audio/`)로 동작합니다.

관리자 삭제 비밀번호는 `7978`입니다. (방명록에서 항목 선택 → 선택 삭제)

`public/assets/images/`

| 파일명 | 용도 | 권장 크기 |
|---|---|---|
| `paper-texture.jpg` (선택) | 방명록 카드의 종이 질감 | 800x800 내외 |

각 폴더 안의 `README.txt`에도 동일한 안내가 적혀 있습니다.

## 프로젝트 구조

```
├── index.html                 # GitHub Pages용 리다이렉트 (public/index.html로 이동)
├── .nojekyll                  # GitHub Pages가 Jekyll 처리를 하지 않도록 하는 빈 파일
├── server.js                  # Express 서버 (정적 파일 + REST API)
├── package.json
├── data/
│   └── entries.json           # 방명록 데이터 저장 파일 (서버 모드)
└── public/
    ├── index.html              # 실제 앱 화면
    ├── css/style.css           # 화이트 톤 미니멀 스타일
    ├── js/
    │   ├── app.js               # 상태 흐름(idle→ringing→listening→...) 및 UI 로직
    │   ├── speech.js             # Web Speech API 래퍼 (10초 인식)
    │   └── api.js                # API 호출 헬퍼 (서버 모드 / localStorage 모드 자동 전환)
    └── assets/
        ├── images/              # 나중에 사진을 넣을 자리 (README.txt 참고)
        └── sounds/              # 벨소리 파일을 넣을 자리 (선택)
```

## API

- `GET /api/entries` - 저장된 방명록을 최신순으로 반환
- `POST /api/entries` - `{ name, message }` 를 받아 `id`, `date`(자동)를 채워 저장
