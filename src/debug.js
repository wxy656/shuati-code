export function debugLog(event, details) {
  if (localStorage.getItem('shuati-debug') === '1') {
    console.info(`[刷题] ${event}`, details);
  }
}
