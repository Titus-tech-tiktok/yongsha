'use strict';

const path = require('node:path');

function comparablePath(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function isSameOrChildPath(rootPath, candidatePath) {
  const root = comparablePath(rootPath);
  const candidate = comparablePath(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveInside(rootPath, relativePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(root, String(relativePath || ''));
  if (!isSameOrChildPath(root, candidate)) throw new Error('相对路径无效');
  return candidate;
}

module.exports = {
  comparablePath,
  isSameOrChildPath,
  resolveInside
};
