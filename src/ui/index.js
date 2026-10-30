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
  ['submit', '提交'], ['scrollUp', '向上阅读'], ['scrollDown', '向下阅读'],
  ['optionPrevious', '上一选项（可选）'], ['optionNext', '下一选项（可选）'],
  ['optionToggle', '勾选当前选项（可选）'],
  ['back', '返回题库'], ['redo', '重新作答'], ['cancel', '关闭回答'],
];

function keyName(code) {
  if (!code) return '未设置';
  return code.startsWith('Key') ? code.slice(3) : code;
}

export function mountUi(root, practice) {
  const pressed = new Set();
  let capturingAction = null;
  let keyFeedback = '';
  let dataFeedback = '';
  let jumpOpen = false;
  let jumpValue = '';
  const selectedWrongIds = new Set();

  function renderDataTools(main, state) {
    const tools = element('section', '', 'settings');
    tools.append(element('h3', '题库与学习数据'));
    tools.append(element('p', '正式题库 ZIP 下载到“文件”后，在这里选择导入；学习备份只含记录，不含题库音频。'));
    const release = element('a', '下载完整题库 ZIP（v1，1499 题，约 191 MiB）');
    release.href = 'https://github.com/wxy656/shuati-code/releases/download/shanghai-poetry-v1/shanghai-poetry-v1.zip';
    release.target = '_blank';
    release.rel = 'noopener noreferrer';
    tools.append(release);
    const row = element('div', '', 'button-row');
    const bankFile = document.createElement('input');
    bankFile.type = 'file';
    bankFile.accept = '.zip,application/zip';
    bankFile.setAttribute('aria-label', '选择题库 ZIP');
    bankFile.disabled = state.importing;
    bankFile.addEventListener('change', () => {
      if (bankFile.files[0]) practice.installBank(bankFile.files[0]);
    });
    row.append(bankFile);
    if (state.bank?.local) row.append(button('删除本机题库资源', practice.deleteLocalBank, { disabled: state.importing }));
    tools.append(row);
    if (state.importing) tools.append(element('p', `正在导入，已保存 ${state.importCount} 个文件…`));
    if (state.storageStatus) tools.append(element('p', state.storageStatus));
    const backupRow = element('div', '', 'button-row');
    backupRow.append(button('导出学习备份', async () => {
      try {
        const backup = await practice.exportBackup();
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `刷题学习备份-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        dataFeedback = `导出失败：${error.message}`;
        render(practice.state);
      }
    }));
    const usePreferences = document.createElement('input');
    usePreferences.type = 'checkbox';
    usePreferences.setAttribute('aria-label', '同时采用备份中的设置和进度');
    const preferenceLabel = element('label', '', 'setting-row');
    preferenceLabel.append(usePreferences, element('span', '同时采用备份中的设置和进度'));
    backupRow.append(preferenceLabel);
    const backupFile = document.createElement('input');
    backupFile.type = 'file';
    backupFile.accept = '.json,application/json';
    backupFile.setAttribute('aria-label', '选择学习备份 JSON');
    backupFile.addEventListener('change', async () => {
      if (!backupFile.files[0]) return;
      try {
        await practice.importBackup(backupFile.files[0], usePreferences.checked);
        dataFeedback = '';
      } catch (error) {
        dataFeedback = `导入备份失败：${error.message}`;
        render(practice.state);
      }
    });
    backupRow.append(backupFile);
    tools.append(backupRow);
    if (dataFeedback) tools.append(element('p', dataFeedback, 'error'));
    main.append(tools);
  }

  function renderHome(main, state) {
    main.append(element('h2', '题库管理'));
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

    const offline = element('section', '', 'settings');
    offline.append(element('h3', '离线使用'));
    if (state.offline.available) {
      offline.append(element('p', `题目：${state.offline.questionReady ? '可离线使用' : '尚未准备'} · 音频：${state.offline.audioReadyCount}/${state.offline.audioTotal} 已准备`));
      const complete = state.offline.questionReady && state.offline.audioReadyCount === state.offline.audioTotal;
      offline.append(button(state.offline.preparing ? '准备中…' : complete ? '已准备完成' : '准备离线资源',
        practice.prepareOffline, { disabled: state.offline.preparing || complete }));
      if (state.offline.preparing) {
        const progress = document.createElement('progress');
        progress.max = Math.max(1, state.offline.total);
        progress.value = state.offline.done;
        offline.append(progress, element('p', `已处理 ${state.offline.done}/${state.offline.total} 项`));
      }
      if (state.offline.failedCount) {
        offline.append(element('p', `${state.offline.failedCount} 项准备失败，可再次点击准备重试。`, 'error'));
        for (const failure of state.offline.failures) {
          offline.append(element('p', `${failure.path}：${failure.reason}`, 'offline-failure'));
        }
      }
    } else {
      offline.append(element('p', '离线服务尚未就绪。'));
    }
    if (state.offline.error) offline.append(element('p', state.offline.error, 'error'));
    main.append(offline);

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
      const fullscreenButton = button(document.fullscreenElement ? '退出全屏' : '进入全屏', async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen();
        } catch {
          fullscreenButton.after(element('p', '无法切换全屏，请通过 Safari 的分享菜单添加到主屏幕后打开。', 'error'));
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
    main.append(element('p', '勾选题目后可移出错题集。已有作答记录会保留，再次答错时会重新加入。'));
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
    const showResult = result && !draft?.redo;

    const header = element('header', '', 'practice-header');
    header.append(button('返回题库', practice.backToBanks, { disabled: state.submitting }));
    const heading = element('div', '');
    heading.append(element('h2', state.bank.name));
    heading.append(element('p', `第 ${question.displayNumber} 题 · ${state.position + 1}/${state.bank.questions.length} · ${question.type === 'multiple' ? '多选' : '单选'}`));
    header.append(heading);
    main.append(header);

    const content = element('section', '', `practice-content ${showResult
      ? `result-view ${result.isCorrect ? 'correct' : 'incorrect'}` : 'question-view'}`);
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
      for (const option of question.options) {
        options.append(element('li', `${option.label}. ${option.text}`));
      }
      content.append(options);
      if (draft?.redo) {
        content.append(element('p', '重新作答中；提交成功前，统计仍按上次结果计算。', 'hint'));
      }
    }
    const body = element('div', '', 'practice-body');
    body.append(content);
    if (state.answerOpen) renderAnswer(body, state, question, draft);
    main.append(body);

    const selected = showResult ? result.selectedOptionIds : draft?.selectedOptionIds ?? [];
    const status = element('div', '', 'practice-status');
    status.append(element('span', showResult ? '已提交' : state.submitting ? '保存中…' : '待提交'));
    status.append(element('span', `已选：${selected.length ? answerLabels(question, selected) : '无'}`));
    if (question.options.length > 6 && state.answerOpen) {
      status.append(element('span', `当前选项：${question.options[state.optionCursor]?.label ?? ''}`));
    }
    status.append(element('span', state.audio.message || (state.audio.status === 'playing'
      ? `${state.audio.kind === 'question' ? '题目' : '解析'}播放中`
      : state.audio.status === 'loading' ? '音频加载中' : '音频未播放')));
    main.append(status);
    const keys = state.settings.keyMap;
    main.append(element('p', showResult
      ? `${keyName(keys.next)} 下一题 · ${keyName(keys.replay)} 重读解析 · ${keyName(keys.previous)} 上一题`
      : `选择 A–F · ${keyName(keys.submit)} 提交 · ${keyName(keys.previous)}/${keyName(keys.next)} 切题 · ${keyName(keys.replay)} 重读 · ${keyName(keys.scrollUp)}/${keyName(keys.scrollDown)} 阅读`, 'action-hint'));

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
      : button('回答', practice.openAnswer, { disabled: state.submitting, className: 'primary' }));
    actions.append(button(state.position === state.bank.questions.length - 1 ? '已到末题' : '下一题', () => practice.move(1), {
      disabled: state.submitting || state.position === state.bank.questions.length - 1,
    }));
    main.append(actions);
  }

  function renderAnswer(body, state, question, draft) {
    const panel = element('section', '', 'answer-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `回答第 ${question.displayNumber} 题`);
    const header = element('div', '', 'answer-header');
    header.append(element('h3', `回答第 ${question.displayNumber} 题`));
    const close = button('×', practice.closeAnswer, { disabled: state.submitting });
    close.setAttribute('aria-label', '关闭');
    header.append(close);
    panel.append(header);
    if (question.type === 'multiple') panel.append(element('p', '多选题，可选多项。'));
    const options = element('div', '', 'answer-options');
    for (const option of question.options) {
      const selected = draft?.selectedOptionIds.includes(option.id) ?? false;
      const choice = button(option.label,
        () => practice.selectOption(option.id), {
          disabled: state.submitting,
          className: `answer-choice ${selected ? 'selected' : ''} ${state.optionCursor === question.options.indexOf(option) ? 'cursor' : ''}`,
        });
      choice.setAttribute('aria-pressed', String(selected));
      choice.setAttribute('aria-label', `选项 ${option.label}`);
      options.append(choice);
    }
    panel.append(options);
    if (state.error) panel.append(element('p', state.error, 'error'));
    panel.append(button(state.submitting ? '保存中…' : '提交答案', practice.submit, {
      disabled: state.submitting || !draft?.selectedOptionIds.length,
      className: 'primary submit-answer',
    }));
    body.append(panel);
  }

  function render(state) {
    const previousContent = root.querySelector('.practice-content');
    const scrollKey = previousContent?.dataset.contentKey;
    const scrollTop = previousContent?.scrollTop ?? 0;
    const focusedKey = root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const main = element('main', '', 'page');
    if (state.screen === 'practice') main.classList.add('practice-page');
    main.append(element('h1', '刷题', 'app-title'));
    if (state.loading) main.append(element('p', '正在加载…'));
    if (state.error && !state.answerOpen) main.append(element('p', state.error, 'error'));
    if (state.notice) main.append(element('p', state.notice, 'hint'));
    if (state.offline.updateAvailable) {
      const update = element('section', '', 'update-notice');
      update.append(element('span', state.screen === 'home'
        ? '新版本已准备好。' : '新版本已准备好，返回题库后可更新。'));
      if (state.screen === 'home') update.append(button('更新应用', practice.activateUpdate));
      main.append(update);
    }
    if (state.screen === 'practice' && state.bank) renderPractice(main, state);
    else if (state.screen === 'wrongBook' && state.bank) renderWrongBook(main, state);
    else renderHome(main, state);
    root.replaceChildren(main);
    const content = root.querySelector('.practice-content');
    if (content && content.dataset.contentKey === scrollKey) content.scrollTop = scrollTop;
    if (focusedKey) {
      const focused = [...root.querySelectorAll('button')].find((item) => item.dataset.focusKey === focusedKey);
      focused?.focus({ preventScroll: true });
    }
  }

  window.addEventListener('keydown', (event) => {
    const code = event.code && event.code !== 'Unidentified' ? event.code : event.key;
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
    const action = Object.entries(practice.state.settings.keyMap).find(([, mapped]) => mapped === code)?.[0];
    if (!action) return;
    event.preventDefault();
    if (event.repeat || pressed.has(code)) return;
    pressed.add(code);
    if (action === 'scrollUp' || action === 'scrollDown') {
      const content = root.querySelector('.practice-content');
      content?.scrollBy({ top: content.clientHeight * (action === 'scrollUp' ? -0.65 : 0.65) });
    } else {
      practice.performAction(action);
    }
  });
  window.addEventListener('keyup', (event) => pressed.delete(event.code && event.code !== 'Unidentified' ? event.code : event.key));
  window.addEventListener('blur', () => pressed.clear());
  document.addEventListener('fullscreenchange', () => {
    const toggle = root.querySelector('.fullscreen-toggle');
    if (toggle) toggle.textContent = document.fullscreenElement ? '退出全屏' : '进入全屏';
  });
  practice.subscribe(render);
  render(practice.state);
}
