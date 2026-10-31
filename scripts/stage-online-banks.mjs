import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const directory = new URL('../dist/online-banks/', import.meta.url);
const response = await fetch('https://api.github.com/repos/wxy656/shuati-code/releases?per_page=100');
if (!response.ok) throw new Error(`读取 Release 失败：HTTP ${response.status}`);

await mkdir(directory, { recursive: true });
const resources = [];
for (const release of await response.json()) {
  for (const asset of release.assets.filter((item) => item.name.toLowerCase().endsWith('.zip'))) {
    const archive = await fetch(asset.browser_download_url);
    if (!archive.ok || !archive.body) throw new Error(`下载 ${asset.name} 失败：HTTP ${archive.status}`);
    await pipeline(Readable.fromWeb(archive.body), createWriteStream(new URL(`${asset.id}.zip`, directory)));
    resources.push({
      name: release.name || release.tag_name,
      fileName: asset.name,
      size: asset.size,
      path: `online-banks/${asset.id}.zip`,
    });
  }
}
await writeFile(new URL('index.json', directory), JSON.stringify(resources));
