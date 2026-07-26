const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  findEditElementExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'find-edit-element.executor.ts'));
const {
  smartLayoutExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'smart-layout.executor.ts'));
const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));

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

async function runFindEditCases() {
  const skill = getSkillById('find-and-edit-element');
  record(
    'find-edit-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('getElementMapping')
      && skill.requiredTools.includes('selectLayer')
      && skill.routing
      && skill.routing.supportedModes.includes('setText'),
    skill
  );

  const textEditRoute = fastDeterministicRoute('把右上角价格文案改成 到手价 39');
  record(
    'find-edit-text-change-routes-deterministically',
    !!textEditRoute
      && textEditRoute.skillId === 'find-and-edit-element'
      && textEditRoute.skillParams.action === 'setText'
      && textEditRoute.skillParams.targetDescription === '右上角价格文案'
      && textEditRoute.skillParams.text === '到手价 39',
    textEditRoute
  );

  // 改文案带『详情页』也要进 find-and-edit-element，不被 detail-page-design 抢路由（路由洞②修复）
  const textEditWithDetailPage = fastDeterministicRoute('帮我改一下文案 小狗刺绣 改成堆堆薄款 文档是 详情页');
  record(
    'find-edit-text-change-not-stolen-by-detail-page',
    !!textEditWithDetailPage
      && textEditWithDetailPage.skillId === 'find-and-edit-element'
      && textEditWithDetailPage.skillParams.action === 'setText'
      && textEditWithDetailPage.skillParams.text === '堆堆薄款',
    textEditWithDetailPage
  );
  // 但『做/写 详情页文案』这类生成类不含改动词，仍归 detail-page-design（不误伤）
  const detailPageGenRoute = fastDeterministicRoute('帮我写详情页文案');
  record(
    'find-edit-does-not-steal-detail-page-generation',
    !detailPageGenRoute || detailPageGenRoute.skillId !== 'find-and-edit-element',
    detailPageGenRoute
  );

  const layerOrderRoute = fastDeterministicRoute('把当前选中的图层置顶');
  record(
    'find-edit-does-not-steal-layer-stack-order',
    !!layerOrderRoute && layerOrderRoute.skillId === 'layer-management',
    layerOrderRoute
  );

  const skuNumberRemovalRoute = fastDeterministicRoute('修改一下我们刚刚创建的色卡 去除色卡卡片上的顺序编号');
  record(
    'find-edit-sku-card-number-removal-routes-to-batch-hide',
    !!skuNumberRemovalRoute
      && skuNumberRemovalRoute.skillId === 'find-and-edit-element'
      && skuNumberRemovalRoute.skillParams.action === 'hide'
      && skuNumberRemovalRoute.skillParams.targetDescription === '色卡卡片上的顺序编号',
    skuNumberRemovalRoute
  );

  const steps = [];
  const calls = [];
  await withMockedToolExecutor(async (toolName, params) => {
    calls.push({ toolName, params });
    if (toolName === 'getDocumentInfo') return { success: true, name: '测试文档.psd' };
    if (toolName === 'getElementMapping') {
      return {
        success: true,
        elements: [
          { id: 7, name: '右上角价格文案', type: 'textLayer', visible: true, position: 'top-right', textContent: '原价 59' },
          { id: 8, name: '产品图', type: 'smartObject', visible: true, position: 'center' }
        ]
      };
    }
    if (toolName === 'selectLayer') return { success: true, layerId: params.layerId };
    if (toolName === 'setTextContent') return { success: true, updated: params.updates };
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await findEditElementExecutor.execute({
      params: { targetDescription: '右上角价格文案', action: 'setText', text: '到手价 39' },
      callbacks: { onStep: (step) => steps.push(step) },
      context: {}
    });
    const titles = stepTitles(steps);
    record(
      'find-edit-success-observable-steps',
      result.success === true
        && calls.some((call) => call.toolName === 'getDocumentInfo')
        && calls.some((call) => call.toolName === 'getElementMapping')
        && calls.some((call) => call.toolName === 'selectLayer')
        && calls.some((call) => call.toolName === 'setTextContent')
        && titles.includes('准备定位画布元素')
        && titles.includes('候选图层已排序')
        && titles.includes('开始处理：读取文档信息')
        && titles.includes('开始处理：分析页面元素')
        && titles.includes('开始处理：修改文本')
        && titles.includes('元素定位与操作完成'),
      { result, titles, calls }
    );
  });

  // —— 改文案「按内容查找替换」优先路径：给了原文就决定性改，不甩回用户 ——
  {
    const calls2 = [];
    const steps2 = [];
    await withMockedToolExecutor(async (toolName, params) => {
      calls2.push({ toolName, params });
      if (toolName === 'getDocumentInfo') return { success: true, name: '详情页.psd' };
      if (toolName === 'getElementMapping') {
        return {
          success: true,
          elements: [
            { id: 3, name: 'title-3', type: 'textLayer', visible: true, position: 'top', textContent: '小狗刺绣' },
            { id: 4, name: 'subtitle-4', type: 'textLayer', visible: true, position: 'mid', textContent: '透气清凉' },
            { id: 9, name: 'tag-2', type: 'textLayer', visible: true, position: 'bottom', textContent: '小狗刺绣款' }
          ]
        };
      }
      if (toolName === 'setTextContent') return { success: true, updated: params.updates };
      if (toolName === 'selectLayer') return { success: true, layerId: params.layerId };
      return { success: false, error: `unexpected tool ${toolName}` };
    }, async () => {
      const result = await findEditElementExecutor.execute({
        params: { targetDescription: '小狗刺绣', action: 'setText', text: '堆堆薄款' },
        callbacks: { onStep: (s) => steps2.push(s) },
        context: {}
      });
      const setCall = calls2.find((c) => c.toolName === 'setTextContent');
      const updates = (setCall && setCall.params && setCall.params.updates) || [];
      const byId = Object.fromEntries(updates.map((u) => [u.layerId, u.content]));
      record(
        'find-edit-content-replace-decisive',
        result.success === true
          && !!setCall
          && !calls2.some((c) => c.toolName === 'selectLayer')
          && updates.length === 2
          && byId[3] === '堆堆薄款'
          && byId[9] === '堆堆薄款款'
          && String(result.message || '').includes('小狗刺绣')
          && String(result.message || '').includes('堆堆薄款')
          && !stepTitles(steps2).includes('候选图层已排序'),
        { result, updates, calls: calls2.map((c) => c.toolName) }
      );
      record(
        'find-edit-content-replace-baseline-anchor',
        updates.length > 0 && updates.every((u) => typeof u.baselineContent === 'string' && u.baselineContent.length > 0),
        updates
      );
    });
  }

  // —— 目标带前导指令词（"把小狗刺绣"）也要命中原文，不因「把」漏匹配 ——
  {
    const calls3 = [];
    await withMockedToolExecutor(async (toolName, params) => {
      calls3.push({ toolName, params });
      if (toolName === 'getDocumentInfo') return { success: true, name: '详情页.psd' };
      if (toolName === 'getElementMapping') {
        return {
          success: true,
          elements: [
            { id: 3, name: 'title-3', type: 'text', visible: true, position: 'top', textContent: '小狗刺绣' },
            { id: 4, name: 'sub', type: 'text', visible: true, position: 'mid', textContent: '透气清凉' }
          ]
        };
      }
      if (toolName === 'setTextContent') return { success: true, updated: params.updates };
      if (toolName === 'selectLayer') return { success: true, layerId: params.layerId };
      return { success: false, error: `unexpected tool ${toolName}` };
    }, async () => {
      const result = await findEditElementExecutor.execute({
        params: { targetDescription: '把小狗刺绣', action: 'setText', text: '堆堆薄款' },
        callbacks: {},
        context: {}
      });
      const setCall = calls3.find((c) => c.toolName === 'setTextContent');
      const updates = (setCall && setCall.params && setCall.params.updates) || [];
      record(
        'find-edit-content-replace-strips-leading-verb',
        result.success === true
          && !!setCall
          && !calls3.some((c) => c.toolName === 'selectLayer')
          && updates.length === 1
          && updates[0].layerId === 3
          && updates[0].content === '堆堆薄款',
        { result, updates }
      );
    });
  }

  // —— 反向包含（targetDescription 连写带上下文词『详情页中的文案X』）也要命中图层整段文字 ——
  {
    const calls4 = [];
    await withMockedToolExecutor(async (toolName, params) => {
      calls4.push({ toolName, params });
      if (toolName === 'getDocumentInfo') return { success: true };
      if (toolName === 'getElementMapping') return { success: true, elements: [
        { id: 9, name: 'a', type: 'text', visible: true, textContent: '踩脚堆堆袜套' },
        { id: 4, name: 'b', type: 'text', visible: true, textContent: '透气清凉' }
      ] };
      if (toolName === 'setTextContent') return { success: true };
      if (toolName === 'selectLayer') return { success: true };
      return { success: false };
    }, async () => {
      const result = await findEditElementExecutor.execute({
        params: { targetDescription: '详情页中的文案踩脚堆堆袜套', action: 'setText', text: '堆堆薄款' },
        callbacks: {}, context: {}
      });
      const setCall = calls4.find((c) => c.toolName === 'setTextContent');
      const updates = (setCall && setCall.params && setCall.params.updates) || [];
      record(
        'find-edit-content-replace-reverse-containment',
        result.success === true && updates.length === 1 && updates[0].layerId === 9 && updates[0].content === '堆堆薄款',
        { result, updates }
      );
    });
  }

  // —— 找不到就明说（不甩回『候选不唯一』）——
  {
    const calls5 = [];
    await withMockedToolExecutor(async (toolName, params) => {
      calls5.push({ toolName, params });
      if (toolName === 'getDocumentInfo') return { success: true };
      if (toolName === 'getElementMapping') return { success: true, elements: [
        { id: 9, name: 'a', type: 'text', visible: true, textContent: '踩脚堆堆袜套' }
      ] };
      if (toolName === 'setTextContent') return { success: true };
      return { success: false };
    }, async () => {
      const result = await findEditElementExecutor.execute({
        params: { targetDescription: '不存在的文案XYZ', action: 'setText', text: '堆堆薄款' },
        callbacks: {}, context: {}
      });
      record(
        'find-edit-content-not-found-is-honest',
        result.success === false
          && String(result.message || '').includes('没有找到')
          && !String(result.message || '').includes('候选')
          && String(result.message || '').includes('踩脚堆堆袜套')
          && !calls5.some((c) => c.toolName === 'setTextContent'),
        { result }
      );
    });
  }

  const missingSteps = [];
  const missing = await findEditElementExecutor.execute({
    params: {},
    callbacks: { onStep: (step) => missingSteps.push(step) },
    context: {}
  });
  record(
    'find-edit-missing-target-is-observable',
    missing.success === false
      && stepTitles(missingSteps).includes('缺少目标元素描述')
      && missingSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('Missing target description')),
    { result: missing, titles: stepTitles(missingSteps), missingSteps }
  );

  const skuSteps = [];
  const skuCalls = [];
  await withMockedToolExecutor(async (toolName, params) => {
    skuCalls.push({ toolName, params });
    if (toolName === 'getDocumentInfo') return { success: true, name: 'SKU-card-source.psb' };
    if (toolName === 'getElementMapping') {
      return {
        success: true,
        elements: [
          { id: 101, name: '1-编号', type: 'textLayer', visible: true, parentGroup: '1', textContent: '1' },
          { id: 102, name: '2-编号', type: 'textLayer', visible: true, parentGroup: '2', textContent: '2' },
          { id: 103, name: '3-编号', type: 'textLayer', visible: true, parentGroup: '3', textContent: '3' },
          { id: 104, name: '4-编号', type: 'textLayer', visible: true, parentGroup: '4', textContent: '4' },
          { id: 201, name: '1-色名', type: 'textLayer', visible: true, parentGroup: '1', textContent: '奶白' },
          { id: 202, name: '2-色名', type: 'textLayer', visible: true, parentGroup: '2', textContent: '粉色' },
          { id: 301, name: '1-商品图', type: 'smartObject', visible: true, parentGroup: '1' },
          { id: 401, name: '1-色卡底', type: 'shapeLayer', visible: true, parentGroup: '1' }
        ]
      };
    }
    if (toolName === 'selectLayer') return { success: true, layerId: params.layerId, layerIds: params.layerIds };
    if (toolName === 'setLayerOpacity') return { success: true, layerId: params.layerId, opacity: params.opacity };
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await findEditElementExecutor.execute({
      params: { targetDescription: '色卡卡片上的顺序编号', action: 'hide' },
      callbacks: { onStep: (step) => skuSteps.push(step) },
      context: {}
    });
    const opacityCalls = skuCalls.filter((call) => call.toolName === 'setLayerOpacity');
    const opacityLayerIds = opacityCalls.map((call) => call.params.layerId).sort((a, b) => a - b);
    const titles = stepTitles(skuSteps);
    record(
      'find-edit-sku-card-number-removal-batch-hides-number-layers',
      result.success === true
        && !result.data?.selectionRequired
        && opacityCalls.length === 4
        && JSON.stringify(opacityLayerIds) === JSON.stringify([101, 102, 103, 104])
        && opacityCalls.every((call) => call.params.opacity === 0)
        && !opacityCalls.some((call) => call.params.layerId === 201 || call.params.layerId === 202 || call.params.layerId === 301 || call.params.layerId === 401)
        && titles.includes('同类目标已识别')
        && titles.includes('元素定位与操作完成'),
      { result, titles, skuCalls }
    );
  });
}

async function runSmartLayoutCases() {
  const skill = getSkillById('smart-layout');
  record(
    'smart-layout-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('smartLayout'),
    skill
  );

  const successSteps = [];
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName !== 'smartLayout') return { success: false, error: `unexpected tool ${toolName}` };
    return { success: true, message: '布局完成', params };
  }, async () => {
    const result = await smartLayoutExecutor.execute({
      params: { fillRatio: 0.85, alignment: 'center' },
      callbacks: { onStep: (step) => successSteps.push(step) },
      context: {}
    });
    const titles = stepTitles(successSteps);
    record(
      'smart-layout-success-observable-steps',
      result.success === true
        && titles.includes('准备智能布局参数')
        && titles.includes('开始处理：智能布局')
        && titles.includes('处理完成：智能布局')
        && titles.includes('智能布局结果已返回'),
      { result, titles }
    );
  });

  const failedSteps = [];
  await withMockedToolExecutor(async () => ({ success: false, error: 'NO_LAYER_SELECTED' }), async () => {
    const result = await smartLayoutExecutor.execute({
      params: {},
      callbacks: { onStep: (step) => failedSteps.push(step) },
      context: {}
    });
    const titles = stepTitles(failedSteps);
    record(
      'smart-layout-failure-is-observable',
      result.success === false
        && titles.includes('智能布局未完成')
        && failedSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('NO_LAYER_SELECTED')),
      { result, titles, failedSteps }
    );
  });
}

async function main() {
  await runFindEditCases();
  await runSmartLayoutCases();
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
  const jsonPath = path.join(tmpDir, 'find-smart-observability-smoke.json');
  const mdPath = path.join(tmpDir, 'find-smart-observability-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Find/Edit And Smart Layout Observability Smoke',
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
