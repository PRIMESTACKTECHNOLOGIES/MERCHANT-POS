'use strict';
// Patches semver/functions/truncate.js which is missing in some Node 24 installs.
const fs   = require('fs');
const path = require('path');

const target = path.join(__dirname, 'backend', 'node_modules', 'semver', 'functions', 'truncate.js');

if (fs.existsSync(target)) {
  process.stdout.write('[semver] truncate.js already exists - skipping.\n');
  process.exit(0);
}

const content = [
  "'use strict'",
  "const parse = require('./parse')",
  "const truncate = (version, type) => {",
  "  const parsed = parse(version)",
  "  if (!parsed) return null",
  "  if (type === 'major') return String(parsed.major)",
  "  if (type === 'minor') return parsed.major + '.' + parsed.minor",
  "  return parsed.major + '.' + parsed.minor + '.' + parsed.patch",
  "}",
  "module.exports = truncate",
  ""
].join('\n');

fs.writeFileSync(target, content, 'utf8');
process.stdout.write('[semver] truncate.js patched successfully.\n');
