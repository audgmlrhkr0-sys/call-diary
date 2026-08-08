/**
 * Web Speech API(webkitSpeechRecognition)를 감싼 컨트롤러.
 * 약 15초 동안 음성을 듣고 하나의 문장으로 합쳐 반환합니다.
 *
 * 주의:
 * - iPad/iPhone Chrome(CriOS)은 WebKit 기반이라 음성 인식이 자주 실패합니다. Safari 권장.
 * - iOS에서는 MediaRecorder(getUserMedia)와 동시에 쓰면 마이크가 뺏기는 경우가 많습니다.
 * - Chrome / Edge / Safari(지원 시) + 인터넷 연결이 필요합니다.
 */
const SpeechController = (() => {
  const RECOGNITION_DURATION_MS = 15000;
  const MIC_GRANTED_KEY = 'phone-guestbook-mic-granted';
  const RESTART_DELAY_MS = 180;
  const SpeechRecognitionImpl =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOSChrome = isIOS && /CriOS/.test(ua);

  let recognition = null;
  let stopTimerId = null;
  let restartTimerId = null;
  let progressRafId = null;
  let finalTranscript = '';
  let interimTranscript = '';
  let active = false;
  let endingByTimer = false;
  let suppressEndCallback = false;
  let startedAt = 0;
  let sessionToken = 0;
  let callbacks = {};
  let micWarmStream = null;

  function getTranscript() {
    return `${finalTranscript} ${interimTranscript}`.trim();
  }

  function isSecureEnough() {
    if (window.isSecureContext) return true;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  function releaseMicWarmStream() {
    if (!micWarmStream) return;
    micWarmStream.getTracks().forEach((track) => track.stop());
    micWarmStream = null;
  }

  async function ensureMicrophoneAccess({ keepAlive = false } = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 환경에서는 마이크를 사용할 수 없습니다. localhost 또는 HTTPS로 열어주세요.');
    }

    releaseMicWarmStream();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });

    try {
      localStorage.setItem(MIC_GRANTED_KEY, '1');
    } catch (err) {
      // localStorage 불가 환경은 무시
    }

    if (keepAlive) {
      micWarmStream = stream;
      return stream;
    }

    // SpeechRecognition과 마이크를 동시에 잡지 않도록 바로 해제합니다.
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }

  function clearTimers() {
    clearTimeout(stopTimerId);
    clearTimeout(restartTimerId);
    cancelAnimationFrame(progressRafId);
    stopTimerId = null;
    restartTimerId = null;
    progressRafId = null;
  }

  function finishWithError(message) {
    active = false;
    clearTimers();
    releaseMicWarmStream();
    callbacks.onError && callbacks.onError(message);
  }

  function createRecognition(token) {
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'ko-KR';
    // iOS WebKit은 continuous가 불안정한 경우가 많아 false를 쓰고 onend로 이어붙입니다.
    rec.continuous = !isIOS;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (token !== sessionToken) return;
      // 인식이 마이크를 잡은 뒤 warm 스트림을 해제합니다.
      releaseMicWarmStream();
      callbacks.onStart && callbacks.onStart();
    };

    rec.onresult = (event) => {
      if (token !== sessionToken) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += `${piece} `;
        } else {
          interim += piece;
        }
      }
      interimTranscript = interim;
      const combined = getTranscript();
      callbacks.onInterim && callbacks.onInterim(combined);
    };

    rec.onerror = (event) => {
      if (token !== sessionToken) return;
      // 잠깐 무음이거나 브라우저가 세션을 끊는 경우는 무시하고, 남은 시간이 있으면 재시작합니다.
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        const tip = isIOSChrome
          ? '아이패드 Chrome에서는 음성 인식이 자주 막힙니다. Safari로 열어주세요.'
          : '마이크 사용이 차단되어 있습니다. 브라우저 주소창 왼쪽 아이콘에서 마이크를 허용해주세요.';
        finishWithError(tip);
        return;
      }

      if (event.error === 'audio-capture') {
        finishWithError(
          isIOS
            ? '마이크를 사용할 수 없습니다. 연결된 전화기/헤드셋 마이크와 Safari 마이크 권한을 확인해주세요.'
            : '마이크를 찾을 수 없습니다. 연결 상태를 확인해주세요.'
        );
        return;
      }

      if (event.error === 'network') {
        finishWithError('음성 인식 서비스에 연결할 수 없습니다. 인터넷(Wi‑Fi) 연결을 확인해주세요.');
        return;
      }

      finishWithError('음성 인식 중 오류가 발생했습니다. 다시 시도해주세요.');
    };

    rec.onend = () => {
      if (token !== sessionToken) return;

      if (suppressEndCallback) {
        suppressEndCallback = false;
        active = false;
        clearTimers();
        releaseMicWarmStream();
        return;
      }

      if (!active) {
        clearTimers();
        releaseMicWarmStream();
        callbacks.onEnd && callbacks.onEnd(getTranscript());
        return;
      }

      if (endingByTimer) {
        active = false;
        clearTimers();
        releaseMicWarmStream();
        callbacks.onEnd && callbacks.onEnd(getTranscript());
        return;
      }

      // Chrome/iOS 등은 말이 잠깐 끊기면 세션을 종료합니다. 남은 시간이 있으면 재시작.
      const elapsed = Date.now() - startedAt;
      if (elapsed < RECOGNITION_DURATION_MS - 250) {
        restartTimerId = setTimeout(() => {
          if (token !== sessionToken || !active || endingByTimer) return;
          try {
            recognition = createRecognition(token);
            recognition.start();
          } catch (err) {
            active = false;
            clearTimers();
            releaseMicWarmStream();
            callbacks.onEnd && callbacks.onEnd(getTranscript());
          }
        }, RESTART_DELAY_MS);
        return;
      }

      active = false;
      clearTimers();
      releaseMicWarmStream();
      callbacks.onEnd && callbacks.onEnd(getTranscript());
    };

    return rec;
  }

  async function start({ onInterim, onEnd, onError, onProgress, onStart } = {}) {
    if (!SpeechRecognitionImpl) {
      onError &&
        onError(
          isIOS
            ? '이 브라우저에서는 음성 인식이 지원되지 않습니다. 아이패드에서는 Safari를 사용해주세요.'
            : '이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge에서 실행해주세요.'
        );
      return;
    }

    if (!isSecureEnough() && window.location.protocol === 'file:') {
      onError &&
        onError(
          '음성 인식은 파일 직접 열기(file://)에서는 동작하지 않습니다. npm start 후 http://localhost:4173 으로 열어주세요.'
        );
      return;
    }

    if (active) {
      return;
    }

    callbacks = { onInterim, onEnd, onError, onProgress, onStart };
    finalTranscript = '';
    interimTranscript = '';
    endingByTimer = false;
    suppressEndCallback = false;
    active = true;
    startedAt = Date.now();
    const token = ++sessionToken;

    try {
      // 권한만 확인한 뒤 마이크는 바로 놓습니다.
      // (iOS에서 getUserMedia를 잡은 채 SpeechRecognition을 켜면 인식이 자주 실패합니다.)
      await ensureMicrophoneAccess({ keepAlive: false });
      if (isIOS) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } catch (err) {
      active = false;
      releaseMicWarmStream();
      const denied =
        err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      const insecure = !isSecureEnough();
      onError &&
        onError(
          denied
            ? '마이크 사용이 차단되어 있습니다. 설정 → Safari → 마이크를 허용해주세요.'
            : insecure
              ? '아이패드 Safari는 http://IP주소 에서 마이크/음성인식이 막힐 수 있습니다. HTTPS 또는 컴퓨터에서 localhost로 열어주세요.'
              : '마이크를 시작할 수 없습니다. localhost 또는 HTTPS로 접속했는지 확인해주세요.'
        );
      return;
    }

    if (!active || token !== sessionToken) return;

    try {
      recognition = createRecognition(token);
      recognition.start();
    } catch (err) {
      active = false;
      releaseMicWarmStream();
      onError &&
        onError(
          isIOSChrome
            ? '음성 인식을 시작할 수 없습니다. 아이패드에서는 Safari로 열어주세요.'
            : '음성 인식을 시작할 수 없습니다.'
        );
      return;
    }

    if (onProgress) {
      const tick = () => {
        if (!active) return;
        const elapsed = Date.now() - startedAt;
        const ratio = Math.min(elapsed / RECOGNITION_DURATION_MS, 1);
        onProgress(ratio);
        if (ratio < 1) {
          progressRafId = requestAnimationFrame(tick);
        }
      };
      progressRafId = requestAnimationFrame(tick);
    }

    stopTimerId = setTimeout(() => {
      if (recognition && active) {
        endingByTimer = true;
        try {
          recognition.stop();
        } catch (err) {
          active = false;
          releaseMicWarmStream();
          onEnd && onEnd(getTranscript());
        }
      }
    }, RECOGNITION_DURATION_MS);
  }

  function stop(options = {}) {
    clearTimers();
    endingByTimer = true;
    // stop()은 수동 중단용이라 onEnd를 다시 부르지 않습니다.
    suppressEndCallback = true;
    sessionToken += 1;
    const wasActive = active;
    active = false;
    releaseMicWarmStream();
    if (recognition && wasActive) {
      try {
        recognition.stop();
      } catch (err) {
        // already stopped
      }
    }
  }

  return {
    start,
    stop,
    getTranscript,
    ensureMicrophoneAccess,
    releaseMicWarmStream,
    get supported() {
      return !!SpeechRecognitionImpl;
    },
    get durationMs() {
      return RECOGNITION_DURATION_MS;
    },
    get isIOS() {
      return isIOS;
    },
    get isIOSChrome() {
      return isIOSChrome;
    },
    get hasStoredMicGrant() {
      try {
        return localStorage.getItem(MIC_GRANTED_KEY) === '1';
      } catch (err) {
        return false;
      }
    },
  };
})();
