'use strict';

const path = require('node:path');
const { isSameOrChildPath } = require('./path-utils');

function text(value) {
  return value == null ? '' : String(value).trim();
}

function matchKnownCategory(parts, knownCategories = []) {
  const categories = (knownCategories || []).map(text).filter(Boolean);
  for (const part of parts.map(text).filter(Boolean)) {
    const exact = categories.find(category => part.localeCompare(category, 'zh-CN', { sensitivity: 'accent' }) === 0);
    if (exact) return exact;
  }
  for (const part of parts.map(text).filter(Boolean)) {
    const contained = categories.find(category => part.includes(category) || category.includes(part));
    if (contained) return contained;
  }
  return '';
}

/** Mirrors MainWindow.GetTitleCategoryForReviewFolder. */
function getTitleCategoryForReviewFolder(options = {}) {
  const folder = text(options.folder);
  const templateFolderPath = text(options.templateFolderPath);
  const detailSetsPath = text(options.detailSetsPath);
  const directoryExists = typeof options.directoryExists === 'function'
    ? options.directoryExists
    : () => true;

  if (detailSetsPath && directoryExists(detailSetsPath) && templateFolderPath && isSameOrChildPath(detailSetsPath, templateFolderPath)) {
    const root = path.resolve(detailSetsPath);
    const full = path.resolve(templateFolderPath);
    const relative = root.toLocaleLowerCase('en-US') === full.toLocaleLowerCase('en-US')
      ? '.'
      : full.slice(root.length + path.sep.length);
    const parts = relative.split(/[\\/]+/).filter(Boolean);
    const known = matchKnownCategory(parts, options.knownCategories);
    if (known) return known;
    const first = parts.find(Boolean);
    if (first && first !== '.') return first;
  }

  const fallback = templateFolderPath
    ? path.basename(path.dirname(templateFolderPath) || templateFolderPath)
    : path.basename(folder);
  return matchKnownCategory([fallback, templateFolderPath, folder], options.knownCategories) || fallback;
}

/** Mirrors TitleGenerationState.Count++ and its PascalCase JSON shape. */
function advanceTitleGenerationState(value = {}, updatedAt = new Date()) {
  const countValue = value?.Count ?? value?.count;
  const count = Number.isFinite(Number(countValue)) ? Math.max(0, Math.trunc(Number(countValue))) + 1 : 1;
  const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  return {
    Count: count,
    UpdatedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
  };
}

function createTitleWorkbookRows(category, titles, generatedAt) {
  return [
    ['序号', '品类', '标题', '生成时间'],
    ...(titles || []).map((title, index) => [index + 1, text(category), String(title || ''), text(generatedAt)])
  ];
}

module.exports = {
  advanceTitleGenerationState,
  createTitleWorkbookRows,
  getTitleCategoryForReviewFolder,
  isSameOrChildPath
};
