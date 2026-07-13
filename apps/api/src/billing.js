const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
const BILLING_TYPES = new Set(['image', 'llm']);
const BILLING_CURRENCY = 'USD';
const BILLING_SCALE = 1_000_000;
const LEGACY_CENT_TO_MICRO = 10_000;

function createBillingService(dataRoot) {
  const root = path.join(dataRoot, 'system');
  const rulesFile = path.join(root, 'billing-rules.json');
  const accountsFile = path.join(root, 'billing-accounts.json');
  const ledgerFile = path.join(root, 'billing-ledger.jsonl');
  let mutationChain = Promise.resolve();

  const defaultRules = () => ({
    version: 1,
    enabled: false,
    currency: BILLING_CURRENCY,
    amountScale: BILLING_SCALE,
    imageFeeMinor: 0,
    imageFeeMinMinor: 0,
    imageFeeMaxMinor: 0,
    llmFeeMinor: 0,
    llmFeeMinMinor: 0,
    llmFeeMaxMinor: 0,
    defaultBalanceMinor: 0,
    updatedAt: ''
  });

  function normalizeMinor(value, name, maximum = 1_000_000_000_000) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
      throw new Error(`${name}必须是有效的美元 6 位小数单位整数`);
    }
    return number;
  }

  function migrateMoney(value, sourceScale = BILLING_SCALE) {
    const number = Number(value) || 0;
    if (sourceScale === BILLING_SCALE) return Math.trunc(number);
    return Math.trunc(number * LEGACY_CENT_TO_MICRO);
  }

  function normalizeWorkspaceId(value) {
    const workspaceId = String(value || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workspaceId)) throw new Error('计费工作区无效');
    return workspaceId;
  }

  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch { return fallback; }
  }

  async function writeJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, file);
  }

  async function readRules() {
    const value = await readJson(rulesFile, {});
    const sourceScale = value?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
    const imageFee = Math.max(0, migrateMoney(value?.imageFeeMinor, sourceScale));
    const llmFee = Math.max(0, migrateMoney(value?.llmFeeMinor, sourceScale));
    const imageMin = Math.max(0, value?.imageFeeMinMinor === undefined ? imageFee : migrateMoney(value?.imageFeeMinMinor, sourceScale));
    const imageMax = Math.max(imageMin, value?.imageFeeMaxMinor === undefined ? (imageFee || imageMin) : migrateMoney(value?.imageFeeMaxMinor, sourceScale));
    const llmMin = Math.max(0, value?.llmFeeMinMinor === undefined ? llmFee : migrateMoney(value?.llmFeeMinMinor, sourceScale));
    const llmMax = Math.max(llmMin, value?.llmFeeMaxMinor === undefined ? (llmFee || llmMin) : migrateMoney(value?.llmFeeMaxMinor, sourceScale));
    return {
      ...defaultRules(),
      enabled: value?.enabled === true,
      currency: BILLING_CURRENCY,
      amountScale: BILLING_SCALE,
      imageFeeMinor: imageMax,
      imageFeeMinMinor: imageMin,
      imageFeeMaxMinor: imageMax,
      llmFeeMinor: llmMax,
      llmFeeMinMinor: llmMin,
      llmFeeMaxMinor: llmMax,
      defaultBalanceMinor: Math.max(0, migrateMoney(value?.defaultBalanceMinor, sourceScale)),
      updatedAt: String(value?.updatedAt || '')
    };
  }

  async function readAccounts() {
    const value = await readJson(accountsFile, { version: 1, accounts: {} });
    const sourceScale = value?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
    const accounts = value?.accounts && typeof value.accounts === 'object' ? value.accounts : {};
    if (sourceScale !== BILLING_SCALE) {
      for (const account of Object.values(accounts)) {
        if (!account || typeof account !== 'object') continue;
        account.balanceMinor = migrateMoney(account.balanceMinor, sourceScale);
        for (const reservation of Object.values(account.reservations || {})) {
          if (reservation && typeof reservation === 'object') reservation.amountMinor = migrateMoney(reservation.amountMinor, sourceScale);
        }
      }
    }
    return { version: 1, currency: BILLING_CURRENCY, amountScale: BILLING_SCALE, accounts };
  }

  function mutate(worker) {
    const operation = mutationChain.then(worker);
    mutationChain = operation.catch(() => {});
    return operation;
  }

  function cleanReservations(account, now = Date.now()) {
    account.reservations ||= {};
    for (const [id, reservation] of Object.entries(account.reservations)) {
      if (now - Number(reservation?.createdAt || 0) > RESERVATION_TTL_MS) delete account.reservations[id];
    }
  }

  function normalizeAccount(account, initialBalance = 0) {
    const value = account && typeof account === 'object' ? account : {};
    const existingBalance = Number(value.balanceMinor);
    value.balanceMinor = Number.isFinite(existingBalance) && existingBalance >= 0
      ? existingBalance
      : Math.max(0, Number(initialBalance) || 0);
    value.reservations = value.reservations && typeof value.reservations === 'object' ? value.reservations : {};
    value.createdAt ||= new Date().toISOString();
    value.updatedAt ||= value.createdAt;
    cleanReservations(value);
    return value;
  }

  function reservedMinor(account) {
    return Object.values(account.reservations || {}).reduce((total, item) => total + Math.max(0, Number(item?.amountMinor) || 0), 0);
  }

  function publicAccount(workspaceId, account) {
    const reserved = reservedMinor(account);
    return {
      workspaceId,
      balanceMinor: account.balanceMinor,
      reservedMinor: reserved,
      availableMinor: Math.max(0, account.balanceMinor - reserved),
      updatedAt: account.updatedAt || ''
    };
  }

  async function appendLedger(entry) {
    await fs.mkdir(root, { recursive: true });
    await fs.appendFile(ledgerFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async function ensureAccount(workspaceIdValue) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    return mutate(async () => {
      const [rules, state] = await Promise.all([readRules(), readAccounts()]);
      const existed = Boolean(state.accounts[workspaceId]);
      const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
      state.accounts[workspaceId] = account;
      if (!existed) await writeJson(accountsFile, state);
      return publicAccount(workspaceId, account);
    });
  }

  async function getSummary(workspaceIdValue, limit = 20) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    const [rules, account, transactions] = await Promise.all([
      readRules(),
      ensureAccount(workspaceId),
      listTransactions(workspaceId, limit)
    ]);
    return { rules, account, transactions };
  }

  async function saveRules(payload = {}) {
    return mutate(async () => {
      const imageMin = normalizeMinor(payload.imageFeeMinMinor ?? payload.imageFeeMinor, '成功生图最低单价');
      const imageMax = normalizeMinor(payload.imageFeeMaxMinor ?? payload.imageFeeMinor, '成功生图最高单价');
      const llmMin = normalizeMinor(payload.llmFeeMinMinor ?? payload.llmFeeMinor, '语言模型最低单价');
      const llmMax = normalizeMinor(payload.llmFeeMaxMinor ?? payload.llmFeeMinor, '语言模型最高单价');
      if (imageMax < imageMin) throw new Error('成功生图最高扣费不能低于最低扣费');
      if (llmMax < llmMin) throw new Error('语言模型最高扣费不能低于最低扣费');
      const rules = {
        ...defaultRules(),
        enabled: payload.enabled === true,
        imageFeeMinor: imageMax,
        imageFeeMinMinor: imageMin,
        imageFeeMaxMinor: imageMax,
        llmFeeMinor: llmMax,
        llmFeeMinMinor: llmMin,
        llmFeeMaxMinor: llmMax,
        defaultBalanceMinor: normalizeMinor(payload.defaultBalanceMinor, '新账号初始余额'),
        updatedAt: new Date().toISOString()
      };
      await writeJson(rulesFile, rules);
      return rules;
    });
  }

  async function listAccounts(workspaceIds = []) {
    const rules = await readRules();
    return mutate(async () => {
      const state = await readAccounts();
      let changed = false;
      const result = [];
      for (const value of workspaceIds) {
        const workspaceId = normalizeWorkspaceId(value);
        if (!state.accounts[workspaceId]) changed = true;
        const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
        state.accounts[workspaceId] = account;
        result.push(publicAccount(workspaceId, account));
      }
      if (changed) await writeJson(accountsFile, state);
      return result;
    });
  }

  async function adjustBalance(workspaceIdValue, amountMinorValue, metadata = {}) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    const amountMinor = Number(amountMinorValue);
    if (!Number.isSafeInteger(amountMinor) || amountMinor === 0 || Math.abs(amountMinor) > 1_000_000_000_000) {
      throw new Error('账户金额变更必须是非零的美元 6 位小数单位整数');
    }
    return mutate(async () => {
      const [rules, state] = await Promise.all([readRules(), readAccounts()]);
      const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
      const next = account.balanceMinor + amountMinor;
      if (next < 0) throw new Error('扣减金额不能超过当前余额');
      account.balanceMinor = next;
      account.updatedAt = new Date().toISOString();
      state.accounts[workspaceId] = account;
      const entry = {
        id: crypto.randomUUID(),
        workspaceId,
        kind: 'adjustment',
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor,
        balanceMinor: next,
        description: String(metadata.description || (amountMinor > 0 ? '账户充值到账' : '账户余额扣减')).slice(0, 160),
        operatorUserId: String(metadata.operatorUserId || '').slice(0, 80),
        createdAt: account.updatedAt
      };
      await writeJson(accountsFile, state);
      await appendLedger(entry);
      return { account: publicAccount(workspaceId, account), transaction: entry };
    });
  }

  async function reserve(workspaceIdValue, typeValue, metadata = {}) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    const type = String(typeValue || '');
    if (!BILLING_TYPES.has(type)) throw new Error('未知计费类型');
    return mutate(async () => {
      const rules = await readRules();
      const min = type === 'image' ? rules.imageFeeMinMinor : rules.llmFeeMinMinor;
      const max = type === 'image' ? rules.imageFeeMaxMinor : rules.llmFeeMaxMinor;
      const amountMinor = min === max ? min : min + crypto.randomInt(max - min + 1);
      if (!rules.enabled || amountMinor <= 0) return { billable: false, workspaceId, type, amountMinor: 0 };
      const state = await readAccounts();
      const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
      const available = account.balanceMinor - reservedMinor(account);
      if (available < amountMinor) {
        const required = (amountMinor / BILLING_SCALE).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00');
        const current = (Math.max(0, available) / BILLING_SCALE).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00');
        throw new Error(`账户余额不足：本次${type === 'image' ? '生图' : '模型分析'}需要 $${required}，当前可用 $${current}`);
      }
      const id = crypto.randomUUID();
      account.reservations[id] = {
        id,
        type,
        amountMinor,
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        description: String(metadata.description || (type === 'image' ? '图片生成' : '语言模型调用')).slice(0, 160),
        reference: String(metadata.reference || '').slice(0, 240),
        createdAt: Date.now()
      };
      account.updatedAt = new Date().toISOString();
      state.accounts[workspaceId] = account;
      await writeJson(accountsFile, state);
      return { billable: true, id, workspaceId, type, amountMinor };
    });
  }

  async function commit(reservation) {
    if (!reservation?.billable) return null;
    return mutate(async () => {
      const state = await readAccounts();
      const account = normalizeAccount(state.accounts[reservation.workspaceId]);
      const stored = account.reservations?.[reservation.id];
      if (!stored) return null;
      const amountMinor = Math.max(0, Number(stored.amountMinor) || 0);
      account.balanceMinor = Math.max(0, account.balanceMinor - amountMinor);
      delete account.reservations[reservation.id];
      account.updatedAt = new Date().toISOString();
      state.accounts[reservation.workspaceId] = account;
      const entry = {
        id: crypto.randomUUID(),
        workspaceId: reservation.workspaceId,
        kind: stored.type,
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor: -amountMinor,
        balanceMinor: account.balanceMinor,
        description: stored.description,
        reference: stored.reference,
        createdAt: account.updatedAt
      };
      await writeJson(accountsFile, state);
      await appendLedger(entry);
      return entry;
    });
  }

  async function release(reservation) {
    if (!reservation?.billable) return false;
    return mutate(async () => {
      const state = await readAccounts();
      const account = normalizeAccount(state.accounts[reservation.workspaceId]);
      if (!account.reservations?.[reservation.id]) return false;
      delete account.reservations[reservation.id];
      account.updatedAt = new Date().toISOString();
      state.accounts[reservation.workspaceId] = account;
      await writeJson(accountsFile, state);
      return true;
    });
  }

  async function transferBalance(fromWorkspaceIdValue, toWorkspaceIdValue, amountMinorValue, metadata = {}) {
    const fromWorkspaceId = normalizeWorkspaceId(fromWorkspaceIdValue);
    const toWorkspaceId = normalizeWorkspaceId(toWorkspaceIdValue);
    if (fromWorkspaceId === toWorkspaceId) throw new Error('不能给自己划拨余额');
    const amountMinor = normalizeMinor(amountMinorValue, '划拨金额');
    if (amountMinor <= 0) throw new Error('划拨金额必须大于 0');
    return mutate(async () => {
      const [rules, state] = await Promise.all([readRules(), readAccounts()]);
      const from = normalizeAccount(state.accounts[fromWorkspaceId], rules.defaultBalanceMinor);
      const to = normalizeAccount(state.accounts[toWorkspaceId], rules.defaultBalanceMinor);
      if (from.balanceMinor - reservedMinor(from) < amountMinor) throw new Error('管理员可用余额不足，无法划拨');
      const now = new Date().toISOString();
      from.balanceMinor -= amountMinor;
      to.balanceMinor += amountMinor;
      from.updatedAt = now;
      to.updatedAt = now;
      state.accounts[fromWorkspaceId] = from;
      state.accounts[toWorkspaceId] = to;
      const debit = {
        id: crypto.randomUUID(),
        workspaceId: fromWorkspaceId,
        kind: 'transfer',
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor: -amountMinor,
        balanceMinor: from.balanceMinor,
        description: String(metadata.debitDescription || metadata.description || '成员账户划拨').slice(0, 160),
        operatorUserId: String(metadata.operatorUserId || '').slice(0, 80),
        targetWorkspaceId: toWorkspaceId,
        createdAt: now
      };
      const credit = {
        id: crypto.randomUUID(),
        workspaceId: toWorkspaceId,
        kind: 'transfer',
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor,
        balanceMinor: to.balanceMinor,
        description: String(metadata.creditDescription || metadata.description || '账户充值到账').slice(0, 160),
        operatorUserId: String(metadata.operatorUserId || '').slice(0, 80),
        sourceWorkspaceId: fromWorkspaceId,
        createdAt: now
      };
      await writeJson(accountsFile, state);
      await appendLedger(debit);
      await appendLedger(credit);
      return {
        from: publicAccount(fromWorkspaceId, from),
        to: publicAccount(toWorkspaceId, to),
        transactions: [debit, credit]
      };
    });
  }

  async function listTransactions(workspaceIdValue = '', limitValue = 50) {
    const workspaceId = workspaceIdValue ? normalizeWorkspaceId(workspaceIdValue) : '';
    const limit = Math.max(1, Math.min(500, Number(limitValue) || 50));
    let text = '';
    try { text = await fs.readFile(ledgerFile, 'utf8'); } catch { return []; }
    const entries = text.trim().split('\n').filter(Boolean).reverse();
    const result = [];
    for (const line of entries) {
      try {
        const entry = JSON.parse(line);
        const sourceScale = entry?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
        if (sourceScale !== BILLING_SCALE) {
          entry.amountMinor = migrateMoney(entry.amountMinor, sourceScale);
          entry.balanceMinor = migrateMoney(entry.balanceMinor, sourceScale);
        }
        entry.currency = BILLING_CURRENCY;
        entry.amountScale = BILLING_SCALE;
        if (!workspaceId || entry.workspaceId === workspaceId) result.push(entry);
      } catch {}
      if (result.length >= limit) break;
    }
    return result;
  }

  async function clearTransactions() {
    let cleared = 0;
    try {
      const text = await fs.readFile(ledgerFile, 'utf8');
      cleared = text.trim().split('\n').filter(Boolean).length;
    } catch {}
    await fs.mkdir(path.dirname(ledgerFile), { recursive: true });
    await fs.writeFile(ledgerFile, '', 'utf8');
    return { cleared };
  }

  return {
    adjustBalance,
    clearTransactions,
    commit,
    ensureAccount,
    getRules: readRules,
    getSummary,
    listAccounts,
    listTransactions,
    release,
    reserve,
    saveRules,
    transferBalance
  };
}

module.exports = { createBillingService };
