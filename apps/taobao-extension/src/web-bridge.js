window.addEventListener('message', event => {
  if (event.source !== window) return;
  if (!['CAISHEN_TAOBAO_WEB_SYNC', 'CAISHEN_TAOBAO_WEB_TRIGGER'].includes(event.data?.type)) return;
  const token = String(event.data.token || '');
  const options = { token, enabled: true };
  chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_POPUP_SAVE', options })
    .then(() => {
      if (event.data.type === 'CAISHEN_TAOBAO_WEB_TRIGGER') return chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_TRIGGER_POLL' });
      return null;
    })
    .catch(() => {});
});
