const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { Agent } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const { buildTaskCompletionContract } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'task-completion-contract.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-task-completion-contract-smoke.json');
  const mdPath = path.join(outDir, 'agent-task-completion-contract-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Agent Task Completion Contract Smoke',
    '',
    `- success: ${payload.success}`,
    ''
  ];
  for (const item of payload.cases) {
    lines.push(`## ${item.name}`);
    lines.push(`- status: ${item.status}`);
    if (item.details) lines.push(`- details: ${item.details}`);
    lines.push('');
  }
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function documentResult(documentId, extra = {}) {
  return {
    success: true,
    documentInfo: { id: documentId, name: `doc-${documentId}` },
    ...extra
  };
}

async function runCase(name, fn) {
  try {
    const details = await fn();
    return { name, status: 'pass', details: JSON.stringify(details) };
  } catch (error) {
    return {
      name,
      status: 'fail',
      details: error && error.stack ? error.stack : String(error)
    };
  }
}

function createAgent({ callModel, executeTool, taskCompletionContext, maxIterations = 4 }) {
  return new Agent(
    {
      systemPrompt: 'Test agent. Use tools when needed.',
      tools: [
        { name: 'getDocumentInfo', description: 'Read document info', inputSchema: { type: 'object', properties: {} } },
        { name: 'getAllTextLayers', description: 'Read text layers', inputSchema: { type: 'object', properties: {} } },
        { name: 'createTextLayer', description: 'Create text layer', inputSchema: { type: 'object', properties: {} } },
        { name: 'getScreenSnapshotsWithOverlay', description: 'Verify screen', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations,
      taskCompletionContext,
      toolDecisionContext: {
        photoshopConnected: true,
        hasDocument: true
      },
      callbacks: {}
    },
    callModel,
    executeTool
  );
}

function createReviewedVisualResult(toolName, result) {
  return {
    ...result,
    agentVisualObservation: {
      version: 'agent-visual-observation/v1',
      status: 'observed_by_primary',
      reviewed: true,
      observer: 'primary_model',
      strategy: 'primary-self',
      toolName
    }
  };
}

function createReferenceObservation(observationCount = 1) {
  return {
    version: 'task-completion-reference-observation/v1',
    observed: true,
    source: 'attached_image_observation',
    observationCount
  };
}

function createEntryTaskPlan({ goal, skillId, mode } = {}) {
  return {
    version: 'agent-task-planning-contract/v0',
    designBrief: { goal },
    skillId,
    mode
  };
}

function createLayoutReplicationCompositeResult({
  expected = 3,
  applied = 2,
  failed = 0,
  success = true
} = {}) {
  const applyResult = {
    success: failed === 0,
    createdLayers: 2,
    failedOps: failed,
    elementResults: [
      { referenceElementId: '1:1:title', status: 'applied' },
      { referenceElementId: '1:2:hero', status: applied > 1 ? 'applied' : 'failed' }
    ],
    generatedScreens: [{
      id: 101,
      index: 1,
      name: '海报画面',
      type: '海报',
      copyPlaceholders: [{
        layerId: 201,
        layerName: '文案_1_1',
        currentText: 'Skillver · AI 职业能力挑战',
        role: 'title',
        bounds: { left: 100, top: 80, width: 600, height: 120 }
      }],
      imagePlaceholders: [{
        layerId: 202,
        layerName: '图片_1_2',
        bounds: { left: 560, top: 420, width: 400, height: 720 }
      }]
    }]
  };
  const completionContract = {
    verification: {
      coverage: {
        expected,
        applied,
        failed,
        skipped: Math.max(0, expected - applied - failed)
      }
    }
  };
  return {
    success,
    toolResults: [
      { toolName: 'createDocument', result: { success: true, documentId: 88 } },
      {
        toolName: 'layout-template-apply',
        result: {
          ...applyResult,
          completionContract
        }
      }
    ],
    data: {
      createdDocument: true,
      applyResult,
      completionContract
    }
  };
}

function createTypographyOnlyLayoutReplicationCompositeResult() {
  const copyPlaceholders = Array.from({ length: 9 }, (_, index) => ({
    layerId: 300 + index,
    layerName: `文案_1_${index + 1}`,
    currentText: `参考文案 ${index + 1}`,
    role: index === 0 ? 'title' : 'body',
    bounds: { left: 80, top: 80 + index * 90, width: 640, height: 64 }
  }));
  const elementResults = copyPlaceholders.map((_, index) => ({
    referenceElementId: `1:${index + 1}:text`,
    status: 'applied'
  }));
  const coverage = { expected: 9, applied: 9, failed: 0, skipped: 0 };
  const applyResult = {
    success: true,
    createdLayers: 9,
    failedOps: 0,
    elementResults,
    generatedScreens: [{
      id: 101,
      index: 1,
      name: '纯文字海报画面',
      type: '海报',
      copyPlaceholders,
      imagePlaceholders: []
    }]
  };
  const completionContract = { verification: { coverage } };
  return {
    success: true,
    toolResults: [
      { toolName: 'createDocument', result: { success: true, documentId: 88 } },
      {
        toolName: 'layout-template-apply',
        result: { ...applyResult, completionContract }
      }
    ],
    data: {
      createdDocument: true,
      applyResult,
      completionContract
    }
  };
}

async function main() {
  const cases = [];

  cases.push(await runCase('text-typography-contract-completed-after-read-write-verify', async () => {
    const contract = buildTaskCompletionContract({
      task: '帮我把字体全部改成思源黑体',
      toolCallLog: [
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } },
        {
          name: 'setTextStyle',
          arguments: { fontFamily: '思源黑体' },
          result: {
            success: true,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        },
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'text_typography_edit', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `expected completed, got ${contract.status}`);
    return { summary: contract.summary, requirements: contract.required.map((item) => item.status) };
  }));

  cases.push(await runCase('layer-management-contract-recognizes-place-and-clip', async () => {
    // 真机病例（2026-07-07）：「选图置入组内矩形+建剪切蒙版」任务实际完成，
    // 却因 placeImage/createClippingMask 不在图层管理检查集被判 0/3 未完成，触发重跑+重复置入。
    const contract = buildTaskCompletionContract({
      task: '帮我选一张图 置入到 图层组 12 下面的 00 拷贝 9 子图层 的矩形图层上 并建立剪切蒙版',
      toolCallLog: [
        { name: 'getLayerHierarchy', arguments: {}, result: { success: true } },
        { name: 'getLayerBounds', arguments: { layerId: 370 }, result: { success: true } },
        { name: 'placeImage', arguments: { filePath: '142709.jpg' }, result: { success: true, layerId: 4318 } },
        { name: 'createClippingMask', arguments: { layerId: 4318, baseLayerId: 370 }, result: { success: true } },
        { name: 'getClippingMaskInfo', arguments: { layerId: 4318 }, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'layer_management', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `place+clip 完成链必须判 completed，got ${contract.status}（0/3 病例回归）`);
    assert(contract.required.every((item) => item.status === 'passed'),
      `three requirements should pass: ${contract.required.map((item) => `${item.id}=${item.status}`).join(',')}`);
    return { summary: contract.summary, requirements: contract.required.map((item) => item.status) };
  }));

  cases.push(await runCase('text-contract-needs-review-without-post-verification', async () => {
    const contract = buildTaskCompletionContract({
      task: '把标题文字改成新品上市',
      toolCallLog: [
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } },
        { name: 'setTextContent', arguments: { text: '新品上市' }, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'text_content_edit', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'needs_review', `expected needs_review, got ${contract.status}`);
    assert(contract.warnings.some((item) => item.includes('缺少修改后复核')), `expected post verification warning: ${contract.warnings.join(';')}`);
    return { summary: contract.summary, warnings: contract.warnings };
  }));

  cases.push(await runCase('text-readback-before-latest-write-does-not-verify-final-version', async () => {
    const contract = buildTaskCompletionContract({
      task: '把标题文字改成新品上市，再改成透气新品',
      toolCallLog: [
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } },
        {
          name: 'setTextContent',
          arguments: { text: '新品上市' },
          result: {
            success: true,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        },
        { name: 'getTextContent', arguments: {}, result: { success: true, text: '新品上市' } },
        { name: 'setTextContent', arguments: { text: '透气新品' }, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'text_content_edit', `unexpected kind: ${contract.kind}`);
    const verification = contract.required.find((item) => item.id === 'text-verified');
    assert(verification?.status === 'needs_review',
      `earlier readback/acceptance must not verify a later write: ${JSON.stringify(verification)}`);
    return { summary: contract.summary, verification };
  }));

  cases.push(await runCase('text-readback-from-another-document-does-not-verify-mutation', async () => {
    const contract = buildTaskCompletionContract({
      task: '把 A 文档标题改成透气新品',
      toolCallLog: [
        { name: 'getAllTextLayers', arguments: {}, result: documentResult(101, { layers: [] }) },
        { name: 'setTextContent', arguments: { text: '透气新品' }, result: documentResult(101) },
        { name: 'switchDocument', arguments: { documentId: 202 }, result: documentResult(202) },
        { name: 'getTextContent', arguments: {}, result: documentResult(202, { text: '另一文档' }) }
      ]
    });

    assert(contract, 'expected a contract');
    const verification = contract.required.find((item) => item.id === 'text-verified');
    assert(verification?.status === 'needs_review',
      `cross-document readback must not verify text mutation: ${JSON.stringify(verification)}`);
    return { summary: contract.summary, verification };
  }));

  cases.push(await runCase('reference-contract-needs-review-without-visual-and-coverage', async () => {
    const contract = buildTaskCompletionContract({
      task: '根据参考图复刻这个文本排版',
      context: { imageCount: 1 },
      toolCallLog: [
        {
          name: 'createTextLayer',
          arguments: { text: '合格证' },
          result: {
            success: true,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'reference_replication', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'needs_review', `expected needs_review, got ${contract.status}`);
    assert(contract.required.some((item) => item.id === 'visual-verified' && item.status === 'needs_review'), 'expected visual verification to need review');
    assert(contract.required.some((item) => item.id === 'reference-coverage' && item.status === 'needs_review'), 'expected coverage to need review');
    return { summary: contract.summary, required: contract.required };
  }));

  cases.push(await runCase('reference-contract-completed-with-visual-and-coverage', async () => {
    const contract = buildTaskCompletionContract({
      task: '根据参考图复刻这个文本排版',
      context: { imageCount: 1, referenceObservation: createReferenceObservation() },
      toolCallLog: [
        { name: 'createTextLayer', arguments: { text: '合格证' }, result: { success: true } },
        {
          name: 'getScreenSnapshotsWithOverlay',
          arguments: {},
          result: createReviewedVisualResult('getScreenSnapshotsWithOverlay', {
            success: true,
            data: {
              completionContract: {
                verification: {
                  coverage: {
                    expected: 1,
                    applied: 1,
                    failed: 0,
                    skipped: 0
                  }
                }
              }
            }
          })
        }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.status === 'completed', `expected completed, got ${contract.status}: ${contract.summary}`);
    assert(contract.verification, 'new completion contract must expose verification');
    assert(!Object.prototype.hasOwnProperty.call(contract, 'evidence'), 'new completion contract must not expose the retired evidence field');
    assert(
      contract.verification.referenceObservation?.observationCount === 1,
      `reference observation count missing: ${JSON.stringify(contract.verification.referenceObservation)}`
    );
    return { summary: contract.summary, visual: contract.verification.visual, coverage: contract.verification.coverage };
  }));

  cases.push(await runCase('reference-attachment-count-and-output-snapshot-do-not-prove-understanding', async () => {
    const contract = buildTaskCompletionContract({
      task: '复刻这张海报的版式',
      context: { imageCount: 1, skillId: 'layout-replication' },
      toolCallLog: [
        {
          name: 'layout-replication',
          arguments: { artifactKind: 'poster', outputMode: 'apply' },
          result: createLayoutReplicationCompositeResult({ expected: 2, applied: 2 })
        },
        {
          name: 'getCanvasSnapshot',
          arguments: {},
          result: createReviewedVisualResult('getCanvasSnapshot', {
            success: true,
            imageData: 'replication-snapshot'
          })
        }
      ]
    });

    assert(contract, 'expected strict reference contract');
    const understood = contract.required.find((item) => item.id === 'reference-understood');
    assert(understood?.status === 'needs_review', `attachment count must not prove observation: ${JSON.stringify(understood)}`);
    assert(contract.status === 'needs_review', `missing reference receipt must block completion: ${contract.summary}`);
    assert(!contract.verification.referenceObservation, 'output snapshot must not be reused as reference observation receipt');
    return { summary: contract.summary, understood };
  }));

  cases.push(await runCase('reference-guided-poster-keeps-creative-deliverable-contract', async () => {
    const contract = buildTaskCompletionContract({
      task: '参考这张图做个海报',
      context: {
        imageCount: 1,
        skillId: 'layout-replication',
        referenceObservation: createReferenceObservation()
      },
      toolCallLog: [{
        name: 'layout-replication',
        arguments: { artifactKind: 'poster', outputMode: 'apply' },
        result: createLayoutReplicationCompositeResult()
      }]
    });

    assert(contract, 'expected a creative poster contract');
    assert(contract.kind === 'creative_design', `poster deliverable must win over replication method, got ${contract.kind}`);
    assert(
      contract.required.some((item) => item.id === 'creative-document' && item.status === 'passed'),
      `composite createDocument result should pass: ${JSON.stringify(contract.required)}`
    );
    assert(
      contract.required.some((item) => item.id === 'creative-copy' && item.status === 'passed'),
      `composite editable copy should count: ${JSON.stringify(contract.required)}`
    );
    assert(
      contract.required.some((item) => item.id === 'creative-reference-coverage' && item.status === 'passed'),
      `reference grounding should pass from composite coverage: ${JSON.stringify(contract.required)}`
    );
    assert(
      contract.required.some((item) => item.id === 'creative-visual' && item.status === 'needs_review'),
      'placeholder rectangles must not be mistaken for a real poster subject'
    );
    assert(contract.status === 'needs_review', `skeleton-only poster must continue, got ${contract.status}`);
    return { summary: contract.summary, requirements: contract.required };
  }));

  cases.push(await runCase('reference-guided-typography-poster-stays-review-grade-without-hard-failure', async () => {
    const contract = buildTaskCompletionContract({
      task: '参考这张图做个海报',
      context: {
        imageCount: 1,
        skillId: 'layout-replication',
        referenceObservation: createReferenceObservation()
      },
      toolCallLog: [
        {
          name: 'layout-replication',
          arguments: { artifactKind: 'poster', outputMode: 'apply' },
          result: createTypographyOnlyLayoutReplicationCompositeResult()
        },
        {
          name: 'getCanvasSnapshot',
          arguments: {},
          result: createReviewedVisualResult('getCanvasSnapshot', {
            success: true,
            imageData: 'typography-poster-snapshot'
          })
        }
      ]
    });

    assert(contract, 'expected a creative typography poster contract');
    assert(contract.kind === 'creative_design', `unexpected kind: ${contract.kind}`);
    const visual = contract.required.find((item) => item.id === 'creative-visual');
    assert(visual?.status === 'needs_review', `typography-only visual should stay review-grade: ${JSON.stringify(visual)}`);
    assert(visual?.actual?.subjectCount === 0, `typography fixture must not invent a subject: ${JSON.stringify(visual)}`);
    assert(visual?.actual?.shapeCount === 0, `typography fixture must not invent shapes: ${JSON.stringify(visual)}`);
    assert(
      visual?.actual?.referenceTypographyCompositionCount === 1,
      `verified reference typography should count as a review-grade composition: ${JSON.stringify(visual)}`
    );
    assert(/纯排版|文字构图/.test(visual?.reason || ''), `expected typography-specific reason: ${visual?.reason}`);
    assert(
      contract.required.some((item) => item.id === 'creative-reference-coverage' && item.status === 'passed'),
      `full reference coverage should pass: ${JSON.stringify(contract.required)}`
    );
    assert(
      contract.required.some((item) => item.id === 'creative-review' && item.status === 'passed'),
      `reviewed snapshot should pass: ${JSON.stringify(contract.required)}`
    );
    assert(!contract.required.some((item) => item.status === 'failed'), `typography-only reference must not hard-fail: ${JSON.stringify(contract.required)}`);
    assert(contract.status === 'needs_review', `typography-only poster should terminate at needs_review: ${contract.summary}`);
    return { summary: contract.summary, visual };
  }));

  cases.push(await runCase('reference-guided-poster-completes-after-subject-and-reviewed-snapshot', async () => {
    const contract = buildTaskCompletionContract({
      task: '参考这张图做个海报',
      context: {
        imageCount: 1,
        skillId: 'layout-replication',
        referenceObservation: createReferenceObservation()
      },
      toolCallLog: [
        {
          name: 'layout-replication',
          arguments: { artifactKind: 'poster', outputMode: 'apply' },
          result: createLayoutReplicationCompositeResult({ expected: 3, applied: 2 })
        },
        {
          name: 'placeImage',
          arguments: { requirement: '海报机器人主视觉' },
          result: { success: true, layerId: 301 }
        },
        {
          name: 'getCanvasSnapshot',
          arguments: {},
          result: createReviewedVisualResult('getCanvasSnapshot', {
            success: true,
            imageData: 'poster-snapshot'
          })
        }
      ]
    });

    assert(contract, 'expected a creative poster contract');
    assert(contract.kind === 'creative_design', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `finished poster should complete: ${contract.summary}`);
    assert(
      contract.required.every((item) => item.status === 'passed'),
      `all poster requirements should pass: ${JSON.stringify(contract.required)}`
    );
    return {
      summary: contract.summary,
      visual: contract.verification.visual,
      coverage: contract.verification.coverage
    };
  }));

  cases.push(await runCase('strict-replication-contract-consumes-composite-skill-actions', async () => {
    const contract = buildTaskCompletionContract({
      task: '复刻这张海报的版式',
      context: {
        imageCount: 1,
        skillId: 'layout-replication',
        referenceObservation: createReferenceObservation()
      },
      toolCallLog: [
        {
          name: 'layout-replication',
          arguments: { artifactKind: 'poster', outputMode: 'apply' },
          result: createLayoutReplicationCompositeResult({ expected: 2, applied: 2 })
        },
        {
          name: 'getCanvasSnapshot',
          arguments: {},
          result: createReviewedVisualResult('getCanvasSnapshot', {
            success: true,
            imageData: 'replication-snapshot'
          })
        }
      ]
    });

    assert(contract, 'expected strict reference contract');
    assert(contract.kind === 'reference_replication', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `composite replication should complete: ${contract.summary}`);
    assert(
      contract.required.some((item) => item.id === 'editable-layout-created' && item.status === 'passed'),
      `composite applied elements should count as editable actions: ${JSON.stringify(contract.required)}`
    );
    return { summary: contract.summary, requirements: contract.required };
  }));

  cases.push(await runCase('partial-replication-failure-preserves-applied-composite-result', async () => {
    const contract = buildTaskCompletionContract({
      task: '复刻这张海报的版式',
      context: {
        imageCount: 1,
        skillId: 'layout-replication',
        referenceObservation: createReferenceObservation()
      },
      toolCallLog: [{
        name: 'layout-replication',
        arguments: { artifactKind: 'poster', outputMode: 'apply' },
        result: createLayoutReplicationCompositeResult({
          expected: 2,
          applied: 1,
          failed: 1,
          success: false
        })
      }]
    });

    assert(contract, 'expected strict reference contract');
    assert(contract.kind === 'reference_replication', `unexpected kind: ${contract.kind}`);
    const editable = contract.required.find((item) => item.id === 'editable-layout-created');
    assert(editable?.status === 'passed', `partial mutation must remain visible: ${JSON.stringify(editable)}`);
    assert(editable?.actual?.actionCount > 0, `expected preserved applied action count: ${JSON.stringify(editable)}`);
    assert(contract.status === 'failed', `real failed operations must still block completion: ${contract.summary}`);
    return { summary: contract.summary, editable, blockers: contract.blockers };
  }));

  cases.push(await runCase('creative-design-export-request-fails-until-delivery-file-is-saved', async () => {
    const baseLog = [
      { name: 'createDocument', arguments: { width: 790, height: 2400 }, result: { success: true, documentId: 1 } },
      {
        name: 'renderLayout',
        arguments: {
          canvas: { width: 790, height: 2400 },
          blocks: [
            { role: 'background', content: '#111827', heightRatio: 1 },
            { role: 'title', content: '舒适透气运动袜', heightRatio: 0.12 },
            { role: 'selling-point', content: '吸汗速干', heightRatio: 0.1 }
          ]
        },
        result: { success: true, created: [{ role: 'title' }, { role: 'selling-point' }] }
      },
      { name: 'placeImage', arguments: { requirement: '产品图' }, result: { success: true, layerId: 2 } },
      {
        name: 'getCanvasSnapshot',
        arguments: {},
        result: createReviewedVisualResult('getCanvasSnapshot', { success: true, imageData: 'snapshot' })
      }
    ];

    const missingSave = buildTaskCompletionContract({
      task: '请做一个 790px 详情页长图并导出到项目的详情页目录',
      toolCallLog: baseLog
    });
    assert(missingSave, 'expected creative contract');
    assert(missingSave.kind === 'creative_design', `unexpected kind: ${missingSave.kind}`);
    assert(missingSave.status === 'failed', `missing delivery file should fail the contract: ${missingSave.summary}`);
    assert(
      missingSave.required.some((item) => item.id === 'creative-delivery' && item.status === 'failed'),
      `missing delivery requirement should be failed: ${JSON.stringify(missingSave.required)}`
    );
    assert(
      missingSave.required.some((item) => item.id === 'creative-copy' && item.status === 'passed'),
      `renderLayout should count as copy/layout result: ${JSON.stringify(missingSave.required)}`
    );

    const withPsdOnly = buildTaskCompletionContract({
      task: '请做一个 790px 详情页长图并导出到项目的详情页目录',
      toolCallLog: [
        ...baseLog,
        {
          name: 'saveDocument',
          arguments: { projectSubdir: '详情页', format: 'psd' },
          result: {
            success: true,
            savePath: 'E:/project/详情页/detail.psd'
          }
        }
      ]
    });
    assert(withPsdOnly.status === 'failed', `PSD-only save must not satisfy raster detail-page export: ${withPsdOnly.summary}`);
    assert(
      withPsdOnly.required.some((item) => item.id === 'creative-delivery' && item.status === 'failed' && /图片|JPG|PNG|WebP|PSD/.test(item.reason || '')),
      `PSD-only delivery failure should explain raster export requirement: ${JSON.stringify(withPsdOnly.required)}`
    );

    const withSave = buildTaskCompletionContract({
      task: '请做一个 790px 详情页长图并导出到项目的详情页目录',
      toolCallLog: [
        ...baseLog,
        {
          name: 'saveDocument',
          arguments: { projectSubdir: '详情页', format: 'jpg' },
          result: {
            success: true,
            outputPath: 'E:/project/详情页/detail.jpg',
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        }
      ]
    });
    assert(withSave.status === 'completed', `saved creative delivery should complete: ${withSave.summary}`);
    assert(
      withSave.required.some((item) => item.id === 'creative-delivery' && item.status === 'passed'),
      `saved delivery requirement should pass: ${JSON.stringify(withSave.required)}`
    );
    return {
      missingSave: missingSave.summary,
      withSave: withSave.summary,
      requirements: withSave.required
    };
  }));

  cases.push(await runCase('creative-opening-review-does-not-verify-later-design-mutations', async () => {
    const contract = buildTaskCompletionContract({
      task: '请从零设计一张运动鞋主图',
      toolCallLog: [
        {
          name: 'getAnnotatedSnapshot',
          arguments: {},
          result: createReviewedVisualResult('getAnnotatedSnapshot', {
            success: true,
            imageData: 'opening-snapshot'
          })
        },
        { name: 'createDocument', arguments: { width: 1200, height: 1200 }, result: { success: true, documentId: 1 } },
        { name: 'placeImage', arguments: { requirement: '运动鞋产品图' }, result: { success: true, layerId: 2 } },
        { name: 'createTextLayer', arguments: { text: '轻盈透气' }, result: { success: true, layerId: 3 } }
      ]
    });

    assert(contract, 'expected creative contract');
    assert(contract.kind === 'creative_design', `unexpected kind: ${contract.kind}`);
    const review = contract.required.find((item) => item.id === 'creative-review');
    assert(review?.status === 'needs_review',
      `opening reviewed snapshot must not verify later design writes: ${JSON.stringify(review)}`);
    assert(review?.actual?.reviewCount === 0, `expected zero post-write reviews: ${JSON.stringify(review)}`);
    return { summary: contract.summary, review };
  }));

  cases.push(await runCase('structural-acceptance-snapshot-does-not-masquerade-as-visual-review', async () => {
    const contract = buildTaskCompletionContract({
      task: '请从零设计一张运动鞋主图',
      toolCallLog: [
        { name: 'createDocument', arguments: { width: 1200, height: 1200 }, result: { success: true, documentId: 1 } },
        { name: 'placeImage', arguments: { requirement: '运动鞋产品图' }, result: { success: true, layerId: 2 } },
        { name: 'createTextLayer', arguments: { text: '轻盈透气' }, result: { success: true, layerId: 3 } },
        {
          name: 'getAcceptanceSnapshot',
          arguments: {},
          result: {
            success: true,
            hasDocument: true,
            document: { id: 1, name: '主图.psd' },
            historyStateRef: { documentId: 1, historyStateId: 9 },
            layers: []
          }
        }
      ]
    });

    assert(contract, 'expected creative contract');
    const review = contract.required.find((item) => item.id === 'creative-review');
    assert(review?.status === 'needs_review', `structure-only read must not pass visual review: ${JSON.stringify(review)}`);
    assert(review?.actual?.snapshotCount === 0, `acceptance snapshot must not count as a pixel snapshot: ${JSON.stringify(review)}`);
    return { summary: contract.summary, review };
  }));

  cases.push(await runCase('completion-keeps-entry-creative-identity-after-confirmation-message', async () => {
    const contract = buildTaskCompletionContract({
      task: '确认执行公开计划并继续',
      context: {
        agentTaskPlan: createEntryTaskPlan({
          goal: '为夏季运动鞋设计一张主图并导出 PNG',
          skillId: 'main-image-design',
          mode: 'creative_design'
        })
      },
      toolCallLog: [
        { name: 'createDocument', arguments: {}, result: { success: true, documentId: 1 } },
        { name: 'placeImage', arguments: {}, result: { success: true, layerId: 2 } },
        { name: 'createTextLayer', arguments: { text: '轻盈透气' }, result: { success: true, layerId: 3 } },
        {
          name: 'getCanvasSnapshot',
          arguments: {},
          result: createReviewedVisualResult('getCanvasSnapshot', { success: true, imageData: 'snapshot' })
        }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'creative_design', `entry plan identity drifted: ${contract.kind}`);
    assert(
      contract.required.some((item) => item.id === 'creative-delivery' && item.status === 'failed'),
      `entry plan delivery intent should remain active: ${JSON.stringify(contract.required)}`
    );
    return { kind: contract.kind, summary: contract.summary };
  }));

  cases.push(await runCase('completion-keeps-entry-replication-identity-after-confirmation-message', async () => {
    const contract = buildTaskCompletionContract({
      task: '继续执行已确认的步骤',
      context: {
        imageCount: 1,
        agentTaskPlan: createEntryTaskPlan({
          goal: '参考这张图复刻详情页版式',
          skillId: 'layout-replication',
          mode: 'reference_replication'
        }),
        referenceObservation: createReferenceObservation()
      },
      toolCallLog: [
        { name: 'createTextLayer', arguments: { text: '透气舒适' }, result: { success: true, layerId: 3 } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'reference_replication', `entry plan identity drifted: ${contract.kind}`);
    return { kind: contract.kind, summary: contract.summary };
  }));

  cases.push(await runCase('completion-keeps-legacy-inference-without-entry-plan', async () => {
    const contract = buildTaskCompletionContract({
      task: '确认执行公开计划并继续',
      toolCallLog: [
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } },
        { name: 'createTextLayer', arguments: { text: '透气舒适' }, result: { success: true, layerId: 3 } },
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } }
      ]
    });

    assert(contract, 'expected a legacy-compatible contract');
    assert(contract.kind === 'text_content_edit', `legacy inference changed unexpectedly: ${contract.kind}`);
    return { kind: contract.kind, summary: contract.summary };
  }));

  cases.push(await runCase('creative-design-counts-render-layout-main-image-as-subject-visual', async () => {
    const contract = buildTaskCompletionContract({
      task: '请做一个 790px 详情页长图并导出到项目的详情页目录',
      toolCallLog: [
        { name: 'createDocument', arguments: { width: 790, height: 3000 }, result: { success: true, documentId: 1 } },
        {
          name: 'renderLayout',
          arguments: {
            canvas: { width: 790, height: 3000 },
            blocks: [
              { role: 'main-image', imagePath: 'E:/project/model/152414.jpg', heightRatio: 0.24 },
              { role: 'title', content: 'C-1194 专业运动棉袜', heightRatio: 0.08 },
              { role: 'selling-point', content: '吸湿排汗，持久干爽', heightRatio: 0.1 }
            ]
          },
          result: {
            success: true,
            created: [
              { role: 'background', x: 0, y: 0, width: 790, height: 3000 },
              { role: 'main-image', x: 40, y: 40, width: 710, height: 416 },
              { role: 'title', x: 40, y: 480, width: 710, height: 83 },
              { role: 'selling-point', x: 40, y: 587, width: 710, height: 50 }
            ]
          }
        },
        {
          name: 'getCanvasSnapshot',
          arguments: {},
          result: createReviewedVisualResult('getCanvasSnapshot', { success: true, imageData: 'snapshot' })
        },
        { name: 'saveDocument', arguments: { projectSubdir: '详情页', format: 'jpg' }, result: { success: true, outputPath: 'E:/project/详情页/detail.jpg' } }
      ]
    });

    assert(contract, 'expected creative contract');
    assert(contract.kind === 'creative_design', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `renderLayout main-image result should satisfy creative visual: ${contract.summary}`);
    assert(
      contract.required.some((item) => item.id === 'creative-visual' && item.status === 'passed' && item.actual?.subjectCount > 0),
      `creative visual should pass with renderLayout main-image result: ${JSON.stringify(contract.required)}`
    );
    return {
      summary: contract.summary,
      requirements: contract.required
    };
  }));

  cases.push(await runCase('simple-photoshop-tool-validation-does-not-use-creative-design-contract', async () => {
    const contract = buildTaskCompletionContract({
      task: '请在 Photoshop 中真实执行一个小型工具调用验证：创建临时文档、创建图层组、矩形图层和文字图层，然后读取图层层级并反馈 layerId/groupId。',
      toolCallLog: [
        { name: 'createDocument', arguments: { name: 'Agent真实工具调用验证', width: 800, height: 600 }, result: { success: true, documentId: 6335 } },
        { name: 'createGroup', arguments: { groupName: 'Agent真实调用验证组' }, result: { success: true, layerId: 2, groupId: 2 } },
        { name: 'createRectangle', arguments: { x: 100, y: 100, width: 300, height: 200, name: '验证矩形' }, result: { success: true, layerId: 4 } },
        { name: 'createTextLayer', arguments: { content: 'Agent真实调用验证成功', name: '验证文字' }, result: { success: true, layerId: 5 } },
        { name: 'moveLayerToGroup', arguments: { layerId: 4, targetGroupId: 2 }, result: { success: true, layerId: 4, targetGroupId: 2 } },
        { name: 'moveLayerToGroup', arguments: { layerId: 5, targetGroupId: 2 }, result: { success: true, layerId: 5, targetGroupId: 2 } },
        {
          name: 'getLayerHierarchy',
          arguments: { includeHidden: true },
          result: {
            success: true,
            documentName: 'Agent真实工具调用验证',
            hierarchy: [
              {
                id: 2,
                name: 'Agent真实调用验证组',
                kind: 'group',
                children: [
                  { id: 5, name: '验证文字', kind: 'text', parentId: 2 },
                  { id: 4, name: '验证矩形', kind: 'solidColor', parentId: 2 }
                ]
              }
            ]
          }
        }
      ]
    });

    assert(
      !contract || contract.kind !== 'creative_design',
      `simple tool validation must not be evaluated as creative design: ${JSON.stringify(contract)}`
    );
    return {
      contractKind: contract?.kind || 'none',
      summary: contract?.summary || ''
    };
  }));

  cases.push(await runCase('layer-order-contract-does-not-use-reference-replication', async () => {
    const contract = buildTaskCompletionContract({
      task: '把颜色图层按从浅到深从上到下调整图层顺序',
      toolCallLog: [
        { name: 'getLayerHierarchy', arguments: { includeHidden: true }, result: { success: true } },
        {
          name: 'reorderLayer',
          arguments: { layerId: 8, action: 'above', targetLayerId: 9 },
          result: {
            success: true,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        },
        { name: 'getLayerHierarchy', arguments: { includeHidden: true }, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'layer_order_edit', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `expected completed, got ${contract.status}: ${contract.summary}`);
    assert(!contract.summary.includes('参考图复刻'), `layer order task must not use reference contract: ${contract.summary}`);
    return { summary: contract.summary, requirements: contract.required.map((item) => item.status) };
  }));

  cases.push(await runCase('runtime-downgrades-optimistic-reference-final-response', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      taskCompletionContext: { imageCount: 1 },
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '我先读取当前文档，再根据结果创建参考图中的文本内容。',
            toolCalls: [
              {
                id: 'read-document-1',
                name: 'getDocumentInfo',
                arguments: {}
              }
            ]
          };
        }
        if (modelCalls === 2) {
          return {
            content: '已读取现状，现在创建参考图中的文本内容；完成后仍需截图复核。',
            toolCalls: [
              {
                id: 'create-text-1',
                name: 'createTextLayer',
                arguments: { text: '合格证' }
              }
            ]
          };
        }
        return { content: '已完成参考图复刻。', toolCalls: [] };
      },
      executeTool: async (name) => {
        if (name === 'getDocumentInfo') {
          return { success: true, documentId: 1, name: 'test.psd', width: 800, height: 1200 };
        }
        if (name === 'getAllTextLayers') return { success: true, layers: [] };
        return {
          success: true,
          acceptance: {
            enabled: true,
            verified: true,
            assertionStatus: 'passed',
            noDocumentChangeRisk: false
          }
        }
      },
      maxIterations: 5
    });

    const result = await agent.run('根据参考图复刻这个文本排版');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(
      result.executionSummary?.status === 'needs_review',
      `expected needs_review, got ${result.executionSummary?.status}: ${JSON.stringify(result.executionSummary)}`
    );
    assert(result.executionSummary?.taskCompletion?.kind === 'reference_replication', 'expected reference task contract');
    assert(result.message.includes('最终画面效果还需要人工复核'), `expected manual visual review message: ${result.message}`);
    assert(result.message.includes('请打开导出文件查看图片、文字和排版是否符合要求'), `expected user-facing review instruction: ${result.message}`);
    assert(!result.message.includes('已完成参考图复刻。'), `optimistic completion text should not be exposed: ${result.message}`);
    return {
      modelCalls,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary.status,
      contractSummary: result.executionSummary.taskCompletion.summary
    };
  }));

  const success = cases.every((item) => item.status === 'pass');
  const report = { success, cases, generatedAt: new Date().toISOString() };
  const files = writeReport(report);

  if (!success) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  console.log(`Agent task completion contract smoke passed. Report: ${files.md}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
