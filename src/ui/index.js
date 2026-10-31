import { resourceUrl } from '../banks/index.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, onClick, { disabled = false, className = '' } = {}) {
  const node = element('button', text, className);
  node.type = 'button';
  node.disabled = disabled;
  node.dataset.focusKey = text;
  node.addEventListener('click', onClick);
  return node;
}

function answerLabels(question, ids) {
  return ids.map((id) => question.options.find((option) => option.id === id)?.label ?? id).join('、');
}

const keyActions = [
  ['optionA', '选择 A'], ['optionB', '选择 B'], ['optionC', '选择 C'],
  ['optionD', '选择 D'], ['optionE', '选择 E'], ['optionF', '选择 F'],
  ['previous', '上一题'], ['next', '下一题'], ['replay', '重读'],
  ['submit', '提交'],
  ['scrollUp', '向上阅读'], ['scrollDown', '向下阅读'],
  ['optionPrevious', '上一选项（可选）'], ['optionNext', '下一选项（可选）'],
  ['optionToggle', '勾选当前选项（可选）'],
  ['back', '返回题库'], ['redo', '重新作答'],
];

function keyName(code) {
  if (!code) return '未设置';
  return code.startsWith('Key') ? code.slice(3) : code;
}

export function mountUi(root, practice) {
  let capturingAction = null;
  let keyFeedback = '';
  let jumpOpen = false;
  let jumpValue = '';
  let onlineDialogOpen = false;
  let onlineResources = null;
  let onlineError = '';
  const selectedWrongIds = new Set();

  async function openOnlineResources() {
    onlineDialogOpen = true;
    onlineResources = null;
    onlineError = '';
    render(practice.state);
    try {
      const response = await fetch(resourceUrl('online-banks/index.json'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onlineResources = await response.json();
    } catch (error) {
      onlineError = `无法读取线上资源：${error.message}`;
    }
    if (onlineDialogOpen) render(practice.state);
  }

  function renderDataTools(main, state) {
    const tools = element('section', '', 'settings');
    const row = element('div', '', 'button-row');
    row.append(button('线上资源', openOnlineResources, { disabled: state.importing }));
    const bankFile = document.createElement('input');
    bankFile.type = 'file';
    bankFile.accept = '.zip,application/zip';
    bankFile.setAttribute('aria-label', '选择题库 ZIP');
    bankFile.hidden = true;
    bankFile.disabled = state.importing;
    bankFile.addEventListener('change', () => {
      if (bankFile.files[0]) practice.installBank(bankFile.files[0]);
    });
    row.append(button('本地导入', () => bankFile.click(), { disabled: state.importing }), bankFile);
    if (state.bank?.local) row.append(button('删除本机题库资源', practice.deleteLocalBank, { disabled: state.importing }));
    tools.append(row);
    if (state.importing) tools.append(element('p', `${state.importOnline ? '正在下载并导入' : '正在导入'}，已保存 ${state.importCount} 个文件…`));
    if (state.storageStatus) tools.append(element('p', state.storageStatus));
    if (state.bank) {
      const complete = state.offline.questionReady && state.offline.audioReadyCount === state.offline.audioTotal;
      tools.append(element('p', `${state.bank.name}：题目${state.offline.questionReady ? '已保存' : '未保存'} · 音频 ${state.offline.audioReadyCount}/${state.offline.audioTotal} 已保存${complete ? ' · 可离线使用' : ''}`));
      if (!state.bank.local && !state.offline.available) {
        tools.append(element('p', '离线服务尚未就绪。'));
      }
      if (state.offline.error) tools.append(element('p', state.offline.error, 'error'));
    }
    main.append(tools);

    if (onlineDialogOpen) {
      const dialog = element('dialog', '', 'online-resources-dialog');
      dialog.append(element('h3', '线上资源'));
      if (onlineError) dialog.append(element('p', onlineError, 'error'));
      else if (!onlineResources) dialog.append(element('p', '正在读取 Release 题库…'));
      else if (!onlineResources.length) dialog.append(element('p', '暂无可下载的题库。'));
      else for (const item of onlineResources) {
        const resource = element('div', '', 'online-resource');
        resource.append(element('span', `${item.name} · ${item.fileName} · ${Math.round(item.size / 1048576)} MiB`));
        resource.append(button('下载并导入', () => {
          onlineDialogOpen = false;
          render(practice.state);
          practice.installBank(resourceUrl(item.path).href);
        }, { disabled: state.importing }));
        dialog.append(resource);
      }
      dialog.append(button('关闭', () => {
        onlineDialogOpen = false;
        render(practice.state);
      }));
      dialog.addEventListener('close', () => { onlineDialogOpen = false; });
      main.append(dialog);
    }
  }

  function renderHome(main, state) {
    main.append(element('h2', '题库导入'));
    renderDataTools(main, state);
    if (!state.banks.length) {
      if (!state.loading) main.append(element('p', '暂无可用题库。'));
      return;
    }

    const selector = document.createElement('select');
    selector.setAttribute('aria-label', '选择题库');
    selector.disabled = state.loading;
    for (const entry of state.banks) {
      const option = element('option', entry.name);
      option.value = entry.bankId;
      option.selected = entry.bankId === state.bank?.bankId;
      selector.append(option);
    }
    selector.addEventListener('change', () => practice.selectBank(selector.value));
    main.append(selector);

    if (!state.bank) return;
    const card = element('section', '', 'bank-card');
    card.append(element('h3', state.bank.name));
    card.append(element('p', state.bank.description));
    card.append(element('p', `版本 ${state.bank.version} · ${state.stats.total} 题`));
    const stats = element('div', '', 'stats');
    for (const [label, value] of [
      ['总题数', state.stats.total], ['已完成', state.stats.completed],
      ['未完成', state.stats.remaining], ['正确', state.stats.correct],
      ['错误', state.stats.incorrect], ['正确率', state.stats.accuracy],
    ]) {
      const item = element('div', '', 'stat');
      item.append(element('strong', String(value)), element('span', label));
      stats.append(item);
    }
    card.append(stats);
    card.append(button(state.savedQuestionId ? '继续练习' : '从第一题开始', practice.start, {
      disabled: state.loading || !state.stats.total, className: 'primary',
    }));
    card.append(button('从头开始', () => {
      if (window.confirm('清空当前题库的已完成、正确、错误计数，并从第一题开始？错题集会保留。')) {
        practice.resetFromStart();
      }
    }, { disabled: state.loading || !state.stats.total }));

    const jumpDetails = document.createElement('details');
    jumpDetails.open = jumpOpen;
    jumpDetails.addEventListener('toggle', () => { jumpOpen = jumpDetails.open; });
    jumpDetails.append(element('summary', '跳到指定题号'));
    const jump = element('form', '', 'jump-form');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = jumpValue;
    input.placeholder = '输入题号，如 001';
    input.setAttribute('aria-label', '指定题号');
    input.addEventListener('input', () => { jumpValue = input.value; });
    const submit = element('button', '跳转');
    submit.type = 'submit';
    submit.disabled = state.loading || !state.stats.total;
    jump.append(input, submit);
    jump.addEventListener('submit', (event) => {
      event.preventDefault();
      practice.jumpToNumber(input.value);
      if (practice.state.screen === 'practice') {
        jumpOpen = false;
        jumpValue = '';
      }
    });
    jumpDetails.append(jump);
    card.append(jumpDetails);
    main.append(card);
    const wrongItems = state.bank.questions.filter((question) => {
      const wrong = state.wrong.get(question.id);
      return wrong?.active && wrong.revision === question.revision;
    });
    const wrongBook = element('section', '', 'settings');
    wrongBook.append(element('h3', `错题集（${wrongItems.length} 题）`));
    wrongBook.append(button('进入错题管理', () => {
      selectedWrongIds.clear();
      practice.openWrongBook();
    }));
    main.append(wrongBook);

    const settings = element('section', '', 'settings');
    settings.append(element('h3', '显示设置'));
    const controls = element('div', '', 'button-row');
    controls.append(
      button('字号减小', () => practice.changeFontSize(-2)),
      element('span', `${state.settings.fontSize}px`),
      button('字号增大', () => practice.changeFontSize(2)),
    );
    settings.append(controls);
    if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      const isIPad = /iPad/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const fullscreenButton = button(document.fullscreenElement ? '退出全屏' : '进入全屏', async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else {
            await document.documentElement.requestFullscreen(isIPad ? { keyboardLock: 'browser' } : undefined);
            root.tabIndex = -1;
            root.focus({ preventScroll: true });
          }
        } catch {
          fullscreenButton.after(element('p', isIPad
            ? '当前 Safari 无法在网页全屏中使用物理键盘，请通过分享菜单添加到主屏幕，再从主屏幕打开。'
            : '无法切换全屏，请通过 Safari 的分享菜单添加到主屏幕后打开。', 'error'));
        }
      }, { className: 'fullscreen-toggle' });
      settings.append(fullscreenButton);
    }
    const audioSettings = element('div', '', 'audio-settings');
    for (const [kind, label, checked] of [
      ['question', '进入题目自动朗读', state.settings.autoQuestion],
      ['explanation', '提交后自动朗读解析', state.settings.autoExplanation],
    ]) {
      const row = element('label', '', 'setting-row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checked;
      checkbox.addEventListener('change', () => practice.setAutoPlay(kind, checkbox.checked));
      row.append(checkbox, element('span', label));
      audioSettings.append(row);
    }
    const rateRow = element('label', '', 'setting-row');
    rateRow.append(element('span', '朗读语速'));
    const rate = document.createElement('select');
    for (const value of [0.75, 1, 1.25, 1.5]) {
      const option = element('option', `${value} 倍`);
      option.value = String(value);
      option.selected = value === state.settings.rate;
      rate.append(option);
    }
    rate.addEventListener('change', () => practice.changeRate(Number(rate.value)));
    rateRow.append(rate);
    audioSettings.append(rateRow);
    settings.append(audioSettings);
    settings.append(element('h3', '按键设置'));
    settings.append(element('p', '先选动作，再按一次物理键；显示收到的按键并保存到本机。'));
    const keyRows = element('div', '', 'key-rows');
    for (const [action, label] of keyActions) {
      const row = element('div', '', 'key-row');
      row.append(element('span', label), element('span', keyName(state.settings.keyMap[action])));
      row.append(button(capturingAction === action ? '请按键…' : '设置', () => {
        capturingAction = action;
        keyFeedback = '';
        render(state);
      }));
      keyRows.append(row);
    }
    settings.append(keyRows);
    if (keyFeedback) settings.append(element('p', keyFeedback, 'hint'));
    main.append(settings);
  }

  function renderWrongBook(main, state) {
    const questions = state.bank.questions.filter((question) => {
      const item = state.wrong.get(question.id);
      return item?.active && item.revision === question.revision;
    });
    main.append(button('返回题库管理', practice.closeWrongBook));
    main.append(element('h2', `错题管理 · ${questions.length} 题`));
    main.append(element('p', '勾选题目后可移出错题集；再次答错时会重新加入。'));
    if (!questions.length) {
      main.append(element('p', '目前没有错题。'));
      return;
    }
    const selectAll = element('label', '', 'setting-row');
    const all = document.createElement('input');
    all.type = 'checkbox';
    all.checked = questions.every((question) => selectedWrongIds.has(question.id));
    all.addEventListener('change', () => {
      for (const question of questions) {
        if (all.checked) selectedWrongIds.add(question.id);
        else selectedWrongIds.delete(question.id);
      }
      render(state);
    });
    selectAll.append(all, element('span', '全选'));
    main.append(selectAll);
    const list = element('div', '', 'wrong-list');
    for (const question of questions) {
      const row = element('label', '', 'wrong-item');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = selectedWrongIds.has(question.id);
      check.addEventListener('change', () => {
        if (check.checked) selectedWrongIds.add(question.id);
        else selectedWrongIds.delete(question.id);
        render(state);
      });
      row.append(check, element('span', `第 ${question.displayNumber} 题：${question.stem}`));
      list.append(row);
    }
    main.append(list);
    const selectedCount = questions.filter((question) => selectedWrongIds.has(question.id)).length;
    main.append(button(`移出所选（${selectedCount}）`, async () => {
      if (await practice.removeWrong([...selectedWrongIds])) {
        selectedWrongIds.clear();
        render(practice.state);
      }
    }, { disabled: !selectedCount, className: 'primary' }));
  }

  function renderPractice(main, state) {
    const question = practice.currentQuestion();
    if (!question) return;
    const result = practice.currentResult();
    const draft = practice.currentDraft();
    const showResult = Boolean(result);

    const header = element('header', '', 'practice-header');
    header.append(button('返回题库', practice.backToBanks, { disabled: state.submitting }));
    header.append(element('span', `第 ${question.displayNumber} 题 · ${state.position + 1}/${state.bank.questions.length} · ${question.type === 'multiple' ? '多选' : '单选'} · ${state.bank.name}`, 'practice-location'));
    main.append(header);

    const content = element('section', '', `practice-content ${showResult
      ? `result-view ${result.isCorrect ? 'correct' : 'incorrect'}` : 'question-view'}`);
    content.tabIndex = 0;
    content.dataset.contentKey = `${state.bank.bankId}/${question.id}/${showResult ? 'result' : 'question'}`;
    content.style.fontSize = `${state.settings.fontSize}px`;
    if (showResult) {
      content.append(element('h3', result.isCorrect ? '回答正确' : '回答错误'));
      content.append(element('p', `你的答案：${answerLabels(question, result.selectedOptionIds)}`));
      content.append(element('p', `正确答案：${answerLabels(question, question.correctOptionIds)}`));
      content.append(element('p', question.explanation || '本题暂无解析', 'explanation'));
    } else {
      content.append(element('p', question.stem, 'question-stem'));
      const options = element('ul', '', 'question-options');
      for (const [index, option] of question.options.entries()) {
        const selected = draft?.selectedOptionIds.includes(option.id) ?? false;
        const choice = button(`${option.label}. ${option.text}`, () => practice.selectOption(option.id), {
          disabled: state.submitting,
          className: `question-option ${selected ? 'selected' : ''} ${state.optionCursor === index ? 'cursor' : ''}`,
        });
        choice.setAttribute('aria-pressed', String(selected));
        const item = document.createElement('li');
        item.append(choice);
        options.append(item);
      }
      content.append(options);
    }
    const body = element('div', '', 'practice-body');
    body.append(content);
    main.append(body);
    if (state.error) main.append(element('p', state.error, 'error practice-message'));
    if (state.notice) main.append(element('p', state.notice, 'hint practice-message'));

    const selected = showResult ? result.selectedOptionIds : draft?.selectedOptionIds ?? [];
    const status = element('div', '', 'practice-status');
    status.append(element('span', showResult ? '已提交' : state.submitting ? '保存中…' : '待提交'));
    status.append(element('span', `已选：${selected.length ? answerLabels(question, selected) : '无'}`));
    if (question.options.length > 6 && !showResult) {
      status.append(element('span', `当前选项：${question.options[state.optionCursor]?.label ?? ''}`));
    }
    status.append(element('span', state.audio.message || (state.audio.status === 'playing'
      ? `${state.audio.kind === 'question' ? '题目' : '解析'}播放中`
      : state.audio.status === 'loading' ? '音频加载中' : '音频未播放')));
    main.append(status);
    const keys = state.settings.keyMap;
    main.append(element('p', showResult
      ? `${keyName(keys.next)} 下一题 · ${keyName(keys.replay)} 重读解析 · ${keyName(keys.previous)} 上一题 · ⟳/⟲上下移滑轮`
      : '选择 A–F · Enter 提交 · ←/→切题 · R 重读 ·⟳/⟲上下移滑轮', 'action-hint'));

    const actions = element('nav', '', 'practice-actions');
    actions.append(button('上一题', () => practice.move(-1), {
      disabled: state.submitting || state.position === 0,
    }));
    const audioKind = showResult ? 'explanation' : 'question';
    actions.append(button(question.audio?.[audioKind] ? `朗读${showResult ? '解析' : '题目'}` : `暂无${showResult ? '解析' : '题目'}音频`,
      showResult ? practice.playExplanation : practice.playQuestion, {
      disabled: !question.audio?.[audioKind],
    }));
    actions.append(showResult
      ? button('重新作答', practice.redo, { disabled: state.submitting })
      : button(state.submitting ? '保存中…' : '提交答案', practice.submit, {
        disabled: state.submitting || !draft?.selectedOptionIds.length, className: 'primary',
      }));
    actions.append(button(state.position === state.bank.questions.length - 1 ? '已到末题' : '下一题', () => practice.move(1), {
      disabled: state.submitting || state.position === state.bank.questions.length - 1,
    }));
    main.append(actions);
  }

  function render(state) {
    const previousContent = root.querySelector('.practice-content');
    const scrollKey = previousContent?.dataset.contentKey;
    const scrollTop = previousContent?.scrollTop ?? 0;
    const focusedKey = root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const main = element('main', '', 'page');
    if (state.screen === 'practice') main.classList.add('practice-page');
    if (state.screen !== 'practice') main.append(element('h1', '刷题', 'app-title'));
    if (state.loading) main.append(element('p', '正在加载…'));
    if (state.error && state.screen !== 'practice') main.append(element('p', state.error, 'error'));
    if (state.notice && state.screen !== 'practice') main.append(element('p', state.notice, 'hint'));
    if (state.offline.updateAvailable && state.screen === 'home') {
      const update = element('section', '', 'update-notice');
      update.append(element('span', '新版本已准备好。'));
      update.append(button('更新应用', practice.activateUpdate));
      main.append(update);
    }
    if (state.screen === 'practice' && state.bank) renderPractice(main, state);
    else if (state.screen === 'wrongBook' && state.bank) renderWrongBook(main, state);
    else renderHome(main, state);
    root.replaceChildren(main);
    root.querySelector('.online-resources-dialog')?.showModal();
    const content = root.querySelector('.practice-content');
    if (content && content.dataset.contentKey === scrollKey) content.scrollTop = scrollTop;
    if (focusedKey) {
      const focused = [...root.querySelectorAll('button')].find((item) => item.dataset.focusKey === focusedKey);
      focused?.focus({ preventScroll: true });
    }
    if ((state.screen === 'practice' || capturingAction) && !root.contains(document.activeElement)) {
      if (state.screen === 'practice') content?.focus({ preventScroll: true });
      else {
        root.tabIndex = -1;
        root.focus({ preventScroll: true });
      }
    }
  }

  window.addEventListener('keydown', (event) => {
    const code = event.code && event.code !== 'Unidentified' ? event.code : event.key;
    const keyCode = /^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}` : event.key;
    if (capturingAction && practice.state.screen === 'home') {
      if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      event.preventDefault();
      practice.setKeyBinding(capturingAction, code);
      keyFeedback = `收到 ${event.key}（${code}），已保存。`;
      capturingAction = null;
      render(practice.state);
      return;
    }
    if (practice.state.screen !== 'practice') return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const bindings = Object.entries(practice.state.settings.keyMap);
    const action = bindings.find(([, mapped]) => mapped === code)?.[0]
      ?? bindings.find(([, mapped]) => mapped === keyCode)?.[0];
    if (!action) return;
    event.preventDefault();
    if (action === 'scrollUp' || action === 'scrollDown') {
      const content = root.querySelector('.practice-content');
      content?.scrollBy({ top: (action === 'scrollDown' ? 1 : -1) * content.clientHeight * 0.75 });
      return;
    }
    if (event.repeat) return;
    practice.performAction(action);
  });
  root.addEventListener('wheel', (event) => {
    if (practice.state.screen !== 'practice' || event.ctrlKey || !event.deltaY) return;
    const content = root.querySelector('.practice-content');
    if (!content) return;
    event.preventDefault();
    content.scrollBy({ top: event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? content.clientHeight : 1) });
  }, { passive: false });
  document.addEventListener('fullscreenchange', () => {
    const toggle = root.querySelector('.fullscreen-toggle');
    if (toggle) toggle.textContent = document.fullscreenElement ? '退出全屏' : '进入全屏';
  });
  practice.subscribe(render);
  render(practice.state);
}
