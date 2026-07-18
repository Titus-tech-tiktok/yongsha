const path = require('node:path');

const TAOBAO_CATEGORY_TEMPLATES = [
  ['sideboard', '餐边柜（储物柜）', '餐边柜'],
  ['corner-cabinet', '边角柜', '边角柜'],
  ['tv-cabinet', '电视柜', '电视柜'],
  ['nightstand', '床头柜', '床头柜'],
  ['wardrobe', '衣柜', '衣柜'],
  ['shoe-cabinet', '鞋柜', '鞋柜'],
  ['screen-cabinet', '屏风柜', '屏风柜'],
  ['drawer-cabinet', '斗柜', '斗柜'],
  ['coffee-table', '茶几', '茶几'],
  ['dressing-table', '梳妆台', '梳妆台'],
  ['coat-rack', '衣帽架', '衣帽架'],
  ['bookcase', '书柜', '书柜'],
  ['irregular', '异形产品', '异形产品'],
  ['dopamine-bauhaus', '多巴胺 包豪斯', '多巴胺 包豪斯']
].map(([id, name, product]) => ({
  id,
  name,
  product,
  defaults: {
    publishUrl: '',
    price: '',
    stock: '999',
    shipFrom: '',
    freightTemplate: '',
    serviceTemplate: '',
    attributes: {},
    selectors: {}
  }
}));

function templateById(id) {
  return TAOBAO_CATEGORY_TEMPLATES.find(item => item.id === id) || null;
}

function normalizedStatus(value) {
  return String(value || '').trim();
}

function isReviewReadyForTaobao(review = {}) {
  const jobs = Array.isArray(review.jobs) ? review.jobs : [];
  const actionable = jobs.filter(job => normalizedStatus(job.status) !== '已跳过' && job.action !== 'exclude');
  if (!actionable.length) return false;
  const progress = review.generationProgress || {};
  if (Number(progress.pending) > 0 || Number(progress.failed) > 0) return false;
  if (['queued', 'preparing', 'generating', 'auditing', 'running'].includes(String(progress.phase || ''))) return false;
  return actionable.every(job => {
    const status = normalizedStatus(job.status);
    return Boolean(job.outputUrl) && (status === '已通过' || status === '直接套模板');
  });
}

function taobaoReviewBlockers(review = {}) {
  const jobs = Array.isArray(review.jobs) ? review.jobs : [];
  const actionable = jobs.filter(job => normalizedStatus(job.status) !== '已跳过' && job.action !== 'exclude');
  const progress = review.generationProgress || {};
  const blockers = [];
  if (!actionable.length) blockers.push('没有可发布图片');
  if (Number(progress.pending) > 0 || Number(progress.failed) > 0 || ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(String(progress.phase || ''))) {
    blockers.push('仍有图片生成中或失败');
  }
  if (actionable.length && actionable.some(job => {
    const status = normalizedStatus(job.status);
    return !job.outputUrl || (status !== '已通过' && status !== '直接套模板');
  })) {
    blockers.push('仍有图片未人工通过');
  }
  return blockers;
}

function classifyTaobaoImages(jobs = []) {
  const result = { mainImages: [], ratioImages: [], detailImages: [] };
  for (const job of jobs) {
    if (!job?.outputUrl) continue;
    const relativePath = String(job.relativePath || '').replaceAll('\\', '/');
    const lower = relativePath.toLocaleLowerCase('zh-CN');
    const image = {
      relativePath,
      name: path.basename(relativePath),
      url: job.outputUrl,
      outputUrl: job.outputUrl,
      outputPath: job.outputPath || ''
    };
    if (lower.includes('3-4') || lower.includes('3:4') || lower.includes('3_4')) result.ratioImages.push(image);
    else if (lower.includes('详情') || lower.includes('detail')) result.detailImages.push(image);
    else result.mainImages.push(image);
  }
  return result;
}

function validateTaobaoImagePackage(images = {}) {
  const checks = [
    ['mainImages', '主图'],
    ['ratioImages', '3:4 主图'],
    ['detailImages', '详情页']
  ];
  const missing = checks
    .filter(([key]) => !Array.isArray(images[key]) || !images[key].length)
    .map(([, label]) => label);
  return { ok: missing.length === 0, missing };
}

module.exports = {
  TAOBAO_CATEGORY_TEMPLATES,
  classifyTaobaoImages,
  isReviewReadyForTaobao,
  taobaoReviewBlockers,
  validateTaobaoImagePackage,
  templateById
};
