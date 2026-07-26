#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');

function read(filePath) {
  return fs.readFileSync(path.join(agentRoot, filePath), 'utf8');
}

function exists(filePath) {
  return fs.existsSync(path.join(agentRoot, filePath));
}

function fileIncludes(filePath, needle) {
  try {
    return read(filePath).includes(needle);
  } catch {
    return false;
  }
}

function hasScript(packageJson, scriptName) {
  return Boolean(packageJson.scripts && packageJson.scripts[scriptName]);
}

function buildReport() {
  const packageJson = JSON.parse(read('package.json'));
  const report = {
    reportId: 'main-image-screenshot-probe-readiness',
    scenario: 'main-image',
    purpose: 'Check whether main-image result files can be probed safely before any screenshot-level pixel probe or quality claim.',
    status: 'unknown',
    checks: {
      helperAvailable: exists('src/shared/main-image-screenshot-probe-readiness.ts'),
      qaReportHelperAvailable: exists('src/shared/main-image-qa-report.ts'),
      smokeAvailable: hasScript(packageJson, 'smoke:main-image:screenshot-probe-readiness'),
      pixelProbeAdapterSmokeAvailable: hasScript(packageJson, 'smoke:main-image:pixel-probe-adapter'),
      qaReportSmokeAvailable: hasScript(packageJson, 'smoke:main-image:qa-report'),
      smokeInPreflight: String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:main-image:screenshot-probe-readiness'),
      pixelProbeAdapterSmokeInPreflight: String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:main-image:pixel-probe-adapter'),
      qaReportSmokeInPreflight: String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:main-image:qa-report'),
      executorExposesReadiness: fileIncludes('src/renderer/services/skill-executors/main-image.executor.ts', 'mainImageScreenshotProbeReadiness'),
      executorExposesQaReport: fileIncludes('src/renderer/services/skill-executors/main-image.executor.ts', 'mainImageQaReport'),
      executorProbesResultFiles: fileIncludes('src/renderer/services/skill-executors/main-image.executor.ts', 'probeMainImageResultFiles'),
      executorRunsPixelProbeAfterFileProbe: fileIncludes('src/renderer/services/skill-executors/main-image.executor.ts', 'compareMainImageResultToReference')
        && fileIncludes('src/renderer/services/skill-executors/main-image.executor.ts', 'mainImageResultFileProbes'),
      pixelProbeDoesNotUsePhotoshopTools: !fileIncludes('src/renderer/services/skill-executors/main-image.executor.ts', "executeToolCall('getCanvasSnapshot'"),
      resourceProbeHandlerAvailable: fileIncludes('src/main/ipc-handlers/resource-handlers.ts', 'resource:probeImageFile'),
      resourceServiceProbeAvailable: fileIncludes('src/main/services/resource-manager-service.ts', 'probeImageFile'),
      resourceCompareImageFilesAvailable: fileIncludes('src/main/services/resource-manager-service.ts', 'compareImageFiles'),
      compareImageFilesHandlerAvailable: fileIncludes('src/main/ipc-handlers/resource-handlers.ts', 'resource:compareImageFiles'),
      preloadProbeAvailable: fileIncludes('src/main/preload.ts', 'probeImageFile'),
      preloadCompareImageFilesAvailable: fileIncludes('src/main/preload.ts', 'compareImageFiles'),
      rendererTypeProbeAvailable: fileIncludes('src/renderer/types.d.ts', 'probeImageFile'),
      rendererTypeCompareImageFilesAvailable: fileIncludes('src/renderer/types.d.ts', 'compareImageFiles'),
      rawImageRedactionBoundary: fileIncludes('src/shared/main-image-screenshot-probe-readiness.ts', '不返回 raw image 或 base64')
        || fileIncludes('src/shared/main-image-screenshot-probe-readiness.ts', '不返回 raw image'),
      pixelProbeRawImageRedactionBoundary: fileIncludes('src/main/services/resource-manager-service.ts', '不返回原始图片内容或 base64')
        && fileIncludes('src/main/services/resource-manager-service.ts', 'rawImagesRedacted'),
      qaReportRedactionBoundary: fileIncludes('src/shared/main-image-qa-report.ts', 'pathsRedacted: true')
        && fileIncludes('src/shared/main-image-qa-report.ts', '不会返回 raw image'),
      noQualityClaimBoundary: fileIncludes('src/shared/main-image-screenshot-probe-readiness.ts', '不能把主图结果标记为设计质量通过')
        && fileIncludes('src/shared/main-image-qa-report.ts', 'qualityClaim')
        && fileIncludes('src/shared/main-image-qa-report.ts', '不是模型自动审美评分')
    },
    boundaries: [
      'This readiness report does not run Photoshop.',
      'This readiness report does not run a vision model.',
      'This readiness report does not return raw image or base64 data.',
      'Result file readability and dimensions are not aesthetic acceptance.',
      'Design quality still requires pixelProbe=ok and manual approval.'
    ],
    validation: [
      'npm run smoke:main-image:screenshot-probe-readiness',
      'npm run smoke:main-image:pixel-probe-adapter',
      'npm run smoke:main-image:qa-report',
      'npm run smoke:main-image:screenshot-qa',
      'npm run smoke:design-planner:executor-evidence',
      'npm run build:main',
      'npm run build:typecheck:renderer'
    ]
  };
  report.status = Object.values(report.checks).every(Boolean) ? 'ready' : 'needs_work';
  return report;
}

function format(report) {
  return [
    '# Main Image Screenshot Probe Readiness',
    '',
    `status: ${report.status}`,
    '',
    'checks:',
    ...Object.entries(report.checks).map(([key, value]) => `- ${key}: ${value}`),
    '',
    'boundaries:',
    ...report.boundaries.map((item) => `- ${item}`),
    '',
    'validation:',
    ...report.validation.map((item) => `- ${item}`)
  ].join('\n');
}

const report = buildReport();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(format(report));
}
process.exit(report.status === 'ready' ? 0 : 1);
