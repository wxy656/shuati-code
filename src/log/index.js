const LOG_KEY = 'shuati-runtime-log';
const CONFIG_KEY = 'shuati-log-upload';
const ISSUE_KEY = 'shuati-log-issues';
const MAX_ENTRIES = 120;
const MAX_CHARS = 24000;
const UPLOAD_CHARS = 20000;
const REPO = 'wxy656/shuati-code';
export const DEFAULT_USER_ID = 'wxy656';
const API = 'https://api.github.com';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

let entries = readEntries();

function readEntries() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOG_KEY));
    return Array.isArray(stored) ? stored.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // 存储不可用时保留内存中的记录。
  }
}

function compact(details) {
  if (!details) return undefined;
  const result = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' && value.length > 300) {
      result[key] = `${value.slice(0, 300)}…`;
    } else {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function trim() {
  let serialized = JSON.stringify(entries);
  while (entries.length > MAX_ENTRIES || serialized.length > MAX_CHARS) {
    entries.shift();
    serialized = JSON.stringify(entries);
  }
}

export function recordLog(event, details) {
  const now = Date.now();
  const data = compact(details);
  const last = entries.at(-1);
  if (last && last.e === event && JSON.stringify(last.d ?? null) === JSON.stringify(data ?? null)
      && now - last.t < 5000) {
    last.t = now;
    last.n = (last.n ?? 1) + 1;
  } else {
    entries.push({ t: now, e: event, d: data });
    trim();
  }
  persist();
}

export function installLogCapture() {
  window.addEventListener('error', (event) => {
    if (!event.message) return;
    recordLog('页面错误', {
      message: event.message,
      source: String(event.filename || '').split('/').at(-1),
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordLog('未处理的 Promise 错误', {
      message: reason?.message ?? String(reason),
    });
  });
}

function two(value) {
  return String(value).padStart(2, '0');
}

function stamp(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} `
    + `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export function logText() {
  return entries.map(({ t, e, d, n }) => {
    const detail = d === undefined ? '' : ` ${JSON.stringify(d)}`;
    return `[${stamp(t)}] ${e}${detail}${n > 1 ? ` ×${n}` : ''}`;
  }).join('\n');
}

export function logStats() {
  const text = logText();
  return { count: entries.length, chars: text.length, bytes: new Blob([text]).size };
}

export function clearRuntimeLog() {
  entries = [];
  persist();
}

export function readLogConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveLogConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    throw new Error('无法在本机保存 Token');
  }
}

export function clearLogConfig() {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    // 存储不可用时无需处理。
  }
}

function readIssueNumbers() {
  try {
    return JSON.parse(localStorage.getItem(ISSUE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function rememberIssueNumber(key, number) {
  const map = readIssueNumbers();
  map[key] = number;
  try {
    localStorage.setItem(ISSUE_KEY, JSON.stringify(map));
  } catch {
    // 存储不可用时下次仍按标题查找。
  }
}

async function github(path, token, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    });
  } catch {
    throw new Error('无法连接 GitHub，请检查网络');
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = (await response.json()).message || message;
    } catch {
      // 保留状态码提示。
    }
    if (response.status === 401) message = 'Token 无效或已过期';
    if (response.status === 403) {
      message = /rate limit/i.test(message) ? 'GitHub 请求过于频繁，请稍后再试' : `没有权限：${message}`;
    }
    if (response.status === 404) message = '仓库不存在，或 Token 无权访问该仓库';
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

export async function verifyLogToken(token) {
  await github(`/repos/${REPO}/issues?state=all&per_page=1`, token);
}

function deviceSummary(bank, userId) {
  return [
    `- 用户：${userId}`,
    `- 版本：${APP_VERSION}`,
    `- 上传时间：${stamp(Date.now())}`,
    `- 页面：${location.href}`,
    `- 设备：${navigator.userAgent}`,
    `- 屏幕：${screen.width}x${screen.height} @${devicePixelRatio}x`
      + ` · 主屏幕模式：${matchMedia('(display-mode: standalone)').matches
        || navigator.standalone === true ? '是' : '否'}`,
    `- 网络：${navigator.onLine ? '在线' : '离线'}`,
    `- 题库：${bank ? `${bank.bankId}@${bank.version}` : '未选择题库'}`,
  ].join('\n');
}

function uploadBody(bank, userId) {
  const stats = logStats();
  const header = [
    '## iPad 运行日志',
    deviceSummary(bank, userId),
    '',
    `以下为最近 ${stats.count} 条关键记录（约 ${Math.ceil(stats.bytes / 1024)} KB）。`,
    '',
    '```text',
  ].join('\n');
  const footer = '\n```';
  const text = logText().replace(/```/g, "'''");
  const available = UPLOAD_CHARS - header.length - footer.length;
  const body = text.length > available
    ? `…（较早日志已截断）\n${text.slice(-available)}` : text;
  return `${header}\n${body}${footer}`;
}

export async function uploadRuntimeLog(token, bank, userId = DEFAULT_USER_ID) {
  if (!entries.length) throw new Error('本机暂无日志');
  const title = `[${APP_VERSION}][${userId}] 运行日志`;
  const body = uploadBody(bank, userId);
  const issueKey = `${APP_VERSION}|${userId}`;
  // 先按本机记住的 Issue 编号追加评论。GitHub 的列表接口对刚创建的 Issue
  // 有几秒延迟，只按标题搜索时连续上传会各建一条同标题 Issue。
  const remembered = readIssueNumbers()[issueKey];
  if (remembered) {
    try {
      const comment = await github(`/repos/${REPO}/issues/${remembered}/comments`, token, {
        method: 'POST', body: JSON.stringify({ body }),
      });
      return { number: remembered, created: false, url: comment.html_url };
    } catch {
      // Issue 被删除或编号失效时，继续按标题查找。
    }
  }
  const issues = await github(
    `/repos/${REPO}/issues?state=all&per_page=100&sort=created&direction=desc`, token,
  );
  const existing = issues.find((issue) => issue.title === title && !issue.pull_request);
  if (existing) {
    rememberIssueNumber(issueKey, existing.number);
    const comment = await github(`/repos/${REPO}/issues/${existing.number}/comments`, token, {
      method: 'POST', body: JSON.stringify({ body }),
    });
    return { number: existing.number, created: false, url: comment.html_url };
  }
  const issue = await github(`/repos/${REPO}/issues`, token, {
    method: 'POST', body: JSON.stringify({ title, body }),
  });
  rememberIssueNumber(issueKey, issue.number);
  return { number: issue.number, created: true, url: issue.html_url };
}
