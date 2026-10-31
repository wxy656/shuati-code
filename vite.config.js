import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
      const files = ['.', 'index.html', 'banks/index.json', 'favicon.svg', 'manifest.webmanifest',
        ...Object.keys(bundle).filter((name) => name.startsWith('assets/') && !name.endsWith('.map')),
        ...sampleFiles];
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
