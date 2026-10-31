import { AsyncUnzipInflate, Unzip } from 'fflate';
import { loadBank, resourceUrl } from './index.js';

const textDecoder = new TextDecoder();

export async function importBankZip(file, storage, onProgress) {
  const installId = crypto.randomUUID();
  const cacheName = `shuati-local-${installId}`;
  const cache = await caches.open(cacheName);
  const files = new Set();
  const documents = new Map();
  const pending = new Set();
  const completions = [];
  let failure = null;
  let count = 0;
  const base = `_local-banks/${installId}/`;
  const archive = new Unzip((entry) => {
    const name = entry.name;
    if (!['bank-manifest.json', 'questions.json'].includes(name) &&
        !/^audio\/[A-Za-z0-9._/-]+\.mp3$/.test(name)) {
      failure = new Error(`题库包包含不支持的文件：${name}`);
      entry.ondata = () => {};
      entry.start();
      return;
    }
    if (name.includes('..') || files.has(name)) {
      failure = new Error(`题库包文件名重复或无效：${name}`);
      entry.ondata = () => {};
      entry.start();
      return;
    }
    const chunks = [];
    let completed;
    completions.push(new Promise((resolve) => { completed = resolve; }));
    entry.ondata = (error, chunk, final) => {
      if (error) { failure = error; completed(); return; }
      chunks.push(chunk);
      if (!final) return;
      const blob = new Blob(chunks, { type: name.endsWith('.mp3') ? 'audio/mpeg' : 'application/json' });
      files.add(name);
      if (name.endsWith('.json')) documents.set(name, blob);
      const task = cache.put(resourceUrl(`${base}${name}`), new Response(blob)).then(() => {
        count += 1;
        onProgress(count);
      }).catch((error) => { failure = error; });
      pending.add(task);
      task.finally(() => { pending.delete(task); completed(); });
    };
    entry.start();
  });
  archive.register(AsyncUnzipInflate);
  try {
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      if (failure) throw failure;
      archive.push(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()), false);
      while (pending.size >= 24) await Promise.race(pending);
    }
    archive.push(new Uint8Array(), true);
    await Promise.all(completions);
    if (failure) throw failure;
    const manifestBlob = documents.get('bank-manifest.json');
    const questionsBlob = documents.get('questions.json');
    if (!manifestBlob || !questionsBlob) throw new Error('题库包缺少 manifest 或题目');
    const manifest = JSON.parse(textDecoder.decode(await manifestBlob.arrayBuffer()));
    const data = JSON.parse(textDecoder.decode(await questionsBlob.arrayBuffer()));
    if (manifest.formatVersion !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.bankId) ||
        !/^[A-Za-z0-9._-]+$/.test(manifest.version) ||
        data.bankId !== manifest.bankId || data.version !== manifest.version ||
        !Array.isArray(data.questions) || !data.questions.length) throw new Error('题库包信息不完整或版本不匹配');
    for (const question of data.questions) {
      if (!question.id || !question.revision || !question.stem?.trim() ||
          !question.correctOptionIds?.length || !question.options?.length) {
        throw new Error(`题目 ${question.id ?? '?'} 缺少必要内容`);
      }
      for (const [kind, oldPath] of Object.entries(question.audio ?? {})) {
        const name = `audio/${oldPath.split('/').at(-1)}`;
        if (!files.has(name)) throw new Error(`缺少音频：${name}`);
        question.audio[kind] = `${base}${name}`;
      }
    }
    await cache.put(resourceUrl(`${base}questions.json`), new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    }));
    const entry = {
      bankId: manifest.bankId, version: manifest.version, name: manifest.name,
      description: manifest.description ?? '本机导入的完整题库',
      questionCount: data.questions.length, dataPath: `${base}questions.json`,
      installId, local: true, cacheName,
    };
    await loadBank(entry);
    await storage.saveCatalog(entry);
    return entry;
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}
