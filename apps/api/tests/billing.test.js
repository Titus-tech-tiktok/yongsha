const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBillingService } = require('../src/billing');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-billing-'));
  return { root, billing: createBillingService(root) };
}

test('计费关闭时不占用也不扣除余额', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await billing.ensureAccount('local');
  const reservation = await billing.reserve('local', 'image', { description: '测试生图' });
  await billing.commit(reservation);
  const after = await billing.getSummary('local');
  assert.equal(reservation.billable, false);
  assert.equal(after.account.balanceMinor, before.balanceMinor);
  assert.equal(after.transactions.length, 0);
});

test('成功调用按规则扣费并写入流水', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true, imageFeeMinor: 125, llmFeeMinor: 8, defaultBalanceMinor: 1000 });
  assert.equal((await billing.ensureAccount('user-one')).balanceMinor, 1000);
  const reservation = await billing.reserve('user-one', 'image', { description: '套图换印花生图', reference: '1.jpg' });
  assert.equal((await billing.getSummary('user-one')).account.availableMinor, 875);
  await billing.commit(reservation);
  const summary = await billing.getSummary('user-one');
  assert.equal(summary.account.balanceMinor, 875);
  assert.equal(summary.account.reservedMinor, 0);
  assert.equal(summary.transactions[0].kind, 'image');
  assert.equal(summary.transactions[0].amountMinor, -125);
  assert.equal(summary.transactions[0].reference, '1.jpg');
});

test('同一业务计费 key 只在首次成功时扣费', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true, imageFeeMinor: 125, llmFeeMinor: 8, defaultBalanceMinor: 1000 });
  const first = await billing.reserve('user-once', 'image', { description: '套图换印花生图', reference: '1.jpg', onceKey: 'task-a/1.jpg' });
  await billing.commit(first);
  const second = await billing.reserve('user-once', 'image', { description: '套图图片重新生成', reference: '1.jpg', onceKey: 'task-a/1.jpg' });
  await billing.commit(second);
  const summary = await billing.getSummary('user-once');
  assert.equal(first.billable, true);
  assert.equal(second.billable, false);
  assert.equal(second.alreadyCharged, true);
  assert.equal(summary.account.balanceMinor, 875);
  assert.equal(summary.transactions.filter(entry => entry.kind === 'image').length, 1);
});

test('成功调用按区间随机扣费并预占同一金额', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true, imageFeeMinMinor: 120, imageFeeMaxMinor: 150, llmFeeMinMinor: 3, llmFeeMaxMinor: 5, defaultBalanceMinor: 1000 });
  const reservation = await billing.reserve('user-random', 'image', { description: '随机生图' });
  assert.equal(reservation.billable, true);
  assert.ok(reservation.amountMinor >= 120 && reservation.amountMinor <= 150);
  await billing.commit(reservation);
  const summary = await billing.getSummary('user-random');
  assert.equal(summary.account.balanceMinor, 1000 - reservation.amountMinor);
  assert.equal(summary.transactions[0].amountMinor, -reservation.amountMinor);
});

test('失败调用释放预占且不产生扣费流水', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true, imageFeeMinor: 100, llmFeeMinor: 20, defaultBalanceMinor: 200 });
  const reservation = await billing.reserve('user-two', 'llm');
  assert.equal((await billing.getSummary('user-two')).account.availableMinor, 180);
  await billing.release(reservation);
  const summary = await billing.getSummary('user-two');
  assert.equal(summary.account.balanceMinor, 200);
  assert.equal(summary.account.availableMinor, 200);
  assert.equal(summary.transactions.length, 0);
});

test('余额不足时在调用上游前拒绝', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true, imageFeeMinor: 101, llmFeeMinor: 1, defaultBalanceMinor: 100 });
  await assert.rejects(() => billing.reserve('user-three', 'image'), /余额不足/);
});

test('管理员可充值和扣减但不能扣成负数', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.ensureAccount('user-four');
  await billing.adjustBalance('user-four', 500, { operatorUserId: 'admin' });
  await billing.adjustBalance('user-four', -120, { operatorUserId: 'admin' });
  assert.equal((await billing.getSummary('user-four')).account.balanceMinor, 380);
  await assert.rejects(() => billing.adjustBalance('user-four', -381), /不能超过当前余额/);
});

test('管理员划拨只能正向从自己余额转给成员', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.adjustBalance('admin-workspace', 1000);
  await billing.transferBalance('admin-workspace', 'member-workspace', 250, { operatorUserId: 'admin' });
  assert.equal((await billing.getSummary('admin-workspace')).account.balanceMinor, 750);
  assert.equal((await billing.getSummary('member-workspace')).account.balanceMinor, 250);
  await assert.rejects(() => billing.transferBalance('admin-workspace', 'member-workspace', -1), /必须是有效/);
  await assert.rejects(() => billing.transferBalance('admin-workspace', 'member-workspace', 751), /可用余额不足/);
});

test('默认余额只在首次建立账户时发放一次', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: false, imageFeeMinor: 0, llmFeeMinor: 0, defaultBalanceMinor: 100 });
  await billing.ensureAccount('user-five');
  await billing.adjustBalance('user-five', -100);
  await billing.saveRules({ enabled: false, imageFeeMinor: 0, llmFeeMinor: 0, defaultBalanceMinor: 500 });
  assert.equal((await billing.ensureAccount('user-five')).balanceMinor, 0);
});

test('清空费用流水只删除明细，不改变账号余额', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.adjustBalance('user-clear', 500, { operatorUserId: 'superadmin' });
  assert.equal((await billing.listTransactions('', 10)).length, 1);

  const result = await billing.clearTransactions();

  assert.equal(result.cleared, 1);
  assert.equal((await billing.listTransactions('', 10)).length, 0);
  assert.equal((await billing.getSummary('user-clear')).account.balanceMinor, 500);
});

test('spend totals only include successful model charges', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true, imageFeeMinor: 100, llmFeeMinor: 20, defaultBalanceMinor: 1000 });
  await billing.adjustBalance('user-total', 500, { operatorUserId: 'admin' });
  await billing.commit(await billing.reserve('user-total', 'image', { reference: 'img' }));
  await billing.commit(await billing.reserve('user-total', 'llm', { reference: 'text' }));

  const summary = await billing.getSummary('user-total');

  assert.equal(summary.spendTotals['1'], 120);
  assert.equal(summary.spendTotals['7'], 120);
  assert.equal(summary.spendTotals['30'], 120);
});
