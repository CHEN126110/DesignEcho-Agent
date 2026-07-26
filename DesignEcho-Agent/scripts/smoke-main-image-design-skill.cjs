const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  MAIN_IMAGE_SIZE_SPECS,
  MAIN_IMAGE_DEFAULT_SIZE_KEYS,
  buildMainImageFallbackLayout,
  buildMainImageSizeExecutionPlan,
  chooseMainImageLayoutCandidate,
  buildMainImageExecutionSummary,
  resolveMainImageSizeKeys
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-skills', 'main-image-design.skill.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

try {
  const fallback = buildMainImageFallbackLayout(
    { width: 1200, height: 1000 },
    { width: 800, height: 600 },
    0.65,
    -0.03
  );
  record('fallback-layout', Number.isFinite(fallback.scale) && fallback.scale > 0 && Number.isFinite(fallback.targetX) && Number.isFinite(fallback.targetY), fallback);

  const candidate = chooseMainImageLayoutCandidate(
    fallback,
    { width: 1200, height: 1000 },
    { width: 800, height: 600 },
    0.65,
    -0.03
  );
  record('layout-candidate', candidate.score >= 0 && candidate.score <= 100 && typeof candidate.reason === 'string' && candidate.reason.length > 0, candidate);

  const summary = buildMainImageExecutionSummary({
    sizeResults: [
      { key: '800', scale: 0.7, aestheticUsed: false, reason: 'default layout' },
      { key: '750', scale: 0.72, aestheticUsed: false },
      { key: '1200', scale: 0.69, aestheticUsed: false }
    ],
    imageType: 'click',
    outputDir: 'C:\\Exports',
    copyResult: { candidates: ['轻一点，也更好搭一点'], degraded: false, raw: null },
    critiqueResult: { beforeScore: 72, afterScore: 84, delta: 12, improved: true, afterIssues: [], recommendations: [] }
  });
  const summaryJoined = summary.join('\n');
  record(
    'execution-summary',
    summaryJoined.includes('**主图设计结果已汇总**')
      && summaryJoined.includes('**800** (1440x1440)')
      && summaryJoined.includes('**750** (1440x1920)')
      && summaryJoined.includes('**1200** (1440x2560)')
      && summaryJoined.includes('**文案建议**')
      && summaryJoined.includes('**验收评分** 72 -> 84'),
    summary
  );

  const sizePlan = buildMainImageSizeExecutionPlan({
    sizeKey: '800',
    targetSize: { width: 1440, height: 1440 },
    subjectSize: { width: 500, height: 700 },
    userProductScale: 0.68,
    verticalOffset: -0.02,
    imageType: 'click',
    outputDir: 'C:\\\\Exports',
    layoutSearch: true,
    mainImageSpecRatio: { min: 0.62, max: 0.72 },
    planFlags: { useSubjectDetection: true, useSmartLayout: true, useQuickExport: true },
    smartLayoutStepParams: { quality: 'high' },
    quickExportStepParams: { format: 'png', quality: 10 }
  });
  record(
    'size-execution-plan',
    sizePlan.scale > 0
      && typeof sizePlan.decisionReason === 'string'
      && !!sizePlan.smartLayoutPayload
      && !!sizePlan.quickExportPayload
      && String(sizePlan.quickExportPayload.outputPath).includes('C:\\\\Exports\\主图\\800\\'),
    sizePlan
  );

  const forbiddenConversionPlan = buildMainImageSizeExecutionPlan({
    sizeKey: '1200',
    targetSize: { width: 1440, height: 2560 },
    subjectSize: { width: 500, height: 700 },
    imageType: 'conversion',
    outputDir: 'C:\\\\Exports',
    layoutSearch: true,
    mainImageSpecRatio: { min: 0.62, max: 0.72 },
    planFlags: { useSubjectDetection: true, useSmartLayout: true, useQuickExport: true },
    smartLayoutStepParams: { quality: 'high' },
    quickExportStepParams: { format: 'png', quality: 10 }
  });
  record(
    '1200-conversion-export-blocked',
    !!forbiddenConversionPlan.smartLayoutPayload
      && forbiddenConversionPlan.quickExportPayload === null
      && forbiddenConversionPlan.decisionReason.includes('1200 不导出 conversion'),
    forbiddenConversionPlan
  );

  const defaultSizeKeys = typeof resolveMainImageSizeKeys === 'function' ? resolveMainImageSizeKeys({}) : [];
  record(
    'default-size-keys',
    JSON.stringify(MAIN_IMAGE_DEFAULT_SIZE_KEYS) === JSON.stringify(['800', '750', '1200'])
      && JSON.stringify(defaultSizeKeys) === JSON.stringify(['800', '750', '1200'])
      && JSON.stringify(resolveMainImageSizeKeys({ sizes: ['1:1', '3:4', '9:16', '800'] })) === JSON.stringify(['800', '750', '1200']),
    { MAIN_IMAGE_DEFAULT_SIZE_KEYS, defaultSizeKeys }
  );

  record(
    'size-specs',
    MAIN_IMAGE_SIZE_SPECS['800']?.width === 1440
      && MAIN_IMAGE_SIZE_SPECS['800']?.height === 1440
      && MAIN_IMAGE_SIZE_SPECS['750']?.width === 1440
      && MAIN_IMAGE_SIZE_SPECS['750']?.height === 1920
      && MAIN_IMAGE_SIZE_SPECS['1200']?.width === 1440
      && MAIN_IMAGE_SIZE_SPECS['1200']?.height === 2560
      && MAIN_IMAGE_SIZE_SPECS['3:4']?.height === 1920
      && MAIN_IMAGE_SIZE_SPECS['9:16']?.height === 2560,
    MAIN_IMAGE_SIZE_SPECS
  );
} catch (error) {
  record('unexpected-exception', false, { message: error && error.message ? error.message : String(error), stack: error && error.stack ? error.stack : null });
}

const failed = cases.filter((item) => item.status !== 'pass');
const report = {
  generatedAt: new Date().toISOString(),
  success: failed.length === 0,
  cases
};

const jsonPath = path.join(tmpDir, 'main-image-design-skill-smoke.json');
const mdPath = path.join(tmpDir, 'main-image-design-skill-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
const md = [
  '# Main Image Design Skill Smoke',
  '',
  `success: ${report.success}`,
  '',
  ...cases.map((item) => `- ${item.name}: ${item.status}`)
].join('\n');
fs.writeFileSync(mdPath, md, 'utf8');

console.log(JSON.stringify({ success: report.success, cases: cases.map(({ name, status }) => ({ name, status })), report: { json: jsonPath, md: mdPath } }, null, 2));
process.exit(report.success ? 0 : 1);
