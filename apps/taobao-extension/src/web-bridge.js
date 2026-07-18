window.addEventListener('message', event => {
  if (event.source !== window) return;
  if (event.data?.type !== 'CAISHEN_TAOBAO_WEB_TRIGGER') return;
  chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_TRIGGER_POLL' }).catch(() => {});
});
