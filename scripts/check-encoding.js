#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const repoRoot = path.resolve(__dirname, '..');

// Keep the scan intentionally focused on repository-owned source text. This
// avoids spending time in generated dependencies while still catching the
// files agents are likely to edit by hand.
const scanRoots = [
  '.',
  '.github',
  'docs',
  'e2e',
  'scripts',
  'src',
  'tests'
];

const skipDirs = new Set([
  '.git',
  '.kiro',
  '.gemini',
  '.claude',
  '.firebase',
  'db',
  'node_modules',
  'test-results'
]);

const skipFiles = new Set([
  '.env',
  'package-lock.json'
]);

const textExtensions = new Set([
  '.css',
  '.env',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.sh',
  '.txt',
  '.yaml',
  '.yml'
]);

const extensionlessTextFiles = new Set([
  '.dockerignore',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  'Dockerfile'
]);

// These character clusters are common when UTF-8 Japanese was decoded as a
// Windows legacy code page and then saved back as text. The list is deliberately
// conservative; ordinary Japanese text should not contain these clusters often.
const mojibakeClusters = [
  '\u7e5d',
  '\u7e3a',
  '\u83a8',
  '\u8b41',
  '\u879f',
  '\u873f',
  '\u9015',
  '\u96b4',
  '\u90a8',
  '\u9ae2',
  '\u9b06',
  '\u9a55',
  '\u86f9',
  '\u8c3f',
  '\u8b92',
  '\u8815',
  '\u83a0',
  '\u77e9',
  '\u9e78',
  '\u7e32',
  '\uff82\uff67'
];
const mojibakePattern = new RegExp(mojibakeClusters.join('|'), 'u');

const decoder = new TextDecoder('utf-8', { fatal: true });
const errors = [];
const warnings = [];
let scanned = 0;

function toRepoPath(absPath) {
  return path.relative(repoRoot, absPath).replace(/\\/g, '/');
}

function shouldSkipDir(absPath) {
  return skipDirs.has(path.basename(absPath));
}

function isTextFile(absPath) {
  const rel = toRepoPath(absPath);
  if (skipFiles.has(rel) || skipFiles.has(path.basename(absPath))) return false;
  const base = path.basename(absPath);
  const ext = path.extname(absPath).toLowerCase();
  return textExtensions.has(ext) || extensionlessTextFiles.has(base);
}

function walk(absPath) {
  if (!fs.existsSync(absPath)) return [];
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    if (shouldSkipDir(absPath)) return [];
    return fs.readdirSync(absPath, { withFileTypes: true })
      .flatMap((entry) => walk(path.join(absPath, entry.name)));
  }
  return isTextFile(absPath) ? [absPath] : [];
}

function lineInfo(text, index) {
  const before = text.slice(0, index);
  const line = before.split(/\n/).length;
  const lastNewline = before.lastIndexOf('\n');
  const column = index - lastNewline;
  const lineText = text.split(/\n/)[line - 1] || '';
  return {
    line,
    column,
    snippet: lineText.trim().slice(0, 180)
  };
}

function checkFile(absPath) {
  const rel = toRepoPath(absPath);
  const bytes = fs.readFileSync(absPath);
  if (bytes.length === 0) return;
  scanned += 1;

  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    errors.push(`${rel}: UTF-16 BOM detected. Convert to UTF-8.`);
    return;
  }

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    warnings.push(`${rel}: UTF-8 BOM detected. Prefer UTF-8 without BOM for new files.`);
  }

  let text;
  try {
    text = decoder.decode(bytes);
  } catch (error) {
    errors.push(`${rel}: invalid UTF-8 (${error.message})`);
    return;
  }

  const match = mojibakePattern.exec(text);
  if (match) {
    const info = lineInfo(text, match.index);
    errors.push(`${rel}:${info.line}:${info.column}: possible mojibake "${match[0]}" in "${info.snippet}"`);
  }
}

const files = [...new Set(scanRoots.flatMap((root) => walk(path.join(repoRoot, root))))].sort();
files.forEach(checkFile);

warnings.forEach((message) => console.warn(`encoding warning: ${message}`));

if (errors.length > 0) {
  errors.forEach((message) => console.error(`encoding error: ${message}`));
  console.error(`Encoding check failed: ${errors.length} error(s), ${warnings.length} warning(s), ${scanned} file(s) scanned.`);
  process.exit(1);
}

console.log(`Encoding check passed: ${scanned} file(s) scanned, ${warnings.length} warning(s).`);
