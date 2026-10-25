import { findQuestionPosition, loadBank, loadBankIndex, resourceUrl } from '../banks/index.js';
import { createAudioPlayer } from '../audio/index.js';
import { gradeQuestion } from '../grading/index.js';
import { createStorage } from '../storage/index.js';

const defaultSettings = {
  fontSize: 30,
  autoQuestion: true,
  autoExplanation: true,
  rate: 1,
  lastBankId: null,
};

function createAttemptId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
    banks: [], bank: null, screen: 'home', position: 0,
    results: new Map(), drafts: {}, stats: null,
    settings: { ...defaultSettings }, loading: false, submitting: false,
    answerOpen: false, error: '', notice: '',
    audio: { status: 'idle', kind: null, message: '' },
    offline: { ...offline.state },
  };
  let progressWrites = Promise.resolve();
  let settingsWrites = Promise.resolve();
  let pendingAttempt = null;
  const notify = () => listeners.forEach((listener) => listener(state));
  offline.subscribe((status) => {
    state.offline = status;
    notify();
  });
  const currentQuestion = () => state.bank?.questions[state.position] ?? null;
  const currentResult = () => {
    const question = currentQuestion();
    const result = question && state.results.get(question.id);
    return result?.revision === question?.revision ? result : null;
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

  function progressSnapshot(drafts = state.drafts) {
    return { bankId: state.bank.bankId, questionId: currentQuestion()?.id ?? null, drafts };
  }

  function saveProgress() {
    const snapshot = progressSnapshot();
    progressWrites = progressWrites.catch(() => {}).then(() => storage.saveProgress(snapshot));
    progressWrites.catch((error) => {
      if (state.bank?.bankId === snapshot.bankId) {
        state.error = `进度保存失败：${error.message}`;
        notify();
      }
      console.warn('进度保存失败', { bankId: snapshot.bankId, questionId: snapshot.questionId, error });
    });
  }

  async function loadSelectedBank(entry) {
    const bank = await loadBank(entry);
    const saved = await storage.readBankState(entry.bankId);
    state.bank = bank;
    state.results = new Map(saved.states.map((item) => [item.questionId, item]));
    state.drafts = saved.progress?.drafts ?? {};
    state.position = 0;
    state.stats = calculateStats(bank, state.results);
    state.savedQuestionId = saved.progress?.questionId ?? null;
    state.screen = 'home';
    state.answerOpen = false;
    state.notice = '';
    state.audio = { status: 'idle', kind: null, message: '' };
    offline.selectBank(bank);
    console.info('题库恢复', {
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
      const [settings, banks] = await Promise.all([storage.readSettings(), loadBankIndex()]);
      state.settings = { ...defaultSettings, ...settings };
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
    state.screen = 'practice';
    state.answerOpen = false;
    state.error = '';
    state.audio = { status: 'idle', kind: null, message: '' };
    pendingAttempt = null;
    state.savedQuestionId = currentQuestion().id;
    saveProgress();
    console.info('进入题目', {
      bankId: state.bank.bankId,
      questionId: currentQuestion().id,
      type: currentQuestion().type,
      selectedOptionIds: currentDraft()?.selectedOptionIds ?? [],
      submitted: Boolean(currentResult()),
    });
    notify();
    if (state.settings.autoQuestion && (!currentResult() || currentDraft()?.redo)) {
      playAudio('question', true);
    }
  }

  function start() {
    if (!state.bank?.questions.length) return;
    const savedPosition = state.bank.positionById.get(state.savedQuestionId);
    state.notice = state.savedQuestionId && savedPosition === undefined
      ? '上次浏览的题目已移除，已从第一题开始。' : '';
    enterQuestion(savedPosition ?? 0);
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
    state.answerOpen = false;
    state.error = '';
    state.notice = '';
    saveProgress();
    notify();
  }

  function openAnswer() {
    const question = currentQuestion();
    if (!question || state.submitting || (currentResult() && !currentDraft()?.redo)) return;
    if (!currentDraft()) {
      state.drafts = { ...state.drafts, [question.id]: { revision: question.revision, selectedOptionIds: [], redo: false } };
      saveProgress();
    }
    state.answerOpen = true;
    state.error = '';
    notify();
  }

  function closeAnswer() {
    if (state.submitting) return;
    state.answerOpen = false;
    notify();
  }

  function selectOption(optionId) {
    const question = currentQuestion();
    const draft = currentDraft();
    if (!state.answerOpen || !question || !draft || state.submitting) return;
    const selectedOptionIds = question.type === 'single'
      ? [optionId]
      : draft.selectedOptionIds.includes(optionId)
        ? draft.selectedOptionIds.filter((id) => id !== optionId)
        : [...draft.selectedOptionIds, optionId];
    state.drafts = { ...state.drafts, [question.id]: { ...draft, selectedOptionIds } };
    pendingAttempt = null;
    state.error = '';
    saveProgress();
    notify();
  }

  async function submit() {
    const question = currentQuestion();
    const draft = currentDraft();
    if (!question || !draft?.selectedOptionIds.length || state.submitting) return;
    player.stop();
    const graded = gradeQuestion(question, draft.selectedOptionIds);
    const attempt = pendingAttempt ?? {
      attemptId: createAttemptId(), bankId: state.bank.bankId,
      questionId: question.id, revision: question.revision,
      selectedOptionIds: graded.selectedOptionIds,
      isCorrect: graded.isCorrect, submittedAt: new Date().toISOString(),
    };
    pendingAttempt = attempt;
    const nextDrafts = { ...state.drafts };
    delete nextDrafts[question.id];
    const progress = progressSnapshot(nextDrafts);
    state.submitting = true;
    state.error = '';
    notify();
    console.info('提交判题', {
      attemptId: attempt.attemptId, bankId: attempt.bankId,
      questionId: question.id, selectedOptionIds: graded.selectedOptionIds,
      correctOptionIds: graded.correctOptionIds, isCorrect: graded.isCorrect,
    });
    let saved = false;
    try {
      await progressWrites.catch(() => {});
      await storage.saveAttempt(attempt, progress);
      state.drafts = nextDrafts;
      state.results.set(question.id, {
        bankId: attempt.bankId, questionId: question.id, revision: question.revision,
        attemptId: attempt.attemptId, selectedOptionIds: attempt.selectedOptionIds,
        isCorrect: attempt.isCorrect, submittedAt: attempt.submittedAt,
      });
      state.stats = calculateStats(state.bank, state.results);
      state.answerOpen = false;
      pendingAttempt = null;
      saved = true;
      console.info('作答已保存', {
        attemptId: attempt.attemptId, bankId: attempt.bankId,
        questionId: question.id, result: attempt.isCorrect,
        completed: state.stats.completed, correct: state.stats.correct, incorrect: state.stats.incorrect,
      });
    } catch (error) {
      state.error = `保存失败，请重试：${error.message}`;
      console.warn('作答保存失败', { attemptId: attempt.attemptId, questionId: question.id, error });
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
    state.drafts = { ...state.drafts, [question.id]: { revision: question.revision, selectedOptionIds: [], redo: true } };
    state.answerOpen = true;
    state.error = '';
    pendingAttempt = null;
    saveProgress();
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
    updateSettings({ fontSize: Math.max(22, Math.min(42, state.settings.fontSize + delta)) });
  }

  function setAutoPlay(kind, enabled) {
    updateSettings({ [kind === 'question' ? 'autoQuestion' : 'autoExplanation']: enabled });
  }

  function changeRate(rate) {
    player.setRate(rate);
    updateSettings({ rate });
  }

  return {
    state, subscribe: (listener) => listeners.add(listener), currentQuestion, currentResult, currentDraft,
    initialize, selectBank, start, jumpToNumber, move, backToBanks,
    openAnswer, closeAnswer, selectOption, submit, redo, changeFontSize,
    playQuestion: () => playAudio('question'), playExplanation: () => playAudio('explanation'),
    setAutoPlay, changeRate,
    prepareOffline: offline.prepare,
    activateUpdate: () => {
      if (state.screen === 'home' && !state.submitting) offline.activateUpdate();
    },
  };
}
