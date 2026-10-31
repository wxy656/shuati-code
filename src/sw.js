const scope = self.registration.scope;
const shellName = `shuati-shell-${self.SHELL_VERSION}`;

function url(path) {
  return new URL(path, scope).href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(shellName).then((cache) => cache.addAll(
    self.SHELL_FILES.map((path) => new Request(url(path), { cache: 'reload' })),
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) =>
      (name.startsWith('shuati-shell-') && name !== shellName) || name.startsWith('shuati-bank-'))
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
    const local = request.url.slice(scope.length).match(/^_local-banks\/([^/]+)\//);
    if (local) {
      const cached = await (await caches.open(`shuati-local-${local[1]}`)).match(request.url);
      if (!cached) return new Response('本机题库资源缺失', { status: 404 });
      const range = request.headers.get('Range');
      return range && new URL(request.url).pathname.endsWith('.mp3')
        ? audioRange(cached, range) : cached;
    }
    if (request.mode === 'navigate') {
      try {
        return await fetch(request, { cache: 'reload' });
      } catch {
        return (await caches.open(shellName)).match(url('index.html'));
      }
    }
    const cached = await caches.match(request.url);
    if (cached) {
      const range = request.headers.get('Range');
      return range && new URL(request.url).pathname.endsWith('.mp3')
        ? audioRange(cached, range) : cached;
    }
    return fetch(request);
  })());
});

async function inspect(dataPath, audioPaths) {
  const cache = await caches.open(shellName);
  const existing = new Set((await cache.keys()).map((request) => request.url));
  return {
    questionReady: existing.has(url(dataPath)),
    missingAudio: audioPaths.filter((path) => !existing.has(url(path))),
  };
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  const { type, dataPath, audioPaths = [], requestId } = event.data ?? {};
  if (type !== 'INSPECT' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const result = await inspect(dataPath, audioPaths);
      event.ports[0].postMessage({ requestId, ...result });
    } catch (error) {
      event.ports[0].postMessage({ requestId, error: error.message });
    }
  })());
});
