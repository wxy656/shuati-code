import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;
const buildId = (process.env.GITHUB_SHA || '').slice(0, 7)
  || `local-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(`${packageVersion}+${buildId}`),
  },
  build: {
    copyPublicDir: false,
    rolldownOptions: {
      output: { entryFileNames: 'assets/[name].js' },
    },
  },
  plugins: [{
    name: 'offline-shell-list',
    generateBundle(_options, bundle) {
      const sampleRoot = new URL('./public/banks/sample/', import.meta.url);
      const addPublicFile = (name) => this.emitFile({
        type: 'asset', fileName: name,
        source: readFileSync(new URL(`./public/${name}`, import.meta.url)),
      });
      const sampleFiles = [];
      const addSample = (directory, relative = '') => {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
          const name = join(relative, item.name);
          if (item.isDirectory()) addSample(new URL(`${item.name}/`, directory), name);
          else {
            sampleFiles.push(`banks/sample/${name}`);
            addPublicFile(`banks/sample/${name}`);
          }
        }
      };
      for (const name of ['banks/index.json', 'favicon.svg', 'manifest.webmanifest']) addPublicFile(name);
      addSample(sampleRoot);
      for (const fileName of ['assets/index-Bjle-BFn.js', 'assets/index-DIOki5y8.js']) {
        this.emitFile({ type: 'asset', fileName, source: bundle['assets/index.js'].code });
      }
      const assetNames = Object.keys(bundle)
        .filter((name) => name.startsWith('assets/') && !name.endsWith('.map'));
      // 页面里的脚本/样式 URL 必须带构建号。Service Worker 对静态资源按完整 URL
      // 缓存优先，而入口文件名是固定的 assets/index.js；不带构建号时新页面会一直被
      // 旧缓存挡回旧代码，旧 Service Worker 又因安装失败迟迟不更新，应用就永远停在旧版。
      // 带上 ?v=构建号后，旧缓存必然落空，旧 Service Worker 会联网取到新代码。
      const versioned = (name) => `${name}?v=${buildId}`;
      const shellNames = assetNames.flatMap((name) => [name, versioned(name)]);
      const files = ['.', 'index.html', 'banks/index.json', 'favicon.svg', 'manifest.webmanifest',
        ...shellNames, ...sampleFiles];
      const contentOf = (name) => {
        const asset = bundle[name.split('?')[0]];
        return asset?.code ?? asset?.source ?? '';
      };
      const version = createHash('sha256')
        .update(JSON.stringify(files.map((name) => [name, contentOf(name)])))
        .digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: `self.SHELL_VERSION = ${JSON.stringify(version)};\nself.SHELL_FILES = ${JSON.stringify(files)};\n`
          + readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8'),
      });
    },
    writeBundle(options) {
      // index.html 在 generateBundle 之后才由 Vite 写盘，所以放到这里补构建号。
      const file = join(options.dir ?? 'dist', 'index.html');
      const source = readFileSync(file, 'utf8');
      const next = source.replace(/="\.\/(assets\/[^"?]+)"/g,
        (_match, name) => `="./${name}?v=${buildId}"`);
      if (next !== source) writeFileSync(file, next);
    },
  }],
});
