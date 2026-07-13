'use strict';

const path = require('node:path');
const { isSameOrChildPath } = require('./path-utils');

function text(value) {
  return value == null ? '' : String(value).trim();
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
    const first = relative.split(/[\\/]+/).find(Boolean);
    if (first && first !== '.') return first;
  }

  return templateFolderPath
    ? path.basename(path.dirname(templateFolderPath) || templateFolderPath)
    : path.basename(folder);
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
