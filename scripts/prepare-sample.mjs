import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sourceRoot = 'public/banks/shanghai-poetry/v1';
const sampleRoot = 'public/banks/sample/shanghai-poetry/v1';
const source = JSON.parse(readFileSync(join(sourceRoot, 'questions.json'), 'utf8'));
const questions = source.questions.filter((question) =>
  question.stem?.trim() && question.options?.length && question.correctOptionIds?.length &&
  question.explanation?.trim() && question.audio?.question && question.audio?.explanation,
).slice(0, 50).map((question) => ({
  ...question,
  audio: Object.fromEntries(Object.entries(question.audio).map(([kind, path]) => [
    kind, path.replace('banks/shanghai-poetry/v1/', 'banks/sample/shanghai-poetry/v1/'),
  ])),
}));

rmSync(sampleRoot, { recursive: true, force: true });
mkdirSync(sampleRoot, { recursive: true });
for (const question of questions) {
  for (const [kind, path] of Object.entries(question.audio)) {
    const filename = `${question.displayNumber}-${kind}.mp3`;
    const target = join('public', path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(sourceRoot, 'audio', filename), target);
  }
}
writeFileSync(join(sampleRoot, 'questions.json'), `${JSON.stringify({
  bankId: source.bankId, version: source.version, questions,
}, null, 2)}\n`);
console.log(`已准备 ${questions.length} 道样例题及两段音频。`);
