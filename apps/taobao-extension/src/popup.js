import { DEFAULT_BASE_URL, readOptions, writeOptions } from './shared.js';

const $ = selector => document.querySelector(selector);

function showStatus(text) {
  $('#status').textContent = text;
}

async function refreshToken() {
  showStatus('正在自动读取令牌...');
  const result = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_REFRESH_TOKEN' });
  if (!result?.ok) throw new Error(result?.error || '自动读取令牌失败');
  $('#token').value = result.options?.token || '';
  $('#pollSeconds').value = result.options?.pollSeconds || 12;
  showStatus('令牌已自动读取');
  return result.options;
}

async function load() {
  $('#fixedBaseUrl').textContent = DEFAULT_BASE_URL;
  const options = await readOptions();
  $('#token').value = options.token;
  $('#enabled').checked = options.enabled;
  $('#pollSeconds').value = options.pollSeconds;
  if (options.token) {
    showStatus('令牌已由 Web 端自动同步');
  } else {
    try {
      await refreshToken();
    } catch (error) {
      showStatus(`自动读取失败：${error.message}，可手动粘贴令牌保存`);
    }
  }
  const state = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_GET' });
  if (state?.activeTask) showStatus(`正在处理：${state.activeTask.name || state.activeTask.id}`);
  else if (!options.token && state?.lastError) showStatus(`最近错误：${state.lastError}`);
}

async function save() {
  await writeOptions({
    token: $('#token').value,
    enabled: $('#enabled').checked,
    pollSeconds: Number($('#pollSeconds').value)
  });
  await chrome.runtime.sendMessage({
    type: 'CAISHEN_TAOBAO_POPUP_SAVE',
    options: {
      token: $('#token').value,
      enabled: $('#enabled').checked,
      pollSeconds: Number($('#pollSeconds').value)
    }
  });
  showStatus('已保存备用令牌');
}

async function poll() {
  showStatus('正在领取任务...');
  const result = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_POLL' });
  showStatus(result?.claimed ? '已领取任务，正在打开淘宝页面' : '没有等待插件接收的任务');
}

async function diagnostics() {
  showStatus('正在读取当前淘宝页诊断...');
  const result = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_DIAGNOSTICS' });
  if (!result?.ok) throw new Error(result?.error || '读取诊断失败');
  $('#diagnosticsOutput').hidden = false;
  $('#diagnosticsOutput').textContent = JSON.stringify(result.detail || {}, null, 2);
  $('#copyDiagnosticsButton').hidden = false;
  showStatus('诊断已读取，可复制到 Web 端模板配置');
}

async function copyDiagnostics() {
  const content = $('#diagnosticsOutput').textContent || '';
  if (!content.trim()) throw new Error('暂无可复制的诊断');
  await navigator.clipboard.writeText(content);
  showStatus('诊断 JSON 已复制');
}

$('#refreshTokenButton').addEventListener('click', () => refreshToken().catch(error => showStatus(error.message)));
$('#saveButton').addEventListener('click', () => save().catch(error => showStatus(error.message)));
$('#pollButton').addEventListener('click', () => poll().catch(error => showStatus(error.message)));
$('#diagnosticsButton').addEventListener('click', () => diagnostics().catch(error => showStatus(error.message)));
$('#copyDiagnosticsButton').addEventListener('click', () => copyDiagnostics().catch(error => showStatus(error.message)));
load().catch(error => showStatus(error.message));
