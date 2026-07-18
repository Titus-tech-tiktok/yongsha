import { readOptions, writeOptions } from './shared.js';

const $ = selector => document.querySelector(selector);

async function load() {
  const options = await readOptions();
  $('#baseUrl').value = options.baseUrl;
  $('#token').value = options.token;
  $('#enabled').checked = options.enabled;
  $('#pollSeconds').value = options.pollSeconds;
  const state = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_GET' });
  $('#status').textContent = state?.activeTask
    ? `正在处理：${state.activeTask.name || state.activeTask.id}`
    : state?.lastError
      ? `最近错误：${state.lastError}`
      : '当前没有正在处理的任务';
}

async function save() {
  await writeOptions({
    baseUrl: $('#baseUrl').value,
    token: $('#token').value,
    enabled: $('#enabled').checked,
    pollSeconds: Number($('#pollSeconds').value)
  });
  await chrome.runtime.sendMessage({
    type: 'CAISHEN_TAOBAO_POPUP_SAVE',
    options: {
      baseUrl: $('#baseUrl').value,
      token: $('#token').value,
      enabled: $('#enabled').checked,
      pollSeconds: Number($('#pollSeconds').value)
    }
  });
  $('#status').textContent = '已保存';
}

async function poll() {
  $('#status').textContent = '正在领取任务...';
  const result = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_POLL' });
  $('#status').textContent = result?.claimed ? '已领取任务，正在打开淘宝页面' : '没有等待插件接收的任务';
}

$('#saveButton').addEventListener('click', () => save().catch(error => { $('#status').textContent = error.message; }));
$('#pollButton').addEventListener('click', () => poll().catch(error => { $('#status').textContent = error.message; }));
load().catch(error => { $('#status').textContent = error.message; });
