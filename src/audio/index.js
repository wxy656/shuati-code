export function createAudioPlayer(onStatus) {
  const audio = new Audio();
  let current = null;
  let sequence = 0;

  function report(status, message = '') {
    if (!current) return;
    const details = { ...current, status, message };
    console.info('音频', details);
    onStatus(details);
  }

  function stop() {
    if (!current) return;
    const previous = current;
    current = null;
    sequence += 1;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    console.info('音频', { ...previous, status: 'stopped' });
    onStatus({ ...previous, status: 'stopped', message: '' });
  }

  function play({ bankId, questionId, kind, url, rate, automatic }) {
    stop();
    const request = { bankId, questionId, kind, url, rate, automatic, sequence: ++sequence };
    current = request;
    if (!url) {
      report('unavailable', kind === 'question' ? '本题暂无题目音频' : '本题暂无解析音频');
      return;
    }
    audio.src = url;
    audio.playbackRate = rate;
    report('loading');
    audio.play().then(() => {
      if (current?.sequence === request.sequence) report('playing');
    }).catch((error) => {
      if (current?.sequence !== request.sequence) return;
      report('failed', error.name === 'NotAllowedError'
        ? automatic ? '自动播放受限，请点击朗读按钮' : '播放受限，请检查浏览器媒体设置'
        : `音频播放失败：${error.message}`);
    });
  }

  audio.addEventListener('ended', () => {
    if (current && audio.ended && audio.currentSrc === current.url) report('stopped', '播放结束');
  });
  audio.addEventListener('error', () => {
    if (current && audio.error && audio.currentSrc === current.url) {
      report('failed', `音频资源无法播放（错误代码 ${audio.error.code}）`);
    }
  });

  function setRate(rate) {
    audio.playbackRate = rate;
  }

  return { play, stop, setRate };
}
