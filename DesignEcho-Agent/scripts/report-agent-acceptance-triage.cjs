#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  formatAgentAcceptanceTriageCasesMarkdown
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-triage-report.ts'));

const DEFAULT_REPORT = path.resolve(__dirname, '..', 'tmp', 'acceptance', 'agent-desktop-acceptance-smoke.json');

function resolveReportPath(rawPath) {
  if (!rawPath || rawPath.startsWith('--')) return DEFAULT_REPORT;
  return path.resolve(process.cwd(), rawPath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Acceptance report JSON not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeCases(report) {
  if (Array.isArray(report?.cases)) return report.cases;
  if (report?.acceptanceTriage && report?.report) {
    return [{
      id: report.report.caseId || report.bundle?.caseId || 'unknown',
      status: report.report.status,
      summary: report.report.summary || '',
      acceptanceTriage: report.acceptanceTriage
    }];
  }
  return [];
}

function buildCommandReport(reportPath) {
  const report = readJson(reportPath);
  const cases = normalizeCases(report);
  return {
    reportPath,
    caseCount: cases.length,
    markdown: formatAgentAcceptanceTriageCasesMarkdown(cases)
  };
}

function main() {
  const args = process.argv.slice(2);
  const reportPath = resolveReportPath(args.find((arg) => !arg.startsWith('--')));
  const result = buildCommandReport(reportPath);

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.markdown);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
