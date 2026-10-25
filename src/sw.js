const scope = self.registration.scope;
const shellName = `shuati-shell-${self.SHELL_VERSION}`;
const bankName = (bankId, version) => `shuati-bank-${bankId}-${version}`;

function url(path) {
  return new URL(path, scope).href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(shellName).then((cache) => cache.addAll(self.SHELL_FILES.map(url))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('shuati-shell-') && name !== shellName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function audioRange(response, header) {
  const bytes = await response.arrayBuffer();
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } });
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.byteLength - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
  if (start > end || start >= bytes.byteLength) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } });
  }
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
      'Content-Length': String(end - start + 1),
    },
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request.url);
    if (cached) {
      const range = request.headers.get('Range');
      return range && new URL(request.url).pathname.endsWith('.mp3')
        ? audioRange(cached, range) : cached;
    }
    return fetch(request);
  })());
});

async function inspect(cache, dataPath, audioPaths) {
  const existing = new Set((await cache.keys()).map((request) => request.url));
  return {
    questionReady: existing.has(url(dataPath)),
    missingAudio: audioPaths.filter((path) => !existing.has(url(path))),
  };
}

async function prepare(cache, paths) {
  const failed = [];
  let succeeded = 0;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, paths.length) }, async () => {
    while (next < paths.length) {
      const path = paths[next++];
      try {
        if (await cache.match(url(path))) {
          succeeded += 1;
          continue;
        }
        const response = await fetch(url(path));
        if (!response.ok || response.status !== 200) throw new Error(`HTTP ${response.status}`);
        await cache.put(url(path), response);
        succeeded += 1;
      } catch (error) {
        failed.push({ path, reason: error.message });
      }
    }
  }));
  return { succeeded, failed };
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  const { type, bankId, version, dataPath, audioPaths = [], paths = [], requestId } = event.data ?? {};
  if (!['INSPECT', 'PREPARE'].includes(type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(bankName(bankId, version));
      const result = type === 'INSPECT'
        ? await inspect(cache, dataPath, audioPaths)
        : await prepare(cache, paths);
      event.ports[0].postMessage({ requestId, ...result });
    } catch (error) {
      event.ports[0].postMessage({ requestId, error: error.message });
    }
  })());
});
