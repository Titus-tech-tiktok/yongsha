export const DEFAULT_BASE_URL = 'http://127.0.0.1:3008';
export const DEFAULT_PUBLISH_URL = 'https://item.upload.taobao.com/sell/ai/category.htm';

export const STATUS = {
  accepted: '插件已接收',
  opening: '正在打开淘宝页面',
  filling: '正在填写字段',
  uploading: '正在上传图片',
  saving: '正在保存草稿',
  saved: '已保存草稿',
  failed: '失败'
};

export async function readOptions() {
  const saved = await chrome.storage.local.get(['baseUrl', 'token', 'enabled', 'pollSeconds']);
  return {
    baseUrl: String(saved.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    token: String(saved.token || ''),
    enabled: saved.enabled !== false,
    pollSeconds: Math.max(5, Math.min(120, Number(saved.pollSeconds || 12)))
  };
}

export async function writeOptions(options = {}) {
  const current = await readOptions();
  const next = {
    ...current,
    ...options,
    baseUrl: String(options.baseUrl || current.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    token: String(options.token ?? current.token ?? ''),
    enabled: options.enabled ?? current.enabled,
    pollSeconds: Math.max(5, Math.min(120, Number(options.pollSeconds || current.pollSeconds || 12)))
  };
  await chrome.storage.local.set(next);
  return next;
}

export async function apiFetch(path, init = {}) {
  const options = await readOptions();
  const response = await fetch(`${options.baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.data;
}
