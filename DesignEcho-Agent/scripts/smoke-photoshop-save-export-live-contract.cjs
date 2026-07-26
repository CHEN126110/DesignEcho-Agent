#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'smoke-photoshop-save-export-live.cjs');
const PACKAGE_PATH = path.join(ROOT, 'package.json');

function assertCondition(name, passed, details = {}) {
  if (!passed) {
    throw new Error(`${name} failed: ${JSON.stringify(details, null, 2)}`);
  }
}

function main() {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  const command = pkg.scripts?.['smoke:photoshop-save-export:production-live'] || '';

  assertCondition('production live package script exists', command.includes('--production-size'), {
    command
  });
  assertCondition('production-size flag is parsed by live smoke', source.includes('--production-size'));
  assertCondition('production mode uses detail-page-like tall canvas', source.includes('14525'));
  assertCondition('production output directory is separate from default output', source.includes('photoshop-save-export-production-live'));
  assertCondition('production mode is reported distinctly', source.includes("options.scenario = 'production-size'"));
  assertCondition('default smoke remains the standard scenario', source.includes("scenario: 'standard'"));
  assertCondition('disposable cleanup is still required', source.includes('cleanupDisposable(report, disposableDocumentId, originalDocumentId)'));

  console.log(JSON.stringify({
    outcome: 'pass',
    script: path.relative(ROOT, SCRIPT_PATH),
    packageScript: command
  }, null, 2));
}

main();
