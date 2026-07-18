import { DEFAULT_PUBLISH_URL, STATUS, apiFetch, ensureToken, readOptions, refreshToken, writeOptions } from './shared.js';

let activeTask = null;
let activeTabId = 0;
let activeFrameId = 0;
let lastFrameCandidates = [];
let pollTimer = 0;

chrome.runtime.onInstalled.addListener(async () => {
  const options = await writeOptions({});
  refreshToken().catch(error => setLastError(error));
  schedulePoll(options);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'poll-taobao-publish') pollOnce().catch(error => setLastError(error));
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === activeTabId) {
    clearActiveTask('淘宝发布页已关闭，任务未完成').catch(error => setLastError(error));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    trySendTaskToActiveTab().catch(error => setLastError(error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function setLastError(error) {
  await chrome.storage.local.set({ lastError: error?.message || String(error), lastErrorAt: new Date().toISOString() });
}

async function clearLastError() {
  await chrome.storage.local.remove(['lastError', 'lastErrorAt']);
}

function schedulePoll(options) {
  clearTimeout(pollTimer);
  chrome.alarms.create('poll-taobao-publish', { periodInMinutes: 1 });
  if (!options?.enabled) return;
  pollTimer = setTimeout(async () => {
    try {
      await pollOnce();
    } catch (error) {
      await setLastError(error);
    } finally {
      schedulePoll(await readOptions());
    }
  }, Math.max(30000, options.pollSeconds * 1000));
}

async function updateStatus(taskId, status, detail = {}) {
  const options = await ensureToken();
  if (!taskId || !options.token) return;
  await apiFetch(`/api/taobao/publish/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ token: options.token, status, ...detail })
  });
}

async function clearActiveTask(reason = '') {
  const taskId = activeTask?.id;
  activeTask = null;
  activeTabId = 0;
  activeFrameId = 0;
  lastFrameCandidates = [];
  if (taskId && reason) {
    await updateStatus(taskId, STATUS.failed, {
      failureReason: reason,
      detail: { step: 'tab-closed', closedAt: new Date().toISOString() }
    });
  }
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

async function fetchTaskImage(message = {}) {
  const options = await ensureToken();
  if (!options.token) throw new Error('插件连接令牌未配置');
  const taskId = encodeURIComponent(String(message.taskId || activeTask?.id || ''));
  const group = encodeURIComponent(String(message.group || 'main'));
  const index = Math.max(0, Math.trunc(Number(message.index) || 0));
  if (!taskId) throw new Error('缺少发布任务 ID');
  const url = `${options.baseUrl}/api/taobao/publish/tasks/${taskId}/images/${group}/${index}?token=${encodeURIComponent(options.token)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `图片下载失败 HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return {
    dataUrl: await blobToDataUrl(blob),
    type: blob.type || 'image/jpeg',
    name: String(message.name || `image-${group}-${index}.jpg`)
  };
}

async function claimTask() {
  const options = await ensureToken();
  if (!options.enabled || !options.token) return null;
  return apiFetch('/api/taobao/publish/claim', {
    method: 'POST',
    body: JSON.stringify({ token: options.token, extensionId: chrome.runtime.id })
  });
}

async function findExistingPublishTab() {
  const tabs = await chrome.tabs.query({ url: 'https://item.upload.taobao.com/*' });
  return tabs.find(item => /\/sell\/(ai\/category|v2\/publish)\.htm/i.test(item.url || ''))
    || tabs.find(item => /item\.upload\.taobao\.com/i.test(item.url || ''))
    || null;
}

async function openPublishTab(task) {
  const options = await readOptions();
  const publishUrl = task?.category?.defaults?.publishUrl || DEFAULT_PUBLISH_URL;
  await updateStatus(task.id, STATUS.opening);
  const existingTab = await findExistingPublishTab();
  const tab = existingTab
    ? await chrome.tabs.update(existingTab.id, { url: publishUrl, active: false })
    : await chrome.tabs.create({ url: publishUrl, active: false });
  activeTabId = tab.id;
  activeTask = { ...task, caishenBaseUrl: options.baseUrl };
  setTimeout(() => trySendTaskToActiveTab().catch(error => setLastError(error)), 2000);
}

function publishFrameProbe() {
  const bodyText = String(document.body?.innerText || document.body?.textContent || '');
  const fieldText = [...document.querySelectorAll('input, textarea, [contenteditable="true"], select, button, [role="button"]')]
    .slice(0, 120)
    .map(element => [
      element.placeholder,
      element.getAttribute('aria-label'),
      element.name,
      element.id,
      element.innerText,
      element.textContent
    ].filter(Boolean).join(' '))
    .join('\n');
  const combined = `${bodyText}\n${fieldText}`;
  const hasFileInputs = document.querySelectorAll('input[type="file"]').length > 0;
  const hasTitleField = /标题|宝贝标题|商品标题/.test(combined);
  const hasSaveDraft = /保存草稿|存草稿|保存/.test(combined);
  const hasCategorySearch = /搜索发品|类目关键词|产品名称|条码信息/.test(combined);
  const isTaobaoUpload = /item\.upload\.taobao\.com/i.test(location.href);
  const isCategoryEntry = /\/sell\/ai\/category\.htm/i.test(location.href) || /category\.htm/i.test(location.href);
  const score = [
    isTaobaoUpload ? 10 : 0,
    isCategoryEntry ? 30 : 0,
    hasCategorySearch ? 25 : 0,
    hasTitleField ? 45 : 0,
    hasFileInputs ? 45 : 0,
    hasSaveDraft ? 20 : 0
  ].reduce((sum, value) => sum + value, 0);
  return {
    href: location.href,
    title: document.title,
    hasFileInputs,
    hasTitleField,
    hasSaveDraft,
    hasCategorySearch,
    isCategoryEntry,
    score
  };
}

async function findPublishFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: publishFrameProbe
  });
  const frames = (results || [])
    .map(result => ({ frameId: result.frameId || 0, ...(result.result || {}) }))
    .filter(frame => frame.score > 0)
    .sort((left, right) => right.score - left.score);
  lastFrameCandidates = frames.slice(0, 8);
  return frames[0] || { frameId: 0, score: 0 };
}

async function sendTaskToTab(tabId, task) {
  const frame = await findPublishFrame(tabId).catch(() => ({ frameId: 0, score: 0 }));
  activeFrameId = frame.frameId || 0;
  await updateStatus(task.id, STATUS.opening, {
    detail: {
      step: 'frame-selected',
      frameId: activeFrameId,
      frame: {
        href: frame.href || '',
        title: frame.title || '',
        score: frame.score || 0,
        hasFileInputs: Boolean(frame.hasFileInputs),
        hasTitleField: Boolean(frame.hasTitleField),
        hasSaveDraft: Boolean(frame.hasSaveDraft),
        hasCategorySearch: Boolean(frame.hasCategorySearch),
        isCategoryEntry: Boolean(frame.isCategoryEntry)
      },
      frameCandidates: lastFrameCandidates
    }
  });
  await chrome.tabs.sendMessage(tabId, { type: 'CAISHEN_TAOBAO_START', task }, { frameId: activeFrameId });
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['src/content.js']
  });
}

async function trySendTaskToActiveTab() {
  if (!activeTask || !activeTabId) return false;
  try {
    await sendTaskToTab(activeTabId, activeTask);
    return true;
  } catch (error) {
    if (/Receiving end does not exist|Could not establish connection/i.test(error?.message || '')) {
      await injectContentScript(activeTabId);
      await sendTaskToTab(activeTabId, activeTask);
      return true;
    }
    throw error;
  }
}

async function pollOnce() {
  if (activeTask) return { ok: true, active: true };
  const task = await claimTask();
  await clearLastError();
  if (!task) return { ok: true, claimed: false };
  await openPublishTab(task);
  return { ok: true, claimed: true, taskId: task.id };
}

async function collectActiveTaobaoDiagnostics() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find(item => /item\.upload\.taobao\.com/i.test(item.url || '')) || tabs[0];
  if (!tab?.id || !/item\.upload\.taobao\.com/i.test(tab.url || '')) {
    throw new Error('请先切换到淘宝商品发布页面');
  }
  return chrome.tabs.sendMessage(tab.id, { type: 'CAISHEN_TAOBAO_COLLECT_DIAGNOSTICS' });
}

async function handleMessage(message, sender) {
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_GET') {
    return { ok: true, options: await readOptions(), activeTask, activeTabId, activeFrameId, frameCandidates: lastFrameCandidates, ...(await chrome.storage.local.get(['lastError', 'lastErrorAt'])) };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_REFRESH_TOKEN') {
    const options = await refreshToken();
    await clearLastError();
    return { ok: true, options };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_SAVE') {
    const options = await writeOptions(message.options || {});
    if (options.token) await clearLastError();
    schedulePoll(options);
    if (options.enabled) pollOnce().catch(error => setLastError(error));
    return { ok: true, options };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_POLL') return pollOnce();
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_DIAGNOSTICS') return collectActiveTaobaoDiagnostics();
  if (message?.type === 'CAISHEN_TAOBAO_TRIGGER_POLL') return pollOnce();
  if (message?.type === 'CAISHEN_TAOBAO_FETCH_IMAGE') return { ok: true, image: await fetchTaskImage(message) };
  if (message?.type === 'CAISHEN_TAOBAO_CONTENT_READY') {
    if (activeTask && sender.tab?.id === activeTabId) await trySendTaskToActiveTab();
    return { ok: true };
  }
  if (message?.type === 'CAISHEN_TAOBAO_STATUS') {
    await updateStatus(message.taskId || activeTask?.id, message.status, message.detail || {});
    await clearLastError();
    if ([STATUS.saved, STATUS.failed].includes(message.status)) {
      await clearActiveTask();
    }
    return { ok: true };
  }
  return { ok: false, error: 'unknown message' };
}
