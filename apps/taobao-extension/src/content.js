const STATUS = {
  filling: '\u6b63\u5728\u586b\u5199\u5b57\u6bb5',
  uploading: '\u6b63\u5728\u4e0a\u4f20\u56fe\u7247',
  saving: '\u6b63\u5728\u4fdd\u5b58\u8349\u7a3f',
  saved: '\u5df2\u4fdd\u5b58\u8349\u7a3f',
  failed: '\u5931\u8d25'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let runningTaskId = '';

chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_CONTENT_READY' });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CAISHEN_TAOBAO_COLLECT_DIAGNOSTICS') {
    sendResponse({ ok: true, detail: collectDiagnostics('manual-diagnostics') });
    return;
  }
  if (message?.type !== 'CAISHEN_TAOBAO_START') return;
  if (runningTaskId === message.task?.id) {
    sendResponse({ ok: true, duplicate: true });
    return;
  }
  runningTaskId = message.task?.id || '';
  runPublish(message.task).then(() => sendResponse({ ok: true })).catch(error => {
    report(message.task?.id, STATUS.failed, {
      failureReason: error.message,
      detail: collectDiagnostics(error.step || 'unknown')
    });
    sendResponse({ ok: false, error: error.message });
  }).finally(() => {
    runningTaskId = '';
  });
  return true;
});

async function report(taskId, status, detail = {}) {
  await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_STATUS', taskId, status, detail });
}

function fail(message, step) {
  const error = new Error(message);
  error.step = step;
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function selectors(task) {
  return task?.category?.defaults?.selectors && typeof task.category.defaults.selectors === 'object'
    ? task.category.defaults.selectors
    : {};
}

function query(selector) {
  if (!text(selector)) return null;
  try { return document.querySelector(selector); }
  catch { return null; }
}

function queryAll(selector) {
  if (!text(selector)) return [];
  try { return [...document.querySelectorAll(selector)]; }
  catch { return []; }
}

function visible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function disabled(element) {
  if (!element) return true;
  return Boolean(element.disabled)
    || element.getAttribute('aria-disabled') === 'true'
    || element.classList.contains('disabled')
    || /disabled/i.test(String(element.className || ''));
}

function clickElement(element) {
  if (!element || disabled(element)) return false;
  element.scrollIntoView?.({ block: 'center', inline: 'center' });
  element.focus?.();
  for (const type of ['pointerdown', 'mousedown', 'mouseup']) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  element.click?.();
  return true;
}

function selectorForElement(element) {
  if (!element?.tagName) return '';
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${CSS.escape(element.id)}`;
  const name = element.getAttribute('name');
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;
  const aria = element.getAttribute('aria-label');
  if (aria) return `${tag}[aria-label="${CSS.escape(aria)}"]`;
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
  const role = element.getAttribute('role');
  const type = element.getAttribute('type');
  const parts = [tag];
  if (type) parts.push(`[type="${CSS.escape(type)}"]`);
  if (role) parts.push(`[role="${CSS.escape(role)}"]`);
  const parent = element.parentElement;
  if (!parent || parent === document.body) return parts.join('');
  const siblings = [...parent.children].filter(item => item.tagName === element.tagName);
  const index = siblings.indexOf(element);
  return `${selectorForElement(parent)} > ${parts.join('')}${siblings.length > 1 && index >= 0 ? `:nth-of-type(${index + 1})` : ''}`;
}

function cssSelectorForDiagnostics(element) {
  const selector = selectorForElement(element);
  if (!selector) return '';
  try {
    return document.querySelector(selector) === element ? selector : '';
  } catch {
    return '';
  }
}

function fields() {
  return [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].filter(element => {
    if (element.type === 'file' || element.type === 'hidden') return false;
    return visible(element);
  });
}

function labelText(element) {
  const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText : '';
  const parents = [];
  let node = element;
  for (let index = 0; node && index < 5; index += 1, node = node.parentElement) parents.push(node.innerText || '');
  return [explicit, element.placeholder, element.getAttribute('aria-label'), element.name, element.id, ...parents].join(' ');
}

function byKeywords(elements, keywords) {
  const wanted = keywords.map(item => item.toLocaleLowerCase('zh-CN'));
  return elements.find(element => {
    const label = labelText(element).toLocaleLowerCase('zh-CN');
    return wanted.some(keyword => label.includes(keyword));
  });
}

function findField(keywords, selector = '') {
  const selected = query(selector);
  if (selected) return selected;
  return byKeywords(fields(), keywords);
}

function isSelectLike(element) {
  if (!element) return false;
  return element.tagName === 'SELECT'
    || ['combobox', 'listbox'].includes(String(element.getAttribute('role') || '').toLowerCase())
    || ['listbox', 'menu'].includes(String(element.getAttribute('aria-haspopup') || '').toLowerCase());
}

async function setSelectValue(element, value) {
  const wanted = text(value);
  if (!element || !wanted) return false;
  if (element.tagName === 'SELECT') {
    const option = [...element.options].find(item => {
      const label = text(item.textContent || item.label || item.value).toLocaleLowerCase('zh-CN');
      const lower = wanted.toLocaleLowerCase('zh-CN');
      return label === lower || label.includes(lower);
    });
    if (!option) return false;
    element.value = option.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(180);
    return true;
  }
  clickElement(element);
  await sleep(260);
  return selectOptionByText(wanted);
}

function setNativeValue(element, value) {
  if (!element) return false;
  element.focus();
  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  } else {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  element.blur();
  return true;
}

async function fillField(keywords, value, selector = '') {
  if (!text(value)) return false;
  const field = findField(keywords, selector);
  if (!field) return false;
  if (isSelectLike(field)) return setSelectValue(field, value);
  setNativeValue(field, text(value));
  await sleep(180);
  return true;
}

async function selectOptionByText(value, selector = '') {
  const wanted = text(value).toLocaleLowerCase('zh-CN');
  if (!wanted) return false;
  const options = [
    ...queryAll(selector),
    ...document.querySelectorAll('[role="option"], [role="menuitem"], li, span, div')
  ].filter(visible);
  const option = options.find(element => {
    const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title).toLocaleLowerCase('zh-CN');
    return label === wanted || label.includes(wanted);
  });
  if (!option) return false;
  clickElement(option);
  await sleep(220);
  return true;
}

async function clickFieldOrOption(keywords, value, selector = '') {
  if (!text(value)) return false;
  const selected = query(selector);
  if (selected) {
    if (isSelectLike(selected)) return setSelectValue(selected, value);
    clickElement(selected);
    await sleep(260);
    return selectOptionByText(value) || true;
  }
  const field = findButton(keywords);
  if (field) {
    clickElement(field);
    await sleep(260);
    if (await selectOptionByText(value)) return true;
  }
  const button = findButton([value]);
  if (!button) return false;
  clickElement(button);
  await sleep(180);
  return true;
}

function findButton(keywords, selector = '') {
  const selected = query(selector);
  if (selected && visible(selected) && !disabled(selected)) return selected;
  const wanted = keywords.map(item => item.toLocaleLowerCase('zh-CN'));
  return [...document.querySelectorAll('button, [role="button"], a, span, div')]
    .filter(visible)
    .filter(element => !disabled(element))
    .find(element => {
      const label = [element.innerText, element.textContent, element.getAttribute('aria-label'), element.title].join(' ').toLocaleLowerCase('zh-CN');
      return wanted.some(keyword => label.includes(keyword));
    });
}

async function waitForButton(keywords, selector = '', timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const button = findButton(keywords, selector);
    if (button) return button;
    await sleep(500);
  }
  return null;
}

function categoryKeyword(task) {
  return text(
    task?.category?.defaults?.categoryKeyword
    || task?.category?.product
    || task?.category?.name
    || task?.categoryName
  );
}

function isCategoryEntryPage() {
  return /\/sell\/ai\/category\.htm/i.test(location.pathname)
    || /category\.htm/i.test(location.href)
    || pageText().includes('搜索发品');
}

function dispatchEnter(element) {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    element.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
  }
}

function findCategorySearchInput(task) {
  const selected = query(selectors(task).categorySearch);
  if (selected) return selected;
  return findField(['产品名称', '类目关键词', '条码信息', '搜索发品', '搜索']) || fields()[0] || null;
}

const genericCategoryLabels = new Set([
  '\u5546\u54c1\u53d1\u5e03',
  '\u641c\u7d22\u53d1\u54c1',
  '\u70ed\u95e8\u63a8\u8350',
  '\u4e0b\u4e00\u6b65',
  '\u5f00\u59cb',
  '\u53d1\u5e03',
  '\u9009\u62e9'
]);

const categoryActionWords = ['\u53d1\u5e03', '\u9009\u62e9', '\u4e0b\u4e00\u6b65', '\u5f00\u59cb', '\u786e\u8ba4'];

function categoryCandidateText(element) {
  const chunks = [];
  let node = element;
  for (let index = 0; node && index < 4 && node !== document.body; index += 1, node = node.parentElement) {
    const value = text(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.title || '');
    if (value && value.length <= 600) chunks.push(value);
  }
  return [...new Set(chunks)].join(' ');
}

function scoreCategoryCandidate(element, keyword) {
  if (!visible(element)) return 0;
  const ownLabel = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
  const compactLabel = ownLabel.replace(/\s+/g, '');
  if (!compactLabel || genericCategoryLabels.has(compactLabel) || ownLabel.length > 600) return 0;
  const lowerKeyword = text(keyword).toLocaleLowerCase('zh-CN');
  const ownKeywordHit = ownLabel.toLocaleLowerCase('zh-CN').includes(lowerKeyword);
  const haystack = categoryCandidateText(element).toLocaleLowerCase('zh-CN');
  const keywordHit = lowerKeyword && haystack.includes(lowerKeyword);
  const actionHit = categoryActionWords.some(word => haystack.includes(word));
  if (!keywordHit) return 0;
  let score = 100;
  if (ownKeywordHit) score += 60;
  if (actionHit) score += 40;
  if (['BUTTON', 'A'].includes(element.tagName) || element.getAttribute('role') === 'button') score += 15;
  if (['LI', 'DIV'].includes(element.tagName)) score += 5;
  return score - Math.min(Math.floor(ownLabel.length / 20), 30);
}

function findCategoryCandidate(keyword) {
  const candidates = [...document.querySelectorAll('button, [role="button"], a, li, div, span')]
    .map(element => ({ element, score: scoreCategoryCandidate(element, keyword) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.element || null;
}

function categoryActionLabel(element) {
  return text(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.title)
    .replace(/\s+/g, '');
}

function isCategoryAction(element) {
  if (!element || !visible(element) || disabled(element)) return false;
  if (!['BUTTON', 'A'].includes(element.tagName) && element.getAttribute('role') !== 'button') return false;
  const label = categoryActionLabel(element);
  return label && !label.includes('\u641c\u7d22') && categoryActionWords.some(word => label.includes(word));
}

function categoryResultRoots(selected, keyword) {
  const lowerKeyword = text(keyword).toLocaleLowerCase('zh-CN');
  const roots = [];
  let node = selected;
  for (let index = 0; node && index < 6 && node !== document.body; index += 1, node = node.parentElement) {
    const label = text(node.innerText || node.textContent).toLocaleLowerCase('zh-CN');
    if (label.includes(lowerKeyword) && label.length <= 1200) roots.push(node);
  }
  return roots;
}

function findCategoryAction(selected, keyword) {
  for (const root of categoryResultRoots(selected, keyword)) {
    const candidates = [root, ...root.querySelectorAll('button, [role="button"], a')]
      .filter(isCategoryAction)
      .sort((left, right) => categoryActionLabel(left).length - categoryActionLabel(right).length);
    if (candidates[0]) return candidates[0];
  }
  return null;
}

function findCategoryContinuation(selected, excluded) {
  const candidates = [...document.querySelectorAll('button, [role="button"], a')]
    .filter(element => element !== excluded)
    .filter(isCategoryAction)
    .sort((left, right) => {
      const preferred = label => /^(\u53d1\u5e03|\u4e0b\u4e00\u6b65|\u5f00\u59cb|\u786e\u8ba4)/.test(label) ? 0 : 1;
      return preferred(categoryActionLabel(left)) - preferred(categoryActionLabel(right))
        || categoryActionLabel(left).length - categoryActionLabel(right).length;
    });
  return candidates[0] || null;
}

async function waitForPublishForm(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isCategoryEntryPage()) return true;
    if (findField(['标题', '宝贝标题', '商品标题']) || fileInputs().length) return true;
    await sleep(500);
  }
  return false;
}

async function selectTaobaoCategory(task) {
  const keyword = categoryKeyword(task);
  if (!keyword) throw fail('缺少淘宝类目搜索词', 'select-category');
  const field = findCategorySearchInput(task);
  if (!field) throw fail('未找到淘宝类目搜索输入框', 'select-category');
  setNativeValue(field, keyword);
  field.focus();
  dispatchEnter(field);
  await sleep(1200);
  const searchButton = findButton(['搜索', '查询'], selectors(task).categorySearchButton);
  if (searchButton) {
    clickElement(searchButton);
    await sleep(1200);
  }
  const selected = query(selectors(task).categoryResult) || findCategoryCandidate(keyword);
  if (!selected) throw fail(`未找到淘宝类目候选：${keyword}`, 'select-category');
  const action = findCategoryAction(selected, keyword);
  const clicked = action || selected;
  clickElement(clicked);
  if (await waitForPublishForm(3500)) return;
  const continuation = findCategoryContinuation(selected, clicked);
  if (continuation) {
    clickElement(continuation);
    await sleep(1200);
  }
  if (!(await waitForPublishForm())) throw fail(`已选择淘宝类目但未进入发布表单：${keyword}`, 'select-category');
}

async function preparePublishForm(task) {
  if (!isCategoryEntryPage()) return false;
  await report(task.id, STATUS.filling, { detail: { step: 'select-category', url: location.href } });
  await selectTaobaoCategory(task);
  await sleep(800);
  return false;
}

function pageText() {
  return text(document.body?.innerText || document.body?.textContent || '');
}

function findValidationError() {
  const keywords = [
    '\u5fc5\u586b',
    '\u4e0d\u80fd\u4e3a\u7a7a',
    '\u8bf7\u9009\u62e9',
    '\u672a\u586b\u5199',
    '\u9519\u8bef',
    '\u5931\u8d25',
    '\u6821\u9a8c',
    '\u8fdd\u89c4'
  ];
  const allText = pageText();
  const keyword = keywords.find(item => allText.includes(item));
  if (!keyword) return '';
  const lines = allText.split('\n').map(line => text(line)).filter(Boolean);
  return lines.find(line => line.includes(keyword)) || keyword;
}

async function waitForDraftSaved(timeoutMs = 10000) {
  const successKeywords = [
    '\u4fdd\u5b58\u6210\u529f',
    '\u5df2\u4fdd\u5b58',
    '\u63d0\u4ea4\u6210\u529f'
  ];
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const validationError = findValidationError();
    if (validationError) {
      return { ok: false, reason: validationError };
    }
    const allText = pageText();
    const matched = successKeywords.find(item => allText.includes(item));
    if (matched || /draft/i.test(location.href)) {
      return { ok: true, confirmation: matched || 'url:draft' };
    }
    await sleep(500);
  }
  return { ok: false, reason: '\u4fdd\u5b58\u6309\u94ae\u5df2\u70b9\u51fb\uff0c\u4f46\u672a\u68c0\u6d4b\u5230\u8349\u7a3f\u4fdd\u5b58\u6210\u529f\u63d0\u793a' };
}

function dataUrlToFile(dataUrl, name, type) {
  const [header, payload] = String(dataUrl || '').split(',');
  if (!payload || !/^data:/i.test(header)) throw fail(`图片数据无效：${name}`, 'fetch-image');
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name || 'image.jpg', { type: type || header.match(/^data:([^;]+)/i)?.[1] || 'image/jpeg' });
}

async function fetchFile(task, image, group, index) {
  const response = await chrome.runtime.sendMessage({
    type: 'CAISHEN_TAOBAO_FETCH_IMAGE',
    taskId: task.id,
    group: image._group || group,
    index: Number.isInteger(image._index) ? image._index : index,
    name: image.name
  });
  if (!response?.ok || !response.image?.dataUrl) throw fail(response?.error || `图片读取失败：${image.name}`, 'fetch-image');
  return dataUrlToFile(response.image.dataUrl, response.image.name || image.name, response.image.type);
}

async function assignFiles(task, input, images, group, step) {
  if (!input || !images.length) return false;
  const transfer = new DataTransfer();
  for (let index = 0; index < images.length; index += 1) transfer.items.add(await fetchFile(task, images[index], group, index));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(800);
  await report(task.id, STATUS.uploading, { detail: { step, files: transfer.files.length } });
  return true;
}

function uploadBusyElements() {
  const candidates = [
    ...document.querySelectorAll('[aria-busy="true"], [role="progressbar"], .ant-upload-list-item-uploading, .next-upload-list-item-uploading, .uploading, .loading, .spinner, .ant-spin, .next-loading')
  ];
  const busyText = /上传中|处理中|正在上传|等待上传|解析中|uploading|processing/i;
  candidates.push(...[...document.querySelectorAll('[class], [id], span, div')]
    .filter(element => {
      const marker = `${element.className || ''} ${element.id || ''}`.toLocaleLowerCase('zh-CN');
      if (!/(upload|progress|loading|spin)/i.test(marker)) return false;
      return busyText.test(text(element.innerText || element.textContent || element.getAttribute('aria-label') || ''));
    }));
  return candidates.filter(visible);
}

async function waitForUploadSettled(task, timeoutMs = 60000) {
  const started = Date.now();
  let quietChecks = 0;
  let lastBusyCount = 0;
  while (Date.now() - started < timeoutMs) {
    const busy = uploadBusyElements();
    lastBusyCount = busy.length;
    if (!busy.length) quietChecks += 1;
    else quietChecks = 0;
    if (quietChecks >= 3) {
      await report(task.id, STATUS.uploading, { detail: { step: 'upload-settled', waitedMs: Date.now() - started } });
      return;
    }
    await sleep(1000);
  }
  throw fail(`图片上传仍在处理中，已等待 ${Math.round((Date.now() - started) / 1000)} 秒，忙碌控件 ${lastBusyCount} 个`, 'upload-settled');
}

function fileInputs() {
  return [...document.querySelectorAll('input[type="file"]')];
}

function fileInputFromSelector(selector = '') {
  const selected = query(selector);
  if (!selected) return null;
  if (selected.matches?.('input[type="file"]')) return selected;
  return selected.querySelector?.('input[type="file"]') || null;
}

function queryFileInput(task, selectorKey) {
  return fileInputFromSelector(selectors(task)[selectorKey]);
}

function findFileInput(task, selectorKey, keywords) {
  const selected = queryFileInput(task, selectorKey);
  if (selected) return selected;
  const candidates = fileInputs();
  return byKeywords(candidates, keywords) || null;
}

async function revealUploadControls(task) {
  const uploadButton = findButton(['上传图片', '上传', '选择图片', '添加图片', '图片空间'], selectors(task).uploadButton);
  if (uploadButton) {
    clickElement(uploadButton);
    await sleep(800);
  }
}

async function uploadImages(task) {
  const images = task.images || {};
  const mainImages = images.mainImages || [];
  const ratioImages = images.ratioImages || [];
  const detailImages = images.detailImages || [];
  const taggedMainImages = mainImages.map((image, index) => ({ ...image, _group: 'main', _index: index }));
  const taggedRatioImages = ratioImages.map((image, index) => ({ ...image, _group: 'ratio', _index: index }));
  const taggedDetailImages = detailImages.map((image, index) => ({ ...image, _group: 'detail', _index: index }));
  const allImages = [...taggedMainImages, ...taggedRatioImages, ...taggedDetailImages];
  if (!allImages.length) throw fail('任务包没有可上传图片', 'upload');

  await revealUploadControls(task);
  if (!fileInputs().length) throw fail('未找到淘宝图片上传控件', 'upload');

  const allSelector = selectors(task).allImages;
  if (allSelector) {
    const target = fileInputFromSelector(allSelector);
    if (await assignFiles(task, target, allImages, 'main', 'allImages')) return;
  }

  const uploaded = [];
  const mainInput = findFileInput(task, 'mainImages', ['主图', '商品图片', '宝贝图片']);
  if (await assignFiles(task, mainInput, taggedMainImages, 'main', 'mainImages')) uploaded.push('main');

  const ratioInput = findFileInput(task, 'ratioImages', ['3:4', '3-4', '长图', '竖图']);
  if (await assignFiles(task, ratioInput, taggedRatioImages, 'ratio', 'ratioImages')) uploaded.push('ratio');

  const detailInput = findFileInput(task, 'detailImages', ['详情', '描述', '详情图']);
  if (await assignFiles(task, detailInput, taggedDetailImages, 'detail', 'detailImages')) uploaded.push('detail');

  if (uploaded.length) return;

  const fallback = fileInputs()[0];
  if (!(await assignFiles(task, fallback, allImages, 'main', 'fallbackAllImages'))) {
    throw fail('图片上传控件存在，但无法写入文件', 'upload');
  }
}

async function fillDefaults(task) {
  const defaults = task.category?.defaults || {};
  const map = selectors(task);
  await fillField(['标题', '宝贝标题', '商品标题'], task.title, map.title);
  await fillField(['价格', '一口价', '销售价'], defaults.price, map.price);
  await fillField(['库存', '数量'], defaults.stock, map.stock);
  await fillField(['发货地'], defaults.shipFrom, map.shipFrom);
  await clickFieldOrOption(['运费模板'], defaults.freightTemplate, map.freightTemplate);
  await clickFieldOrOption(['服务模板'], defaults.serviceTemplate, map.serviceTemplate);
  for (const [key, value] of Object.entries(defaults.attributes || {})) {
    await fillField([key], value, map[`attribute.${key}`]);
  }
  await fillCustomFields(task);
}

async function fillCustomFields(task) {
  const customFields = Array.isArray(task.category?.defaults?.customFields) ? task.category.defaults.customFields : [];
  for (const item of customFields) {
    const label = text(item?.label);
    const value = text(item?.value);
    const selector = text(item?.selector);
    const type = text(item?.type || 'text');
    if (!label || !value) continue;
    if (type === 'click') {
      await clickFieldOrOption([label], value, selector);
    } else if (type === 'select') {
      const field = findField([label], selector);
      if (field) await setSelectValue(field, value);
      else await clickFieldOrOption([label], value, selector);
    } else {
      await fillField([label], value, selector);
    }
  }
}

async function confirmSaveDraftIfPrompted(excludedButton) {
  await sleep(300);
  const dialog = [...document.querySelectorAll('[role="dialog"], .ant-modal, .next-dialog, .el-dialog')].find(visible);
  const candidates = [...(dialog || document).querySelectorAll('button, [role="button"], a')]
    .filter(element => element !== excludedButton)
    .filter(visible)
    .filter(element => !disabled(element));
  const keywords = dialog
    ? ['确认', '确定', '继续', '保存']
    : ['确认保存', '继续保存', '仍要保存'];
  const confirmButton = candidates.find(element => {
    const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
    return keywords.some(keyword => label.includes(keyword));
  });
  if (!confirmButton) return false;
  clickElement(confirmButton);
  await sleep(800);
  return true;
}

async function saveDraft(task) {
  const button = await waitForButton(['保存草稿', '存草稿', '保存'], selectors(task).saveDraft);
  if (!button) throw fail('未找到保存草稿按钮', 'save-draft');
  clickElement(button);
  await confirmSaveDraftIfPrompted(button);
  const result = await waitForDraftSaved();
  if (!result.ok) throw fail(result.reason, 'save-draft');
  await report(task.id, STATUS.saved, { detail: { savedAt: new Date().toISOString(), confirmation: result.confirmation } });
}

function collectVisibleFields() {
  return fields().slice(0, 40).map((element, index) => ({
    index,
    selector: cssSelectorForDiagnostics(element),
    tag: element.tagName.toLowerCase(),
    type: element.type || '',
    id: element.id || '',
    name: element.name || '',
    placeholder: element.placeholder || '',
    value: text(element.isContentEditable ? element.textContent : element.value).slice(0, 80),
    label: text(labelText(element)).slice(0, 160)
  }));
}

function collectVisibleSelects() {
  return [...document.querySelectorAll('select, [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]')]
    .filter(visible)
    .slice(0, 40)
    .map((element, index) => ({
      index,
      selector: cssSelectorForDiagnostics(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      name: element.name || '',
      value: text(element.value || element.getAttribute('aria-valuetext') || '').slice(0, 80),
      label: text(labelText(element)).slice(0, 160),
      text: text(element.innerText || element.textContent || '').slice(0, 160)
    }));
}

function collectDiagnostics(step) {
  const buttons = [...document.querySelectorAll('button, [role="button"], a')]
    .filter(visible)
    .slice(0, 40)
    .map(element => ({
      selector: cssSelectorForDiagnostics(element),
      text: text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title)
    }))
    .filter(item => item.text);
  const inputs = fileInputs().map((input, index) => ({
    index,
    selector: cssSelectorForDiagnostics(input),
    id: input.id || '',
    name: input.name || '',
    accept: input.accept || '',
    label: text(labelText(input)).slice(0, 160)
  }));
  return {
    step,
    url: location.href,
    title: document.title,
    validationError: findValidationError(),
    fileInputs: inputs,
    visibleFields: collectVisibleFields(),
    visibleSelects: collectVisibleSelects(),
    visibleButtons: buttons
  };
}

async function runPublish(task) {
  if (!task?.id) throw fail('任务包缺少 ID', 'start');
  await preparePublishForm(task);
  await report(task.id, STATUS.filling, { detail: { step: 'fill' } });
  await fillDefaults(task);
  await report(task.id, STATUS.uploading, { detail: { step: 'upload' } });
  await uploadImages(task);
  await waitForUploadSettled(task);
  await report(task.id, STATUS.saving, { detail: { step: 'save' } });
  await saveDraft(task);
}
