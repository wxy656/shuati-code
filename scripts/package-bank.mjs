import { createReadStream, createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { Zip, ZipPassThrough, strToU8 } from 'fflate';

const sourceRoot = process.argv[2] ?? 'public/banks/shanghai-poetry/v1';
const data = JSON.parse(readFileSync(join(sourceRoot, 'questions.json'), 'utf8'));
const audio = [...new Set(data.questions.flatMap((question) =>
  Object.values(question.audio ?? {}).map((path) => basename(path))))];
const manifest = {
  formatVersion: 1, bankId: data.bankId, version: data.version,
  name: '上海小学古诗文完整题库', description: `${data.questions.length} 道题，含题目和解析音频。`,
  questionCount: data.questions.length,
  resources: ['questions.json', ...audio.map((name) => `audio/${name}`)],
};
mkdirSync('releases', { recursive: true });
const output = createWriteStream(join('releases', `${data.bankId}-${data.version}.zip`));
const zip = new Zip();
let backpressured = false;
zip.ondata = (error, chunk, final) => {
  if (error) { output.destroy(error); return; }
  backpressured = !output.write(chunk);
  if (final) output.end();
};
for (const [name, content] of [
  ['bank-manifest.json', JSON.stringify(manifest)],
  ['questions.json', JSON.stringify(data)],
]) {
  const entry = new ZipPassThrough(name);
  zip.add(entry);
  entry.push(strToU8(content), true);
}
for (const name of audio) {
  const entry = new ZipPassThrough(`audio/${name}`);
  zip.add(entry);
  for await (const chunk of createReadStream(join(sourceRoot, 'audio', name))) {
    entry.push(chunk, false);
    if (backpressured) await once(output, 'drain');
  }
  entry.push(new Uint8Array(), true);
}
zip.end();
await finished(output);
console.log(`已生成 releases/${data.bankId}-${data.version}.zip：${data.questions.length} 题、${audio.length} 段音频`);
