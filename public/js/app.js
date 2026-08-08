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
  const promptQuestionEl = document.getElementById('prompt-question');
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
  let selectedEntryIds = new Set();
  let pendingDeleteIds = [];
  let playingEntryId = null;

  const PROMPT_VOICES = [
    {
      src: 'assets/sounds/prompts/minsung.m4a',
      question: '미술관에 방문하게 된 계기는?',
    },
    {
      src: 'assets/sounds/prompts/minsung2.m4a',
      question: '나만의 규칙을 말해 주세요!',
    },
    {
      src: 'assets/sounds/prompts/seoyeon.m4a',
      question: '당신에게 기준이란?',
    },
    {
      src: 'assets/sounds/prompts/seoyeon2.m4a',
      question: '가장 기억에 남는 작품을 말해 주세요!',
    },
    {
      src: 'assets/sounds/prompts/jisu.m4a',
      question: '오늘의 기분을 한 줄로 소개해 주세요!',
    },
    {
      src: 'assets/sounds/prompts/jisu2.m4a',
      question: '여러분에게 미술관이란?',
    },
  ];

  let promptVoiceQueue = [];
  let lastPromptVoiceSrc = '';

  function shuffleList(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function refillPromptVoiceQueue() {
    promptVoiceQueue = shuffleList(PROMPT_VOICES);
    if (
      promptVoiceQueue.length > 1 &&
      promptVoiceQueue[0].src === lastPromptVoiceSrc
    ) {
      promptVoiceQueue.push(promptVoiceQueue.shift());
    }
  }

  function pickRandomPromptVoice() {
    if (!promptVoiceQueue.length) {
      refillPromptVoiceQueue();
    }
    const next = promptVoiceQueue.shift();
    lastPromptVoiceSrc = next.src;
    return next;
  }

  function setPromptQuestion(text) {
    const value = text || '';
    if (promptQuestionEl) promptQuestionEl.textContent = value;
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
    if (!promptAudio) return;
    promptAudio.onended = null;
    promptAudio.onerror = null;
    promptAudio.pause();
    promptAudio.muted = false;
    promptAudio.removeAttribute('src');
    promptAudio.load();
  }

  async function unlockPromptAudio(url) {
    if (!promptAudio) return false;

    promptAudio.muted = true;
    promptAudio.src = url;

    try {
      // await 없이 바로 play() 해야 사용자 제스처가 유지됩니다.
      const playPromise = promptAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        await playPromise;
      }
      promptAudio.pause();
      promptAudio.currentTime = 0;
      promptAudio.muted = false;
      return true;
    } catch (err) {
      console.warn('안내 음성을 준비하지 못했습니다.', url, err);
      promptAudio.muted = false;
      return false;
    }
  }

  async function playRandomPromptVoice() {
    if (!promptAudio) return;

    setAudioSessionType('playback');
    const prompt = pickRandomPromptVoice();
    confirmedQuestion = prompt.question;
    setPromptQuestion(prompt.question);

    // 통화 시작 클릭(사용자 제스처) 안에서 먼저 오디오를 잠금 해제합니다.
    const ready = await unlockPromptAudio(prompt.src);
    if (!ready) {
      console.warn('안내 음성 파일을 재생할 수 없습니다:', prompt.src);
      return;
    }
    if (deskScene.dataset.state !== 'listening') return;

    await delay(1000);
    if (deskScene.dataset.state !== 'listening') return;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        promptAudio.onended = null;
        promptAudio.onerror = null;
        resolve();
      };

      promptAudio.onended = finish;
      promptAudio.onerror = () => {
        console.warn('안내 음성 재생 중 오류:', prompt.src);
        finish();
      };

      try {
        promptAudio.currentTime = 0;
      } catch (err) {
        // ignore
      }

      const playPromise = promptAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.catch((err) => {
          console.warn('안내 음성 재생 실패:', prompt.src, err);
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
    stopPromptAudio();
    SpeechController.stop();
    AudioRecorder.cancel();
    recordedAudioBlob = null;
    confirmedQuestion = '';
    setPromptQuestion('');
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

    // 사용자 제스처 시점에 마이크 권한을 미리 받아 두면,
    // 같은 주소에서는 새로고침 후에도 브라우저가 다시 묻지 않습니다.
    if (SpeechController.ensureMicrophoneAccess) {
      SpeechController.ensureMicrophoneAccess().catch(() => {});
    }
  }

  async function beginListeningSession() {
    liveTranscript.textContent = '… 답변 중 …';
    listenConfirmBtn.disabled = true;
    progressFill.style.transition = 'none';
    progressFill.style.width = '100%';
    void progressFill.offsetWidth;
    progressFill.style.transition = `width ${SpeechController.durationMs / 1000}s linear`;
    requestAnimationFrame(() => {
      progressFill.style.width = '0%';
    });

    recordedAudioBlob = null;
    try {
      await AudioRecorder.start();
    } catch (err) {
      // 녹음 실패해도 음성 인식은 시도합니다.
      console.warn('음성 녹음을 시작하지 못했습니다.', err);
    }

    SpeechController.start({
      onInterim: (text) => {
        liveTranscript.textContent = text || '… 답변 중 …';
        listenConfirmBtn.disabled = !text;
      },
      onEnd: async (finalText) => {
        if (deskScene.dataset.state !== 'listening') return;
        recordedAudioBlob = await AudioRecorder.stop();
        if (!finalText) {
          recordedAudioBlob = null;
          goRingingReadyForRetry();
          return;
        }
        goReviewing(finalText);
      },
      onError: async (message) => {
        if (deskScene.dataset.state !== 'listening') return;
        await AudioRecorder.cancel();
        recordedAudioBlob = null;
        if (message) showError(message);
        goRingingReadyForRetry();
      },
    });
  }

  async function goListening() {
    deskScene.dataset.state = 'listening';
    clearError();
    handsetEl.classList.remove('ringing');
    stopRing();
    stopPromptAudio();
    statusText.textContent = '';
    setAudioSessionType('playback');
    showOnly(listeningPanel);

    liveTranscript.textContent = '… 상대방이 말하는 중 …';
    listenConfirmBtn.disabled = true;
    progressFill.style.transition = 'none';
    progressFill.style.width = '100%';

    await playRandomPromptVoice();
    if (deskScene.dataset.state !== 'listening') return;

    setAudioSessionType('play-and-record');
    beginListeningSession();
  }

  async function restartListening() {
    SpeechController.stop();
    stopPromptAudio();
    await AudioRecorder.cancel();
    recordedAudioBlob = null;
    goListening();
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
    setAudioSessionType('playback');
    statusText.textContent = '';
    showOnly(answerBtn);
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
  }

  function goNaming() {
    deskScene.dataset.state = 'naming';
    clearError();
    statusText.textContent = '';
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
      await GuestbookAPI.createEntry(
        nameInput.value,
        confirmedMessage,
        recordedAudioBlob,
        confirmedQuestion
      );
      recordedAudioBlob = null;
      statusText.textContent = '';
      showOnly(savedPanel);
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
  answerBtn.addEventListener('click', goListening);
  listenCancelBtn.addEventListener('click', restartListening);
  listenConfirmBtn.addEventListener('click', confirmListeningEarly);
  retryBtn.addEventListener('click', async () => {
    await AudioRecorder.cancel();
    recordedAudioBlob = null;
    goListening();
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
