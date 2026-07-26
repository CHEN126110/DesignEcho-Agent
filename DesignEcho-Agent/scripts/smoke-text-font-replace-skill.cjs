const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  textFontReplaceExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'text-font-replace.executor.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

async function withMockedToolExecutor(mock, fn) {
  const original = toolExecutor.executeToolCall;
  toolExecutor.executeToolCall = mock;
  try {
    return await fn();
  } finally {
    toolExecutor.executeToolCall = original;
  }
}

async function main() {
  const input = '帮我把字体全部改成思源黑体';
  const route = fastDeterministicRoute(input);
  record(
    'route-text-font-replace',
    route && route.skillId === 'text-font-replace' && route.skillParams && route.skillParams.fontName === '思源黑体',
    route
  );

  const skill = getSkillById('text-font-replace');
  record(
    'skill-declaration',
    !!skill && Array.isArray(skill.requiredTools) && skill.requiredTools.includes('getAllTextLayers') && skill.requiredTools.includes('setTextStyle'),
    skill
  );

  let successGetAllTextLayersCallCount = 0;
  let successSetTextStyleCallCount = 0;
  const successSetTextStyleParams = [];
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      successGetAllTextLayersCallCount += 1;
      return {
        success: true,
        layers: [
          { id: 1, name: '标题', bounds: { left: 0, top: 0, right: 200, bottom: 60 }, style: { fontName: successGetAllTextLayersCallCount === 1 ? '原字体' : '思源黑体', fontSize: 48, tracking: 0, leading: 54 } },
          { id: 2, name: '副标题', bounds: { left: 0, top: 80, right: 160, bottom: 120 }, style: { fontName: successGetAllTextLayersCallCount === 1 ? '原字体' : '思源黑体', fontSize: 32, tracking: 0, leading: 38 } }
        ]
      };
    }
    if (toolName === 'setTextStyle') {
      successSetTextStyleCallCount += 1;
      successSetTextStyleParams.push({ ...params });
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-success-requires-verified-fonts',
      result.success === true
        && result.message.includes('2 个文本图层')
        && result.data?.layoutImpactReview?.status === 'passed'
        && result.data?.layoutImpactReview?.canClaimTypographyLayoutPreserved === true,
      result
    );
    record(
      'executor-uses-controlled-text-style-plan',
      result.success === true
        && successSetTextStyleCallCount === 2
        && result.data?.controlledTextStyleBatch?.plan?.status === 'ready_dry_run'
        && result.data?.controlledTextStyleBatch?.toolCallPlan?.status === 'ready_tool_call_plan'
        && result.data?.controlledTextStyleBatch?.execution?.status === 'completed_needs_verification'
        && result.data?.controlledTextStyleBatch?.benchmark?.canClaimDesignQuality === false,
      result.data?.controlledTextStyleBatch
    );
    record(
      'executor-preserves-existing-typography-metrics-while-changing-font',
      successSetTextStyleParams.length === 2
        && successSetTextStyleParams.some((item) => Number(item.layerId) === 1 && item.fontName === '思源黑体' && item.fontSize === 48 && item.tracking === 0 && item.leading === 54)
        && successSetTextStyleParams.some((item) => Number(item.layerId) === 2 && item.fontName === '思源黑体' && item.fontSize === 32 && item.tracking === 0 && item.leading === 38),
      successSetTextStyleParams
    );
  });

  let missingBoundsGetAllTextLayersCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      missingBoundsGetAllTextLayersCallCount += 1;
      return {
        success: true,
        layers: [
          { id: 1, name: '标题', style: { fontName: missingBoundsGetAllTextLayersCallCount === 1 ? '原字体' : '思源黑体', fontSize: 48, tracking: 0, leading: 54 } }
        ]
      };
    }
    if (toolName === 'setTextStyle') {
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-does-not-claim-layout-preserved-when-bounds-unavailable',
      result.success === false
        && result.error === 'font replacement needs layout review'
        && result.data?.layoutImpactReview?.status === 'needs_layout_review'
        && result.data?.layoutImpactReview?.canClaimTypographyLayoutPreserved === false
        && result.data?.layoutImpactReview?.issues?.some((item) => item.kind === 'boundsUnavailable')
        && result.message.includes('不能判断')
        && result.message.includes('相邻元素'),
      result
    );
  });

  let boundsShiftGetAllTextLayersCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      boundsShiftGetAllTextLayersCallCount += 1;
      return {
        success: true,
        layers: boundsShiftGetAllTextLayersCallCount === 1
          ? [
              { id: 1, name: '标题', bounds: { left: 0, top: 0, right: 200, bottom: 60 }, style: { fontName: '原字体', fontSize: 48, tracking: 0, leading: 54 } }
            ]
          : [
              { id: 1, name: '标题', bounds: { left: 0, top: 0, right: 252, bottom: 60 }, style: { fontName: '思源黑体', fontSize: 48, tracking: 0, leading: 54 } }
            ]
      };
    }
    if (toolName === 'setTextStyle') {
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-does-not-claim-success-when-text-bounds-change',
      result.success === false
        && result.error === 'font replacement needs layout review'
        && result.data?.layoutImpactReview?.status === 'needs_layout_review'
        && result.data?.requiresManualReview === true
        && typeof result.data?.layoutImpactReview?.primaryRecommendation === 'string'
        && result.data.layoutImpactReview.primaryRecommendation.includes('标题')
        && result.data.layoutImpactReview.primaryRecommendation.includes('相邻元素')
        && result.message.includes('字体已写入')
        && result.message.includes('相邻元素')
        && result.data?.layoutImpactReview?.issues?.some((item) => item.kind === 'boundsChanged'),
      result
    );
  });

  let driftGetAllTextLayersCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      driftGetAllTextLayersCallCount += 1;
      return {
        success: true,
        layers: driftGetAllTextLayersCallCount === 1
          ? [
              { id: 1, name: '标题', bounds: { left: 0, top: 0, right: 200, bottom: 60 }, style: { fontName: '原字体', fontSize: 48, tracking: 0, leading: 54 } }
            ]
          : [
              { id: 1, name: '标题', bounds: { left: 0, top: 0, right: 160, bottom: 45 }, style: { fontName: '思源黑体', fontSize: 36, tracking: 0, leading: 54 } }
            ]
      };
    }
    if (toolName === 'setTextStyle') {
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-detects-typography-metric-drift',
      result.success === false
        && result.error === 'font replacement changed typography metrics'
        && result.data?.layoutImpactReview?.status === 'failed_style_drift'
        && result.data?.layoutImpactReview?.issues?.some((item) => item.kind === 'fontSizeChanged'),
      result
    );
  });

  let partialFailureSetTextStyleCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      return {
        success: true,
        layers: [
          { id: 1, name: '锁定标题', style: { fontName: '原字体' } },
          { id: 2, name: '副标题', style: { fontName: '思源黑体' } }
        ]
      };
    }
    if (toolName === 'setTextStyle') {
      partialFailureSetTextStyleCallCount += 1;
      if (Number(params.layerId) === 1) {
        return { success: false, error: 'layer is locked', params };
      }
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-partial-tool-failure-still-attempts-remaining-layers',
      result.success === false
        && partialFailureSetTextStyleCallCount === 2
        && result.data?.controlledTextStyleBatch?.execution?.status === 'failed_tool_call'
        && result.data?.failures?.some((item) => item.layerId === 1),
      {
        partialFailureSetTextStyleCallCount,
        result
      }
    );
  });

  let getAllTextLayersCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      getAllTextLayersCallCount += 1;
      if (getAllTextLayersCallCount === 1) {
        return {
          success: true,
          layers: [
            { id: 1, name: '标题', style: { fontName: '原字体' } },
            { id: 2, name: '副标题', style: { fontName: '原字体' } }
          ]
        };
      }
      return {
        success: true,
        layers: [
          { id: 1, name: '标题', style: { fontName: '思源黑体' } },
          { id: 2, name: '副标题', style: { fontName: '原字体' } }
        ]
      };
    }
    if (toolName === 'setTextStyle') {
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-final-mismatch-is-not-success',
      result.success === false
        && result.message.includes('字体替换未完全成功')
        && result.data?.failures?.some((item) => item.layerId === 2),
      result
    );
  });
}

main().catch((error) => {
  record('unexpected-exception', false, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  });
}).finally(() => {
  const failed = cases.filter((item) => item.status !== 'pass');
  const report = {
    generatedAt: new Date().toISOString(),
    success: failed.length === 0,
    cases
  };

  const jsonPath = path.join(tmpDir, 'text-font-replace-skill-smoke.json');
  const mdPath = path.join(tmpDir, 'text-font-replace-skill-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Text Font Replace Skill Smoke',
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
});
