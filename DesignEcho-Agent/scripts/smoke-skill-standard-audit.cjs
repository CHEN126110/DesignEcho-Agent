const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const auditScriptPath = path.join(root, 'scripts', 'audit-skill-standard.cjs');
const standardDocPath = path.join(root, 'docs', 'skill-standard.md');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(root, 'tsconfig.main.json')
});

const {
  findSkillRoutingIntent
} = require(path.join(root, 'src', 'shared', 'skill-routing.ts'));

function fail(message, details = {}) {
  console.error(JSON.stringify({ success: false, message, details }, null, 2));
  process.exit(1);
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    fail('audit script produced empty stdout');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('audit script stdout is not valid JSON', { stdout: text, error: error.message });
  }
}

if (!fs.existsSync(standardDocPath)) {
  fail('skill standard document is missing', { standardDocPath });
}

const standardDoc = fs.readFileSync(standardDocPath, 'utf8');
const requiredDocMarkers = [
  'DesignEcho Skill Standard',
  '什么时候用',
  '什么时候不用',
  '前置证据',
  '触发评估',
  '真实结果验收',
  '反模式'
];
const missingDocMarkers = requiredDocMarkers.filter((marker) => !standardDoc.includes(marker));
if (missingDocMarkers.length > 0) {
  fail('skill standard document is missing required sections', { missingDocMarkers });
}

if (!fs.existsSync(auditScriptPath)) {
  fail('skill standard audit script is missing', { auditScriptPath });
}

const result = spawnSync(process.execPath, [auditScriptPath], {
  cwd: root,
  encoding: 'utf8'
});

if (result.status !== 0) {
  fail('skill standard audit script failed', {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  });
}

const payload = parseJsonFromStdout(result.stdout);
if (!payload.success) {
  fail('skill standard audit reported blockers', payload);
}

if (!payload.summary || payload.summary.totalSkills < 10) {
  fail('skill standard audit summary is incomplete', { summary: payload.summary });
}

if (payload.summary.warningCount !== 0 || payload.summary.warningCases !== 0) {
  fail('skill standard audit still has warnings', {
    warningCount: payload.summary.warningCount,
    warningCases: payload.summary.warningCases,
    warningSkillIds: (payload.cases || [])
      .filter((item) => Array.isArray(item.warnings) && item.warnings.length > 0)
      .map((item) => item.id)
  });
}

const casesById = new Map((payload.cases || []).map((item) => [item.id, item]));
const protectedSkillIds = ['main-image-design', 'detail-page-design', 'sku-batch'];
const missingProtectedCases = protectedSkillIds.filter((id) => !casesById.has(id));
if (missingProtectedCases.length > 0) {
  fail('skill standard audit did not inspect protected business skills', { missingProtectedCases });
}

const failedProtectedCases = protectedSkillIds
  .map((id) => casesById.get(id))
  .filter((item) => item.status !== 'pass');
if (failedProtectedCases.length > 0) {
  fail('protected business skills failed standard audit', { failedProtectedCases });
}

const routingCases = [
  {
    name: 'smart-layout-direct-layout-operation',
    input: '把产品居中并缩放到合适比例',
    expectedSkillId: 'smart-layout'
  },
  {
    name: 'sku-config-color-export-operation',
    input: '帮我导出 SKU 颜色配置',
    expectedSkillId: 'sku-config'
  },
  {
    name: 'visual-analysis-single-image-inspection',
    input: '分析这个海报的构图',
    expectedSkillId: 'visual-analysis'
  },
  {
    name: 'reference-search-stays-reference-search',
    input: '找一些极简运动风参考图',
    expectedSkillId: 'design-reference-search'
  },
  {
    name: 'layout-replication-stays-layout-replication',
    input: '按这张图复刻布局',
    expectedSkillId: 'layout-replication'
  },
  {
    name: 'sku-production-stays-sku-batch',
    input: '帮我批量做 SKU',
    expectedSkillId: 'sku-batch'
  }
];

const failedRoutingCases = routingCases
  .map((testCase) => ({
    ...testCase,
    actualSkillId: findSkillRoutingIntent(testCase.input)?.skillId
  }))
  .filter((testCase) => testCase.actualSkillId !== testCase.expectedSkillId);

if (failedRoutingCases.length > 0) {
  fail('skill standard routing governance cases failed', { failedRoutingCases });
}

const report = payload.report || {};
for (const reportPath of [report.json, report.md]) {
  if (!reportPath || !fs.existsSync(reportPath)) {
    fail('skill standard audit report is missing', { report });
  }
}

console.log(JSON.stringify({
  success: true,
  summary: payload.summary,
  report: payload.report
}, null, 2));
