const STATUS = {
  filling: '\u6b63\u5728\u586b\u5199\u5b57\u6bb5',
  uploading: '\u6b63\u5728\u4e0a\u4f20\u56fe\u7247',
  saving: '\u6b63\u5728\u4fdd\u5b58\u8349\u7a3f',
  saved: '\u5df2\u4fdd\u5b58\u8349\u7a3f',
  failed: '\u5931\u8d25'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_CONTENT_READY' });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CAISHEN_TAOBAO_START') return;
  runPublish(message.task).then(() => sendResponse({ ok: true })).catch(error => {
    report(message.task?.id, STATUS.failed, {
      failureReason: error.message,
      detail: collectDiagnostics(error.step || 'unknown')
    });
    sendResponse({ ok: false, error: error.message });
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
  setNativeValue(field, text(value));
  await sleep(180);
  return true;
}

function clickFieldOrOption(keywords, value, selector = '') {
  if (!text(value)) return false;
  const selected = query(selector);
  if (selected) {
    selected.click();
    return true;
  }
  const button = findButton([...keywords, value]);
  if (!button) return false;
  button.click();
  return true;
}

function findButton(keywords, selector = '') {
  const selected = query(selector);
  if (selected) return selected;
  const wanted = keywords.map(item => item.toLocaleLowerCase('zh-CN'));
  return [...document.querySelectorAll('button, [role="button"], a, span, div')]
    .filter(visible)
    .find(element => {
      const label = [element.innerText, element.textContent, element.getAttribute('aria-label'), element.title].join(' ').toLocaleLowerCase('zh-CN');
      return wanted.some(keyword => label.includes(keyword));
    });
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

function fileInputs() {
  return [...document.querySelectorAll('input[type="file"]')];
}

function findFileInput(task, selectorKey, keywords) {
  const selected = query(selectors(task)[selectorKey]);
  if (selected?.type === 'file') return selected;
  const candidates = fileInputs();
  return byKeywords(candidates, keywords) || null;
}

async function revealUploadControls(task) {
  const uploadButton = findButton(['上传图片', '上传', '选择图片', '添加图片', '图片空间'], selectors(task).uploadButton);
  if (uploadButton) {
    uploadButton.click();
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
    const target = query(allSelector);
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
}

async function saveDraft(task) {
  const button = findButton(['保存草稿', '存草稿', '保存'], selectors(task).saveDraft);
  if (!button) throw fail('未找到保存草稿按钮', 'save-draft');
  button.click();
  await sleep(1800);
  await report(task.id, STATUS.saved, { detail: { savedAt: new Date().toISOString() } });
}

function collectDiagnostics(step) {
  const buttons = [...document.querySelectorAll('button, [role="button"], a')]
    .filter(visible)
    .slice(0, 40)
    .map(element => text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title))
    .filter(Boolean);
  const inputs = fileInputs().map((input, index) => ({
    index,
    id: input.id || '',
    name: input.name || '',
    accept: input.accept || '',
    label: text(labelText(input)).slice(0, 160)
  }));
  return {
    step,
    url: location.href,
    title: document.title,
    fileInputs: inputs,
    visibleButtons: buttons
  };
}

async function runPublish(task) {
  if (!task?.id) throw fail('任务包缺少 ID', 'start');
  await report(task.id, STATUS.filling, { detail: { step: 'fill' } });
  await fillDefaults(task);
  await report(task.id, STATUS.uploading, { detail: { step: 'upload' } });
  await uploadImages(task);
  await report(task.id, STATUS.saving, { detail: { step: 'save' } });
  await saveDraft(task);
}
