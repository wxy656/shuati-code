import './style.css';
import { createPractice } from './practice/index.js';
import { createOffline } from './offline/index.js';
import { installLogCapture, recordLog, APP_VERSION } from './log/index.js';
import { mountUi } from './ui/index.js';

installLogCapture();
recordLog('应用启动', { version: APP_VERSION });
const offline = createOffline();
const practice = createPractice(offline);
mountUi(document.querySelector('#app'), practice);
practice.initialize();
offline.initialize();
