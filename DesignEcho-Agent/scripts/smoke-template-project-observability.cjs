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
  useAppStore
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'stores', 'app.store.ts'));
const {
  templateSaveExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'template-save.executor.ts'));
const {
  projectImageAnalysisExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'project-image-analysis.executor.ts'));

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

function stepTitles(steps) {
  return steps.map((step) => String(step.title || ''));
}

function installWindowBridge(overrides = {}) {
  global.window = {
    designEcho: {
      getProjectRoot: async () => 'C:/UXP/DesignEchoProject',
      invoke: async (channel, ...args) => {
        if (channel === 'state:setPersistedValue' || channel === 'state:removePersistedValue') {
          return { success: true };
        }
        const payload = args[0] || {};
        return {
          id: 'template-1',
          name: String(payload?.documentName || '当前文档').replace(/\.[^.]+$/, ''),
          type: payload?.type || 'other'
        };
      },
      analyzeAssetContent: async (imagePath) => ({
        success: true,
        analysis: {
          description: `样本 ${path.basename(imagePath)}`,
          mainSubject: '袜子',
          colors: ['混色'],
          style: '基础商品拍摄',
          suggestedPlacement: '材质细节'
        }
      }),
      chat: async () => ({
        text: '1. 款式判断：袜子。\n2. 主要特征：混色与针织质感。\n3. 详情页可以怎么做：展示材质、袜口和上脚效果。\n4. 还缺什么信息：尺码和卖点。'
      }),
      analyzeProjectContactSheetOverview: async (options = {}) => ({
        success: true,
        contactSheet: {
          items: (options.images || []).map((image, index) => ({
            id: `A${String(index + 1).padStart(2, '0')}`,
            path: image.path,
            relativePath: image.relativePath,
            labelHint: image.labelHint,
            status: 'rendered'
          }))
        },
        observation: {
          projectStyle: '基础商品拍摄',
          productUnderstanding: '袜子项目，包含产品图和细节图。',
          sellingPoints: ['材质细节', '上脚效果'],
          imageRoles: [{ id: 'A02', role: 'detail candidate', reason: 'mock overview prefers the second image' }],
          nextSingleImageChecks: ['A02']
        },
        warnings: [],
        limitations: []
      }),
      writeProjectVisualInsightCache: async () => ({ success: true }),
      ...overrides
    }
  };
}

async function runTemplateSaveCases() {
  const route = fastDeterministicRoute('帮我把当前文档保存为模板并加入设计库');
  record(
    'route-save-current-template',
    route && route.skillId === 'save-current-template',
    route
  );

  const skill = getSkillById('save-current-template');
  record(
    'template-save-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('listDocuments'),
    skill
  );

  installWindowBridge();
  const successSteps = [];
  await withMockedToolExecutor(async (toolName) => {
    if (toolName !== 'listDocuments') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      documents: [
        {
          id: 7,
          name: '详情页模板.psd',
          path: 'C:/UXP/DesignEchoProject/templates/详情页模板.psd',
          isActive: true
        }
      ]
    };
  }, async () => {
    const result = await templateSaveExecutor.execute({
      params: { templateIntent: '详情页模板', tags: ['详情页'] },
      callbacks: {
        onStep: (step) => successSteps.push(step)
      },
      context: { userInput: '保存详情页模板' }
    });
    const titles = stepTitles(successSteps);
    record(
      'template-save-success-observable-steps',
      result.success === true
        && titles.includes('开始处理：检查设计文档')
        && titles.includes('处理完成：检查设计文档')
        && titles.includes('确定模板保存上下文')
        && titles.includes('识别模板类型')
        && titles.includes('写入模板库')
        && titles.includes('模板已保存'),
      { result, titles }
    );
  });

  const failedSteps = [];
  await withMockedToolExecutor(async () => ({ success: true, documents: [] }), async () => {
    const result = await templateSaveExecutor.execute({
      params: {},
      callbacks: {
        onStep: (step) => failedSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(failedSteps);
    record(
      'template-save-no-document-is-observable',
      result.success === false
        && titles.includes('未找到可保存文档')
        && failedSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('No active Photoshop document')),
      { result, titles, failedSteps }
    );
  });
}

async function runProjectImageAnalysisCases() {
  const route = fastDeterministicRoute('理解一下项目中的图片，分析款式特征和详情页方向');
  record(
    'route-project-image-analysis',
    route && route.skillId === 'project-image-analysis',
    route
  );

  const c1198DesignBriefRoute = fastDeterministicRoute(
    '帮我理解当前项目图片，看看这款是什么款式，有哪些可见特征和卖点，后续主图和详情页可以怎么做。'
  );
  record(
    'open-design-followup-does-not-use-fixed-project-image-analysis-route',
    c1198DesignBriefRoute === null,
    c1198DesignBriefRoute
  );

  const inventoryRoute = fastDeterministicRoute('你可以帮我看看这个项目都有什么');
  record(
    'route-project-inventory-overview-stays-fast',
    inventoryRoute
      && inventoryRoute.skillId === 'project-image-analysis'
      && inventoryRoute.skillParams?.analysisMode === 'inventory'
      && inventoryRoute.skillParams?.sampleSize === 0,
    inventoryRoute
  );

  const skill = getSkillById('project-image-analysis');
  record(
    'project-image-analysis-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('analyzeAssetContent'),
    skill
  );

  installWindowBridge();
  useAppStore.setState({
    ecommerceStructure: {
      summary: { totalImages: 2 },
      folders: [
        {
          type: 'source',
          images: [
            { path: 'C:/Project/原图/BK9A7874.jpg', relativePath: '原图/BK9A7874.jpg', name: 'BK9A7874.jpg', type: 'product' },
            { path: 'C:/Project/原图/BK9A7875.jpg', relativePath: '原图/BK9A7875.jpg', name: 'BK9A7875.jpg', type: 'detail' }
          ]
        }
      ]
    }
  });

  const successSteps = [];
  const result = await projectImageAnalysisExecutor.execute({
    params: { sampleSize: 2, focus: 'style-and-detail-page' },
    callbacks: {
      onStep: (step) => successSteps.push(step)
    },
    context: {
      userInput: '理解项目图片',
      projectContext: {
        projectPath: 'C:/Project',
        projectImageCount: 2,
        sampleImagePaths: ['C:/Project/原图/BK9A7874.jpg']
      }
    }
  });
  const titles = stepTitles(successSteps);
  record(
    'project-image-analysis-success-observable-steps',
    result.success === true
      && result.data?.analyzedSampleCount === 2
      && result.data?.productDesignUnderstanding?.version === 'project-design-understanding-summary/v0'
      && result.data?.contactSheetOverview?.success === true
      && String(result.message || '').includes('图片理解提炼')
      && String(result.message || '').includes('项目总览观察')
      && titles.includes('读取项目图片上下文')
      && titles.includes('建立项目图片总览')
      && titles.includes('项目图片总览已观察')
      && titles.includes('选择分析样本')
      && titles.includes('分析图片样本 1/2')
      && titles.includes('图片样本已分析 1/2')
      && titles.includes('汇总图片分析结果')
      && titles.includes('项目图片分析完成'),
    { result, titles }
  );

  const c1198CacheWrites = [];
  installWindowBridge({
    analyzeAssetContent: async () => ({
      success: true,
      analysis: {
        description: '模特上脚浅色中筒袜，袜筒有镂空透气纹理和波浪花边袜口，整体轻薄清爽。',
        category: '中筒袜',
        mainSubject: '袜子',
        colors: ['奶白'],
        style: '清爽柔和',
        suggestedPlacement: '上脚场景',
        suggestedEffects: ['镂空', '波浪袜口', '轻薄'],
        material: '桑蚕丝'
      }
    }),
    writeProjectVisualInsightCache: async (options) => {
      c1198CacheWrites.push(options);
      return { success: true };
    },
    chat: async () => ({
      text: '1. 款式判断：桑蚕丝中筒袜。\n2. 主要特征：镂空透气纹理、波浪花边袜口、轻薄清爽。\n3. 设计使用建议：主图放大袜筒细节，详情页讲材质和透气。\n4. 还缺什么信息：成分比例。'
    })
  });
  useAppStore.setState({
    ecommerceStructure: {
      summary: { totalImages: 1 },
      folders: [
        {
          type: 'source',
          name: 'SCS1270桑蚕丝波浪镂空',
          images: [
            {
              path: 'C:/Project/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
              relativePath: 'SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
              name: 'HJT_3829.jpg',
              type: 'model'
            }
          ]
        }
      ]
    }
  });
  const c1198Result = await projectImageAnalysisExecutor.execute({
    params: { sampleSize: 1, focus: 'style-and-detail-page' },
    callbacks: { onStep: () => undefined },
    context: {
      userInput: '理解当前项目图片，提炼卖点和设计方向',
      projectContext: {
        projectPath: 'C:/Project',
        projectImageCount: 1,
        sampleImagePaths: ['C:/Project/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg']
      }
    }
  });
  record(
    'project-image-analysis-builds-product-understanding-and-cache',
    c1198Result.success === true
      && String(c1198Result.message || '').includes('桑蚕丝')
      && String(c1198Result.message || '').includes('镂空透气纹理')
      && !/(productUnderstanding=|visibleProductFeatures=|groundedSellingAngles=|operatorEvidenceNeeded=)/.test(String(c1198Result.message || ''))
      && !/(品类：socks|款式：product_detail|product_detail)/.test(String(c1198Result.message || ''))
      && c1198Result.data?.productDesignUnderstanding?.understanding?.observations?.materials?.includes('桑蚕丝')
      && c1198Result.data?.productDesignUnderstanding?.understanding?.observations?.visualSummaries?.some((item) => item.includes('镂空透气纹理'))
      && !Object.prototype.hasOwnProperty.call(c1198Result.data?.productDesignUnderstanding?.understanding || {}, 'designDirections')
      && c1198Result.data?.visualInsightCacheWrite?.success === true
      && c1198CacheWrites.length === 1
      && c1198CacheWrites[0]?.entries?.[0]?.insight?.material === '桑蚕丝',
    { c1198Result, c1198CacheWrites }
  );

  installWindowBridge({
    analyzeAssetContent: async () => ({
      success: true,
      analysis: {
        description: '上脚浅色中筒袜，袜筒有透气纹理和花边袜口。',
        category: '中筒袜',
        mainSubject: '袜子',
        colors: ['奶白'],
        style: '清爽柔和',
        suggestedPlacement: '主图和详情页可放大袜筒纹理',
        suggestedEffects: ['透气纹理', '花边袜口']
      }
    }),
    chat: async () => ({
      text: '1. 款式判断：浅色中筒袜。\n2. 主要特征：透气纹理和花边袜口。\n3. 设计使用建议：先突出上脚质感和袜筒细节。\n4. 还缺什么信息：材质比例。'
    })
  });
  useAppStore.setState({
    ecommerceStructure: null
  });
  const contextAssetOnlyResult = await projectImageAnalysisExecutor.execute({
    params: { sampleSize: 1, focus: 'style-and-detail-page' },
    callbacks: { onStep: () => undefined },
    context: {
      userInput: '帮我理解当前项目图片，看看这款是什么款式，有哪些可见特征和卖点，后续主图和详情页可以怎么做。',
      projectContext: {
        projectPath: 'C:/Project/C-1198',
        projectImageCount: 38,
        sampleImagePaths: ['C:/Project/C-1198/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg'],
        assetIndex: {
          summary: { totalImages: 38 },
          assets: [
            {
              id: 'asset-1',
              path: 'C:/Project/C-1198/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
              relativePath: 'SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
              name: 'HJT_3829.jpg',
              role: 'raw-model-wear',
              folderRole: 'source',
              isImage: true
            }
          ],
          visionCandidates: [
            {
              assetId: 'asset-1',
              path: 'C:/Project/C-1198/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
              role: 'raw-model-wear',
              reason: '上脚图需要视觉确认款式和卖点。',
              priority: 100
            }
          ]
        },
        visualSamplingPlan: {
          selectedCandidates: [
            {
              assetId: 'asset-1',
              path: 'C:/Project/C-1198/SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
              role: 'raw-model-wear',
              priority: 100,
              score: 100,
              reason: '优先理解上脚图。',
              cacheKey: 'project-visual:test',
              cacheStatus: 'miss',
              shouldAnalyze: true,
              requiredEvidence: [],
              evidence: []
            }
          ],
          cacheSummary: { hit: 0, miss: 1, stale: 0, shouldAnalyze: 1 }
        }
      }
    }
  });
  record(
    'project-image-analysis-uses-context-asset-index-when-store-structure-missing',
    contextAssetOnlyResult.success === true
      && contextAssetOnlyResult.data?.analyzedSampleCount === 1
      && String(contextAssetOnlyResult.message || '').includes('图片理解提炼')
      && String(contextAssetOnlyResult.message || '').includes('中筒袜')
      && !/(productUnderstanding=|visibleProductFeatures=|groundedSellingAngles=|operatorEvidenceNeeded=)/.test(String(contextAssetOnlyResult.message || ''))
      && !/(品类：socks|款式：product_detail|product_detail)/.test(String(contextAssetOnlyResult.message || ''))
      && contextAssetOnlyResult.data?.analyzedSamples?.[0]?.relativePath === 'SCS1270桑蚕丝波浪镂空/HJT_3829.jpg',
    { contextAssetOnlyResult }
  );

  let inventoryAnalyzeCallCount = 0;
  installWindowBridge({
    analyzeAssetContent: async () => {
      inventoryAnalyzeCallCount += 1;
      return { success: false, error: 'inventory overview must not call analyzeAssetContent' };
    }
  });
  useAppStore.setState({
    ecommerceStructure: {
      summary: { totalImages: 3 },
      folders: [
        {
          type: 'source',
          name: '原图',
          images: [
            { path: 'C:/Project/原图/a.jpg', relativePath: '原图/a.jpg', name: 'a.jpg', type: 'product' },
            { path: 'C:/Project/原图/b.jpg', relativePath: '原图/b.jpg', name: 'b.jpg', type: 'detail' }
          ],
          children: [
            {
              type: 'sku',
              name: 'SKU',
              images: [
                { path: 'C:/Project/SKU/sku.psd', relativePath: 'SKU/sku.psd', name: 'sku.psd', type: 'psd' }
              ]
            }
          ]
        }
      ]
    }
  });
  const inventorySteps = [];
  const inventoryResult = await projectImageAnalysisExecutor.execute({
    params: inventoryRoute.skillParams,
    callbacks: {
      onStep: (step) => inventorySteps.push(step)
    },
    context: {
      userInput: '你可以帮我看看这个项目都有什么',
      projectContext: {
        projectPath: 'C:/Project',
        projectImageCount: 3
      }
    }
  });
  const inventoryTitles = stepTitles(inventorySteps);
  record(
    'project-inventory-overview-does-not-call-visual-analysis',
    inventoryResult.success === true
      && inventoryResult.data?.analysisMode === 'inventory'
      && inventoryResult.data?.analyzedSampleCount === 0
      && inventoryResult.data?.projectInventoryOverview?.version === 'project-inventory-overview/v0'
      && inventoryResult.message === inventoryResult.data?.projectInventoryOverview?.compactText
      && String(inventoryResult.message || '').includes('已读取当前项目资源索引')
      && !String(inventoryResult.message || '').includes('项目资源概览：')
      && !String(inventoryResult.message || '').includes('下一步建议')
      && !String(inventoryResult.message || '').includes('\n')
      && String(inventoryResult.data?.projectInventoryOverview?.detailText || '').includes('主要文件夹')
      && String(inventoryResult.data?.projectInventoryOverview?.followUpHint || '').includes('项目图片内容分析')
      && inventoryAnalyzeCallCount === 0
      && inventoryTitles.includes('读取项目资源索引')
      && inventoryTitles.includes('项目资源概览完成')
      && !inventoryTitles.some((title) => title.includes('分析图片样本')),
    { inventoryResult, inventoryAnalyzeCallCount, inventoryTitles }
  );

  let emptyInventoryAnalyzeCallCount = 0;
  installWindowBridge({
    analyzeAssetContent: async () => {
      emptyInventoryAnalyzeCallCount += 1;
      return { success: false, error: 'empty inventory overview must not call analyzeAssetContent' };
    }
  });
  useAppStore.setState({
    ecommerceStructure: {
      summary: { totalImages: 0 },
      folders: []
    }
  });
  const emptyInventorySteps = [];
  const emptyInventoryResult = await projectImageAnalysisExecutor.execute({
    params: { analysisMode: 'inventory', sampleSize: 0, focus: 'inventory' },
    callbacks: {
      onStep: (step) => emptyInventorySteps.push(step)
    },
    context: {
      userInput: '当前是什么项目',
      projectContext: {
        projectPath: 'C:/Project/C-1166',
        projectImageCount: 0,
        sampleImagePaths: []
      }
    }
  });
  const emptyInventoryTitles = stepTitles(emptyInventorySteps);
  record(
    'project-inventory-overview-allows-empty-image-index',
    emptyInventoryResult.success === true
      && emptyInventoryResult.data?.analysisMode === 'inventory'
      && emptyInventoryResult.data?.analyzedSampleCount === 0
      && emptyInventoryResult.data?.projectInventoryOverview?.totalProjectImages === 0
      && String(emptyInventoryResult.message || '').includes('已读取当前项目资源索引：0 个图片/素材')
      && !String(emptyInventoryResult.message || '').includes('没有可分析的图片资源')
      && emptyInventoryAnalyzeCallCount === 0
      && emptyInventoryTitles.includes('读取项目资源索引')
      && emptyInventoryTitles.includes('项目资源概览完成'),
    { emptyInventoryResult, emptyInventoryAnalyzeCallCount, emptyInventoryTitles }
  );

  let driftAnalyzeCallCount = 0;
  installWindowBridge({
    analyzeAssetContent: async () => {
      driftAnalyzeCallCount += 1;
      return { success: false, error: 'inventory drift guard must not call analyzeAssetContent' };
    }
  });
  const driftSteps = [];
  const driftResult = await projectImageAnalysisExecutor.execute({
    params: {
      analysisMode: 'content',
      sampleSize: 5,
      focus: 'style-and-detail-page',
      userIntent: '你可以帮我看看这个项目都有什么'
    },
    callbacks: {
      onStep: (step) => driftSteps.push(step)
    },
    context: {
      userInput: '你可以帮我看看这个项目都有什么',
      projectContext: {
        projectPath: 'C:/Project',
        projectImageCount: 3
      }
    }
  });
  const driftTitles = stepTitles(driftSteps);
  record(
    'project-inventory-executor-forces-metadata-only-on-param-drift',
    driftResult.success === true
      && driftResult.data?.analysisMode === 'inventory'
      && driftResult.data?.analyzedSampleCount === 0
      && driftAnalyzeCallCount === 0
      && driftTitles.includes('读取项目资源索引')
      && !driftTitles.some((title) => title.includes('分析图片样本')),
    { driftResult, driftAnalyzeCallCount, driftTitles }
  );

  const failedSteps = [];
  const noProject = await projectImageAnalysisExecutor.execute({
    params: {},
    callbacks: {
      onStep: (step) => failedSteps.push(step)
    },
    context: {}
  });
  record(
    'project-image-analysis-missing-project-is-observable',
    noProject.success === false
      && stepTitles(failedSteps).includes('项目图片分析未开始')
      && failedSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('Missing project context')),
    { result: noProject, titles: stepTitles(failedSteps), failedSteps }
  );
}

async function main() {
  await runTemplateSaveCases();
  await runProjectImageAnalysisCases();
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

  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const jsonPath = path.join(tmpDir, 'template-project-observability-smoke.json');
  const mdPath = path.join(tmpDir, 'template-project-observability-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Template And Project Image Observability Smoke',
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
