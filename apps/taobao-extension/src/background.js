import { DEFAULT_PUBLISH_URL, STATUS, apiFetch, readOptions, writeOptions } from './shared.js';

let activeTask = null;
let activeTabId = 0;
let pollTimer = 0;

chrome.runtime.onInstalled.addListener(async () => {
  const options = await writeOptions({});
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function setLastError(error) {
  await chrome.storage.local.set({ lastError: error?.message || String(error), lastErrorAt: new Date().toISOString() });
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
  const options = await readOptions();
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
  const options = await readOptions();
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
  const options = await readOptions();
  if (!options.enabled || !options.token) return null;
  return apiFetch('/api/taobao/publish/claim', {
    method: 'POST',
    body: JSON.stringify({ token: options.token, extensionId: chrome.runtime.id })
  });
}

async function openPublishTab(task) {
  const options = await readOptions();
  const publishUrl = task?.category?.defaults?.publishUrl || DEFAULT_PUBLISH_URL;
  await updateStatus(task.id, STATUS.opening);
  const tab = await chrome.tabs.create({ url: publishUrl, active: false });
  activeTabId = tab.id;
  activeTask = { ...task, caishenBaseUrl: options.baseUrl };
}

async function sendTaskToTab(tabId, task) {
  await chrome.tabs.sendMessage(tabId, { type: 'CAISHEN_TAOBAO_START', task });
}

async function pollOnce() {
  if (activeTask) return { ok: true, active: true };
  const task = await claimTask();
  if (!task) return { ok: true, claimed: false };
  await openPublishTab(task);
  return { ok: true, claimed: true, taskId: task.id };
}

async function handleMessage(message, sender) {
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_GET') {
    return { ok: true, options: await readOptions(), activeTask, activeTabId, ...(await chrome.storage.local.get(['lastError', 'lastErrorAt'])) };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_SAVE') {
    const options = await writeOptions(message.options || {});
    schedulePoll(options);
    if (options.enabled) pollOnce().catch(error => setLastError(error));
    return { ok: true, options };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_POLL') return pollOnce();
  if (message?.type === 'CAISHEN_TAOBAO_TRIGGER_POLL') return pollOnce();
  if (message?.type === 'CAISHEN_TAOBAO_FETCH_IMAGE') return { ok: true, image: await fetchTaskImage(message) };
  if (message?.type === 'CAISHEN_TAOBAO_CONTENT_READY') {
    if (activeTask && sender.tab?.id === activeTabId) await sendTaskToTab(sender.tab.id, activeTask);
    return { ok: true };
  }
  if (message?.type === 'CAISHEN_TAOBAO_STATUS') {
    await updateStatus(message.taskId || activeTask?.id, message.status, message.detail || {});
    if ([STATUS.saved, STATUS.failed].includes(message.status)) {
      await clearActiveTask();
    }
    return { ok: true };
  }
  return { ok: false, error: 'unknown message' };
}
