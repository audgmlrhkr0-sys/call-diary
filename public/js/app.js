/**
 * 전화기 방명록 - 메인 애플리케이션 로직
 * 상태 흐름: idle -> ringing -> listening -> reviewing -> naming -> saved -> idle
 */
(() => {
  'use strict';

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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ------------------------------------------------------------
   * DOM 참조
   * ---------------------------------------------------------- */
  const deskScene = document.getElementById('desk-scene');
  const galleryScene = document.getElementById('gallery-scene');
  const homeBtn = document.getElementById('home-btn');
  const galleryToggleBtn = document.getElementById('gallery-toggle-btn');
  const backBtn = document.getElementById('back-btn');
  const galleryList = document.getElementById('gallery-list');
  const galleryDeleteBtn = document.getElementById('gallery-delete-btn');
  const adminModal = document.getElementById('admin-modal');
  const adminPasswordInput = document.getElementById('admin-password-input');
  const adminModalError = document.getElementById('admin-modal-error');
  const adminCancelBtn = document.getElementById('admin-cancel-btn');
  const adminConfirmBtn = document.getElementById('admin-confirm-btn');
  const entryAudio = document.getElementById('entry-audio');

  const handsetEl = document.getElementById('handset');
  const statusText = document.getElementById('status-text');
  const errorText = document.getElementById('error-text');

  const callBtn = document.getElementById('call-btn');
  const answerBtn = document.getElementById('answer-btn');

  const listeningPanel = document.getElementById('listening-panel');
  const progressFill = document.getElementById('progress-fill');
  const liveTranscript = document.getElementById('live-transcript');
  const liveTranscriptStatus = document.getElementById('live-transcript-status');
  const promptQuestionEl = document.getElementById('prompt-question');
  const listenHomeBtn = document.getElementById('listen-home-btn');
  const listenCancelBtn = document.getElementById('listen-cancel-btn');
  const listenConfirmBtn = document.getElementById('listen-confirm-btn');

  const reviewPanel = document.getElementById('review-panel');
  const reviewQuestionEl = document.getElementById('review-question');
  const reviewText = document.getElementById('review-text');
  const retryBtn = document.getElementById('retry-btn');
  const confirmBtn = document.getElementById('confirm-btn');

  const namingPanel = document.getElementById('naming-panel');
  const namingQuote = document.getElementById('naming-quote');
  const nameInput = document.getElementById('name-input');
  const datePreview = document.getElementById('date-preview');
  const cancelNameBtn = document.getElementById('cancel-name-btn');
  const saveBtn = document.getElementById('save-btn');

  const savedPanel = document.getElementById('saved-panel');
  const ringAudio = document.getElementById('ring-audio');
  const promptAudio = document.getElementById('prompt-audio');

  let confirmedMessage = '';
  let confirmedQuestion = '';
  let recordedAudioBlob = null;
  let savedResetTimerId = null;
  let promptDelayTimerId = null;
  let promptNearEndTimerId = null;
  let promptTimeUpdateHandler = null;
  let speechCaptureEnabled = false;
  let primedRecognitionStarted = false;
  let listeningRecorderStarted = false;
  let selectedEntryIds = new Set();
  let pendingDeleteIds = [];
  let playingEntryId = null;

  const UNIFIED_PROMPT_QUESTION = '하고 싶은 말을 자유롭게 남겨주세요.';
  const PROMPT_VOICES = [
    'assets/sounds/prompts/su.m4a',
    'assets/sounds/prompts/min.m4a',
  ];

  let nextPromptVoiceIndex = 0;

  function pickNextPromptVoice() {
    const src = PROMPT_VOICES[nextPromptVoiceIndex];
    nextPromptVoiceIndex = (nextPromptVoiceIndex + 1) % PROMPT_VOICES.length;
    return {
      src,
      question: UNIFIED_PROMPT_QUESTION,
    };
  }

  function setLiveTranscriptStatus(text) {
    if (liveTranscriptStatus) {
      liveTranscriptStatus.textContent = text || '';
    } else if (liveTranscript) {
      liveTranscript.textContent = text || '';
    }
  }

  function setListeningQuestion(text) {
    if (!promptQuestionEl) return;
    const value = (text || '').trim();
    promptQuestionEl.textContent = value ? `“${value}”` : '';
  }

  function setPromptQuestion(text) {
    const value = text || '';
    if (reviewQuestionEl) reviewQuestionEl.textContent = value;
  }

  function delay(ms) {
    return new Promise((resolve) => {
      promptDelayTimerId = setTimeout(() => {
        promptDelayTimerId = null;
        resolve();
      }, ms);
    });
  }

  function stopPromptAudio() {
    clearTimeout(promptDelayTimerId);
    promptDelayTimerId = null;
    clearTimeout(promptNearEndTimerId);
    promptNearEndTimerId = null;
    setListeningQuestion('');
    stopPromptBufferSource();
    if (!promptAudio) return;
    if (promptTimeUpdateHandler) {
      promptAudio.removeEventListener('timeupdate', promptTimeUpdateHandler);
      promptTimeUpdateHandler = null;
    }
    promptAudio.onended = null;
    promptAudio.onerror = null;
    promptAudio.pause();
    promptAudio.muted = false;
    promptAudio.removeAttribute('src');
    promptAudio.load();
  }

  function schedulePromptNearEnd(durationSec, onNearEnd) {
    clearTimeout(promptNearEndTimerId);
    promptNearEndTimerId = null;
    if (!onNearEnd || !(durationSec > 0)) return;
    // 인식 엔진이 켜지는 시간을 안내 음성 끝과 겹쳐, 끝나자마자 말할 수 있게 합니다.
    const leadSec = SpeechController.isIOS ? 0.12 : 0.35;
    const waitMs = Math.max(0, (durationSec - leadSec) * 1000);
    promptNearEndTimerId = setTimeout(() => {
      promptNearEndTimerId = null;
      onNearEnd();
    }, waitMs);
  }

  async function playPromptVoice({ onNearEnd } = {}) {
    setAudioSessionType('playback');
    const prompt = pickNextPromptVoice();
    confirmedQuestion = prompt.question;
    setPromptQuestion(prompt.question);

    // 사용자 제스처 안에서 AudioContext를 깨워 둡니다.
    await resumeAudioCtx();
    if (deskScene.dataset.state !== 'listening') return;

    const bufferPromise = loadPromptAudioBuffer(prompt.src).catch((err) => {
      console.warn('안내 음성 미리 로드 실패:', prompt.src, err);
      return null;
    });
    // 안내 음성이 나오는 동안 마이크를 미리 열어 인식 전환 공백을 없앱니다.
    SpeechController.ensureMicrophoneAccess({ keepAlive: true }).catch(() => {});

    await delay(1000);
    if (deskScene.dataset.state !== 'listening') return;

    // iOS Safari: HTMLAudioElement 직후 SpeechRecognition이 자주 깨져 Web Audio로 재생합니다.
    try {
      const buffer = await bufferPromise;
      if (!buffer) throw new Error('버퍼 없음');
      if (deskScene.dataset.state !== 'listening') return;
      setListeningQuestion(prompt.question);
      schedulePromptNearEnd(buffer.duration, onNearEnd);
      await playPromptBuffer(buffer);
      setListeningQuestion('');
      return;
    } catch (err) {
      console.warn('Web Audio 안내 음성 실패, HTMLAudio로 재시도:', prompt.src, err);
    }

    if (!promptAudio) return;
    promptAudio.muted = false;
    promptAudio.src = prompt.src;
    try {
      promptAudio.currentTime = 0;
    } catch (e) {
      // ignore
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        setListeningQuestion('');
        if (promptTimeUpdateHandler) {
          promptAudio.removeEventListener('timeupdate', promptTimeUpdateHandler);
          promptTimeUpdateHandler = null;
        }
        promptAudio.onended = null;
        promptAudio.onerror = null;
        resolve();
      };

      promptTimeUpdateHandler = () => {
        const duration = promptAudio.duration;
        if (!duration || !isFinite(duration)) return;
        const leadSec = SpeechController.isIOS ? 0.12 : 0.35;
        if (duration - promptAudio.currentTime <= leadSec) {
          promptAudio.removeEventListener('timeupdate', promptTimeUpdateHandler);
          promptTimeUpdateHandler = null;
          if (onNearEnd) onNearEnd();
        }
      };
      promptAudio.addEventListener('timeupdate', promptTimeUpdateHandler);

      promptAudio.onended = finish;
      promptAudio.onerror = () => {
        console.warn('안내 음성 재생 중 오류:', prompt.src);
        finish();
      };

      setListeningQuestion(prompt.question);
      const playPromise = promptAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (promptAudio.duration && isFinite(promptAudio.duration)) {
              schedulePromptNearEnd(promptAudio.duration, onNearEnd);
            }
          })
          .catch((playErr) => {
            console.warn('안내 음성 재생 실패:', prompt.src, playErr);
            finish();
          });
      }
    });
  }

  /* ------------------------------------------------------------
   * iOS/iPadOS 오디오 세션 제어 (Safari 17+ AudioSession API)
   * 아이패드는 마이크가 켜지면(음성 인식 중) 오디오 출력 경로가 제멋대로
   * 바뀌는 경우가 있어, 상황에 맞게 세션 종류를 명시적으로 지정합니다.
   * - 'playback'      : 벨소리 등 재생 전용 → 스피커로 재생
   * - 'play-and-record': 음성 인식(마이크 캡처) 중 → 마이크가 확실히 사용되도록
   * 이 API를 지원하지 않는 브라우저(Chrome/Edge 등)에서는 조용히 무시됩니다.
   * ---------------------------------------------------------- */
  function setAudioSessionType(type) {
    try {
      if (navigator.audioSession) {
        navigator.audioSession.type = type;
      }
    } catch (err) {
      // AudioSession API 미지원 환경은 무시하고 기본 동작을 따릅니다.
    }
  }

  /** iOS: 이전 인식/재생 세션을 강제로 내려 다시 마이크를 잡을 수 있게 합니다. */
  async function resetAudioSessionForCapture() {
    setAudioSessionType('play-and-record');
  }

  /* ------------------------------------------------------------
   * 합성 벨소리 (Web Audio API) - call.mp3 파일이 없을 때 대체 사용
   * ---------------------------------------------------------- */
  let audioCtx = null;
  let ringIntervalId = null;
  let usingAudioFile = false;
  let promptBufferSource = null;
  const promptAudioBufferCache = new Map();

  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    return audioCtx;
  }

  async function resumeAudioCtx() {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        // ignore
      }
    }
    return ctx;
  }

  function stopPromptBufferSource() {
    if (!promptBufferSource) return;
    try {
      promptBufferSource.onended = null;
      promptBufferSource.stop(0);
    } catch (err) {
      // already stopped
    }
    try {
      promptBufferSource.disconnect();
    } catch (err) {
      // ignore
    }
    promptBufferSource = null;
  }

  async function loadPromptAudioBuffer(url) {
    if (promptAudioBufferCache.has(url)) {
      return promptAudioBufferCache.get(url);
    }
    const ctx = await resumeAudioCtx();
    if (!ctx) throw new Error('Web Audio 불가');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`안내 음성 로드 실패: ${url}`);
    const data = await res.arrayBuffer();
    // Safari는 decodeAudioData가 ArrayBuffer를 detach 하는 경우가 있어 복사본을 넘깁니다.
    const buffer = await ctx.decodeAudioData(data.slice(0));
    promptAudioBufferCache.set(url, buffer);
    return buffer;
  }

  function playPromptBuffer(buffer) {
    return new Promise(async (resolve) => {
      const ctx = await resumeAudioCtx();
      if (!ctx) {
        resolve(false);
        return;
      }

      stopPromptBufferSource();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      promptBufferSource = source;

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (promptBufferSource === source) promptBufferSource = null;
        try {
          source.disconnect();
        } catch (err) {
          // ignore
        }
        resolve(true);
      };

      source.onended = finish;
      try {
        source.start(0);
      } catch (err) {
        console.warn('Web Audio 안내 음성 시작 실패', err);
        finish();
      }
    });
  }

  function playBellBurst() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(950, now);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(22, now);
    lfoGain.gain.setValueAtTime(90, now);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + 0.9);
    lfo.stop(now + 0.9);
  }

  function startSynthRing() {
    stopSynthRing();
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    playBellBurst();
    ringIntervalId = setInterval(playBellBurst, 1400);
  }

  function stopSynthRing() {
    if (ringIntervalId) {
      clearInterval(ringIntervalId);
      ringIntervalId = null;
    }
  }

  function startRing() {
    usingAudioFile = false;
    setAudioSessionType('playback'); // 벨소리는 항상 스피커로 재생되도록
    if (ringAudio) {
      ringAudio.currentTime = 0;
      ringAudio.loop = true;
      const playPromise = ringAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            usingAudioFile = true;
          })
          .catch(() => {
            startSynthRing();
          });
        return;
      }
    }
    startSynthRing();
  }

  function stopRing() {
    if (ringAudio && usingAudioFile) {
      ringAudio.pause();
      ringAudio.currentTime = 0;
    }
    stopSynthRing();
  }

  /* ------------------------------------------------------------
   * 화면 전환 (idle / ringing / listening / reviewing / naming / saved)
   * ---------------------------------------------------------- */
  function showOnly(panel) {
    [answerBtn, listeningPanel, reviewPanel, namingPanel, savedPanel].forEach((el) => {
      if (el) el.classList.add('hidden');
    });
    callBtn.classList.add('hidden');
    if (panel) panel.classList.remove('hidden');
  }

  function clearError() {
    errorText.classList.add('hidden');
    errorText.textContent = '';
  }

  function showError(message) {
    if (!message) {
      errorText.classList.add('hidden');
      errorText.textContent = '';
      return;
    }
    errorText.textContent = message;
    errorText.classList.remove('hidden');
  }

  function updateHomeBtn() {
    const inGallery = galleryScene && !galleryScene.classList.contains('hidden');
    const state = deskScene.dataset.state;
    const showHeaderHome = !inGallery && state !== 'idle' && state !== 'listening';
    if (homeBtn) homeBtn.classList.toggle('hidden', !showHeaderHome);
  }

  function goIdle() {
    clearTimeout(savedResetTimerId);
    deskScene.dataset.state = 'idle';
    speechCaptureEnabled = false;
    primedRecognitionStarted = false;
    listeningRecorderStarted = false;
    setAudioSessionType('playback');
    stopRing();
    stopPromptAudio();
    SpeechController.stop();
    AudioRecorder.cancel();
    recordedAudioBlob = null;
    confirmedQuestion = '';
    setPromptQuestion('');
    setListeningQuestion('');
    handsetEl.classList.remove('ringing');
    clearError();
    showOnly(null);
    callBtn.classList.remove('hidden');
    statusText.textContent = '';
    updateHomeBtn();
  }

  function goRinging() {
    deskScene.dataset.state = 'ringing';
    speechCaptureEnabled = false;
    primedRecognitionStarted = false;
    listeningRecorderStarted = false;
    clearError();
    handsetEl.classList.add('ringing');
    startRing();
    statusText.innerHTML = '따르릉 &mdash; 전화가 오고 있습니다';
    showOnly(answerBtn);
    updateHomeBtn();

    resumeAudioCtx();
    PROMPT_VOICES.forEach((src) => {
      loadPromptAudioBuffer(src).catch(() => {});
    });

    // 사용자 제스처 시점에 마이크 권한을 미리 받아 두면,
    // 같은 주소에서는 새로고침 후에도 브라우저가 다시 묻지 않습니다.
    if (SpeechController.ensureMicrophoneAccess) {
      SpeechController.ensureMicrophoneAccess({ keepAlive: true }).catch(() => {});
    }
  }

  function startListeningCaptureUi() {
    setLiveTranscriptStatus('… 답변 중 …');
    setListeningQuestion('');
    statusText.textContent = '';
    listenConfirmBtn.disabled = true;
    progressFill.style.transition = 'none';
    progressFill.style.width = '100%';
    void progressFill.offsetWidth;
    progressFill.style.transition = `width ${SpeechController.durationMs / 1000}s linear`;
    requestAnimationFrame(() => {
      progressFill.style.width = '0%';
    });
  }

  function enableSpeechCapture() {
    speechCaptureEnabled = true;
    SpeechController.clearTranscript();
    startListeningCaptureUi();
    startListeningRecorder();
  }

  async function startListeningRecorder() {
    if (!speechCaptureEnabled) return;
    if (listeningRecorderStarted || deskScene.dataset.state !== 'listening') return;
    listeningRecorderStarted = true;
    try {
      await AudioRecorder.start();
    } catch (err) {
      listeningRecorderStarted = false;
      console.warn('음성 녹음을 시작하지 못했습니다.', err);
    }
  }

  async function beginListeningSession({ primed = false } = {}) {
    if (primedRecognitionStarted && SpeechController.isActive) return;
    primedRecognitionStarted = true;

    if (speechCaptureEnabled) {
      startListeningCaptureUi();
      startListeningRecorder();
    }

    recordedAudioBlob = null;

    SpeechController.start({
      primed,
      onStart: () => {
        if (!speechCaptureEnabled) return;
        startListeningRecorder();
      },
      onInterim: (text) => {
        if (!speechCaptureEnabled) return;
        setLiveTranscriptStatus(text || '… 답변 중 …');
        listenConfirmBtn.disabled = !text;
        if (text) startListeningRecorder();
      },
      onEnd: async (finalText) => {
        if (deskScene.dataset.state !== 'listening') return;
        recordedAudioBlob = listeningRecorderStarted ? await AudioRecorder.stop() : null;
        const text = speechCaptureEnabled ? finalText : '';
        if (!text) {
          recordedAudioBlob = null;
          goRingingReadyForRetry();
          return;
        }
        goReviewing(text);
      },
      onError: async (message) => {
        if (deskScene.dataset.state !== 'listening') return;
        await AudioRecorder.cancel();
        recordedAudioBlob = null;
        if (message) showError(message);
        goRingingReadyForRetry();
      },
    });

    setTimeout(() => {
      startListeningRecorder();
    }, SpeechController.isIOS ? 200 : 40);
  }

  async function goListening(options = {}) {
    const skipPrompt = !!options.skipPrompt;
    deskScene.dataset.state = 'listening';
    speechCaptureEnabled = false;
    primedRecognitionStarted = false;
    listeningRecorderStarted = false;
    clearError();
    handsetEl.classList.remove('ringing');
    stopRing();
    stopPromptAudio();
    statusText.textContent = '';
    setAudioSessionType('playback');
    showOnly(listeningPanel);
    updateHomeBtn();

    resumeAudioCtx();

    if (!window.isSecureContext) {
      const host = window.location.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') {
        statusText.textContent =
          '주의: http://IP 주소에서는 아이패드 음성인식이 막힐 수 있습니다. HTTPS를 사용해주세요.';
      }
    }

    listenConfirmBtn.disabled = true;
    progressFill.style.transition = 'none';
    progressFill.style.width = '100%';

    if (skipPrompt) {
      // 다시하기: 안내 음성을 건너뛰어 iOS 인식 성공률을 높입니다.
      speechCaptureEnabled = true;
      setLiveTranscriptStatus('… 답변 중 …');
      if (confirmedQuestion) setListeningQuestion(confirmedQuestion);
      await resetAudioSessionForCapture();
      if (deskScene.dataset.state !== 'listening') return;
      setListeningQuestion('');
      beginListeningSession({ primed: true });
      return;
    }

    setLiveTranscriptStatus('… 상대방이 말하는 중 …');
    setListeningQuestion('');

    const startRecognitionEarly = () => {
      if (deskScene.dataset.state !== 'listening') return;
      if (primedRecognitionStarted) return;
      setAudioSessionType('play-and-record');
      beginListeningSession({ primed: true });
    };

    await playPromptVoice({
      onNearEnd: startRecognitionEarly,
    });
    if (deskScene.dataset.state !== 'listening') return;

    setAudioSessionType('play-and-record');
    enableSpeechCapture();
    if (!primedRecognitionStarted) {
      beginListeningSession({ primed: true });
    }
  }

  async function restartListening() {
    await SpeechController.prepareRestart();
    stopPromptAudio();
    await AudioRecorder.cancel();
    recordedAudioBlob = null;
    await goListening({ skipPrompt: SpeechController.isIOS });
  }

    async function confirmListeningEarly() {
    if (deskScene.dataset.state !== 'listening') return;
    const text = SpeechController.getTranscript();
    if (!text) return;
    SpeechController.stop();
    recordedAudioBlob = await AudioRecorder.stop();
    goReviewing(text);
  }

  // 인식 실패 시, 전화는 끊지 않고 바로 다시 "통화 시작"을 누를 수 있는 상태로
  function goRingingReadyForRetry() {
    deskScene.dataset.state = 'ringing';
    speechCaptureEnabled = false;
    primedRecognitionStarted = false;
    listeningRecorderStarted = false;
    SpeechController.stop();
    AudioRecorder.cancel();
    setAudioSessionType('playback');
    statusText.textContent = '';
    showOnly(answerBtn);
    updateHomeBtn();
  }

  function goReviewing(text) {
    deskScene.dataset.state = 'reviewing';
    clearError();
    setAudioSessionType('playback');
    confirmedMessage = text;
    setPromptQuestion(confirmedQuestion);
    reviewText.textContent = `“${text}”`;
    statusText.textContent = '';
    showOnly(reviewPanel);
    updateHomeBtn();
  }

  function goNaming() {
    deskScene.dataset.state = 'naming';
    clearError();
    statusText.textContent = '';
    namingQuote.textContent = `“${confirmedMessage}”`;
    nameInput.value = '';
    datePreview.textContent = formatPostmarkDate(new Date());
    showOnly(namingPanel);
    updateHomeBtn();
    setTimeout(() => nameInput.focus(), 50);
  }

  async function goSaved() {
    deskScene.dataset.state = 'saved';
    clearError();
    saveBtn.disabled = true;

    try {
      await GuestbookAPI.createEntry(
        nameInput.value,
        confirmedMessage,
        recordedAudioBlob,
        confirmedQuestion
      );
      recordedAudioBlob = null;
      statusText.textContent = '';
      showOnly(savedPanel);
      updateHomeBtn();
      galleryToggleBtn.classList.add('nudge');
      savedResetTimerId = setTimeout(goIdle, 3200);
    } catch (err) {
      showError(err.message || '저장에 실패했습니다. 다시 시도해주세요.');
      deskScene.dataset.state = 'naming';
      showOnly(namingPanel);
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ------------------------------------------------------------
   * 이벤트 바인딩 - 데스크/전화기 화면
   * ---------------------------------------------------------- */
  callBtn.addEventListener('click', goRinging);
  answerBtn.addEventListener('click', () => goListening());
  if (homeBtn) homeBtn.addEventListener('click', goIdle);
  if (listenHomeBtn) listenHomeBtn.addEventListener('click', goIdle);
  listenCancelBtn.addEventListener('click', restartListening);
  listenConfirmBtn.addEventListener('click', confirmListeningEarly);
  retryBtn.addEventListener('click', async () => {
    // 다시하기: 세션 정리 후 안내음성 없이 바로 재인식 (아이패드 안정화)
    await SpeechController.prepareRestart();
    await AudioRecorder.cancel();
    recordedAudioBlob = null;
    await goListening({ skipPrompt: true });
  });
  confirmBtn.addEventListener('click', goNaming);
  cancelNameBtn.addEventListener('click', goIdle);
  saveBtn.addEventListener('click', goSaved);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goSaved();
  });

  /* ------------------------------------------------------------
   * 방명록 갤러리
   * ---------------------------------------------------------- */
  function updateDeleteButtonState() {
    galleryDeleteBtn.disabled = selectedEntryIds.size === 0;
  }

  function stopEntryAudio() {
    if (!entryAudio) return;
    entryAudio.pause();
    entryAudio.removeAttribute('src');
    entryAudio.load();
    playingEntryId = null;
    galleryList.querySelectorAll('.gallery-play-btn.is-playing').forEach((btn) => {
      btn.classList.remove('is-playing');
      btn.textContent = '▶';
    });
  }

  function togglePlayEntry(entry, button) {
    if (!entry.audioUrl) return;

    if (playingEntryId === entry.id && !entryAudio.paused) {
      stopEntryAudio();
      return;
    }

    stopEntryAudio();
    playingEntryId = entry.id;
    entryAudio.src = entry.audioUrl;
    button.classList.add('is-playing');
    button.textContent = '■';
    const playPromise = entryAudio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        stopEntryAudio();
      });
    }
  }

  function renderGalleryCards(entries) {
    galleryList.innerHTML = '';
    selectedEntryIds = new Set();
    updateDeleteButtonState();
    stopEntryAudio();

    if (!entries.length) {
      return;
    }

    entries.forEach((entry, index) => {
      const card = document.createElement('article');
      card.className = 'gallery-card';
      const tilt = (index % 2 === 0 ? -1 : 1) * (0.6 + (index % 3) * 0.4);
      card.style.setProperty('--tilt', `${tilt}deg`);

      const hasAudio = !!(entry.audioUrl);
      card.innerHTML = `
        <label class="gallery-card-select">
          <input type="checkbox" class="gallery-card-checkbox" data-id="${escapeHtml(entry.id)}" />
        </label>
        <p class="gallery-card-name">${escapeHtml(entry.name || '이름 없음')}</p>
        ${
          entry.question
            ? `<p class="gallery-card-question">${escapeHtml(entry.question)}</p>`
            : ''
        }
        <p class="gallery-card-message">${escapeHtml(entry.message || '')}</p>
        <div class="gallery-card-footer">
          <button
            class="gallery-play-btn${!hasAudio ? ' is-disabled' : ''}"
            type="button"
            data-id="${escapeHtml(entry.id)}"
            ${hasAudio ? '' : 'disabled'}
            aria-label="음성 재생"
          >▶</button>
          <p class="gallery-card-date">${escapeHtml(entry.date || '')}</p>
        </div>
      `;

      const checkbox = card.querySelector('.gallery-card-checkbox');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedEntryIds.add(entry.id);
        else selectedEntryIds.delete(entry.id);
        card.classList.toggle('is-selected', checkbox.checked);
        updateDeleteButtonState();
      });

      const playBtn = card.querySelector('.gallery-play-btn');
      if (hasAudio) {
        playBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          togglePlayEntry(entry, playBtn);
        });
      }

      galleryList.appendChild(card);
    });
  }

  async function openGallery() {
    deskScene.classList.add('hidden');
    galleryScene.classList.remove('hidden');
    galleryToggleBtn.classList.add('hidden');
    updateHomeBtn();
    galleryToggleBtn.classList.remove('nudge');
    galleryList.innerHTML = '';
    try {
      const entries = await GuestbookAPI.fetchEntries();
      renderGalleryCards(entries);
    } catch (err) {
      galleryList.innerHTML = '';
    }
  }

  function closeGallery() {
    stopEntryAudio();
    selectedEntryIds = new Set();
    updateDeleteButtonState();
    closeAdminModal();
    galleryScene.classList.add('hidden');
    deskScene.classList.remove('hidden');
    galleryToggleBtn.classList.remove('hidden');
    updateHomeBtn();
  }

  function openAdminModal(ids) {
    pendingDeleteIds = ids.slice();
    adminPasswordInput.value = '';
    adminModalError.classList.add('hidden');
    adminModalError.textContent = '';
    adminModal.classList.remove('hidden');
    setTimeout(() => adminPasswordInput.focus(), 30);
  }

  function closeAdminModal() {
    adminModal.classList.add('hidden');
    pendingDeleteIds = [];
    adminPasswordInput.value = '';
    adminModalError.classList.add('hidden');
  }

  async function confirmAdminDelete() {
    adminConfirmBtn.disabled = true;
    try {
      await GuestbookAPI.deleteEntries(pendingDeleteIds, adminPasswordInput.value);
      closeAdminModal();
      const entries = await GuestbookAPI.fetchEntries();
      renderGalleryCards(entries);
    } catch (err) {
      adminModalError.textContent = err.message || '삭제에 실패했습니다.';
      adminModalError.classList.remove('hidden');
    } finally {
      adminConfirmBtn.disabled = false;
    }
  }

  galleryToggleBtn.addEventListener('click', openGallery);
  backBtn.addEventListener('click', closeGallery);
  galleryDeleteBtn.addEventListener('click', () => {
    if (!selectedEntryIds.size) return;
    openAdminModal(Array.from(selectedEntryIds));
  });
  adminCancelBtn.addEventListener('click', closeAdminModal);
  adminConfirmBtn.addEventListener('click', confirmAdminDelete);
  adminPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmAdminDelete();
  });
  adminModal.addEventListener('click', (e) => {
    if (e.target === adminModal) closeAdminModal();
  });
  if (entryAudio) {
    entryAudio.addEventListener('ended', stopEntryAudio);
  }

  /* ------------------------------------------------------------
   * 전체화면
   * ---------------------------------------------------------- */
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const fullscreenEnterIcon = fullscreenBtn.querySelector('.fullscreen-icon-enter');
  const fullscreenExitIcon = fullscreenBtn.querySelector('.fullscreen-icon-exit');

  function isFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );
  }

  function updateFullscreenIcon() {
    const on = isFullscreen();
    fullscreenEnterIcon.classList.toggle('hidden', on);
    fullscreenExitIcon.classList.toggle('hidden', !on);
    fullscreenBtn.setAttribute('aria-label', on ? '전체화면 종료' : '전체화면');
    fullscreenBtn.setAttribute('title', on ? '전체화면 종료' : '전체화면');
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
      }
    } catch (err) {
      // 브라우저/기기에서 전체화면을 막은 경우는 조용히 무시
    }
    updateFullscreenIcon();
  }

  fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenIcon);
  document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
  updateFullscreenIcon();

  /* ------------------------------------------------------------
   * 초기화
   * ---------------------------------------------------------- */
  goIdle();

  if (!SpeechController.supported) {
    showError('현재 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge에서 열어주세요.');
  }
})();
