#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES,
  isReferenceBenchmarkCategorySlug
} = require('./lib/reference-benchmark-categories.cjs');
const {
  REAL_REFERENCE_SOURCE_KINDS,
  isBlockedReferenceSourceKind,
  isRealReferenceSourceKind,
  normalizeReferenceSourceKind
} = require('./lib/reference-source-kinds.cjs');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    let value = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;
    if (value === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }
    options[key] = value === undefined ? true : value;
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/plan-reference-real-case-intake.cjs --id rr-100 --name "Real case" --category poster-layout --reference-image "C:\\path\\reference.jpg"',
    '',
    'Required:',
    '  --id <case-id>',
    '  --name <text>',
    '  --category <slug>',
    '  --reference-image <path>',
    '',
    'Options:',
    '  --source-kind <kind>            Default: real-commercial-reference',
    '  --reference-description <text>',
    '  --json',
    '  --help'
  ].join('\n');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function validateCaseId(caseId) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(caseId);
}

function quoteShell(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function commandLine(parts) {
  return parts.filter(Boolean).join(' ');
}

function buildEvidencePlan(caseId) {
  if (!caseId || !validateCaseId(caseId)) {
    return {
      resultScreenshot: null,
      resultEvidenceJson: null,
      resultEvidenceMarkdown: null,
      normalizedSnapshot: null,
      commands: {}
    };
  }

  const benchmarkDir = path.resolve(process.cwd(), 'benchmarks', 'reference-replication');
  const resultName = `${caseId}-result.png`;
  const resultRelativePath = path.posix.join('results', resultName);
  const resultAbsolutePath = path.join(benchmarkDir, 'results', resultName);
  const evidenceJson = path.resolve(process.cwd(), 'tmp', `${caseId}-result-evidence.json`);
  const evidenceMarkdown = path.resolve(process.cwd(), 'tmp', `${caseId}-result-evidence.md`);
  const normalizedSnapshot = path.resolve(process.cwd(), 'tmp', `${caseId}-evaluated-snapshot.png`);

  const capturePlan = commandLine([
    'npm run maintenance:reference-capture-plan --',
    '--id', quoteShell(caseId),
    '--result-name', quoteShell(resultName)
  ]);
  const evaluateResult = commandLine([
    'npm run benchmark:reference-replication:evaluate-result --',
    '--id', quoteShell(caseId),
    '--result-screenshot', quoteShell(resultAbsolutePath),
    '--output-json', quoteShell(evidenceJson),
    '--output-md', quoteShell(evidenceMarkdown),
    '--normalized-snapshot-out', quoteShell(normalizedSnapshot)
  ]);
  const validateEvidence = commandLine([
    'npm run benchmark:reference-replication:validate-evidence --',
    '--evidence-json', quoteShell(evidenceJson)
  ]);
  const recordExistingBenchmarkResultAfterManualReview = commandLine([
    'npm run benchmark:reference-replication:record-result --',
    '--id', quoteShell(caseId),
    '--result-screenshot', quoteShell(resultRelativePath),
    '--build-verified',
    '--manual-verified',
    '--reviewer', quoteShell('<reviewer>'),
    '--score-structure', quoteShell('<0..1>'),
    '--score-placement', quoteShell('<0..1>'),
    '--score-text-hierarchy', quoteShell('<0..1>'),
    '--score-editability', quoteShell('<0..1>'),
    '--score-overall', quoteShell('<0..1>')
  ]);
  const recordExternalResultAfterManualReviewTemplate = commandLine([
    'npm run benchmark:reference-replication:record-result --',
    '--id', quoteShell(caseId),
    '--result-screenshot', quoteShell('<external-result-screenshot.png>'),
    '--copy-result-screenshot',
    '--result-screenshot-name', quoteShell(resultName),
    '--build-verified',
    '--manual-verified',
    '--reviewer', quoteShell('<reviewer>'),
    '--score-structure', quoteShell('<0..1>'),
    '--score-placement', quoteShell('<0..1>'),
    '--score-text-hierarchy', quoteShell('<0..1>'),
    '--score-editability', quoteShell('<0..1>'),
    '--score-overall', quoteShell('<0..1>')
  ]);

  return {
    resultScreenshot: {
      benchmarkRelativePath: resultRelativePath,
      absolutePath: resultAbsolutePath,
      expectedBeforeEvaluate: true
    },
    resultEvidenceJson: {
      absolutePath: evidenceJson,
      validator: 'npm run benchmark:reference-replication:validate-evidence'
    },
    resultEvidenceMarkdown: {
      absolutePath: evidenceMarkdown
    },
    normalizedSnapshot: {
      absolutePath: normalizedSnapshot,
      diagnosticOnly: true
    },
    commands: {
      capturePlan,
      evaluateResult,
      validateEvidence,
      recordExistingBenchmarkResultAfterManualReview,
      recordExternalResultAfterManualReviewTemplate,
      qualityGateAfterRecording: 'npm run maintenance:reference-quality-gate -- --json',
      statusAfterRecording: 'npm run maintenance:reference-status -- --json',
      maintenanceValidateAfterRecording: 'npm run maintenance:validate'
    }
  };
}

function resolveReferenceImage(rawPath) {
  const referenceImage = normalizeText(rawPath);
  if (!referenceImage) {
    return { ok: false, absolutePath: '', error: 'reference image is required' };
  }
  const absolutePath = path.isAbsolute(referenceImage)
    ? referenceImage
    : path.resolve(process.cwd(), referenceImage);
  if (!fs.existsSync(absolutePath)) {
    return { ok: false, absolutePath, error: 'reference image does not exist' };
  }
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    return { ok: false, absolutePath, error: 'reference image is not a file' };
  }
  const ext = path.extname(absolutePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, absolutePath, error: `unsupported reference image extension: ${ext || '(none)'}` };
  }
  return {
    ok: true,
    absolutePath,
    error: '',
    ext,
    sizeBytes: stat.size
  };
}

function buildReport(options) {
  const caseId = normalizeText(options.id);
  const name = normalizeText(options.name);
  const category = normalizeText(options.category);
  const sourceKind = normalizeReferenceSourceKind(options['source-kind'] || 'real-commercial-reference');
  const referenceDescription = normalizeText(options['reference-description']);
  const blockers = [];
  const warnings = [];

  if (!caseId) blockers.push('missing --id');
  if (caseId && !validateCaseId(caseId)) blockers.push('case id must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/');
  if (!name) blockers.push('missing --name');
  if (!category) {
    blockers.push('missing --category');
  } else if (!isReferenceBenchmarkCategorySlug(category)) {
    blockers.push('category must be a stable lowercase slug');
  } else if (!REPRESENTATIVE_REFERENCE_BENCHMARK_CATEGORIES.includes(category)) {
    warnings.push(`category is valid but not in representative starter set: ${category}`);
  }

  if (isBlockedReferenceSourceKind(sourceKind)) {
    blockers.push(`source kind is benchmark-only and cannot be used as a real quality case: ${sourceKind}`);
  } else if (!isRealReferenceSourceKind(sourceKind)) {
    warnings.push(`source kind is custom; only these source kinds can support quality claims: ${Array.from(REAL_REFERENCE_SOURCE_KINDS).join(', ')}`);
  }

  const image = resolveReferenceImage(options['reference-image']);
  if (!image.ok) blockers.push(image.error);
  if (image.ok) {
    const basename = path.basename(image.absolutePath).toLowerCase();
    if (/\b(fex|synthetic|fixture)\b|(^|[-_])(fex|synthetic|fixture)([-_.]|$)/.test(basename)) {
      blockers.push('reference image name indicates a FEX/synthetic/fixture asset; use a real commercial reference image for real-case intake');
    }
  }

  const canCreateCase = blockers.length === 0;
  const scenarioNotes = [
    `sourceKind=${sourceKind}`,
    'real-case-intake=true',
    'not-quality-evidence-until-result-screenshot-build-manual-review-and-complete-scores'
  ].join('; ');

  const createCaseDryRunCommand = canCreateCase
    ? commandLine([
        'npm run benchmark:reference-replication:create-case --',
        '--dry-run',
        '--id', quoteShell(caseId),
        '--name', quoteShell(name),
        '--category', quoteShell(category),
        '--source-kind', quoteShell(sourceKind),
        '--source-boundary', quoteShell('Real-case intake source. This is not quality evidence until result screenshot, build verification, manual review and complete scores exist.'),
        '--reference-image', quoteShell(image.absolutePath),
        '--copy-reference-image',
        referenceDescription ? `--reference-description ${quoteShell(referenceDescription)}` : '',
        '--scenario-notes', quoteShell(scenarioNotes)
      ])
    : '';

  const createCaseCommand = createCaseDryRunCommand.replace(' --dry-run', '');
  const evidencePlan = buildEvidencePlan(caseId);

  return {
    success: canCreateCase,
    case: {
      id: caseId,
      name,
      category,
      sourceKind
    },
    referenceImage: {
      absolutePath: image.absolutePath || '',
      exists: Boolean(image.ok),
      extension: image.ext || '',
      sizeBytes: image.sizeBytes || 0
    },
    blockers,
    warnings,
    qualityBoundary: {
      notDesignQualityEvidenceYet: true,
      canBecomeQualityCandidateAfterExecution: canCreateCase,
      requiredBeforeQualityClaim: [
        'explicit real reference source kind',
        'created benchmark case with sourceKind persisted',
        'real result screenshot',
        'valid result evidence report',
        'diagnostic screenshot pixel probe',
        'build/execution verification',
        'manual review',
        'complete 0..1 scores',
        'non-synthetic and non-FEX source'
      ],
      syntheticAndFexRemainExcluded: true
    },
    expectedEvidence: {
      resultScreenshot: evidencePlan.resultScreenshot,
      resultEvidenceJson: evidencePlan.resultEvidenceJson,
      resultEvidenceMarkdown: evidencePlan.resultEvidenceMarkdown,
      normalizedSnapshot: evidencePlan.normalizedSnapshot
    },
    qualityEvidenceRequirements: {
      validRealSourceKind: isRealReferenceSourceKind(sourceKind) && !isBlockedReferenceSourceKind(sourceKind),
      validResultEvidenceReportRequired: true,
      screenshotPixelProbeIsDiagnosticOnly: true,
      manualScoresRequired: [
        'structure',
        'placement',
        'textHierarchy',
        'editability',
        'overall'
      ],
      cannotClaimFromIntakeOnly: true
    },
    commands: {
      dryRunCreateCase: createCaseDryRunCommand,
      createCase: createCaseCommand,
      nextAfterCaseCreated: 'npm run maintenance:reference-evidence-pipeline',
      capturePlan: evidencePlan.commands.capturePlan || '',
      evaluateResult: evidencePlan.commands.evaluateResult || '',
      validateEvidence: evidencePlan.commands.validateEvidence || '',
      recordExistingBenchmarkResultAfterManualReview: evidencePlan.commands.recordExistingBenchmarkResultAfterManualReview || '',
      recordExternalResultAfterManualReviewTemplate: evidencePlan.commands.recordExternalResultAfterManualReviewTemplate || '',
      qualityGateAfterRecording: evidencePlan.commands.qualityGateAfterRecording || '',
      statusAfterRecording: evidencePlan.commands.statusAfterRecording || '',
      maintenanceValidateAfterRecording: evidencePlan.commands.maintenanceValidateAfterRecording || ''
    },
    workflow: [
      'run dryRunCreateCase and inspect output',
      'run createCase only after confirming the real source boundary',
      'run capturePlan to see the expected result screenshot path',
      'capture or place a real result screenshot at expectedEvidence.resultScreenshot.absolutePath',
      'run evaluateResult to generate tmp/<caseId>-result-evidence.json',
      'run validateEvidence and fix evidence blockers before recording the case',
      'run recordExistingBenchmarkResultAfterManualReview or recordExternalResultAfterManualReviewTemplate after human scoring',
      'run qualityGateAfterRecording and maintenanceValidateAfterRecording'
    ],
    policy: {
      readOnly: true,
      doesNotCopyFiles: true,
      doesNotWriteCaseJson: true,
      doesNotRunPhotoshop: true,
      doesNotCallModel: true
    }
  };
}

function formatText(report) {
  const lines = [
    'Reference real case intake plan',
    `success: ${report.success}`,
    `case: ${report.case.id || '(missing)'} / ${report.case.category || '(missing)'}`,
    `referenceImage: ${report.referenceImage.exists ? report.referenceImage.absolutePath : '(missing)'}`,
    ''
  ];
  if (report.blockers.length) {
    lines.push('blockers:');
    report.blockers.forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }
  if (report.warnings.length) {
    lines.push('warnings:');
    report.warnings.forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }
  lines.push('quality boundary:');
  report.qualityBoundary.requiredBeforeQualityClaim.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('commands:');
  lines.push(`- dryRunCreateCase: ${report.commands.dryRunCreateCase || '(blocked)'}`);
  lines.push(`- createCase: ${report.commands.createCase || '(blocked)'}`);
  lines.push(`- nextAfterCaseCreated: ${report.commands.nextAfterCaseCreated}`);
  lines.push(`- capturePlan: ${report.commands.capturePlan || '(blocked)'}`);
  lines.push(`- evaluateResult: ${report.commands.evaluateResult || '(blocked)'}`);
  lines.push(`- validateEvidence: ${report.commands.validateEvidence || '(blocked)'}`);
  lines.push(`- recordExistingBenchmarkResultAfterManualReview: ${report.commands.recordExistingBenchmarkResultAfterManualReview || '(blocked)'}`);
  lines.push(`- qualityGateAfterRecording: ${report.commands.qualityGateAfterRecording || '(blocked)'}`);
  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const report = buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatText(report));
  }
  if (!report.success) {
    process.exitCode = 1;
  }
}

main();
