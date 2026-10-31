import { findQuestionPosition, loadBank, loadBankIndex, resourceUrl } from '../banks/index.js';
import { createAudioPlayer } from '../audio/index.js';
import { gradeQuestion } from '../grading/index.js';
import { createStorage } from '../storage/index.js';
import { debugLog } from '../debug.js';
import { importBankZip } from '../banks/import.js';

const defaultSettings = {
  fontSize: 42,
  autoQuestion: true,
  autoExplanation: true,
  rate: 1,
  lastBankId: null,
  keyMap: {
    optionA: 'KeyA', optionB: 'KeyB', optionC: 'KeyC',
    optionD: 'KeyD', optionE: 'KeyE', optionF: 'KeyF',
    previous: 'ArrowLeft', next: 'ArrowRight', replay: 'KeyR',
    submit: 'Enter',
    scrollUp: 'ArrowUp', scrollDown: 'ArrowDown',
    optionPrevious: null, optionNext: null, optionToggle: null,
  },
};

function calculateStats(bank, results) {
  let correct = 0;
  let incorrect = 0;
  for (const question of bank.questions) {
    const result = results.get(question.id);
    if (result?.revision !== question.revision) continue;
    if (result.isCorrect) correct += 1;
    else incorrect += 1;
  }
  const completed = correct + incorrect;
  return {
    total: bank.questions.length,
    completed,
    remaining: bank.questions.length - completed,
    correct,
    incorrect,
    accuracy: completed ? `${(correct / completed * 100).toFixed(1)}%` : '—',
  };
}

export function createPractice(offline) {
  const storage = createStorage();
  const listeners = new Set();
  const state = {
    banks: [], bank: null, screen: 'home', position: 0, optionCursor: 0,
    results: new Map(), wrong: new Map(), drafts: {}, sessionResult: null, stats: null,
    importing: false, importOnline: false, importCount: 0, storageStatus: '',
    settings: { ...defaultSettings }, loading: false, submitting: false,
    error: '', notice: '',
    audio: { status: 'idle', kind: null, message: '' },
    offline: { ...offline.state },
  };
  let progressWrites = Promise.resolve();
  let settingsWrites = Promise.resolve();
  const notify = () => listeners.forEach((listener) => listener(state));
  offline.subscribe((status) => {
    state.offline = status;
    notify();
  });
  const currentQuestion = () => state.bank?.questions[state.position] ?? null;
  const currentResult = () => {
    const question = currentQuestion();
    const result = state.sessionResult;
    return result?.questionId === question?.id && result?.revision === question?.revision ? result : null;
  };
  const currentDraft = () => {
    const question = currentQuestion();
    const draft = question && state.drafts[question.id];
    return draft?.revision === question?.revision ? draft : null;
  };
  const player = createAudioPlayer((details) => {
    if (state.screen !== 'practice' || state.bank?.bankId !== details.bankId ||
        currentQuestion()?.id !== details.questionId) return;
    state.audio = { status: details.status, kind: details.kind, message: details.message };
    notify();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) player.stop();
  });

  function playAudio(kind, automatic = false) {
    const question = currentQuestion();
    if (!question || state.screen !== 'practice') return;
    const path = question.audio?.[kind];
    player.play({
      bankId: state.bank.bankId, questionId: question.id, kind,
      url: path ? resourceUrl(path).href : null, rate: state.settings.rate, automatic,
    });
  }

  function progressSnapshot() {
    return { bankId: state.bank.bankId, questionId: currentQuestion()?.id ?? null };
  }

  function saveProgress() {
    const snapshot = progressSnapshot();
    progressWrites = progressWrites.catch(() => {}).then(() => storage.saveProgress(snapshot));
    progressWrites.catch((error) => {
      if (state.bank?.bankId === snapshot.bankId) {
        state.error = `进度保存失败：${error.message}`;
        notify();
      }
      debugLog('进度保存失败', { bankId: snapshot.bankId, questionId: snapshot.questionId, error: error.message });
    });
  }

  async function loadSelectedBank(entry) {
    const bank = await loadBank(entry);
    const saved = await storage.readBankState(entry.bankId);
    state.bank = bank;
    state.results = new Map(saved.states.map((item) => [item.questionId, item]));
    state.wrong = new Map(saved.wrong.map((item) => [item.questionId, item]));
    state.drafts = {};
    state.sessionResult = null;
    state.position = 0;
    state.stats = calculateStats(bank, state.results);
    state.savedQuestionId = saved.progress?.questionId ?? null;
    state.screen = 'home';
    state.notice = '';
    state.audio = { status: 'idle', kind: null, message: '' };
    offline.selectBank(bank);
    debugLog('题库恢复', {
      bankId: bank.bankId,
      version: bank.version,
      questionId: state.savedQuestionId,
      completed: state.stats.completed,
    });
  }

  async function initialize() {
    state.loading = true;
    notify();
    try {
      const [settings, builtIn, catalog] = await Promise.all([
        storage.readSettings(), loadBankIndex().catch(() => []), storage.readCatalog(),
      ]);
      const banks = [...builtIn.filter((item) => !catalog.some((local) => local.bankId === item.bankId)), ...catalog];
      const savedSettings = settings ?? {};
      const { cancel, ...savedKeyMap } = savedSettings.keyMap ?? {};
      state.settings = {
        ...defaultSettings, ...savedSettings,
        fontSize: Math.max(32, Math.min(80, savedSettings.fontSize ?? defaultSettings.fontSize)),
        keyMap: { ...defaultSettings.keyMap, ...savedKeyMap },
      };
      state.banks = banks;
      const entry = banks.find((bank) => bank.bankId === state.settings.lastBankId) ?? banks[0];
      if (entry) await loadSelectedBank(entry);
      state.error = '';
    } catch (error) {
      state.error = `加载失败：${error.message}`;
    } finally {
      state.loading = false;
      notify();
    }
  }

  async function selectBank(bankId) {
    if (state.loading || state.submitting) return;
    const entry = state.banks.find((bank) => bank.bankId === bankId);
    if (!entry) return;
    player.stop();
    state.loading = true;
    state.error = '';
    notify();
    try {
      await progressWrites.catch(() => {});
      await loadSelectedBank(entry);
      state.settings = { ...state.settings, lastBankId: bankId };
      const snapshot = state.settings;
      settingsWrites = settingsWrites.catch(() => {}).then(() => storage.saveSettings(snapshot));
      await settingsWrites;
    } catch (error) {
      state.error = `切换题库失败：${error.message}`;
    } finally {
      state.loading = false;
      notify();
    }
  }

  function enterQuestion(position) {
    if (!state.bank?.questions[position] || state.submitting) return;
    player.stop();
    state.position = position;
    state.optionCursor = 0;
    state.screen = 'practice';
    state.drafts = {};
    state.sessionResult = null;
    state.error = '';
    state.audio = { status: 'idle', kind: null, message: '' };
    state.savedQuestionId = currentQuestion().id;
    saveProgress();
    debugLog('进入题目', {
      bankId: state.bank.bankId,
      version: state.bank.version,
      questionId: currentQuestion().id,
      type: currentQuestion().type,
      selectedOptionIds: [],
      submitted: false,
    });
    notify();
    if (state.settings.autoQuestion) playAudio('question', true);
  }

  function start() {
    if (!state.bank?.questions.length) return;
    const savedPosition = state.bank.positionById.get(state.savedQuestionId);
    state.notice = state.savedQuestionId && savedPosition === undefined
      ? '上次浏览的题目已移除，已从第一题开始。' : '';
    enterQuestion(savedPosition ?? 0);
  }

  async function resetFromStart() {
    if (!state.bank?.questions.length || state.loading || state.submitting) return;
    player.stop();
    state.loading = true;
    notify();
    try {
      await progressWrites.catch(() => {});
      await storage.resetBank(state.bank.bankId, state.bank.questions[0].id);
      state.results = new Map();
      state.drafts = {};
      state.sessionResult = null;
      state.stats = calculateStats(state.bank, state.results);
      state.savedQuestionId = state.bank.questions[0].id;
      state.notice = '';
      enterQuestion(0);
    } catch (error) {
      state.error = `从头开始失败：${error.message}`;
    } finally {
      state.loading = false;
      notify();
    }
  }

  function jumpToNumber(displayNumber) {
    if (!state.bank || state.submitting) return;
    const position = findQuestionPosition(state.bank, displayNumber.trim());
    if (position < 0) {
      state.error = `找不到题号「${displayNumber}」`;
      notify();
      return;
    }
    state.notice = '';
    enterQuestion(position);
  }

  function move(offset) {
    if (state.submitting) return;
    const position = state.position + offset;
    if (!state.bank?.questions[position]) {
      state.notice = offset > 0 ? '已经是最后一题。' : '已经是第一题。';
      notify();
      return;
    }
    state.notice = '';
    enterQuestion(position);
  }

  function backToBanks() {
    if (state.submitting) return;
    player.stop();
    state.screen = 'home';
    state.drafts = {};
    state.sessionResult = null;
    state.error = '';
    state.notice = '';
    saveProgress();
    notify();
  }

  function openWrongBook() {
    if (state.screen !== 'home' || !state.bank) return;
    state.screen = 'wrongBook';
    state.error = '';
    notify();
  }

  function closeWrongBook() {
    state.screen = 'home';
    state.error = '';
    notify();
  }

  async function removeWrong(questionIds) {
    const updatedAt = new Date().toISOString();
    const items = questionIds.map((questionId) => state.wrong.get(questionId))
      .filter((item) => item?.active)
      .map((item) => ({ ...item, active: false, updatedAt }));
    if (!items.length) return;
    try {
      await storage.setWrong(items);
      for (const item of items) state.wrong.set(item.questionId, item);
      notify();
      return true;
    } catch (error) {
      state.error = `移除错题失败：${error.message}`;
      notify();
      return false;
    }
  }

  function selectOption(optionId) {
    const question = currentQuestion();
    if (currentResult() || !question?.options.some((option) => option.id === optionId) || state.submitting) return;
    const draft = currentDraft() ?? { revision: question.revision, selectedOptionIds: [] };
    const selectedOptionIds = question.type === 'single'
      ? [optionId]
      : draft.selectedOptionIds.includes(optionId)
        ? draft.selectedOptionIds.filter((id) => id !== optionId)
        : [...draft.selectedOptionIds, optionId];
    state.drafts = { ...state.drafts, [question.id]: { ...draft, selectedOptionIds } };
    state.optionCursor = question.options.findIndex((option) => option.id === optionId);
    state.error = '';
    notify();
  }

  async function submit() {
    const question = currentQuestion();
    const draft = currentDraft();
    if (!question || !draft?.selectedOptionIds.length || state.submitting) return;
    player.stop();
    const graded = gradeQuestion(question, draft.selectedOptionIds);
    const attempt = {
      bankId: state.bank.bankId,
      questionId: question.id, revision: question.revision,
      selectedOptionIds: graded.selectedOptionIds,
      isCorrect: graded.isCorrect, submittedAt: new Date().toISOString(),
    };
    const progress = progressSnapshot();
    state.submitting = true;
    state.error = '';
    notify();
    debugLog('提交判题', {
      bankId: attempt.bankId,
      questionId: question.id, selectedOptionIds: graded.selectedOptionIds,
      correctOptionIds: graded.correctOptionIds, isCorrect: graded.isCorrect,
    });
    let saved = false;
    try {
      await progressWrites.catch(() => {});
      await storage.saveAttempt(attempt, progress);
      state.drafts = {};
      state.sessionResult = attempt;
      state.results.set(question.id, {
        bankId: attempt.bankId, questionId: question.id, revision: question.revision,
        isCorrect: attempt.isCorrect, submittedAt: attempt.submittedAt,
      });
      if (!attempt.isCorrect) state.wrong.set(question.id, {
        bankId: attempt.bankId, questionId: question.id, revision: question.revision,
        active: true, updatedAt: attempt.submittedAt,
      });
      state.stats = calculateStats(state.bank, state.results);
      saved = true;
      debugLog('作答已保存', {
        bankId: attempt.bankId,
        questionId: question.id, result: attempt.isCorrect,
        completed: state.stats.completed, correct: state.stats.correct, incorrect: state.stats.incorrect,
      });
    } catch (error) {
      state.error = `保存失败，请重试：${error.message}`;
      debugLog('作答保存失败', { questionId: question.id, error: error.message });
    } finally {
      state.submitting = false;
      notify();
      if (saved && state.settings.autoExplanation) playAudio('explanation', true);
    }
  }

  function redo() {
    const question = currentQuestion();
    if (!question || !currentResult() || state.submitting) return;
    player.stop();
    state.sessionResult = null;
    state.drafts = { [question.id]: { revision: question.revision, selectedOptionIds: [] } };
    state.optionCursor = 0;
    state.error = '';
    notify();
  }

  function updateSettings(changes) {
    state.settings = { ...state.settings, ...changes };
    const snapshot = state.settings;
    settingsWrites = settingsWrites.catch(() => {}).then(() => storage.saveSettings(snapshot));
    settingsWrites.catch((error) => {
      state.error = `设置保存失败：${error.message}`;
      notify();
    });
    notify();
  }

  function changeFontSize(delta) {
    updateSettings({ fontSize: Math.max(32, Math.min(80, state.settings.fontSize + delta)) });
  }

  function setKeyBinding(action, code) {
    if (!(action in defaultSettings.keyMap) && !['back', 'redo'].includes(action)) return;
    const keyMap = { ...state.settings.keyMap };
    for (const name of Object.keys(keyMap)) {
      if (keyMap[name] === code) keyMap[name] = null;
    }
    keyMap[action] = code;
    updateSettings({ keyMap });
  }

  function performAction(action) {
    if (state.screen !== 'practice') return;
    if (action.startsWith('option') && action.length === 7) {
      const index = action.charCodeAt(6) - 65;
      const option = currentQuestion()?.options[index];
      if (option) selectOption(option.id);
      return;
    }
    switch (action) {
      case 'optionPrevious':
      case 'optionNext': {
        const length = currentQuestion()?.options.length ?? 0;
        if (!currentResult() && length) {
          state.optionCursor = (state.optionCursor + (action === 'optionNext' ? 1 : length - 1)) % length;
          notify();
        }
        break;
      }
      case 'optionToggle': {
        const option = currentQuestion()?.options[state.optionCursor];
        if (option) selectOption(option.id);
        break;
      }
      case 'submit': submit(); break;
      case 'previous': move(-1); break;
      case 'next': move(1); break;
      case 'replay': playAudio(currentResult() ? 'explanation' : 'question'); break;
      case 'back': backToBanks(); break;
      case 'redo': redo(); break;
    }
  }

  function setAutoPlay(kind, enabled) {
    updateSettings({ [kind === 'question' ? 'autoQuestion' : 'autoExplanation']: enabled });
  }

  function changeRate(rate) {
    player.setRate(rate);
    updateSettings({ rate });
  }

  async function installBank(fileOrUrl) {
    if (state.screen !== 'home' || state.importing || state.submitting) return;
    state.importing = true;
    state.importOnline = typeof fileOrUrl === 'string';
    state.importCount = 0;
    state.error = '';
    notify();
    try {
      const source = typeof fileOrUrl === 'string' ? await fetch(fileOrUrl, { cache: 'no-store' }) : fileOrUrl;
      if (source instanceof Response && !source.ok) throw new Error(`下载失败：HTTP ${source.status}`);
      const entry = await importBankZip(source, storage, (count) => {
        state.importCount = count;
        notify();
      });
      const previous = state.banks.find((item) => item.bankId === entry.bankId && item.local);
      const builtIn = await loadBankIndex().catch(() => []);
      const catalog = await storage.readCatalog();
      state.banks = [...builtIn.filter((item) => !catalog.some((local) => local.bankId === item.bankId)), ...catalog];
      await loadSelectedBank(entry);
      const persisted = await navigator.storage?.persist?.().catch(() => false);
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      state.storageStatus = `${estimate ? `本机已使用约 ${Math.round((estimate.usage ?? 0) / 1048576)} MiB；` : ''}${persisted
        ? '浏览器已允许持久存储。' : '浏览器未承诺永久保留，学习记录可能丢失。'}`;
      state.notice = `${entry.name} 已导入，本机可离线练习。${previous ? '旧版学习记录仍保留。' : ''}`;
      if (previous && previous.cacheName !== entry.cacheName) await caches.delete(previous.cacheName);
    } catch (error) {
      state.error = `导入题库失败：${error.message}`;
    } finally {
      state.importing = false;
      notify();
    }
  }

  async function deleteLocalBank() {
    if (!state.bank?.local || state.screen !== 'home' || state.importing) return;
    const { bankId, cacheName } = state.bank;
    try {
      await storage.removeCatalog(bankId);
      await caches.delete(cacheName);
      await initialize();
      state.notice = '本机题库资源已删除，学习记录仍保留。';
      notify();
    } catch (error) {
      state.error = `删除题库失败：${error.message}`;
      notify();
    }
  }

  return {
    state, subscribe: (listener) => listeners.add(listener), currentQuestion, currentResult, currentDraft,
    initialize, selectBank, start, resetFromStart, jumpToNumber, move, backToBanks,
    openWrongBook, closeWrongBook, removeWrong,
    selectOption, submit, redo, changeFontSize,
    setKeyBinding, performAction,
    playQuestion: () => playAudio('question'), playExplanation: () => playAudio('explanation'),
    setAutoPlay, changeRate, installBank, deleteLocalBank,
    activateUpdate: () => {
      if (state.screen === 'home' && !state.submitting) offline.activateUpdate();
    },
  };
}
