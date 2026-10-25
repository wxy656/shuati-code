import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      output: { entryFileNames: 'assets/[name].js' },
    },
  },
  plugins: [{
    name: 'offline-shell-list',
    generateBundle(_options, bundle) {
      for (const fileName of ['assets/index-Bjle-BFn.js', 'assets/index-DIOki5y8.js']) {
        this.emitFile({ type: 'asset', fileName, source: bundle['assets/index.js'].code });
      }
      const files = ['.', 'index.html', 'banks/index.json', 'favicon.svg', 'manifest.webmanifest',
        ...Object.keys(bundle).filter((name) => name.startsWith('assets/') && !name.endsWith('.map'))];
      const version = createHash('sha256')
        .update(JSON.stringify(files.map((name) => [name, bundle[name]?.code ?? bundle[name]?.source ?? ''])))
        .digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: `self.SHELL_VERSION = ${JSON.stringify(version)};\nself.SHELL_FILES = ${JSON.stringify(files)};\n`
          + readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8'),
      });
    },
  }],
});
