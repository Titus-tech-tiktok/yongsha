window.addEventListener('message', event => {
  if (event.source !== window) return;
  if (event.data?.type !== 'CAISHEN_TAOBAO_WEB_TRIGGER') return;
  const baseUrl = String(event.data.baseUrl || `${location.protocol}//${location.host}`).replace(/\/+$/, '');
  const token = String(event.data.token || '');
  const options = { baseUrl, token, enabled: true };
  chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_SAVE', options })
    .then(() => chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_TRIGGER_POLL' }))
    .catch(() => {});
});
