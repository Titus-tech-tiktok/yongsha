const STATUS = {
  filling: '正在填写字段',
  uploading: '正在上传图片',
  saving: '正在保存草稿',
  saved: '已保存草稿',
  failed: '失败'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_CONTENT_READY' });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CAISHEN_TAOBAO_START') return;
  runPublish(message.task).then(() => sendResponse({ ok: true })).catch(error => {
    report(message.task?.id, STATUS.failed, { failureReason: error.message });
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

async function report(taskId, status, detail = {}) {
  await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_STATUS', taskId, status, detail });
}

function text(value) {
  return String(value || '').trim();
}

function visible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function fields() {
  return [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].filter(visible);
}

function labelText(element) {
  const id = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText : '';
  const parents = [];
  let node = element;
  for (let index = 0; node && index < 4; index += 1, node = node.parentElement) parents.push(node.innerText || '');
  return [id, element.placeholder, element.getAttribute('aria-label'), element.name, ...parents].join(' ');
}

function findField(keywords) {
  const wanted = keywords.map(item => item.toLocaleLowerCase('zh-CN'));
  return fields().find(element => {
    const label = labelText(element).toLocaleLowerCase('zh-CN');
    return wanted.some(keyword => label.includes(keyword));
  });
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
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  element.blur();
  return true;
}

async function fillField(keywords, value) {
  if (!text(value)) return false;
  const field = findField(keywords);
  if (!field) return false;
  setNativeValue(field, text(value));
  await sleep(180);
  return true;
}

function findButton(keywords) {
  const wanted = keywords.map(item => item.toLocaleLowerCase('zh-CN'));
  return [...document.querySelectorAll('button, [role="button"], a, span, div')]
    .filter(visible)
    .find(element => {
      const label = [element.innerText, element.textContent, element.getAttribute('aria-label'), element.title].join(' ').toLocaleLowerCase('zh-CN');
      return wanted.some(keyword => label.includes(keyword));
    });
}

function absoluteImageUrl(task, url) {
  const value = String(url || '');
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(task?.caishenBaseUrl || '').replace(/\/+$/, '');
  return `${base}${value.startsWith('/') ? '' : '/'}${value}`;
}

async function fetchFile(task, url, name) {
  const response = await fetch(absoluteImageUrl(task, url), { credentials: 'include' });
  if (!response.ok) throw new Error(`图片读取失败：${name}`);
  const blob = await response.blob();
  return new File([blob], name || 'image.jpg', { type: blob.type || 'image/jpeg' });
}

async function assignFiles(task, input, images) {
  const transfer = new DataTransfer();
  for (const image of images) transfer.items.add(await fetchFile(task, image.outputUrl || image.url, image.name));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function uploadImages(task) {
  const allImages = [
    ...(task.images?.mainImages || []),
    ...(task.images?.ratioImages || []),
    ...(task.images?.detailImages || [])
  ];
  if (!allImages.length) throw new Error('任务包没有可上传图片');
  const inputs = [...document.querySelectorAll('input[type="file"]')].filter(visible);
  if (!inputs.length) {
    const uploadButton = findButton(['上传图片', '上传', '选择图片', '添加图片']);
    uploadButton?.click();
    await sleep(600);
  }
  const nextInputs = [...document.querySelectorAll('input[type="file"]')];
  if (!nextInputs.length) throw new Error('未找到淘宝图片上传控件');
  const mainInput = nextInputs[0];
  await assignFiles(task, mainInput, allImages);
  await sleep(1500);
}

async function fillDefaults(task) {
  const defaults = task.category?.defaults || {};
  await fillField(['标题', '宝贝标题', '商品标题'], task.title);
  await fillField(['价格', '一口价', '销售价'], defaults.price);
  await fillField(['库存', '数量'], defaults.stock);
  await fillField(['发货地'], defaults.shipFrom);
  for (const [key, value] of Object.entries(defaults.attributes || {})) {
    await fillField([key], value);
  }
}

async function saveDraft(task) {
  const button = findButton(['保存草稿', '存草稿', '保存']);
  if (!button) throw new Error('未找到保存草稿按钮');
  button.click();
  await sleep(1500);
  await report(task.id, STATUS.saved);
}

async function runPublish(task) {
  if (!task?.id) throw new Error('任务包缺少 ID');
  await report(task.id, STATUS.filling);
  await fillDefaults(task);
  await report(task.id, STATUS.uploading);
  await uploadImages(task);
  await report(task.id, STATUS.saving);
  await saveDraft(task);
}
