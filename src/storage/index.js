import { debugLog } from '../debug.js';

const DB_NAME = 'shuati-learning';
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains('attempts')) db.createObjectStore('attempts', { keyPath: 'attemptId' });
      if (!db.objectStoreNames.contains('questionStates')) {
        const states = db.createObjectStore('questionStates', { keyPath: ['bankId', 'questionId'] });
        states.createIndex('bankId', 'bankId');
      }
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'bankId' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('bankCatalog')) db.createObjectStore('bankCatalog', { keyPath: 'bankId' });
      if (!db.objectStoreNames.contains('wrongBook')) {
        const wrongBook = db.createObjectStore('wrongBook', { keyPath: ['bankId', 'questionId'] });
        request.transaction.objectStore('questionStates').openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          const item = cursor.value;
          if (!item.isCorrect) wrongBook.put({
            bankId: item.bankId, questionId: item.questionId, revision: item.revision,
            active: true, updatedAt: item.submittedAt,
          });
          cursor.continue();
        };
      }
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
    const transaction = db.transaction(['questionStates', 'progress', 'wrongBook'], 'readonly');
    const states = requestResult(transaction.objectStore('questionStates').index('bankId').getAll(bankId));
    const progress = requestResult(transaction.objectStore('progress').get(bankId));
    const wrong = requestResult(transaction.objectStore('wrongBook').getAll());
    const [savedStates, savedProgress, wrongItems] = await Promise.all([states, progress, wrong]);
    return { states: savedStates, progress: savedProgress,
      wrong: wrongItems.filter((item) => item.bankId === bankId) };
  }

  async function readCatalog() {
    const db = await database;
    return requestResult(db.transaction('bankCatalog').objectStore('bankCatalog').getAll());
  }

  async function saveCatalog(entry) {
    const db = await database;
    const transaction = db.transaction('bankCatalog', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('bankCatalog').put(entry);
    await done;
  }

  async function removeCatalog(bankId) {
    const db = await database;
    const transaction = db.transaction('bankCatalog', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('bankCatalog').delete(bankId);
    await done;
  }

  async function setWrong(items) {
    const db = await database;
    const transaction = db.transaction('wrongBook', 'readwrite');
    const done = transactionDone(transaction);
    for (const item of items) transaction.objectStore('wrongBook').put(item);
    await done;
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
    const transaction = db.transaction(['questionStates', 'progress', 'wrongBook'], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('questionStates').put({
      bankId: attempt.bankId,
      questionId: attempt.questionId,
      revision: attempt.revision,
      isCorrect: attempt.isCorrect,
      submittedAt: attempt.submittedAt,
    });
    transaction.objectStore('progress').put(progress);
    if (!attempt.isCorrect) transaction.objectStore('wrongBook').put({
      bankId: attempt.bankId, questionId: attempt.questionId,
      revision: attempt.revision, active: true, updatedAt: attempt.submittedAt,
    });
    await done;
    debugLog('作答写入', {
      bankId: attempt.bankId, questionId: attempt.questionId, isCorrect: attempt.isCorrect,
      progressQuestionId: progress.questionId,
    });
  }

  async function resetBank(bankId, questionId) {
    const db = await database;
    const transaction = db.transaction(['attempts', 'questionStates', 'progress'], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('progress').put({ bankId, questionId });
    transaction.objectStore('questionStates').index('bankId').openCursor(bankId).onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    transaction.objectStore('attempts').openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.bankId === bankId) cursor.delete();
        cursor.continue();
      }
    };
    await done;
  }

  return { readSettings, saveSettings, readBankState, readCatalog, saveCatalog, removeCatalog,
    setWrong, saveProgress, saveAttempt, resetBank };
}
