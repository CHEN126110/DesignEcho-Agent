const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  designReferenceSearchExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'design-reference-search.executor.ts'));
const {
  visualAnalysisExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'visual-analysis.executor.ts'));
const {
  VisualThinkingService
} = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'visual-thinking-service.ts'));

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

function installWindowBridge(visualResponse) {
  const calls = [];
  global.window = {
    designEcho: {
      invoke: async (channel, ...args) => {
        calls.push({ channel, args });
        if (channel === 'visual:analyzeBase64Image' || channel === 'visual:analyzeLocalImage') {
          return visualResponse || {
            success: true,
            data: {
              style: '简洁商品风',
              composition: '居中构图',
              colorPalette: ['#ffffff', '#111111'],
              elements: ['标题', '产品图', '辅助文案'],
              suggestions: ['加强层级', '保留留白']
            }
          };
        }
        return { success: false, error: `unexpected channel ${channel}` };
      }
    }
  };
  return calls;
}

async function runDesignReferenceCases() {
  const skill = getSkillById('design-reference-search');
  record(
    'design-reference-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('searchDesigns')
      && skill.requiredTools.includes('fetchWebPageDesignContent'),
    skill
  );

  const searchSteps = [];
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName !== 'searchDesigns') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      total: 2,
      results: [
        { title: '袜子详情页参考', url: 'https://example.com/a', platform: params.platform },
        { title: '针织材质排版', url: 'https://example.com/b', platform: params.platform }
      ]
    };
  }, async () => {
    const result = await designReferenceSearchExecutor.execute({
      params: { mode: 'search', query: '袜子 详情页', platform: 'all', limit: 2 },
      callbacks: {
        onStep: (step) => searchSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(searchSteps);
    record(
      'design-reference-search-observable-steps',
      result.success === true
        && titles.includes('准备设计参考检索')
        && searchSteps.some((step) => step.toolName === 'searchDesigns' && step.status === 'success')
        && titles.includes('设计参考检索完成')
        && Array.isArray(result.data?.knowledgeResults)
        && result.data.knowledgeResults.length === 2
        && result.data.knowledgeResults.every((item) => item.sourceType === 'design_crawler')
        && result.data.knowledgeResults.every((item) => !item.allowedUses.includes('direct_photoshop_action')),
      { result, titles }
    );
  });

  const fetchSteps = [];
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName !== 'fetchWebPageDesignContent') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      title: '袜子详情页网页参考',
      description: '页面描述用于参考，不直接执行 Photoshop。',
      textContent: `参考 URL: ${params.url}\n强调材质、版式和卖点层级。`,
      images: [{ src: 'https://example.com/a.jpg' }]
    };
  }, async () => {
    const result = await designReferenceSearchExecutor.execute({
      params: { mode: 'fetchUrl', url: 'https://example.com/detail-reference', extractImages: true },
      callbacks: {
        onStep: (step) => fetchSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(fetchSteps);
    record(
      'design-reference-fetch-url-knowledge-results',
      result.success === true
        && titles.includes('网页设计内容已获取')
        && Array.isArray(result.data?.knowledgeResults)
        && result.data.knowledgeResults.length === 1
        && result.data.knowledgeResults[0].sourceType === 'web_page'
        && result.data.knowledgeResults[0].sourceUrl === 'https://example.com/detail-reference'
        && !result.data.knowledgeResults[0].allowedUses.includes('direct_photoshop_action'),
      { result, titles }
    );
  });

  const missingQuerySteps = [];
  const missingQuery = await designReferenceSearchExecutor.execute({
    params: { mode: 'search' },
    callbacks: {
      onStep: (step) => missingQuerySteps.push(step)
    },
    context: {}
  });
  record(
    'design-reference-missing-query-is-observable',
    missingQuery.success === false
      && stepTitles(missingQuerySteps).includes('设计参考检索未开始')
      && missingQuerySteps.some((step) => step.status === 'error' && String(step.issue || '').includes('Query is required')),
    { result: missingQuery, titles: stepTitles(missingQuerySteps), missingQuerySteps }
  );
}

async function runVisualAnalysisCases() {
  const skill = getSkillById('visual-analysis');
  record(
    'visual-analysis-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('getCanvasSnapshot')
      && skill.requiredTools.includes('findLayers')
      && skill.requiredTools.includes('getLayerBounds')
      && skill.requiredTools.includes('exportLayerAsBase64')
      && skill.requiredTools.includes('visual:analyzeBase64Image')
      && skill.parameters.find((parameter) => parameter.name === 'sourceType')?.enum?.includes('attached_image'),
    skill
  );

  const attachedImageCalls = installWindowBridge();
  const attachedImageToolCalls = [];
  const attachedImageSteps = [];
  await withMockedToolExecutor(async (toolName, params) => {
    attachedImageToolCalls.push({ toolName, params });
    return { success: false, error: `unexpected Photoshop tool ${toolName}` };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: { sourceType: 'attached_image', analysisFocus: 'elements' },
      callbacks: {
        onStep: (step) => attachedImageSteps.push(step)
      },
      context: {
        attachedImages: [{
          id: 'chat-image-1',
          data: 'data:image/png;base64,iVBORw0KGgo=',
          mediaType: 'image/png',
          source: 'chat-upload',
          createdAt: 1,
          name: '袜子实拍.png'
        }]
      }
    });
    const analysisCall = attachedImageCalls.find((call) => call.channel === 'visual:analyzeBase64Image');
    const titles = stepTitles(attachedImageSteps);
    record(
      'visual-analysis-attached-image-bypasses-photoshop-snapshot',
      result.success === true
        && attachedImageToolCalls.length === 0
        && analysisCall?.args?.[0] === 'iVBORw0KGgo='
        && String(analysisCall?.args?.[1] || '').includes('用户本轮上传的图片')
        && analysisCall?.args?.[2] === 'image/png'
        && titles.includes('调用视觉模型分析用户图片')
        && titles.includes('用户图片视觉分析完成')
        && !titles.includes('调用视觉模型分析画布'),
      { result, attachedImageToolCalls, attachedImageCalls, titles }
    );
  });

  const plainTextCalls = installWindowBridge({
    success: true,
    data: {
      style: '',
      composition: '',
      colorPalette: [],
      elements: [],
      suggestions: [],
      analysisFormat: 'text',
      rawAnalysis: '画面主体是五双低饱和配色的短袜，采用俯拍扇形构图。',
      modelId: 'vision-test'
    }
  });
  const plainTextResult = await visualAnalysisExecutor.execute({
    params: { sourceType: 'attached_image', analysisFocus: 'composition' },
    callbacks: {},
    context: {
      attachedImages: [{
        id: 'chat-image-text',
        data: '/9j/test-image',
        mediaType: 'image/jpeg',
        source: 'chat-upload',
        createdAt: 2
      }]
    }
  });
  record(
    'visual-analysis-accepts-honest-plain-text-model-response',
    plainTextResult.success === true
      && String(plainTextResult.message || '').includes('五双低饱和配色的短袜')
      && plainTextCalls[0]?.args?.[2] === 'image/jpeg',
    { result: plainTextResult, calls: plainTextCalls }
  );

  installWindowBridge({ success: false, error: '视觉供应商拒绝了图片输入' });
  const failedVisionResult = await visualAnalysisExecutor.execute({
    params: { sourceType: 'attached_image', analysisFocus: 'elements' },
    callbacks: {},
    context: {
      attachedImages: [{
        id: 'chat-image-failed',
        data: '/9j/test-image',
        mediaType: 'image/jpeg',
        source: 'chat-upload',
        createdAt: 3
      }]
    }
  });
  record(
    'visual-analysis-surfaces-provider-failure-without-fake-success',
    failedVisionResult.success === false
      && String(failedVisionResult.message || '').includes('视觉供应商拒绝了图片输入')
      && failedVisionResult.error === '视觉供应商拒绝了图片输入',
    failedVisionResult
  );

  installWindowBridge();
  const activeDocSteps = [];
  await withMockedToolExecutor(async (toolName) => {
    if (toolName !== 'getCanvasSnapshot') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      snapshot: {
        base64: 'iVBORw0KGgo=',
        width: 800,
        height: 800
      }
    };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: { sourceType: 'active_document', analysisFocus: 'layout' },
      callbacks: {
        onStep: (step) => activeDocSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(activeDocSteps);
    record(
      'visual-analysis-active-document-observable-steps',
      result.success === true
        && titles.includes('准备视觉分析')
        && activeDocSteps.some((step) => step.toolName === 'getCanvasSnapshot' && step.status === 'success')
        && titles.includes('调用视觉模型分析画布')
        && titles.includes('画布视觉分析完成')
        && titles.includes('视觉分析报告已生成'),
      { result, titles }
    );
  });

  const canvasFailureSteps = [];
  await withMockedToolExecutor(async (toolName) => {
    if (toolName === 'getAnnotatedSnapshot') {
      return { success: false, error: '标注快照编码失败' };
    }
    if (toolName === 'getCanvasSnapshot') {
      return { success: false, error: 'host is in a modal state：另一插件正在执行命令' };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: { sourceType: 'active_document', analysisFocus: 'layout' },
      callbacks: {
        onStep: (step) => canvasFailureSteps.push(step)
      },
      context: {}
    });
    record(
      'visual-analysis-preserves-canvas-snapshot-root-error',
      result.success === false
        && result.error === 'host is in a modal state：另一插件正在执行命令'
        && String(result.message || '').includes('host is in a modal state')
        && canvasFailureSteps.some((step) => String(step.detail || '').includes('另一插件正在执行命令')),
      { result, canvasFailureSteps }
    );
  });

  const missingPathSteps = [];
  const missingPath = await visualAnalysisExecutor.execute({
    params: { sourceType: 'local_file' },
    callbacks: {
      onStep: (step) => missingPathSteps.push(step)
    },
    context: {}
  });
  record(
    'visual-analysis-missing-file-is-observable',
    missingPath.success === false
      && stepTitles(missingPathSteps).includes('视觉分析未开始')
      && missingPathSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('File path is required')),
    { result: missingPath, titles: stepTitles(missingPathSteps), missingPathSteps }
  );

  const layerAnalysisCalls = installWindowBridge();
  const layerSteps = [];
  const toolCalls = [];
  await withMockedToolExecutor(async (toolName, params) => {
    toolCalls.push({ toolName, params });
    if (toolName === 'getDocumentInfo') {
      return {
        success: true,
        document: {
          name: '模板.psb'
        }
      };
    }
    if (toolName === 'findLayers') {
      return {
        success: true,
        layers: [
          {
            id: 1600,
            name: '2026-05-10 090013',
            kind: 'smartObject',
            path: '详情页/1/图片/2026-05-10 090013'
          }
        ]
      };
    }
    if (toolName === 'getLayerBounds') {
      return {
        success: true,
        layerId: params.layerId,
        bounds: { left: 120, top: 240, right: 520, bottom: 640, width: 400, height: 400 }
      };
    }
    if (toolName === 'exportLayerAsBase64') {
      return {
        success: true,
        base64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        width: 512,
        height: 512,
        layerId: params.layerId
      };
    }
    if (toolName === 'getCanvasSnapshot') {
      return { success: false, error: 'getCanvasSnapshot should not be used for layer source' };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: {
        sourceType: 'layer',
        layerName: '2026-05-10 090013',
        analysisFocus: 'elements'
      },
      callbacks: {
        onStep: (step) => layerSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(layerSteps);
    record(
      'visual-analysis-layer-source-exports-specific-layer-before-vision',
      result.success === true
        && toolCalls.map((call) => call.toolName).join('>') === 'getDocumentInfo>findLayers>getLayerBounds>exportLayerAsBase64'
        && toolCalls.some((call) => call.toolName === 'exportLayerAsBase64' && call.params?.mode === 'imaging')
        && layerAnalysisCalls.some((call) => call.channel === 'visual:analyzeBase64Image'
          && String(call.args?.[1] || '').includes('2026-05-10 090013')
          && String(call.args?.[1] || '').includes('详情页/1/图片/2026-05-10 090013'))
        && titles.includes('定位目标图层')
        && titles.includes('目标图层已导出')
        && titles.includes('调用视觉模型分析图层')
        && titles.includes('图层视觉分析完成')
        && titles.includes('视觉分析报告已生成'),
      { result, titles, toolCalls, layerAnalysisCalls }
    );
  });

  installWindowBridge();
  const nestedExportErrorCalls = [];
  await withMockedToolExecutor(async (toolName, params) => {
    nestedExportErrorCalls.push({ toolName, params });
    if (toolName === 'getDocumentInfo') {
      return {
        success: true,
        document: {
          name: '模板.psb'
        }
      };
    }
    if (toolName === 'findLayers') {
      return {
        success: true,
        layers: [
          {
            id: 1600,
            name: '2026-05-10 090013',
            kind: 'smartObject',
            path: '详情页/1/图片/2026-05-10 090013'
          }
        ]
      };
    }
    if (toolName === 'getLayerBounds') {
      return {
        success: true,
        bounds: { left: 120, top: 240, right: 520, bottom: 640, width: 400, height: 400 }
      };
    }
    if (toolName === 'exportLayerAsBase64') {
      return {
        success: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Only 8 bit image data can be encoded as jpeg',
              data: null
            })
          }
        ]
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: {
        sourceType: 'layer',
        layerName: '2026-05-10 090013',
        analysisFocus: 'elements'
      },
      callbacks: {},
      context: {}
    });
    record(
      'visual-analysis-layer-source-surfaces-nested-export-error',
      result.success === false
        && String(result.message || '').includes('Only 8 bit image data can be encoded as jpeg')
        && String(result.error || '').includes('Only 8 bit image data can be encoded as jpeg')
        && nestedExportErrorCalls.map((call) => call.toolName).join('>') === 'getDocumentInfo>findLayers>getLayerBounds>exportLayerAsBase64',
      { result, calls: nestedExportErrorCalls }
    );
  });

  installWindowBridge();
  const contentArrayExportErrorCalls = [];
  await withMockedToolExecutor(async (toolName, params) => {
    contentArrayExportErrorCalls.push({ toolName, params });
    if (toolName === 'getDocumentInfo') {
      return {
        success: true,
        document: {
          name: '模板.psb'
        }
      };
    }
    if (toolName === 'findLayers') {
      return {
        success: true,
        layers: [
          {
            id: 1600,
            name: '2026-05-10 090013',
            kind: 'smartObject',
            path: '详情页/1/图片/2026-05-10 090013'
          }
        ]
      };
    }
    if (toolName === 'getLayerBounds') {
      return {
        success: true,
        bounds: { left: 120, top: 240, right: 520, bottom: 640, width: 400, height: 400 }
      };
    }
    if (toolName === 'exportLayerAsBase64') {
      return [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Only 8 bit image data can be encoded as jpeg',
            data: null
          })
        }
      ];
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: {
        sourceType: 'layer',
        layerName: '2026-05-10 090013',
        analysisFocus: 'elements'
      },
      callbacks: {},
      context: {}
    });
    record(
      'visual-analysis-layer-source-surfaces-content-array-export-error',
      result.success === false
        && String(result.message || '').includes('Only 8 bit image data can be encoded as jpeg')
        && String(result.error || '').includes('Only 8 bit image data can be encoded as jpeg')
        && contentArrayExportErrorCalls.map((call) => call.toolName).join('>') === 'getDocumentInfo>findLayers>getLayerBounds>exportLayerAsBase64',
      { result, calls: contentArrayExportErrorCalls }
    );
  });

  installWindowBridge();
  const containsFallbackSteps = [];
  const containsFallbackCalls = [];
  await withMockedToolExecutor(async (toolName, params) => {
    containsFallbackCalls.push({ toolName, params });
    if (toolName === 'getDocumentInfo') {
      return {
        success: true,
        document: {
          name: '模板.psb'
        }
      };
    }
    if (toolName === 'findLayers' && params.nameEquals) {
      return { success: true, matches: [], totalMatched: 0 };
    }
    if (toolName === 'findLayers' && params.nameContains) {
      return {
        success: true,
        matches: [
          {
            id: 1601,
            name: '2026-05-10 090013 拷贝',
            kind: 'smartObject',
            path: '详情页/1/图片/2026-05-10 090013 拷贝'
          }
        ]
      };
    }
    if (toolName === 'getLayerBounds') {
      return {
        success: true,
        bounds: { left: 120, top: 240, right: 520, bottom: 640, width: 400, height: 400 }
      };
    }
    if (toolName === 'exportLayerAsBase64') {
      return {
        success: true,
        data: {
          success: true,
          base64: 'iVBORw0KGgo=',
          width: 512,
          height: 512
        }
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: {
        sourceType: 'layer',
        layerName: '2026-05-10 090013',
        analysisFocus: 'elements'
      },
      callbacks: {
        onStep: (step) => containsFallbackSteps.push(step)
      },
      context: {}
    });
    record(
      'visual-analysis-layer-source-falls-back-to-name-contains',
      result.success === true
        && containsFallbackCalls.map((call) => call.toolName).join('>') === 'getDocumentInfo>findLayers>findLayers>getLayerBounds>exportLayerAsBase64'
        && containsFallbackCalls[1]?.params?.nameEquals === '2026-05-10 090013'
        && containsFallbackCalls[2]?.params?.nameContains === '2026-05-10 090013',
      { result, calls: containsFallbackCalls, titles: stepTitles(containsFallbackSteps) }
    );
  });
}

async function runVisualThinkingServiceCases() {
  const modelCalls = [];
  const textModelService = {
    chat: async (modelId, messages, options) => {
      modelCalls.push({ modelId, messages, options });
      return { text: '画面为五双袜子的俯拍商品照片，整体为日系低饱和风格。' };
    }
  };
  const service = new VisualThinkingService(textModelService);
  service.setVisionModelId('vision-test');
  const textResult = await service.analyzeGenericImage(
    'data:image/jpeg;base64,/9j/test-image',
    '分析袜子商品图'
  );
  const imageBlock = modelCalls[0]?.messages?.[0]?.content?.find((item) => item.type === 'image');
  record(
    'visual-thinking-service-preserves-image-type-and-plain-text-evidence',
    textResult.analysisFormat === 'text'
      && String(textResult.rawAnalysis || '').includes('五双袜子')
      && imageBlock?.image?.mediaType === 'image/jpeg'
      && imageBlock?.image?.data === '/9j/test-image'
      && modelCalls[0]?.options?.maxTokens === 2000,
    { result: textResult, call: modelCalls[0] }
  );

  const emptyService = new VisualThinkingService({
    chat: async () => ({ text: '' })
  });
  emptyService.setVisionModelId('vision-test');
  let emptyError = '';
  try {
    await emptyService.analyzeGenericImage('/9j/test-image');
  } catch (error) {
    emptyError = error && error.message ? error.message : String(error);
  }
  record(
    'visual-thinking-service-rejects-empty-response-instead-of-faking-success',
    emptyError.includes('返回了空文本'),
    { emptyError }
  );

  const explicitFailureService = new VisualThinkingService({
    chat: async () => ({ text: '分析失败：当前模型无法读取该图片。' })
  });
  explicitFailureService.setVisionModelId('vision-test');
  let explicitFailureError = '';
  try {
    await explicitFailureService.analyzeGenericImage('/9j/test-image');
  } catch (error) {
    explicitFailureError = error && error.message ? error.message : String(error);
  }
  record(
    'visual-thinking-service-rejects-explicit-text-failure',
    explicitFailureError.includes('明确表示未能分析图片'),
    { explicitFailureError }
  );

  const engineSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'),
    'utf8'
  );
  const chatPanelSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx'),
    'utf8'
  );
  record(
    'skill-result-reply-cannot-bypass-visual-tool-by-rereading-attachment',
    /purpose:\s*'skill_result_user_reply'[\s\S]{0,120}includeAttachedImages:\s*false/.test(engineSource)
      && /shouldUseAttachedImages\s*=\s*hasAttachedImage\s*&&\s*options\?\.includeAttachedImages\s*!==\s*false/.test(chatPanelSource)
      && /hasImage:\s*shouldUseAttachedImages/.test(chatPanelSource)
      && /injectImagesIntoLastUserMessage\(msgs, attachedImages\)/.test(chatPanelSource),
    { guarded: true }
  );
}

async function main() {
  await runDesignReferenceCases();
  await runVisualAnalysisCases();
  await runVisualThinkingServiceCases();
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
  const jsonPath = path.join(tmpDir, 'analysis-reference-observability-smoke.json');
  const mdPath = path.join(tmpDir, 'analysis-reference-observability-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Analysis And Reference Observability Smoke',
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
