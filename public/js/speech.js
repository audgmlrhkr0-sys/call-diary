/**
 * Web Speech API(webkitSpeechRecognition)를 감싼 컨트롤러.
 * 약 15초 동안 음성을 듣고 하나의 문장으로 합쳐 반환합니다.
 * Chrome / Edge / Safari(지원 시) + 인터넷 연결이 필요합니다.
 * 마이크 권한은 getUserMedia로 먼저 받아 두면, 같은 주소(localhost 등)에서는
 * 새로고침 후에도 브라우저가 다시 묻지 않습니다.
 */
const SpeechController = (() => {
  const RECOGNITION_DURATION_MS = 15000;
  const MIC_GRANTED_KEY = 'phone-guestbook-mic-granted';
  const SpeechRecognitionImpl =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  let recognition = null;
  let stopTimerId = null;
  let progressRafId = null;
  let finalTranscript = '';
  let interimTranscript = '';
  let active = false;
  let endingByTimer = false;
  let suppressEndCallback = false;
  let startedAt = 0;
  let sessionToken = 0;
  let callbacks = {};

  function getTranscript() {
    return `${finalTranscript} ${interimTranscript}`.trim();
  }

  function isSecureEnough() {
    if (window.isSecureContext) return true;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  async function ensureMicrophoneAccess() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 환경에서는 마이크를 사용할 수 없습니다. localhost 또는 HTTPS로 열어주세요.');
    }

    // 권한을 명시적으로 받아 두면 같은 오리진에서는 새로고침 후에도 유지됩니다.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    // SpeechRecognition이 마이크를 쓸 수 있도록 트랙은 바로 해제합니다.
    stream.getTracks().forEach((track) => track.stop());
    try {
      localStorage.setItem(MIC_GRANTED_KEY, '1');
    } catch (err) {
      // localStorage 불가 환경은 무시
    }
  }

  function createRecognition(token) {
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      if (token !== sessionToken) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += piece;
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
        active = false;
        clearTimeout(stopTimerId);
        callbacks.onError &&
          callbacks.onError('마이크 사용이 차단되어 있습니다. 브라우저 주소창 왼쪽 아이콘에서 마이크를 허용해주세요.');
        return;
      }

      if (event.error === 'audio-capture') {
        active = false;
        clearTimeout(stopTimerId);
        callbacks.onError && callbacks.onError('마이크를 찾을 수 없습니다. 연결 상태를 확인해주세요.');
        return;
      }

      if (event.error === 'network') {
        active = false;
        clearTimeout(stopTimerId);
        callbacks.onError &&
          callbacks.onError('음성 인식 서비스에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.');
        return;
      }

      active = false;
      clearTimeout(stopTimerId);
      callbacks.onError &&
        callbacks.onError('음성 인식 중 오류가 발생했습니다. 다시 시도해주세요.');
    };

    rec.onend = () => {
      if (token !== sessionToken) return;

      if (suppressEndCallback) {
        suppressEndCallback = false;
        active = false;
        clearTimeout(stopTimerId);
        cancelAnimationFrame(progressRafId);
        return;
      }

      if (!active) {
        clearTimeout(stopTimerId);
        cancelAnimationFrame(progressRafId);
        callbacks.onEnd && callbacks.onEnd(getTranscript());
        return;
      }

      // 타이머로 정상 종료한 경우
      if (endingByTimer) {
        active = false;
        clearTimeout(stopTimerId);
        cancelAnimationFrame(progressRafId);
        callbacks.onEnd && callbacks.onEnd(getTranscript());
        return;
      }

      // Chrome 등은 말이 잠깐 끊기면 세션을 종료합니다. 남은 시간이 있으면 재시작.
      const elapsed = Date.now() - startedAt;
      if (elapsed < RECOGNITION_DURATION_MS - 200) {
        try {
          recognition = createRecognition(token);
          recognition.start();
          return;
        } catch (err) {
          // 재시작 실패 시 아래에서 종료 처리
        }
      }

      active = false;
      clearTimeout(stopTimerId);
      cancelAnimationFrame(progressRafId);
      callbacks.onEnd && callbacks.onEnd(getTranscript());
    };

    return rec;
  }

  async function start({ onInterim, onEnd, onError, onProgress } = {}) {
    if (!SpeechRecognitionImpl) {
      onError &&
        onError(
          '이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge에서 실행해주세요.'
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

    callbacks = { onInterim, onEnd, onError, onProgress };
    finalTranscript = '';
    interimTranscript = '';
    endingByTimer = false;
    suppressEndCallback = false;
    active = true;
    startedAt = Date.now();
    const token = ++sessionToken;

    try {
      await ensureMicrophoneAccess();
    } catch (err) {
      active = false;
      const denied =
        err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      onError &&
        onError(
          denied
            ? '마이크 사용이 차단되어 있습니다. 브라우저 주소창 왼쪽 아이콘에서 마이크를 허용해주세요.'
            : '마이크를 시작할 수 없습니다. localhost 또는 HTTPS로 접속했는지 확인해주세요.'
        );
      return;
    }

    if (!active) return;

    try {
      recognition = createRecognition(token);
      recognition.start();
    } catch (err) {
      active = false;
      onError && onError('음성 인식을 시작할 수 없습니다.');
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
          onEnd && onEnd(getTranscript());
        }
      }
    }, RECOGNITION_DURATION_MS);
  }

  function stop(options = {}) {
    clearTimeout(stopTimerId);
    cancelAnimationFrame(progressRafId);
    endingByTimer = true;
    // stop()은 수동 중단용이라 onEnd를 다시 부르지 않습니다.
    // (타이머 종료는 recognition.stop()을 직접 호출하고 endingByTimer로 처리)
    suppressEndCallback = true;
    sessionToken += 1;
    const wasActive = active;
    active = false;
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
    get supported() {
      return !!SpeechRecognitionImpl;
    },
    get durationMs() {
      return RECOGNITION_DURATION_MS;
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
