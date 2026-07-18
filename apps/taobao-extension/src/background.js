import { DEFAULT_PUBLISH_URL, STATUS, apiFetch, readOptions, writeOptions } from './shared.js';

let activeTask = null;
let activeTabId = 0;

chrome.runtime.onInstalled.addListener(async () => {
  const options = await writeOptions({});
  chrome.alarms.create('poll-taobao-publish', { periodInMinutes: Math.max(1, options.pollSeconds / 60) });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'poll-taobao-publish') pollOnce().catch(error => setLastError(error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function setLastError(error) {
  await chrome.storage.local.set({ lastError: error?.message || String(error), lastErrorAt: new Date().toISOString() });
}

async function updateStatus(taskId, status, detail = {}) {
  const options = await readOptions();
  if (!taskId || !options.token) return;
  await apiFetch(`/api/taobao/publish/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ token: options.token, status, ...detail })
  });
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
    chrome.alarms.create('poll-taobao-publish', { periodInMinutes: Math.max(1, options.pollSeconds / 60) });
    return { ok: true, options };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_POLL') return pollOnce();
  if (message?.type === 'CAISHEN_TAOBAO_CONTENT_READY') {
    if (activeTask && sender.tab?.id === activeTabId) await sendTaskToTab(sender.tab.id, activeTask);
    return { ok: true };
  }
  if (message?.type === 'CAISHEN_TAOBAO_STATUS') {
    await updateStatus(message.taskId || activeTask?.id, message.status, message.detail || {});
    if ([STATUS.saved, STATUS.failed].includes(message.status)) {
      activeTask = null;
      activeTabId = 0;
    }
    return { ok: true };
  }
  return { ok: false, error: 'unknown message' };
}
