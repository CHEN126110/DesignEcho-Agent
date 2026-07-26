const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  formatLayoutReplicationUserReport,
  summarizeTemplateApplyCompletion,
  summarizeLayoutMatchCompletion
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'layout-replication-completion.ts'));
const {
  buildTemplateApplyCoverageReport,
  buildLayoutMatchCoverageReport
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'layout-replication-coverage.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

try {
  const templateSuccess = summarizeTemplateApplyCompletion({
    headingSuccess: '详情页模板骨架已生成',
    headingReview: '详情页模板骨架部分生成，需复核',
    baseSuccess: true,
    screenCount: 3,
    createdLayers: 12,
    rootGroupName: '详情页模板',
    failedOps: 0,
    qaSummary: '结构正常'
  });
  record(
    'template-apply-success',
    templateSuccess.success === true && templateSuccess.heading === '详情页模板骨架已生成',
    templateSuccess
  );

  const templateFailedOps = summarizeTemplateApplyCompletion({
    headingSuccess: '详情页模板骨架已生成',
    headingReview: '详情页模板骨架部分生成，需复核',
    baseSuccess: true,
    screenCount: 3,
    createdLayers: 10,
    failedOps: 2,
    qaSummary: '存在失败操作'
  });
  record(
    'template-apply-failed-ops-is-not-success',
    templateFailedOps.success === false
      && templateFailedOps.heading.includes('需复核')
      && templateFailedOps.messageLines.some((line) => line.includes('失败/跳过操作: 2')),
    templateFailedOps
  );

  const templateAutoFillFailure = summarizeTemplateApplyCompletion({
    headingSuccess: '详情页模板骨架已生成',
    headingReview: '详情页模板骨架部分生成，需复核',
    baseSuccess: true,
    screenCount: 3,
    createdLayers: 12,
    failedOps: 0,
    qaSummary: '自动填充失败',
    autoFill: {
      success: false,
      filledScreens: 1,
      filledImages: 1,
      guardedScreens: 1,
      failedScreens: 2
    }
  });
  record(
    'template-autofill-failure-is-not-success',
    templateAutoFillFailure.success === false
      && templateAutoFillFailure.messageLines.some((line) => line.includes('自动填充失败: 2')),
    templateAutoFillFailure
  );

  const templateOverlayVerification = summarizeTemplateApplyCompletion({
    headingSuccess: '详情页模板骨架已生成',
    headingReview: '详情页模板骨架部分生成，需复核',
    baseSuccess: true,
    screenCount: 2,
    createdLayers: 8,
    failedOps: 0,
    qaSummary: 'overlay 已采集',
    visualQa: {
      summary: '视觉 QA ok',
      snapshotObservation: {
        source: 'getScreenSnapshotsWithOverlay',
        snapshotCount: 2,
        overlayCount: 5
      }
    }
  });
  record(
    'template-overlay-verification-summary',
    templateOverlayVerification.success === true
      && templateOverlayVerification.messageLines.some((line) => line.includes('Overlay 检查: 2 张截图，5 项标注')),
    templateOverlayVerification
  );

  const templatePixelProbeVerification = summarizeTemplateApplyCompletion({
    headingSuccess: '参考图复刻骨架已生成',
    headingReview: '参考图复刻骨架部分生成，需复核',
    baseSuccess: true,
    screenCount: 1,
    createdLayers: 11,
    failedOps: 0,
    qaSummary: '截图探针为观察项',
    visualQa: {
      summary: '视觉 QA ok',
      snapshotObservation: {
        source: 'getCanvasSnapshot',
        snapshotCount: 1,
        overlayCount: 0,
        pixelProbe: {
          status: 'watch',
          mae: 13.445,
          darkJaccard: 0.4399,
          rawImagesRedacted: true
        }
      },
      verificationReport: {
        blockers: [],
        warnings: ['截图像素探针状态为 watch，不能作为高保真复刻结论。']
      }
    }
  });
  record(
    'template-pixel-probe-summary-is-redacted',
    templatePixelProbeVerification.success === true
      && templatePixelProbeVerification.completionContract?.status === 'needs_review'
      && Object.prototype.hasOwnProperty.call(templatePixelProbeVerification.completionContract || {}, 'verification')
      && templatePixelProbeVerification.messageLines.some((line) => line.includes('截图探针: watch'))
      && templatePixelProbeVerification.completionContract?.verification?.visual?.pixelProbe?.rawImagesRedacted === true
      && templatePixelProbeVerification.userReport?.status === 'needs_review'
      && templatePixelProbeVerification.userReport?.verificationLines.some((line) => line.includes('截图像素检查: watch'))
      && templatePixelProbeVerification.userReport?.limitations.some((line) => line.includes('不能作为高保真通过结论')),
    templatePixelProbeVerification
  );
  const pixelProbeUserMessage = formatLayoutReplicationUserReport(
    templatePixelProbeVerification.userReport,
    templatePixelProbeVerification.messageLines
  );
  record(
    'template-pixel-probe-user-report-is-readable-and-not-overclaimed',
    pixelProbeUserMessage.includes('参考图复刻需复核')
      && pixelProbeUserMessage.includes('截图像素检查: watch')
      && pixelProbeUserMessage.includes('检查项，不等于审美验收通过')
      && !pixelProbeUserMessage.includes('pixel-probe')
      && !pixelProbeUserMessage.includes('bounds')
      && !pixelProbeUserMessage.includes('benchmark case')
      && !pixelProbeUserMessage.includes('高保真复刻完成'),
    { pixelProbeUserMessage }
  );

  const templateOverlayBlocked = summarizeTemplateApplyCompletion({
    headingSuccess: '详情页模板骨架已生成',
    headingReview: '详情页模板骨架部分生成，需复核',
    baseSuccess: true,
    screenCount: 2,
    createdLayers: 8,
    failedOps: 0,
    qaSummary: 'overlay 未采集到截图',
    visualQa: {
      summary: '视觉 QA unverified',
      snapshotObservation: {
        source: 'getScreenSnapshotsWithOverlay',
        snapshotCount: 0,
        overlayCount: 5
      },
      verificationReport: {
        blockers: ['已请求 overlay 截图，但没有获得任何截图结果。'],
        warnings: []
      }
    }
  });
  record(
    'template-overlay-blocker-is-not-success',
    templateOverlayBlocked.success === false
      && templateOverlayBlocked.heading.includes('需复核')
      && templateOverlayBlocked.messageLines.some((line) => line.includes('视觉验收阻断')),
    templateOverlayBlocked
  );

  const templateCoverage = buildTemplateApplyCoverageReport({
    blueprintScreens: [{
      index: 1,
      type: '合格证',
      label: '第1屏_合格证',
      groups: ['文案'],
      elements: [
        { role: 'copy', name: 'title', content: '合格证', x: 0.3, y: 0.1, width: 0.4, height: 0.1 },
        { role: 'copy', name: 'brand', content: '品牌:FEX', x: 0.08, y: 0.25, width: 0.25, height: 0.06 }
      ]
    }],
    generatedScreens: [{
      id: 1,
      index: 1,
      name: '一_01_合格证',
      type: '合格证',
      copyPlaceholders: [{
        layerId: 10,
        layerName: '文案_1_1',
        currentText: '合格证',
        role: 'title',
        sourceKind: 'reference',
        referenceElementId: '1:1:title',
        bounds: { left: 1, top: 1, width: 10, height: 10 }
      }],
      imagePlaceholders: []
    }],
    failedOps: 0
  });
  record(
    'template-apply-coverage-detects-missing-reference-element',
    templateCoverage.expected === 2
      && templateCoverage.applied === 1
      && templateCoverage.skipped === 1
      && templateCoverage.missingIds.includes('1:2:brand'),
    templateCoverage
  );

  const templateCoverageFromElementResults = buildTemplateApplyCoverageReport({
    blueprintScreens: [{
      index: 1,
      type: '合格证',
      label: '第1屏_合格证',
      groups: ['文案'],
      elements: [
        { role: 'copy', name: 'title', content: '合格证', x: 0.3, y: 0.1, width: 0.4, height: 0.1 },
        { role: 'copy', name: 'brand', content: '品牌:FEX', x: 0.08, y: 0.25, width: 0.25, height: 0.06 }
      ]
    }],
    generatedScreens: [],
    elementResults: [
      {
        source: 'template-apply',
        referenceElementId: '1:1:title',
        screenIndex: 1,
        elementIndex: 1,
        name: 'title',
        role: 'copy',
        status: 'applied',
        layerId: 10
      },
      {
        source: 'template-apply',
        referenceElementId: '1:2:brand',
        screenIndex: 1,
        elementIndex: 2,
        name: 'brand',
        role: 'copy',
        status: 'failed',
        reason: 'createTextLayer returned no layerId'
      }
    ],
    failedOps: 1
  });
  record(
    'template-apply-coverage-prefers-per-element-results',
    templateCoverageFromElementResults.expected === 2
      && templateCoverageFromElementResults.applied === 1
      && templateCoverageFromElementResults.failed === 1
      && templateCoverageFromElementResults.skipped === 0
      && templateCoverageFromElementResults.missingIds.includes('1:2:brand'),
    templateCoverageFromElementResults
  );

  const templateCoverageSummary = summarizeTemplateApplyCompletion({
    headingSuccess: '详情页模板骨架已生成',
    headingReview: '详情页模板骨架部分生成，需复核',
    baseSuccess: true,
    screenCount: 1,
    createdLayers: 1,
    failedOps: 0,
    qaSummary: '覆盖率不完整',
    coverage: templateCoverage
  });
  record(
    'template-apply-incomplete-coverage-is-not-success',
    templateCoverageSummary.success === false
      && templateCoverageSummary.messageLines.some((line) => line.includes('元素覆盖: 1/2'))
      && templateCoverageSummary.completionContract?.verification?.coverage?.applied === 1,
    templateCoverageSummary
  );

  const noExecutableMatch = summarizeLayoutMatchCompletion({
    hasExecutableMatches: false,
    referenceElementCount: 8,
    layoutType: 'poster'
  });
  record(
    'no-executable-match-is-not-success',
    noExecutableMatch.success === false
      && noExecutableMatch.error === 'No executable layout matches'
      && noExecutableMatch.heading.includes('没有生成可执行匹配')
      && noExecutableMatch.completionContract?.status === 'failed'
      && noExecutableMatch.userReport?.status === 'failed'
      && noExecutableMatch.userReport?.blockers.some((line) => line.includes('没有生成可执行匹配')),
    noExecutableMatch
  );
  const noExecutableUserMessage = formatLayoutReplicationUserReport(
    noExecutableMatch.userReport,
    noExecutableMatch.messageLines
  );
  record(
    'no-executable-match-user-report-has-blocker',
    noExecutableUserMessage.includes('参考图复刻未完成')
      && noExecutableUserMessage.includes('阻断项:')
      && noExecutableUserMessage.includes('没有生成可执行匹配动作'),
    { noExecutableUserMessage }
  );

  const matchSuccess = summarizeLayoutMatchCompletion({
    hasExecutableMatches: true,
    referenceElementCount: 8,
    successCount: 5,
    failCount: 0,
    qaSummary: '匹配正常'
  });
  record(
    'match-success',
    matchSuccess.success === true
      && matchSuccess.heading === '布局复刻已执行'
      && !matchSuccess.messageLines.join('\n').includes('布局复刻完成')
      && matchSuccess.userReport?.status === 'completed'
      && matchSuccess.userReport?.limitations.some((line) => line.includes('不证明整体审美质量')),
    matchSuccess
  );

  const matchPartialFailure = summarizeLayoutMatchCompletion({
    hasExecutableMatches: true,
    referenceElementCount: 8,
    successCount: 4,
    failCount: 2,
    matchSummary: '部分图层不可安全移动',
    qaSummary: '存在失败项'
  });
  record(
    'match-partial-failure-is-not-success',
    matchPartialFailure.success === false
      && matchPartialFailure.heading.includes('部分执行')
      && matchPartialFailure.messageLines.some((line) => line.includes('失败/跳过: 2')),
    matchPartialFailure
  );

  const matchCoverage = buildLayoutMatchCoverageReport({
    representation: {
      canvas: { width: 460, height: 460 },
      layout: { layoutType: 'certificate' },
      alignmentGroups: [],
      elements: [
        {
          id: 'title',
          sourceType: 'main-title',
          name: 'title',
          role: 'headline',
          nodeKind: 'text',
          box: { x: 0.3, y: 0.1, width: 0.4, height: 0.1 },
          zIndex: 1
        },
        {
          id: 'brand',
          sourceType: 'body-text',
          name: 'brand',
          role: 'supporting-copy',
          nodeKind: 'text',
          box: { x: 0.08, y: 0.25, width: 0.25, height: 0.06 },
          zIndex: 2
        }
      ]
    },
    matchResult: {
      matches: [
        { refElement: 'title', action: { tool: 'moveLayer', params: { x: 1 } } },
        { refElement: 'brand', action: { tool: 'moveLayer', params: { x: 2 } } }
      ]
    },
    executionResults: [
      { refElement: 'title', toolName: 'moveLayer', success: true },
      { refElement: 'brand', toolName: 'moveLayer', success: false, skipped: true, reason: 'unsafe' }
    ]
  });
  record(
    'layout-match-coverage-detects-skipped-reference-element',
    matchCoverage.expected === 2
      && matchCoverage.applied === 1
      && matchCoverage.skipped === 1
      && matchCoverage.missingIds.includes('brand'),
    matchCoverage
  );

  const matchCoverageRequiresStableId = buildLayoutMatchCoverageReport({
    representation: {
      canvas: { width: 460, height: 460 },
      layout: { layoutType: 'certificate' },
      alignmentGroups: [],
      elements: [{
        id: 'title',
        sourceType: 'main-title',
        name: '标题',
        role: 'headline',
        nodeKind: 'text',
        box: { x: 0.3, y: 0.1, width: 0.4, height: 0.1 },
        zIndex: 1
      }]
    },
    matchResult: {
      matches: [
        { refElement: '标题', action: { tool: 'moveLayer', params: { x: 1 } } }
      ]
    },
    executionResults: [
      { refElement: '标题', toolName: 'moveLayer', success: true }
    ]
  });
  record(
    'layout-match-coverage-does-not-count-non-id-refElement',
    matchCoverageRequiresStableId.expected === 1
      && matchCoverageRequiresStableId.applied === 0
      && matchCoverageRequiresStableId.missingIds.includes('title'),
    matchCoverageRequiresStableId
  );

  const matchZeroSuccess = summarizeLayoutMatchCompletion({
    hasExecutableMatches: true,
    referenceElementCount: 8,
    successCount: 0,
    failCount: 0,
    qaSummary: '没有实际执行'
  });
  record(
    'match-zero-success-is-not-success',
    matchZeroSuccess.success === false && matchZeroSuccess.heading === '布局复刻未执行成功',
    matchZeroSuccess
  );
} catch (error) {
  record('unexpected-exception', false, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  });
}

const failed = cases.filter((item) => item.status !== 'pass');
const report = {
  generatedAt: new Date().toISOString(),
  success: failed.length === 0,
  cases
};

const jsonPath = path.join(tmpDir, 'layout-replication-completion-smoke.json');
const mdPath = path.join(tmpDir, 'layout-replication-completion-smoke.md');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(
  mdPath,
  [
    '# Layout Replication Completion Smoke',
    '',
    `success: ${report.success}`,
    '',
    ...cases.map((item) => `- ${item.name}: ${item.status}`)
  ].join('\n'),
  'utf8'
);

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status }) => ({ name, status })),
  report: { json: jsonPath, md: mdPath }
}, null, 2));

process.exit(report.success ? 0 : 1);
