import { debugLog } from '../debug.js';

const DB_NAME = 'shuati-learning';
const DB_VERSION = 1;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function createStorage() {
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('attempts', { keyPath: 'attemptId' });
      const questionStates = db.createObjectStore('questionStates', { keyPath: ['bankId', 'questionId'] });
      questionStates.createIndex('bankId', 'bankId');
      db.createObjectStore('progress', { keyPath: 'bankId' });
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function readSettings() {
    const db = await database;
    const transaction = db.transaction('settings', 'readonly');
    return (await requestResult(transaction.objectStore('settings').get('app')))?.value ?? null;
  }

  async function saveSettings(value) {
    const db = await database;
    const transaction = db.transaction('settings', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('settings').put({ key: 'app', value });
    await done;
  }

  async function readBankState(bankId) {
    const db = await database;
    const transaction = db.transaction(['questionStates', 'progress'], 'readonly');
    const states = requestResult(transaction.objectStore('questionStates').index('bankId').getAll(bankId));
    const progress = requestResult(transaction.objectStore('progress').get(bankId));
    const [savedStates, savedProgress] = await Promise.all([states, progress]);
    return { states: savedStates, progress: savedProgress };
  }

  async function saveProgress(progress) {
    const db = await database;
    const transaction = db.transaction('progress', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('progress').put(progress);
    await done;
  }

  async function saveAttempt(attempt, progress) {
    const db = await database;
    const transaction = db.transaction(['attempts', 'questionStates', 'progress'], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('attempts').put(attempt);
    transaction.objectStore('questionStates').put({
      bankId: attempt.bankId,
      questionId: attempt.questionId,
      revision: attempt.revision,
      attemptId: attempt.attemptId,
      selectedOptionIds: attempt.selectedOptionIds,
      isCorrect: attempt.isCorrect,
      submittedAt: attempt.submittedAt,
    });
    transaction.objectStore('progress').put(progress);
    await done;
    debugLog('作答写入', {
      attemptId: attempt.attemptId, bankId: attempt.bankId, questionId: attempt.questionId,
      selectedOptionIds: attempt.selectedOptionIds, isCorrect: attempt.isCorrect,
      progressQuestionId: progress.questionId,
    });
  }

  return { readSettings, saveSettings, readBankState, saveProgress, saveAttempt };
}
