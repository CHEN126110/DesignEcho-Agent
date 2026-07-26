#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'smoke-detail-page-template-live-case.cjs');
const PACKAGE_PATH = path.join(ROOT, 'package.json');

function assertCondition(name, passed, details = {}) {
  if (!passed) {
    throw new Error(`${name} failed: ${JSON.stringify(details, null, 2)}`);
  }
}

function main() {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  const command = pkg.scripts?.['smoke:detail-page:template-export-live-case'] || '';

  assertCondition('export live package script exists', command.includes('--export-smoke'), {
    command
  });
  assertCondition('export smoke is explicit only', source.includes('--export-smoke'));
  assertCondition('template live case uses batchExport for export smoke', source.includes("callPhotoshopTool('batchExport'"));
  assertCondition('export smoke writes under template-validation exports', source.includes("path.join(OUT_DIR, 'exports')"));
  assertCondition('export smoke records file evidence before cleanup', source.includes('assertExportFileExists'));
  assertCondition('export smoke cleanup is explicit', source.includes('cleanupExportArtifacts'));
  assertCondition('explicit template open failure is fatal', source.includes('Template open failed before parse'));
  assertCondition('template document cleanup remains in finally', source.includes('await cleanupOpenedTemplate(report)'));

  console.log(JSON.stringify({
    outcome: 'pass',
    script: path.relative(ROOT, SCRIPT_PATH),
    packageScript: command
  }, null, 2));
}

main();
