'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const TEMPLATE_CACHE_VERSION = 8;
const TEMPLATE_CACHE_FOLDER = '.caishen-template-cache';
const DEFAULT_FORBIDDEN_AREA = '背景、文字、尺寸线、墙面、地面、柜脚、把手、门缝、抽屉缝、抽屉内侧、柜门内侧、包装、道具等非留白家具表面区域';

function finiteNumber(value, fallback = 0) {
  if (typeof value === 'string' && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, minimum)));
}

function round(value, digits = 4) {
  return Number(finiteNumber(value).toFixed(digits));
}

/**
 * Mirrors TemplateReplaceRegion parsing in MainWindow.xaml.cs. Width and height
 * are clamped independently; final image-edge clipping happens in
 * regionToPixelRect, as it does in WPF's ToPixelRect.
 */
function normalizeRegion(value) {
  if (!value || typeof value !== 'object') return null;
  const width = finiteNumber(value.width ?? value.w);
  const height = finiteNumber(value.height ?? value.h);
  if (width <= 0 || height <= 0) return null;
  return {
    x: clamp(value.x, 0, 1),
    y: clamp(value.y, 0, 1),
    width: clamp(width, 0, 1),
    height: clamp(height, 0, 1)
  };
}

function normalizeRegions(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeRegion).filter(Boolean);
}

function formatRegionSummary(values, hasMask = false) {
  const regions = normalizeRegions(values);
  if (!regions.length) {
    return hasMask
      ? '已有画笔蒙版，但没有矩形外接区域。重新保存一次会自动补齐。'
      : '未框选区域。换印花图片必须先框选或画笔标出可换印花面板。';
  }
  const prefix = hasMask ? '已有画笔蒙版，' : '';
  const number = value => String(round(value, 3));
  return `${prefix}已标记 ${regions.length} 个区域：${regions.map((region, index) => (
    `${index + 1}. x=${number(region.x)}, y=${number(region.y)}, w=${number(region.width)}, h=${number(region.height)}`
  )).join('; ')}`;
}

function regionToPixelRect(regionValue, imageWidthValue, imageHeightValue) {
  const imageWidth = Math.max(1, finiteNumber(imageWidthValue, 1));
  const imageHeight = Math.max(1, finiteNumber(imageHeightValue, 1));
  const region = normalizeRegion(regionValue);
  if (!region) return { x: 0, y: 0, width: 0, height: 0 };

  const x = region.x * imageWidth;
  const y = region.y * imageHeight;
  let width = region.width * imageWidth;
  let height = region.height * imageHeight;
  if (x + width > imageWidth) width = imageWidth - x;
  if (y + height > imageHeight) height = imageHeight - y;
  return {
    x,
    y,
    width: Math.max(0, width),
    height: Math.max(0, height)
  };
}

function calculateDisplaySize(imageWidthValue, imageHeightValue, maxWidthValue = 980, maxHeightValue = 620) {
  const imageWidth = Math.max(1, finiteNumber(imageWidthValue, 1));
  const imageHeight = Math.max(1, finiteNumber(imageHeightValue, 1));
  const maxWidth = Math.max(1, finiteNumber(maxWidthValue, 980));
  const maxHeight = Math.max(1, finiteNumber(maxHeightValue, 620));
  const scale = Math.min(1, maxWidth / imageWidth, maxHeight / imageHeight);
  return {
    imageWidth,
    imageHeight,
    displayWidth: Math.max(1, imageWidth * scale),
    displayHeight: Math.max(1, imageHeight * scale),
    scale
  };
}

function displayPointToNormalized(point, displayWidthValue, displayHeightValue) {
  const displayWidth = Math.max(1, finiteNumber(displayWidthValue, 1));
  const displayHeight = Math.max(1, finiteNumber(displayHeightValue, 1));
  return {
    x: clamp(finiteNumber(point?.x) / displayWidth, 0, 1),
    y: clamp(finiteNumber(point?.y) / displayHeight, 0, 1)
  };
}

function normalizedPointToDisplay(point, displayWidthValue, displayHeightValue) {
  const displayWidth = Math.max(1, finiteNumber(displayWidthValue, 1));
  const displayHeight = Math.max(1, finiteNumber(displayHeightValue, 1));
  return {
    x: clamp(point?.x, 0, 1) * displayWidth,
    y: clamp(point?.y, 0, 1) * displayHeight
  };
}

/** WPF accepts a completed rectangle only when both display dimensions are at least 8 px. */
function displayRectToRegion(start, end, displayWidthValue, displayHeightValue, minimumDisplaySize = 8) {
  const displayWidth = Math.max(1, finiteNumber(displayWidthValue, 1));
  const displayHeight = Math.max(1, finiteNumber(displayHeightValue, 1));
  const left = clamp(Math.min(finiteNumber(start?.x), finiteNumber(end?.x)), 0, displayWidth);
  const top = clamp(Math.min(finiteNumber(start?.y), finiteNumber(end?.y)), 0, displayHeight);
  const right = clamp(Math.max(finiteNumber(start?.x), finiteNumber(end?.x)), 0, displayWidth);
  const bottom = clamp(Math.max(finiteNumber(start?.y), finiteNumber(end?.y)), 0, displayHeight);
  const width = right - left;
  const height = bottom - top;
  if (width < minimumDisplaySize || height < minimumDisplaySize) return null;
  return {
    x: left / displayWidth,
    y: top / displayHeight,
    width: width / displayWidth,
    height: height / displayHeight
  };
}

function normalizeMaskStroke(value) {
  if (!value || typeof value !== 'object') return null;
  const sizeRatio = finiteNumber(value.sizeRatio ?? value.size_ratio);
  if (sizeRatio <= 0) return null;
  return {
    x: clamp(value.x, 0, 1),
    y: clamp(value.y, 0, 1),
    sizeRatio,
    erase: value.erase === true
  };
}

function normalizeMaskStrokes(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeMaskStroke).filter(Boolean);
}

function createMaskStrokeFromDisplay(point, brushSizeValue, displayWidthValue, displayHeightValue, erase = false) {
  const displayWidth = Math.max(1, finiteNumber(displayWidthValue, 1));
  const displayHeight = Math.max(1, finiteNumber(displayHeightValue, 1));
  const parsedBrushSize = typeof brushSizeValue === 'string' && !brushSizeValue.trim()
    ? 28
    : Number(brushSizeValue);
  const brushSize = Number.isFinite(parsedBrushSize) ? clamp(parsedBrushSize, 6, 120) : 28;
  return {
    x: clamp(finiteNumber(point?.x) / displayWidth, 0, 1),
    y: clamp(finiteNumber(point?.y) / displayHeight, 0, 1),
    sizeRatio: brushSize / displayWidth,
    erase: Boolean(erase)
  };
}

function strokeToPixelCircle(strokeValue, imageWidthValue, imageHeightValue) {
  const imageWidth = Math.max(1, finiteNumber(imageWidthValue, 1));
  const imageHeight = Math.max(1, finiteNumber(imageHeightValue, 1));
  const stroke = normalizeMaskStroke(strokeValue);
  if (!stroke) return null;
  return {
    x: stroke.x * imageWidth,
    y: stroke.y * imageHeight,
    radius: Math.max(2, stroke.sizeRatio * imageWidth / 2),
    erase: stroke.erase
  };
}

/** Mirrors the WPF fallback used when the operator painted but created no rectangle. */
function boundingRegionFromAddStrokes(values) {
  const strokes = normalizeMaskStrokes(values).filter(stroke => !stroke.erase);
  if (!strokes.length) return null;
  const left = Math.min(...strokes.map(stroke => stroke.x - stroke.sizeRatio / 2));
  const top = Math.min(...strokes.map(stroke => stroke.y - stroke.sizeRatio / 2));
  const right = Math.max(...strokes.map(stroke => stroke.x + stroke.sizeRatio / 2));
  const bottom = Math.max(...strokes.map(stroke => stroke.y + stroke.sizeRatio / 2));
  return {
    x: clamp(left, 0, 1),
    y: clamp(top, 0, 1),
    width: clamp(right - left, 0.001, 1),
    height: clamp(bottom - top, 0.001, 1)
  };
}

function normalizeMaskData(value = {}) {
  let replaceRegions = normalizeRegions(value.replaceRegions ?? value.replace_regions ?? value.regions);
  const maskStrokes = normalizeMaskStrokes(value.maskStrokes ?? value.mask_strokes ?? value.strokes);
  if (!replaceRegions.length) {
    const strokeBounds = boundingRegionFromAddStrokes(maskStrokes);
    if (strokeBounds) replaceRegions = [strokeBounds];
  }
  return {
    version: TEMPLATE_CACHE_VERSION,
    replaceRegions,
    maskStrokes,
    keepExistingMask: value.keepExistingMask === true || value.keep_existing_mask === true
  };
}

function serializeMaskData(value, space = 2) {
  const normalized = normalizeMaskData(value);
  return JSON.stringify({
    version: TEMPLATE_CACHE_VERSION,
    replace_regions: normalized.replaceRegions.map(region => ({ ...region })),
    mask_strokes: normalized.maskStrokes.map(stroke => ({
      x: stroke.x,
      y: stroke.y,
      size_ratio: stroke.sizeRatio,
      erase: stroke.erase
    })),
    keep_existing_mask: normalized.keepExistingMask
  }, null, space);
}

function deserializeMaskData(value) {
  const parsed = typeof value === 'string' ? JSON.parse(extractJsonObject(value)) : value;
  return normalizeMaskData(parsed);
}

/**
 * Produces a renderer-neutral 8-bit mask. It follows SaveTemplateMask ordering:
 * optional previous mask, white rectangles, then additive/eraser brush dots.
 */
function rasterizeMask({ width: widthValue, height: heightValue, regions, strokes, existingMask, keepExistingMask = false }) {
  const width = Math.max(1, Math.trunc(finiteNumber(widthValue, 1)));
  const height = Math.max(1, Math.trunc(finiteNumber(heightValue, 1)));
  const pixelCount = width * height;
  const output = new Uint8Array(pixelCount);
  if (keepExistingMask && existingMask && existingMask.length === pixelCount) {
    for (let index = 0; index < pixelCount; index += 1) output[index] = existingMask[index] >= 96 ? 255 : 0;
  }

  for (const region of normalizeRegions(regions)) {
    const rect = regionToPixelRect(region, width, height);
    if (rect.width < 2 || rect.height < 2) continue;
    const startX = Math.max(0, Math.floor(rect.x));
    const startY = Math.max(0, Math.floor(rect.y));
    const endX = Math.min(width, Math.ceil(rect.x + rect.width));
    const endY = Math.min(height, Math.ceil(rect.y + rect.height));
    for (let y = startY; y < endY; y += 1) {
      output.fill(255, y * width + startX, y * width + endX);
    }
  }

  for (const stroke of normalizeMaskStrokes(strokes)) {
    const circle = strokeToPixelCircle(stroke, width, height);
    const startX = Math.max(0, Math.floor(circle.x - circle.radius));
    const endX = Math.min(width - 1, Math.ceil(circle.x + circle.radius));
    const startY = Math.max(0, Math.floor(circle.y - circle.radius));
    const endY = Math.min(height - 1, Math.ceil(circle.y + circle.radius));
    const radiusSquared = circle.radius * circle.radius;
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const dx = x - circle.x;
        const dy = y - circle.y;
        if (dx * dx + dy * dy <= radiusSquared) {
          output[y * width + x] = circle.erase ? 0 : 255;
        }
      }
    }
  }
  return output;
}

function maskChannelCount(maskPixels, width, height, requestedChannels) {
  if (requestedChannels === 1 || requestedChannels === 4) return requestedChannels;
  return maskPixels?.length >= width * height * 4 ? 4 : 1;
}

function maskPixelValue(maskPixels, pixelIndex, channels) {
  if (!maskPixels || pixelIndex < 0) return 0;
  if (channels === 1) return finiteNumber(maskPixels[pixelIndex]);
  const offset = pixelIndex * channels;
  return Math.max(
    finiteNumber(maskPixels[offset]),
    finiteNumber(maskPixels[offset + 1]),
    finiteNumber(maskPixels[offset + 2])
  );
}

function getMaskContentBounds(maskPixels, maskWidthValue, maskHeightValue, imageWidthValue = maskWidthValue, imageHeightValue = maskHeightValue, channelsValue) {
  const maskWidth = Math.max(1, Math.trunc(finiteNumber(maskWidthValue, 1)));
  const maskHeight = Math.max(1, Math.trunc(finiteNumber(maskHeightValue, 1)));
  const imageWidth = Math.max(1, finiteNumber(imageWidthValue, maskWidth));
  const imageHeight = Math.max(1, finiteNumber(imageHeightValue, maskHeight));
  const channels = maskChannelCount(maskPixels, maskWidth, maskHeight, channelsValue);
  let left = maskWidth;
  let top = maskHeight;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < maskHeight; y += 1) {
    for (let x = 0; x < maskWidth; x += 1) {
      if (maskPixelValue(maskPixels, y * maskWidth + x, channels) < 96) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  const scaleX = imageWidth / maskWidth;
  const scaleY = imageHeight / maskHeight;
  return {
    x: left * scaleX,
    y: top * scaleY,
    width: Math.max(1, (right - left + 1) * scaleX),
    height: Math.max(1, (bottom - top + 1) * scaleY)
  };
}

function maskBoundsToRegion(bounds, imageWidthValue, imageHeightValue) {
  if (!bounds) return null;
  const imageWidth = Math.max(1, finiteNumber(imageWidthValue, 1));
  const imageHeight = Math.max(1, finiteNumber(imageHeightValue, 1));
  return normalizeRegion({
    x: finiteNumber(bounds.x) / imageWidth,
    y: finiteNumber(bounds.y) / imageHeight,
    width: finiteNumber(bounds.width) / imageWidth,
    height: finiteNumber(bounds.height) / imageHeight
  });
}

function isLikelyLightFurniturePanel(rValue, gValue, bValue) {
  const r = clamp(rValue, 0, 255);
  const g = clamp(gValue, 0, 255);
  const b = clamp(bValue, 0, 255);
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const spread = maximum - minimum;
  if (luminance < 118 || maximum < 128) return false;
  return spread <= 68 || (luminance > 165 && spread <= 95);
}

function erodeMask(sourceValue, widthValue, heightValue, radiusValue) {
  const width = Math.max(1, Math.trunc(finiteNumber(widthValue, 1)));
  const height = Math.max(1, Math.trunc(finiteNumber(heightValue, 1)));
  const radius = Math.max(0, Math.trunc(finiteNumber(radiusValue)));
  const source = sourceValue || [];
  const result = new Uint8Array(width * height);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let keep = true;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (!source[(y + dy) * width + x + dx]) {
            keep = false;
            break;
          }
        }
      }
      result[y * width + x] = keep ? 1 : 0;
    }
  }
  return result;
}

function removeSmallMaskComponents(sourceValue, widthValue, heightValue, minimumAreaValue) {
  const width = Math.max(1, Math.trunc(finiteNumber(widthValue, 1)));
  const height = Math.max(1, Math.trunc(finiteNumber(heightValue, 1)));
  const minimumArea = Math.max(0, Math.trunc(finiteNumber(minimumAreaValue)));
  const source = sourceValue || [];
  const result = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const offsets = [-1, 1, -width, width];
  for (let index = 0; index < source.length; index += 1) {
    if (!source[index] || visited[index]) continue;
    const queue = [index];
    const component = [];
    visited[index] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);
      const x = current % width;
      for (const offset of offsets) {
        const next = current + offset;
        if (next < 0 || next >= source.length || visited[next] || !source[next]) continue;
        if ((offset === -1 && x === 0) || (offset === 1 && x === width - 1)) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (component.length < minimumArea) continue;
    for (const pixel of component) result[pixel] = 1;
  }
  return result;
}

// System.Math.Round(double) uses midpoint-to-even; JS Math.round does not.
function roundToEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * Math.max(1, Math.abs(value))) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

/**
 * Pure-data counterpart of EnsureCleanTemplateMask. Template pixels may be
 * canvas RGBA (default) or WPF-style BGRA. Returned mask is grayscale 0/255.
 */
function cleanTemplateMask({
  templatePixels,
  maskPixels,
  width: widthValue,
  height: heightValue,
  maskWidth: maskWidthValue = widthValue,
  maskHeight: maskHeightValue = heightValue,
  maskChannels,
  templatePixelFormat = 'rgba'
}) {
  const width = Math.max(1, Math.trunc(finiteNumber(widthValue, 1)));
  const height = Math.max(1, Math.trunc(finiteNumber(heightValue, 1)));
  const maskWidth = Math.max(1, Math.trunc(finiteNumber(maskWidthValue, width)));
  const maskHeight = Math.max(1, Math.trunc(finiteNumber(maskHeightValue, height)));
  if (!templatePixels || templatePixels.length < width * height * 4) {
    throw new RangeError('模板像素数据长度不足');
  }
  const channels = maskChannelCount(maskPixels, maskWidth, maskHeight, maskChannels);
  if (!maskPixels || maskPixels.length < maskWidth * maskHeight * channels) {
    throw new RangeError('蒙版像素数据长度不足');
  }

  const raw = new Uint8Array(width * height);
  const cleaned = new Uint8Array(width * height);
  let rawCount = 0;
  let cleanedCount = 0;
  for (let y = 0; y < height; y += 1) {
    const maskY = clamp(roundToEven(y * (maskHeight - 1) / Math.max(1, height - 1)), 0, maskHeight - 1);
    for (let x = 0; x < width; x += 1) {
      const maskX = clamp(roundToEven(x * (maskWidth - 1) / Math.max(1, width - 1)), 0, maskWidth - 1);
      if (maskPixelValue(maskPixels, maskY * maskWidth + maskX, channels) < 96) continue;
      const pixelIndex = y * width + x;
      raw[pixelIndex] = 1;
      rawCount += 1;

      const templateOffset = pixelIndex * 4;
      const isBgra = String(templatePixelFormat).toLowerCase() === 'bgra';
      const r = templatePixels[templateOffset + (isBgra ? 2 : 0)];
      const g = templatePixels[templateOffset + 1];
      const b = templatePixels[templateOffset + (isBgra ? 0 : 2)];
      if (isLikelyLightFurniturePanel(r, g, b)) {
        cleaned[pixelIndex] = 1;
        cleanedCount += 1;
      }
    }
  }

  if (rawCount === 0) {
    return { mask: new Uint8Array(width * height), rawCount, cleanedCount, usedLightPanelFilter: false };
  }
  const usedLightPanelFilter = cleanedCount >= Math.max(120, rawCount * 0.08);
  let result = usedLightPanelFilter ? cleaned : raw;
  result = erodeMask(result, width, height, 2);
  result = removeSmallMaskComponents(result, width, height, Math.max(80, Math.trunc(width * height / 8000)));
  const mask = Uint8Array.from(result, value => value ? 255 : 0);
  return { mask, rawCount, cleanedCount, usedLightPanelFilter };
}

function normalizeTemplateAction(value) {
  const action = String(value || '').trim().toLowerCase();
  if (action.includes('copy') || action.includes('复制')) return 'copy_template';
  if (action.includes('skip') || action.includes('跳过')) return 'skip_copy';
  if (action.includes('manual') || action.includes('人工') || action.includes('不确定')) return 'manual_check';
  return 'replace_print';
}

function normalizeGenerationAction(value) {
  const action = String(value || '').trim().toLowerCase();
  if (action.includes('skip') || action.includes('无效') || action.includes('跳过')) return 'skip_copy';
  if (action.includes('manual') || action.includes('人工') || action.includes('不确定')) return 'manual_check';
  if (action.includes('replace_print') || action.includes('generate_with_print') || action.includes('换印花') || action.includes('替换印花')) return 'replace_print';
  if (action.includes('copy') || action.includes('复制') || action.includes('信息页')) return 'copy_template';
  return 'replace_print';
}

function categoryForAction(action) {
  if (action === 'copy_template') return '纯文字信息页';
  if (action === 'skip_copy') return '装饰图';
  if (action === 'manual_check') return '不确定';
  return '商品场景图';
}

function isUncertainManualText(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return [
    '不确定',
    '无',
    '没有',
    '模板分析失败',
    '需要人工确认',
    'manual',
    'uncertain',
    'unknown',
    'none'
  ].some(token => text.includes(token));
}

function createManualTemplateAnalysis({ action: actionValue, reason = '', replaceArea = '', forbiddenArea = '', regions = [] } = {}) {
  const action = normalizeTemplateAction(actionValue);
  const needsManualCheck = action === 'manual_check';
  const manualReason = String(reason || '').trim();
  const manualReplaceArea = String(replaceArea || '').trim();
  const defaultReplaceArea = action === 'replace_print' ? '运营确认的留白家具面板或柜门外表面' : '无';
  const safeReplaceArea = action === 'replace_print' && isUncertainManualText(manualReplaceArea)
    ? defaultReplaceArea
    : manualReplaceArea || defaultReplaceArea;
  return {
    version: TEMPLATE_CACHE_VERSION,
    category: categoryForAction(action),
    action,
    generation_action: action,
    confidence: needsManualCheck ? 0.5 : 1,
    reason: String(reason || '').trim() || '运营手动筛选',
    replace_area: String(replaceArea || '').trim() || (action === 'replace_print' ? '运营确认的留白家具表面' : '无'),
    reason: manualReason || '运营手动筛选',
    replace_area: safeReplaceArea,
    replace_regions: normalizeRegions(regions).map(region => ({
      x: round(region.x),
      y: round(region.y),
      width: round(region.width),
      height: round(region.height)
    })),
    forbidden_area: String(forbiddenArea || '').trim() || DEFAULT_FORBIDDEN_AREA,
    view_state: '按模板原图保持',
    print_mapping: action === 'replace_print' ? '把一张完整印花按模板留白家具表面等比例贴合，不平铺、不重复主视觉' : '无',
    handle_door_rule: '保持模板的开门、开抽屉、背面和遮挡状态；只处理可见留白外表面',
    drawer_or_door_state: '按模板原图保持',
    risk_points: ['运营手动筛选结果优先于AI分析'],
    instruction: action === 'replace_print'
      ? '按 replace_area 描述把原始印花完整贴到留白家具表面，其他区域保持模板原图。'
      : action === 'copy_template'
        ? '直接复制模板图，不调用生图。'
        : action === 'skip_copy'
          ? '跳过或复制该模板图，不调用生图。'
          : '需要人工进一步确认后再生成。',
    needs_manual_check: needsManualCheck
  };
}

function createFallbackTemplateAnalysis() {
  return {
    version: 6,
    category: '不确定',
    action: 'manual_check',
    generation_action: 'manual_check',
    confidence: 0,
    reason: '模板分析失败，需要人工确认',
    replace_area: '不确定',
    replace_regions: [],
    forbidden_area: '背景、文字、墙面、地面、柜脚、把手、抽屉内侧、柜门内侧、包装、留白等非可印花面板区域',
    drawer_or_door_state: '无',
    risk_points: ['模板未成功分析，不能自动生成'],
    instruction: '请人工确认可替换印花区域后再生成。',
    needs_manual_check: true
  };
}

function extractJsonObject(content) {
  const text = String(content ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function deserializeTemplateAnalysis(value) {
  if (value && typeof value === 'object') return value;
  const parsed = JSON.parse(extractJsonObject(value));
  if (typeof parsed?.analysis === 'string' && !parsed.action && !parsed.generation_action) {
    return deserializeTemplateAnalysis(parsed.analysis);
  }
  return parsed;
}

function serializeTemplateAnalysis(value, space = 2) {
  const parsed = typeof value === 'string' ? deserializeTemplateAnalysis(value) : value;
  return JSON.stringify(parsed, null, space);
}

function getJsonString(object, ...names) {
  for (const name of names) {
    const value = object?.[name];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function getJsonNumber(object, name, fallback) {
  const value = object?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTemplateAnalysisSummary(value) {
  try {
    const root = deserializeTemplateAnalysis(value);
    const action = getJsonString(root, 'action', 'generation_action') || 'manual_check';
    return {
      action: normalizeTemplateAction(action),
      confidence: getJsonNumber(root, 'confidence', 0),
      reason: getJsonString(root, 'reason'),
      replaceArea: getJsonString(root, 'replace_area'),
      forbiddenArea: getJsonString(root, 'forbidden_area'),
      regions: normalizeRegions(root.replace_regions)
    };
  } catch {
    return {
      action: 'manual_check',
      confidence: 0,
      reason: '分析结果不可读，请人工确认。',
      replaceArea: '',
      forbiddenArea: '',
      regions: []
    };
  }
}

function includesAny(value, ...needles) {
  const text = String(value || '');
  return needles.some(needle => text.includes(needle));
}

function inferGenerationAction(text, needsMaster = true) {
  if (!needsMaster) return 'copy_template';
  if (includesAny(text, '纯装饰', '横幅', '品牌底图', '无效', '不需要生成', '无法迁移')) return 'skip_copy';
  if (includesAny(text, '包装运输', '包装', '运输', '安装售后', '售后', '买家须知', '纯文字', '信息页')) return 'copy_template';
  return 'replace_print';
}

function resolveGenerationAction(value) {
  let root;
  try {
    root = deserializeTemplateAnalysis(value);
  } catch {
    return inferGenerationAction(value, true);
  }

  const confidence = getJsonNumber(root, 'confidence', 1);
  if (root.needs_manual_check === true || confidence < 0.75) return 'manual_check';
  const action = getJsonString(root, 'action', 'generation_action');
  if (action.trim()) return normalizeGenerationAction(action);
  const category = getJsonString(root, 'category', 'template_purpose', 'template_type');
  const needsMaster = root.needs_master_product === undefined || root.needs_master_product === true;
  return inferGenerationAction(category, needsMaster);
}

/** Cross-platform equivalent of WPF SafeMetadataName, using Windows' invalid-name superset. */
function safeMetadataName(relativePathValue) {
  let value = String(relativePathValue || '');
  const lastSeparator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const lastDot = value.lastIndexOf('.');
  if (lastDot > lastSeparator) value = value.slice(0, lastDot);
  value = value
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  return value.trim() ? value : 'template';
}

function templateCachePaths(templateRoot, relativeTemplatePath) {
  const cacheFolder = path.join(templateRoot, TEMPLATE_CACHE_FOLDER);
  const name = safeMetadataName(relativeTemplatePath);
  return {
    cacheFolder,
    analysisFile: path.join(cacheFolder, `${name}.template-analysis.json`),
    maskFile: path.join(cacheFolder, `${name}.replace-mask.png`),
    cleanMaskFile: path.join(cacheFolder, `${name}.clean-mask.png`)
  };
}

/** Formats Date or Unix nanoseconds like DateTime.UtcNow.ToString("O"). */
function formatDotNetUtc(value = new Date()) {
  if (typeof value === 'bigint') {
    let seconds = value / 1_000_000_000n;
    let nanoseconds = value % 1_000_000_000n;
    if (nanoseconds < 0) {
      seconds -= 1n;
      nanoseconds += 1_000_000_000n;
    }
    const stem = new Date(Number(seconds) * 1000).toISOString().slice(0, 19);
    const fraction = String(nanoseconds / 100n).padStart(7, '0');
    return `${stem}.${fraction}Z`;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('无效的 UTC 时间');
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$10000Z');
}

async function getTemplateFileSignature(templateImagePath) {
  let stat;
  try {
    stat = await fs.stat(templateImagePath, { bigint: true });
  } catch (error) {
    if (error?.code !== 'ERR_INVALID_ARG_VALUE' && error?.code !== 'ERR_INVALID_ARG_TYPE') throw error;
    stat = await fs.stat(templateImagePath);
  }
  const length = typeof stat.size === 'bigint' ? Number(stat.size) : stat.size;
  const templateLastWriteUtc = typeof stat.mtimeNs === 'bigint'
    ? formatDotNetUtc(stat.mtimeNs)
    : formatDotNetUtc(stat.mtime);
  return { length, templateLastWriteUtc };
}

function analysisToString(analysis) {
  return typeof analysis === 'string' ? analysis : serializeTemplateAnalysis(analysis);
}

function buildTemplateAnalysisCache({
  relativeTemplatePath = '',
  signature,
  analysis,
  manualOverride = false,
  version = TEMPLATE_CACHE_VERSION,
  now = new Date()
}) {
  if (!signature || !Number.isFinite(Number(signature.length)) || !signature.templateLastWriteUtc) {
    throw new TypeError('缺少模板文件签名');
  }
  return {
    version,
    template_relative_path: String(relativeTemplatePath || ''),
    template_last_write_utc: String(signature.templateLastWriteUtc),
    template_length: Number(signature.length),
    updated_at: formatDotNetUtc(now),
    manual_override: Boolean(manualOverride),
    analysis: analysisToString(analysis)
  };
}

async function writeTemplateAnalysisCache({
  cacheFile,
  templateRoot,
  templateImagePath,
  relativeTemplatePath,
  analysis,
  manualOverride = false,
  now = new Date()
}) {
  if (!templateImagePath) throw new TypeError('缺少模板图片路径');
  const relativePath = relativeTemplatePath || path.basename(templateImagePath);
  const root = templateRoot || path.dirname(templateImagePath);
  const outputFile = cacheFile || templateCachePaths(root, relativePath).analysisFile;
  const signature = await getTemplateFileSignature(templateImagePath);
  const payload = buildTemplateAnalysisCache({
    relativeTemplatePath: relativePath,
    signature,
    analysis,
    manualOverride,
    now
  });
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(payload, null, 2), 'utf8');
  return { cacheFile: outputFile, payload };
}

function cacheField(cache, snakeName, camelName) {
  return cache?.[snakeName] ?? cache?.[camelName];
}

async function readTemplateAnalysisCache({ cacheFile, templateImagePath }) {
  if (!cacheFile || !templateImagePath) {
    return { valid: false, analysis: '', reason: 'missing-path', cache: null };
  }

  let text;
  try {
    text = await fs.readFile(cacheFile, 'utf8');
  } catch (error) {
    return { valid: false, analysis: '', reason: error?.code === 'ENOENT' ? 'cache-not-found' : 'cache-read-failed', cache: null };
  }

  let cache;
  try {
    cache = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { valid: false, analysis: '', reason: 'invalid-json', cache: null };
  }

  const analysis = cache?.analysis;
  if (typeof analysis !== 'string') {
    return { valid: false, analysis: '', reason: 'missing-analysis', cache };
  }

  let signature;
  try {
    signature = await getTemplateFileSignature(templateImagePath);
  } catch (error) {
    return { valid: false, analysis: '', reason: error?.code === 'ENOENT' ? 'template-not-found' : 'template-stat-failed', cache };
  }

  const cachedLength = Number(cacheField(cache, 'template_length', 'templateLength'));
  const cachedLastWrite = String(cacheField(cache, 'template_last_write_utc', 'templateLastWriteUtc') || '');
  if (cachedLength !== signature.length || cachedLastWrite.toLowerCase() !== signature.templateLastWriteUtc.toLowerCase()) {
    return { valid: false, analysis: '', reason: 'template-signature-mismatch', cache };
  }

  const version = Number(cache.version) || 0;
  const manualOverride = cacheField(cache, 'manual_override', 'manualOverride') === true;
  const looksManual = analysis.toLowerCase().includes('运营手动筛选') || analysis.toLowerCase().includes('运营手动确认');
  if (version < TEMPLATE_CACHE_VERSION && !manualOverride && !looksManual) {
    return { valid: false, analysis: '', reason: 'unsupported-cache-version', cache };
  }
  return { valid: true, analysis, reason: 'ok', cache };
}

async function readValidTemplateAnalysisCache(options) {
  const result = await readTemplateAnalysisCache(options);
  return result.valid ? result.analysis : '';
}

module.exports = {
  DEFAULT_FORBIDDEN_AREA,
  TEMPLATE_CACHE_FOLDER,
  TEMPLATE_CACHE_VERSION,
  boundingRegionFromAddStrokes,
  buildTemplateAnalysisCache,
  calculateDisplaySize,
  cleanTemplateMask,
  createFallbackTemplateAnalysis,
  createManualTemplateAnalysis,
  createMaskStrokeFromDisplay,
  deserializeMaskData,
  deserializeTemplateAnalysis,
  displayPointToNormalized,
  displayRectToRegion,
  extractJsonObject,
  formatDotNetUtc,
  formatRegionSummary,
  getMaskContentBounds,
  getTemplateFileSignature,
  inferGenerationAction,
  normalizeGenerationAction,
  normalizeMaskData,
  normalizeMaskStroke,
  normalizeMaskStrokes,
  normalizeRegion,
  normalizeRegions,
  normalizeTemplateAction,
  normalizedPointToDisplay,
  parseTemplateAnalysisSummary,
  rasterizeMask,
  readTemplateAnalysisCache,
  readValidTemplateAnalysisCache,
  removeSmallMaskComponents,
  regionToPixelRect,
  resolveGenerationAction,
  safeMetadataName,
  serializeMaskData,
  serializeTemplateAnalysis,
  strokeToPixelCircle,
  templateCachePaths,
  erodeMask,
  isLikelyLightFurniturePanel,
  maskBoundsToRegion,
  writeTemplateAnalysisCache
};
