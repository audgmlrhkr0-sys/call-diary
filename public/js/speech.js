/**
 * Web Speech API(webkitSpeechRecognition)를 감싼 컨트롤러.
 * 약 15초 동안 음성을 듣고 하나의 문장으로 합쳐 반환합니다.
 *
 * 주의:
 * - iPad/iPhone은 데스크톱보다 불안정합니다. 특히 다시하기 직후 AudioSession이
 *   아직 안 풀리면 인식이 침묵으로 끝나는 경우가 많습니다.
 * - iOS에서는 MediaRecorder(getUserMedia)와 동시에 쓰면 마이크가 뺏기는 경우가 많습니다.
 * - Chrome / Edge / Safari(지원 시) + 인터넷 연결이 필요합니다.
 */
const SpeechController = (() => {
  const RECOGNITION_DURATION_MS = 15000;
  const MIC_GRANTED_KEY = 'phone-guestbook-mic-granted';
  const RESTART_DELAY_MS = 80;
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
  let lastStoppedAt = 0;

  function getTranscript() {
    return `${finalTranscript} ${interimTranscript}`.trim();
  }

  function clearTranscript() {
    finalTranscript = '';
    interimTranscript = '';
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

    if (keepAlive && micWarmStream) {
      return micWarmStream;
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
    lastStoppedAt = Date.now();
    clearTimers();
    releaseMicWarmStream();
    try {
      if (recognition) recognition.abort();
    } catch (err) {
      // ignore
    }
    recognition = null;
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
        lastStoppedAt = Date.now();
        clearTimers();
        releaseMicWarmStream();
        recognition = null;
        return;
      }

      if (!active) {
        lastStoppedAt = Date.now();
        clearTimers();
        releaseMicWarmStream();
        recognition = null;
        callbacks.onEnd && callbacks.onEnd(getTranscript());
        return;
      }

      if (endingByTimer) {
        active = false;
        lastStoppedAt = Date.now();
        clearTimers();
        releaseMicWarmStream();
        recognition = null;
        callbacks.onEnd && callbacks.onEnd(getTranscript());
        return;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed < RECOGNITION_DURATION_MS - 250) {
        restartTimerId = setTimeout(() => {
          if (token !== sessionToken || !active || endingByTimer) return;
          try {
            recognition = createRecognition(token);
            recognition.start();
          } catch (err) {
            active = false;
            lastStoppedAt = Date.now();
            clearTimers();
            releaseMicWarmStream();
            recognition = null;
            callbacks.onEnd && callbacks.onEnd(getTranscript());
          }
        }, RESTART_DELAY_MS);
        return;
      }

      active = false;
      lastStoppedAt = Date.now();
      clearTimers();
      releaseMicWarmStream();
      recognition = null;
      callbacks.onEnd && callbacks.onEnd(getTranscript());
    };

    return rec;
  }

  async function start({ onInterim, onEnd, onError, onProgress, onStart, primed = false } = {}) {
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

    // 이전 세션이 막 끝났다면 iOS가 마이크를 놓을 시간을 줍니다.
    // primed: 안내 음성 중에 마이크를 이미 열어 둔 경우 → 대기 없이 바로 인식 시작
    if (active) {
      stop();
    }
    if (!primed) {
      const sinceStop = Date.now() - lastStoppedAt;
      const needSettle = isIOS ? Math.max(0, 400 - sinceStop) : Math.max(0, 40 - sinceStop);
      if (needSettle > 0) {
        await new Promise((resolve) => setTimeout(resolve, needSettle));
      }
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
      if (primed && micWarmStream) {
        // 안내 음성 동안 열어 둔 마이크를 인식 시작까지 유지합니다.
      } else if (!primed) {
        await ensureMicrophoneAccess({ keepAlive: false });
        if (isIOS) {
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      }
    } catch (err) {
      active = false;
      lastStoppedAt = Date.now();
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
      // InvalidStateError: 아직 이전 인식이 안 끝난 경우 → 잠시 후 한 번 더
      if (isIOS) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        if (!active || token !== sessionToken) return;
        try {
          recognition = createRecognition(token);
          recognition.start();
        } catch (err2) {
          active = false;
          lastStoppedAt = Date.now();
          releaseMicWarmStream();
          onError && onError('음성 인식을 다시 시작할 수 없습니다. 잠시 후 다시 눌러주세요.');
          return;
        }
      } else {
        active = false;
        lastStoppedAt = Date.now();
        releaseMicWarmStream();
        onError && onError('음성 인식을 시작할 수 없습니다.');
        return;
      }
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
          lastStoppedAt = Date.now();
          releaseMicWarmStream();
          recognition = null;
          onEnd && onEnd(getTranscript());
        }
      }
    }, RECOGNITION_DURATION_MS);
  }

  function stop() {
    clearTimers();
    endingByTimer = true;
    suppressEndCallback = true;
    sessionToken += 1;
    const wasActive = active;
    active = false;
    lastStoppedAt = Date.now();
    releaseMicWarmStream();
    if (recognition && wasActive) {
      try {
        recognition.abort();
      } catch (err) {
        try {
          recognition.stop();
        } catch (err2) {
          // already stopped
        }
      }
    }
    recognition = null;
  }

  /** 다시하기 전에 호출: 세션을 끊고 iOS가 마이크를 놓을 때까지 기다립니다. */
  async function prepareRestart() {
    stop();
    releaseMicWarmStream();
    await new Promise((resolve) => setTimeout(resolve, isIOS ? 220 : 40));
  }

  return {
    start,
    stop,
    prepareRestart,
    getTranscript,
    clearTranscript,
    ensureMicrophoneAccess,
    releaseMicWarmStream,
    get supported() {
      return !!SpeechRecognitionImpl;
    },
    get durationMs() {
      return RECOGNITION_DURATION_MS;
    },
    get isActive() {
      return active;
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
