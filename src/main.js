import './style.css';
import { createPractice } from './practice/index.js';
import { createOffline } from './offline/index.js';
import { mountUi } from './ui/index.js';

const offline = createOffline();
const practice = createPractice(offline);
mountUi(document.querySelector('#app'), practice);
practice.initialize();
offline.initialize();
