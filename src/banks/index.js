import { debugLog } from '../debug.js';

const loadedBanks = new Map();

export function resourceUrl(path) {
  return new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI));
}

async function readJson(path) {
  const response = path.startsWith('_local-banks/')
    ? await caches.match(resourceUrl(path))
    : await fetch(resourceUrl(path));
  if (!response) throw new Error(`本机题库资源缺失：${path}`);
  if (!response.ok) {
    throw new Error(`无法读取题库资源：${path}（HTTP ${response.status}）`);
  }
  return response.json();
}

export async function loadBankIndex() {
  const index = await readJson('banks/index.json');
  return index.banks;
}

export async function loadBank(entry) {
  const key = `${entry.bankId}@${entry.version}@${entry.dataPath}`;
  if (loadedBanks.has(key)) return loadedBanks.get(key);

  const data = await readJson(entry.dataPath);
  if (data.bankId !== entry.bankId || data.version !== entry.version) {
    throw new Error(`题库「${entry.name}」的 ID 或版本与索引不一致`);
  }
  if (!Array.isArray(data.questions)) {
    throw new Error(`题库「${entry.name}」缺少题目列表`);
  }

  const positionById = new Map();
  const positionByDisplayNumber = new Map();
  for (const [position, question] of data.questions.entries()) {
    const label = question.displayNumber || question.id || position + 1;
    if (!question.id || !question.displayNumber || !question.stem?.trim() ||
        !Array.isArray(question.options) || !question.options.length ||
        !Array.isArray(question.correctOptionIds) || !question.correctOptionIds.length) {
      throw new Error(`题库「${entry.name}」第 ${label} 题缺少题干、选项或标准答案`);
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    if (!['single', 'multiple'].includes(question.type) ||
        (question.type === 'single' && question.correctOptionIds.length !== 1) ||
        question.correctOptionIds.some((id) => !optionIds.has(id))) {
      throw new Error(`题库「${entry.name}」第 ${label} 题的题型或标准答案与选项不匹配`);
    }
    if (positionById.has(question.id) || positionByDisplayNumber.has(question.displayNumber)) {
      throw new Error(`题库「${entry.name}」第 ${label} 题的 ID 或展示题号重复`);
    }
    positionById.set(question.id, position);
    positionByDisplayNumber.set(question.displayNumber, position);
  }

  const bank = { ...entry, questions: data.questions, positionById, positionByDisplayNumber };
  loadedBanks.set(key, bank);
  debugLog('题库加载', { bankId: entry.bankId, version: entry.version, count: bank.questions.length });
  return bank;
}

export function findQuestionById(bank, questionId) {
  const position = bank.positionById.get(questionId);
  return position === undefined ? null : bank.questions[position];
}

export function findQuestionPosition(bank, displayNumber) {
  return bank.positionByDisplayNumber.get(displayNumber) ?? -1;
}
