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
  const galleryToggleBtn = document.getElementById('gallery-toggle-btn');
  const backBtn = document.getElementById('back-btn');
  const galleryList = document.getElementById('gallery-list');
  const galleryEmpty = document.getElementById('gallery-empty');
  const storageNotice = document.getElementById('storage-notice');

  const handsetEl = document.getElementById('handset');
  const statusText = document.getElementById('status-text');
  const errorText = document.getElementById('error-text');

  const callBtn = document.getElementById('call-btn');
  const answerBtn = document.getElementById('answer-btn');

  const listeningPanel = document.getElementById('listening-panel');
  const progressFill = document.getElementById('progress-fill');
  const liveTranscript = document.getElementById('live-transcript');

  const reviewPanel = document.getElementById('review-panel');
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

  let confirmedMessage = '';
  let savedResetTimerId = null;

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

  /* ------------------------------------------------------------
   * 합성 벨소리 (Web Audio API) - call.mp3 파일이 없을 때 대체 사용
   * ---------------------------------------------------------- */
  let audioCtx = null;
  let ringIntervalId = null;
  let usingAudioFile = false;

  function getAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    return audioCtx;
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

  function goIdle() {
    clearTimeout(savedResetTimerId);
    deskScene.dataset.state = 'idle';
    setAudioSessionType('playback');
    stopRing();
    SpeechController.stop();
    handsetEl.classList.remove('ringing');
    clearError();
    showOnly(null);
    callBtn.classList.remove('hidden');
    statusText.textContent = '';
  }

  function goRinging() {
    deskScene.dataset.state = 'ringing';
    clearError();
    handsetEl.classList.add('ringing');
    startRing();
    statusText.innerHTML = '따르릉 &mdash; 전화가 오고 있습니다';
    showOnly(answerBtn);
  }

  function goListening() {
    deskScene.dataset.state = 'listening';
    clearError();
    handsetEl.classList.remove('ringing');
    stopRing();
    statusText.textContent = '';
    setAudioSessionType('play-and-record'); // 음성 인식은 마이크로만 캡처되도록
    showOnly(listeningPanel);

    liveTranscript.textContent = '… 듣고 있어요 …';
    progressFill.style.transition = 'none';
    progressFill.style.width = '100%';
    // 강제 리플로우 후 트랜지션 재적용 (10초 동안 줄어드는 바)
    void progressFill.offsetWidth;
    progressFill.style.transition = `width ${SpeechController.durationMs / 1000}s linear`;
    requestAnimationFrame(() => {
      progressFill.style.width = '0%';
    });

    SpeechController.start({
      onInterim: (text) => {
        liveTranscript.textContent = text || '… 듣고 있어요 …';
      },
      onEnd: (finalText) => {
        if (deskScene.dataset.state !== 'listening') return;
        if (!finalText) {
          showError('문장을 알아듣지 못했어요. 다시 시도해주세요.');
          goRingingReadyForRetry();
          return;
        }
        goReviewing(finalText);
      },
      onError: (message) => {
        if (deskScene.dataset.state !== 'listening') return;
        showError(message);
        goRingingReadyForRetry();
      },
    });
  }

  // 인식 실패 시, 전화는 끊지 않고 바로 다시 "통화 시작"을 누를 수 있는 상태로
  function goRingingReadyForRetry() {
    deskScene.dataset.state = 'ringing';
    setAudioSessionType('playback');
    statusText.textContent = '';
    showOnly(answerBtn);
  }

  function goReviewing(text) {
    deskScene.dataset.state = 'reviewing';
    clearError();
    setAudioSessionType('playback');
    confirmedMessage = text;
    reviewText.textContent = `“${text}”`;
    statusText.textContent = '';
    showOnly(reviewPanel);
  }

  function goNaming() {
    deskScene.dataset.state = 'naming';
    clearError();
    statusText.textContent = '방명록에 남길 이름을 적어주세요';
    namingQuote.textContent = `“${confirmedMessage}”`;
    nameInput.value = '';
    datePreview.textContent = formatPostmarkDate(new Date());
    showOnly(namingPanel);
    setTimeout(() => nameInput.focus(), 50);
  }

  async function goSaved() {
    deskScene.dataset.state = 'saved';
    clearError();
    saveBtn.disabled = true;

    try {
      await GuestbookAPI.createEntry(nameInput.value, confirmedMessage);
      statusText.textContent = '감사합니다';
      showOnly(savedPanel);
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
  answerBtn.addEventListener('click', goListening);
  retryBtn.addEventListener('click', goListening);
  confirmBtn.addEventListener('click', goNaming);
  cancelNameBtn.addEventListener('click', goIdle);
  saveBtn.addEventListener('click', goSaved);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goSaved();
  });

  /* ------------------------------------------------------------
   * 방명록 갤러리
   * ---------------------------------------------------------- */
  function renderGalleryCards(entries) {
    galleryList.innerHTML = '';
    galleryEmpty.classList.add('hidden');
    if (!entries.length) {
      return;
    }

    entries.forEach((entry, index) => {
      const card = document.createElement('article');
      card.className = 'gallery-card';
      const tilt = (index % 2 === 0 ? -1 : 1) * (1 + (index % 3));
      card.style.setProperty('--tilt', `${tilt}deg`);
      card.innerHTML = `
        <p class="gallery-card-name">${escapeHtml(entry.name || '이름 없음')}</p>
        <p class="gallery-card-message">${escapeHtml(entry.message || '')}</p>
        <p class="gallery-card-date">${escapeHtml(entry.date || '')}</p>
      `;
      galleryList.appendChild(card);
    });
  }

  async function openGallery() {
    deskScene.classList.add('hidden');
    galleryScene.classList.remove('hidden');
    galleryToggleBtn.classList.add('hidden');
    galleryList.innerHTML = '';
    galleryEmpty.classList.add('hidden');
    storageNotice.classList.add('hidden');
    try {
      const entries = await GuestbookAPI.fetchEntries();
      renderGalleryCards(entries);
    } catch (err) {
      galleryList.innerHTML = '';
      galleryEmpty.classList.add('hidden');
    }
  }

  function closeGallery() {
    galleryScene.classList.add('hidden');
    deskScene.classList.remove('hidden');
    galleryToggleBtn.classList.remove('hidden');
  }

  galleryToggleBtn.addEventListener('click', openGallery);
  backBtn.addEventListener('click', closeGallery);

  /* ------------------------------------------------------------
   * 초기화
   * ---------------------------------------------------------- */
  goIdle();

  if (!SpeechController.supported) {
    showError('현재 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge에서 열어주세요.');
  }
})();
