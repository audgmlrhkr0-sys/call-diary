/**
 * MediaRecorder로 음성 인식과 동시에 오디오를 녹음합니다.
 */
const AudioRecorder = (() => {
  let mediaStream = null;
  let mediaRecorder = null;
  let chunks = [];
  let mimeType = '';

  function pickMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return '';
    }
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function start() {
    await stop(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 환경에서는 녹음을 지원하지 않습니다.');
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
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
    mimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.start(250);
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
            ? new Blob(chunks, { type: mimeType || 'audio/webm' })
            : null;
        finish(blob);
      };

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
