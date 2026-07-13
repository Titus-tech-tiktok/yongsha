const path = require('node:path');

const FORBIDDEN_MATERIAL_ROOTS = ['实木', '黄花梨', '人工木', '岩板', '玻璃', '金属', '不锈钢', '竹', '藤'];
const CORE_SYNONYM_HINTS = ['储物', '置物', '边柜', '收纳', '柜子', '餐边'];
const FALLBACK_ROOTS = [
  '家用', '客厅', '厨房', '落地', '靠墙', '大容量', '收纳', '置物', '储物', '新款',
  '高级感', '小户型', '轻奢', '中古风', '法式', '一体', '柜', '款', '家'
];

function field(value, camelName) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, camelName)) return value[camelName];
  const pascalName = camelName[0].toUpperCase() + camelName.slice(1);
  return value[pascalName];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value == null ? '' : String(value);
}

function ordinalIgnoreCaseKey(value) {
  return text(value).toUpperCase();
}

function equalsIgnoreCase(left, right) {
  return ordinalIgnoreCaseKey(left) === ordinalIgnoreCaseKey(right);
}

function containsIgnoreCase(value, search) {
  return ordinalIgnoreCaseKey(value).includes(ordinalIgnoreCaseKey(search));
}

function distinctIgnoreCase(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = ordinalIgnoreCaseKey(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function normalizeHeader(value) {
  return text(value).replace(/\s+/g, '').trim();
}

function normalizeTitleText(value) {
  return text(value).replace(/[\s,，。；;、|/\\]+/g, '').trim();
}

function splitTitleRoots(value) {
  return distinctIgnoreCase(text(value)
    .split(/[、,，/\s]+/)
    .map(root => root.trim())
    .filter(Boolean));
}

function parseTitlePrefixRoots(value) {
  const values = Array.isArray(value) ? value : text(value).split(/[\s,，、;；/\\|]+/);
  return distinctIgnoreCase(values.map(normalizeTitleText).filter(Boolean));
}

function findHeaderIndex(headers, candidates) {
  for (let index = 0; index < headers.length; index += 1) {
    if (candidates.some(candidate => containsIgnoreCase(headers[index], candidate))) return index;
  }
  return -1;
}

function parseTitleNumber(value) {
  const normalized = text(value).trim().replace(/%+$/, '');
  let result = Number(normalized);
  if (!Number.isFinite(result) && /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(normalized)) {
    result = Number(normalized.replaceAll(',', ''));
  }
  return Number.isFinite(result) ? result : 0;
}

function guessTitleCategoryFromExcel(fileName, sheetName) {
  if (text(sheetName).trim() && !text(sheetName).trim().toUpperCase().startsWith('SHEET')) {
    return text(sheetName).trim();
  }

  const name = path.basename(text(fileName), path.extname(text(fileName)));
  const match = name.match(/关键词数据[_\- ]*(?<category>.+?)([_\- ]*\d{8}.*)?$/);
  return match?.groups?.category?.replace(/^[_\- ]+|[_\- ]+$/g, '') || name;
}

function parseTitleKeywordRows(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Excel 表为空。');
  }

  const headers = asArray(rows[0]).map(normalizeHeader);
  const keywordIndex = findHeaderIndex(headers, ['关键词', '关键字', '词']);
  if (keywordIndex < 0) throw new Error('没有找到关键词列。');

  const searchIndex = findHeaderIndex(headers, ['搜索指数', '搜索人气', '搜索量']);
  const clickIndex = findHeaderIndex(headers, ['点击率']);
  const conversionIndex = findHeaderIndex(headers, ['支付转化率', '转化率', '成交转化率']);
  const rootsIndex = findHeaderIndex(headers, ['词根拆分', '词根', '分词']);
  const records = [];

  for (const rawRow of rows.slice(1)) {
    const row = asArray(rawRow);
    const keyword = text(row[keywordIndex]);
    if (!keyword.trim()) continue;
    const rootsText = rootsIndex >= 0 ? text(row[rootsIndex]) : '';
    records.push({
      keyword: keyword.trim(),
      searchIndex: parseTitleNumber(searchIndex >= 0 ? row[searchIndex] : ''),
      clickRate: parseTitleNumber(clickIndex >= 0 ? row[clickIndex] : ''),
      conversionRate: parseTitleNumber(conversionIndex >= 0 ? row[conversionIndex] : ''),
      roots: splitTitleRoots(rootsText.trim() ? rootsText : keyword)
    });
  }

  const fileName = text(options.fileName || options.sourceFileName);
  return {
    categoryName: guessTitleCategoryFromExcel(fileName, options.sheetName),
    prefixRoot: '',
    prefixRoots: [],
    requiredRoots: [],
    sourceFileName: path.basename(fileName),
    importedAt: options.importedAt || new Date().toISOString(),
    records
  };
}

function recordScore(record) {
  return parseTitleNumber(field(record, 'searchIndex')) * 0.6
    + parseTitleNumber(field(record, 'clickRate')) * 200
    + parseTitleNumber(field(record, 'conversionRate')) * 500;
}

function libraryRecords(library) {
  return asArray(field(library, 'records'));
}

function getRequiredRoots(library) {
  return asArray(field(library, 'requiredRoots'));
}

function getTitlePrefixRoots(library) {
  if (!library) return [];
  const roots = asArray(field(library, 'prefixRoots')).map(normalizeTitleText).filter(Boolean);
  const legacyRoot = normalizeTitleText(field(library, 'prefixRoot'));
  if (roots.length === 0 && legacyRoot) roots.push(legacyRoot);
  return distinctIgnoreCase(roots);
}

function getTitlePrefixRootForVariant(prefixRoots, variantIndex) {
  const roots = parseTitlePrefixRoots(prefixRoots);
  if (roots.length === 0) return '';
  const index = Number.isFinite(Number(variantIndex)) ? Math.trunc(Number(variantIndex)) : 1;
  return roots[Math.abs(index - 1) % roots.length];
}

function getTitleRootCandidates(library) {
  const grouped = new Map();
  let insertionIndex = 0;
  for (const record of libraryRecords(library)) {
    const roots = asArray(field(record, 'roots'));
    const candidates = roots.length === 0 ? splitTitleRoots(field(record, 'keyword')) : roots;
    const score = recordScore(record);
    for (const candidate of candidates) {
      const root = normalizeTitleText(candidate);
      if (!root) continue;
      const key = ordinalIgnoreCaseKey(root);
      const existing = grouped.get(key);
      if (existing) {
        existing.score = Math.max(existing.score, score);
      } else {
        grouped.set(key, { root, score, insertionIndex: insertionIndex++ });
      }
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.score - left.score || left.insertionIndex - right.insertionIndex)
    .map(item => item.root);
}

function mergeImportedTitleLibrary(importedLibrary, existingLibrary) {
  const merged = { ...(importedLibrary || {}) };
  const existingPrefixRoots = getTitlePrefixRoots(existingLibrary);
  if (existingPrefixRoots.length > 0 && getTitlePrefixRoots(merged).length === 0) {
    merged.prefixRoots = existingPrefixRoots;
    merged.prefixRoot = existingPrefixRoots[0] || '';
  }

  const candidateKeys = new Set(getTitleRootCandidates(merged).map(ordinalIgnoreCaseKey));
  merged.requiredRoots = getRequiredRoots(existingLibrary)
    .filter(root => candidateKeys.has(ordinalIgnoreCaseKey(root)));
  return merged;
}

function generateTaobaoTitle(category, library, profile = {}, variantIndex = 1) {
  const material = text(field(profile, 'material'));
  const notes = text(field(profile, 'notes'));
  const dimensions = text(field(profile, 'dimensions'));
  const selected = [];

  function addRoot(value) {
    const root = normalizeTitleText(value);
    if (!root) return;
    if (selected.some(existing => containsIgnoreCase(existing, root) || containsIgnoreCase(root, existing))) return;
    if (selected.join('').length + root.length > 30) return;
    selected.push(root);
  }

  addRoot(category);
  for (const root of splitTitleRoots(material)) addRoot(root);
  for (const root of splitTitleRoots(notes)) addRoot(root);

  const requiredRoots = distinctIgnoreCase(getRequiredRoots(library)
    .map(normalizeTitleText)
    .filter(Boolean));
  const normalizedVariantIndex = Number.isFinite(Number(variantIndex)) ? Math.trunc(Number(variantIndex)) : 1;
  const requiredOffset = requiredRoots.length === 0 ? 0 : Math.abs(normalizedVariantIndex - 1) % requiredRoots.length;
  const rotatedRequiredRoots = requiredRoots.slice(requiredOffset).concat(requiredRoots.slice(0, requiredOffset));
  for (const root of rotatedRequiredRoots) {
    if (selected.join('').length + root.length <= 30) addRoot(root);
  }

  const groupedRoots = new Map();
  let insertionIndex = 0;
  for (const record of libraryRecords(library)) {
    for (const rawRoot of asArray(field(record, 'roots'))) {
      const root = text(rawRoot);
      const isUnsupportedMaterial = FORBIDDEN_MATERIAL_ROOTS.some(materialRoot => (
        containsIgnoreCase(root, materialRoot)
        && !containsIgnoreCase(material, materialRoot)
        && !containsIgnoreCase(notes, materialRoot)
      ));
      if (isUnsupportedMaterial) continue;
      const key = ordinalIgnoreCaseKey(root);
      const score = recordScore(record);
      const existing = groupedRoots.get(key);
      if (existing) {
        existing.score = Math.max(existing.score, score);
      } else {
        groupedRoots.set(key, { root, score, insertionIndex: insertionIndex++ });
      }
    }
  }

  const roots = [...groupedRoots.values()]
    .sort((left, right) => right.score - left.score || left.insertionIndex - right.insertionIndex);
  const coreRoots = distinctIgnoreCase(roots
    .filter(item => !equalsIgnoreCase(item.root, category)
      && CORE_SYNONYM_HINTS.some(hint => containsIgnoreCase(item.root, hint)))
    .map(item => item.root));
  const coreKeys = new Set(coreRoots.map(ordinalIgnoreCaseKey));
  const optionalRoots = roots
    .map(item => item.root)
    .filter(root => !equalsIgnoreCase(root, category) && !coreKeys.has(ordinalIgnoreCaseKey(root)));

  const coreOffset = coreRoots.length === 0 ? 0 : Math.abs(normalizedVariantIndex - 1) % coreRoots.length;
  const coreTake = Math.min(coreRoots.length, normalizedVariantIndex % 3 === 0 ? 1 : 2);
  const rotatedCoreRoots = coreRoots.slice(coreOffset).concat(coreRoots.slice(0, coreOffset)).slice(0, coreTake);
  const optionalOffset = optionalRoots.length === 0 ? 0 : Math.abs(normalizedVariantIndex - 1) % optionalRoots.length;
  const rotatedRoots = rotatedCoreRoots.concat(optionalRoots.slice(optionalOffset), optionalRoots.slice(0, optionalOffset));

  for (const root of rotatedRoots) {
    if (selected.join('').length >= 30) break;
    addRoot(root);
  }

  if (dimensions.trim()) {
    const compactDimensions = dimensions.replace(/\s+/g, '');
    if (compactDimensions.length <= 16) addRoot(compactDimensions);
  }

  let title = selected.join('');
  if (title.length < 30) {
    const fillRoots = distinctIgnoreCase(optionalRoots
      .concat(coreRoots)
      .concat(libraryRecords(library).map(record => field(record, 'keyword')))
      .concat(FALLBACK_ROOTS)
      .map(normalizeTitleText)
      .filter(Boolean))
      .map((root, index) => ({ root, index }))
      .sort((left, right) => right.root.length - left.root.length || left.index - right.index)
      .map(item => item.root);
    const fillOffset = fillRoots.length === 0 ? 0 : Math.abs(normalizedVariantIndex - 1) % fillRoots.length;
    const rotatedFillRoots = fillRoots.slice(fillOffset).concat(fillRoots.slice(0, fillOffset));
    let madeProgress = true;
    while (title.length < 30 && madeProgress) {
      madeProgress = false;
      for (const root of rotatedFillRoots) {
        if (title.length >= 30) break;
        if (containsIgnoreCase(title, root) || title.length + root.length > 30) continue;
        title += root;
        madeProgress = true;
      }
    }
  }

  return title;
}

function parseGenerationCount(value) {
  let count;
  if (typeof value === 'number' && Number.isInteger(value)) {
    count = value;
  } else if (/^[+-]?\d+$/.test(text(value).trim())) {
    count = Number(text(value).trim());
  } else {
    count = 30;
  }
  return Math.max(1, Math.min(200, count));
}

function generateStandaloneTitles(options = {}) {
  const library = options.library || {};
  if (libraryRecords(library).length === 0) throw new Error('请先导入关键词表。');
  const prefixRoots = parseTitlePrefixRoots(options.prefixRoots ?? getTitlePrefixRoots(library));
  if (prefixRoots.length === 0) throw new Error('请先填写至少一个标题开头词根。');

  const count = parseGenerationCount(options.count);
  const startVariantIndex = Number.isInteger(options.startVariantIndex) && options.startVariantIndex > 0
    ? options.startVariantIndex
    : 1;
  const titles = [];
  const titleKeys = new Set();
  let lastVariantIndex = startVariantIndex + count - 1;

  function addVariant(index) {
    const category = getTitlePrefixRootForVariant(prefixRoots, index);
    const title = generateTaobaoTitle(category, library, options.profile || {}, index);
    const key = ordinalIgnoreCaseKey(title);
    if (!titleKeys.has(key)) {
      titleKeys.add(key);
      titles.push(title);
    }
  }

  for (let offset = 0; offset < count; offset += 1) addVariant(startVariantIndex + offset);
  let nextIndex = startVariantIndex + count;
  while (titles.length < count && nextIndex < startVariantIndex + count + 500) {
    addVariant(nextIndex);
    lastVariantIndex = nextIndex;
    nextIndex += 1;
  }

  return {
    titles,
    lastVariantIndex,
    nextVariantIndex: lastVariantIndex + 1
  };
}

function generateTitlesFromFlatKeywords(prefixValue, keywordValue, countValue, requiredValue = '', options = {}) {
  const prefixRoots = parseTitlePrefixRoots(prefixValue);
  if (prefixRoots.length === 0) throw new Error('至少填写一个标题开头词根');
  const keywords = parseTitlePrefixRoots(keywordValue);
  if (keywords.length === 0) throw new Error('至少填写一个关键词');
  const records = keywords.map((keyword, index) => ({
    keyword,
    searchIndex: (keywords.length - index) * 1000,
    clickRate: 0,
    conversionRate: 0,
    roots: [keyword]
  }));
  const library = {
    requiredRoots: parseTitlePrefixRoots(requiredValue),
    records
  };
  return generateStandaloneTitles({
    prefixRoots,
    count: countValue,
    startVariantIndex: options.startVariantIndex || 1,
    profile: options.profile || {},
    library
  }).titles;
}

module.exports = {
  generateStandaloneTitles,
  generateTaobaoTitle,
  generateTitlesFromFlatKeywords,
  getTitlePrefixRootForVariant,
  getTitlePrefixRoots,
  getTitleRootCandidates,
  guessTitleCategoryFromExcel,
  mergeImportedTitleLibrary,
  normalizeHeader,
  normalizeTitleText,
  parseTitleKeywordRows,
  parseTitleNumber,
  parseTitlePrefixRoots,
  splitTitleRoots
};
