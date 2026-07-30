/**
 * Web Speech API(webkitSpeechRecognition)를 감싼 컨트롤러.
 * 약 10초 동안 음성을 듣고 하나의 문장으로 합쳐 반환합니다.
 * Chrome / Edge 등 Web Speech API를 지원하는 브라우저 + 인터넷 연결이 필요합니다.
 */
const SpeechController = (() => {
  const RECOGNITION_DURATION_MS = 10000;
  const SpeechRecognitionImpl =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;

  let recognition = null;
  let stopTimerId = null;
  let progressRafId = null;
  let finalTranscript = '';
  let active = false;

  function start({ onInterim, onEnd, onError, onProgress } = {}) {
    if (!SpeechRecognitionImpl) {
      onError &&
        onError(
          '이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge에서 실행해주세요.'
        );
      return;
    }

    if (active) {
      return;
    }

    finalTranscript = '';
    active = true;

    recognition = new SpeechRecognitionImpl();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += piece;
        } else {
          interim += piece;
        }
      }
      const combined = `${finalTranscript} ${interim}`.trim();
      onInterim && onInterim(combined);
    };

    recognition.onerror = (event) => {
      // 안내성 에러(마이크 권한, 무음 등)는 화면에 띄우지 않습니다.
      if (
        event.error === 'no-speech' ||
        event.error === 'not-allowed' ||
        event.error === 'service-not-allowed' ||
        event.error === 'audio-capture'
      ) {
        onError && onError('');
        return;
      }
      let message = '음성 인식 중 오류가 발생했습니다. 다시 시도해주세요.';
      if (event.error === 'network') {
        message = '음성 인식 서비스에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.';
      }
      onError && onError(message);
    };

    recognition.onend = () => {
      active = false;
      clearTimeout(stopTimerId);
      cancelAnimationFrame(progressRafId);
      onEnd && onEnd(finalTranscript.trim());
    };

    try {
      recognition.start();
    } catch (err) {
      active = false;
      onError && onError('음성 인식을 시작할 수 없습니다.');
      return;
    }

    const startedAt = Date.now();
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
        recognition.stop();
      }
    }, RECOGNITION_DURATION_MS);
  }

  function stop() {
    clearTimeout(stopTimerId);
    if (recognition && active) {
      recognition.stop();
    }
  }

  return {
    start,
    stop,
    get supported() {
      return !!SpeechRecognitionImpl;
    },
    get durationMs() {
      return RECOGNITION_DURATION_MS;
    },
  };
})();
