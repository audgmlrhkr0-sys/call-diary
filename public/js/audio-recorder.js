/**
 * MediaRecorder로 음성 인식과 동시에 오디오를 녹음합니다.
 * iOS Safari는 webm보다 mp4(aac)를 지원합니다.
 */
const AudioRecorder = (() => {
  let mediaStream = null;
  let mediaRecorder = null;
  let chunks = [];
  let mimeType = '';

  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function pickMimeType() {
    const candidates = isIOS
      ? [
          'audio/mp4',
          'audio/aac',
          'audio/wav',
          'audio/webm;codecs=opus',
          'audio/webm',
        ]
      : [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
          'audio/ogg;codecs=opus',
        ];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return isIOS ? 'audio/mp4' : '';
    }
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function start() {
    await stop(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 환경에서는 녹음을 지원하지 않습니다.');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('이 브라우저는 MediaRecorder를 지원하지 않습니다.');
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });

    chunks = [];
    mimeType = pickMimeType();

    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);
    } catch (err) {
      // 지정 mime이 실패하면 기본 생성자로 재시도
      mediaRecorder = new MediaRecorder(mediaStream);
    }
    mimeType = mediaRecorder.mimeType || mimeType || (isIOS ? 'audio/mp4' : 'audio/webm');

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    // timeslice를 주면 Safari에서도 조각이 쌓이기 쉽습니다.
    try {
      mediaRecorder.start(250);
    } catch (err) {
      mediaRecorder.start();
    }
  }

  function stop(discard) {
    return new Promise((resolve) => {
      const finish = (blob) => {
        if (mediaStream) {
          mediaStream.getTracks().forEach((track) => track.stop());
        }
        mediaStream = null;
        mediaRecorder = null;
        chunks = [];
        resolve(discard ? null : blob);
      };

      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        finish(null);
        return;
      }

      mediaRecorder.onstop = () => {
        const blob =
          !discard && chunks.length
            ? new Blob(chunks, { type: mimeType || 'audio/mp4' })
            : null;
        finish(blob);
      };

      try {
        if (typeof mediaRecorder.requestData === 'function' && mediaRecorder.state === 'recording') {
          mediaRecorder.requestData();
        }
      } catch (err) {
        // ignore
      }

      try {
        mediaRecorder.stop();
      } catch (err) {
        finish(null);
      }
    });
  }

  function cancel() {
    return stop(true);
  }

  return {
    start,
    stop: () => stop(false),
    cancel,
    get isRecording() {
      return !!(mediaRecorder && mediaRecorder.state === 'recording');
    },
  };
})();
