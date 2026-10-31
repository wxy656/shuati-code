import { resourceUrl } from '../banks/index.js';
import { debugLog } from '../debug.js';

export function createOffline() {
  const listeners = new Set();
  const state = {
    available: false, questionReady: false,
    audioReadyCount: 0, audioTotal: 0, error: '', updateAvailable: false,
  };
  let registration = null;
  let currentBank = null;
  let selection = 0;
  let updating = false;
  const notify = () => listeners.forEach((listener) => listener({ ...state }));
  const audioPaths = (bank) => [...new Set(bank.questions.flatMap((question) =>
    [question.audio?.question, question.audio?.explanation].filter(Boolean)))];

  function request(type, bank, payload = {}) {
    const worker = navigator.serviceWorker.controller || registration?.active;
    if (!worker) return Promise.reject(new Error('离线服务尚未就绪'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => {
        channel.port1.close();
        if (data.requestId !== requestId) return reject(new Error('离线请求标识不匹配'));
        if (data.error) return reject(new Error(data.error));
        resolve(data);
      };
      worker.postMessage({ type, requestId, bankId: bank.bankId, version: bank.version,
        dataPath: bank.dataPath, ...payload }, [channel.port2]);
    });
  }

  async function inspect(bank = currentBank) {
    if (!bank) return null;
    if (bank.local) {
      const cache = await caches.open(bank.cacheName);
      const existing = new Set((await cache.keys()).map((request) => request.url));
      const paths = audioPaths(bank);
      const missingAudio = paths.filter((path) => !existing.has(resourceUrl(path).href));
      state.questionReady = existing.has(resourceUrl(bank.dataPath).href);
      state.audioTotal = paths.length;
      state.audioReadyCount = paths.length - missingAudio.length;
      state.error = state.questionReady && !missingAudio.length
        ? '' : '本机题库资源不完整，请重新导入 ZIP。';
      notify();
      return { questionReady: state.questionReady, missingAudio };
    }
    if (!state.available) return null;
    const selected = selection;
    const paths = audioPaths(bank);
    try {
      const result = await request('INSPECT', bank, { audioPaths: paths });
      if (selected !== selection) return null;
      state.questionReady = result.questionReady;
      state.audioTotal = paths.length;
      state.audioReadyCount = paths.length - result.missingAudio.length;
      state.error = state.questionReady && !result.missingAudio.length
        ? '' : '离线资源不完整，请联网更新应用。';
      debugLog('离线资源状态', {
        bankId: bank.bankId, version: bank.version,
        questionReady: state.questionReady, audioReady: state.audioReadyCount, audioTotal: paths.length,
      });
      notify();
      return result;
    } catch (error) {
      if (selected === selection) {
        state.error = `检查离线资源失败：${error.message}`;
        debugLog('离线资源检查失败', { bankId: bank.bankId, version: bank.version, error: error.message });
        notify();
      }
      return null;
    }
  }

  function selectBank(bank) {
    currentBank = bank;
    selection += 1;
    Object.assign(state, {
      questionReady: false, audioReadyCount: 0,
      audioTotal: audioPaths(bank).length, error: '',
    });
    notify();
    inspect(bank);
  }

  async function initialize() {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    try {
      registration = await navigator.serviceWorker.register(resourceUrl('sw.js'), {
        scope: resourceUrl('.').pathname,
        updateViaCache: 'none',
      });
      const updateStatus = () => {
        state.updateAvailable = Boolean(registration.waiting);
        notify();
      };
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', updateStatus);
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updating) window.location.reload();
        else inspect();
      });
      await navigator.serviceWorker.ready;
      state.available = true;
      updateStatus();
      inspect();
    } catch (error) {
      state.error = `离线服务启用失败：${error.message}`;
      notify();
    }
  }

  function activateUpdate() {
    if (!registration?.waiting) return;
    updating = true;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  return { state, subscribe: (listener) => listeners.add(listener), initialize,
    selectBank, activateUpdate };
}
