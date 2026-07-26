const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  getDefaultAgentTools
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
const {
  buildTaskCompletionContract
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'task-completion-contract.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));

if (!global.localStorage) {
  global.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'layer-management-skill-smoke.json');
  const mdPath = path.join(outDir, 'layer-management-skill-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Layer Management Skill Smoke',
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mcpTextResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: false
  };
}

async function main() {
  const cases = [];

  cases.push(await runCase('skill-declaration-and-executor-exist', () => {
    const skill = getSkillById('layer-management');
    const executor = getSkillExecutor('layer-management');
    assert(skill, 'missing layer-management skill');
    assert(executor, 'missing layer-management executor');
    assert(skill.visibility === 'user-facing', `unexpected visibility: ${skill.visibility}`);
    assert(skill.kind === 'operation', `unexpected kind: ${skill.kind}`);
    assert(skill.requiredTools.includes('listDocuments'), 'requiredTools must include listDocuments for document-targeted inspection');
    assert(skill.requiredTools.includes('switchDocument'), 'requiredTools must include switchDocument for document-targeted inspection');
    assert(skill.requiredTools.includes('reorderLayer'), 'requiredTools must include reorderLayer');
    assert(skill.requiredTools.includes('deleteLayer'), 'requiredTools must include deleteLayer');
    assert(skill.parameters.some((param) => param.name === 'inspectMode'), 'parameters must declare inspectMode for color-layer inspection');
    return { visibility: skill.visibility, kind: skill.kind, requiredTools: skill.requiredTools };
  }));

  cases.push(await runCase('lightness-layer-order-routes-deterministically', () => {
    const route = fastDeterministicRoute('把图层的颜色从浅到深，从上到下调整图层顺序');
    assert(route, 'expected deterministic route');
    assert(route.skillId === 'layer-management', `unexpected skill: ${route.skillId}`);
    assert(route.skillParams.action === 'reorder', `unexpected action: ${route.skillParams.action}`);
    assert(route.skillParams.sortBy === 'lightness', `unexpected sortBy: ${route.skillParams.sortBy}`);
    assert(route.skillParams.sortDirection === 'light-to-dark', `unexpected sortDirection: ${route.skillParams.sortDirection}`);
    assert(!route.skillParams.layerName, `should not extract fake layerName: ${route.skillParams.layerName}`);
    return route;
  }));

  cases.push(await runCase('color-layer-count-routes-to-layer-management-inspect', () => {
    const route = fastDeterministicRoute('当前文档中的图层是几个颜色');
    assert(route, 'expected color count route');
    assert(route.skillId === 'layer-management', `unexpected skill: ${route.skillId}`);
    assert(route.skillParams.action === 'inspect', `unexpected action: ${route.skillParams.action}`);
    assert(route.skillParams.inspectMode === 'color-layers', `unexpected inspectMode: ${route.skillParams.inspectMode}`);
    assert(!route.skillParams.layerName, `color count should not extract fake layerName: ${route.skillParams.layerName}`);
    return route;
  }));

  cases.push(await runCase('color-layer-count-includes-hidden-product-colors-and-skips-helpers', async () => {
    const route = fastDeterministicRoute('那么现在一共是几个颜色');
    assert(route, 'expected color count route');
    assert(route.skillId === 'layer-management', `unexpected skill: ${route.skillId}`);
    assert(route.skillParams.action === 'inspect', `unexpected action: ${route.skillParams.action}`);
    assert(route.skillParams.inspectMode === 'color-layers', `unexpected inspectMode: ${route.skillParams.inspectMode}`);
    assert(!route.skillParams.layerName, `color count should not extract fake layerName: ${route.skillParams.layerName}`);

    const executor = getSkillExecutor('layer-management');
    const toolCalls = [];
    let hierarchy = [
      { id: 10, name: '矩形选取', kind: 'solidColor', visible: false },
      { id: 7, name: '藏青', kind: 'pixel', visible: false },
      { id: 6, name: '白色', kind: 'pixel', visible: false },
      { id: 4, name: '浅蓝', kind: 'pixel', visible: true },
      { id: 3, name: '浅灰', kind: 'pixel', visible: true },
      { id: 8, name: '雾蓝', kind: 'pixel', visible: true },
      { id: 5, name: '深灰', kind: 'pixel', visible: true },
      { id: 9, name: '黑色', kind: 'pixel', visible: true },
      { id: 2, name: '浅卡其', kind: 'pixel', visible: true },
      { id: 1, name: '背景', kind: 'pixel', visible: true, locked: true }
    ];
    const previousWindow = global.window;
    global.window = {
      designEcho: {
        callMcpToolCancellable: async (_requestKey, toolName, params) => {
          toolCalls.push({ toolName, params });
          if (toolName === 'getDocumentInfo') return mcpTextResult({ success: true });
          if (toolName === 'getLayerHierarchy') return mcpTextResult({ success: true, hierarchy, totalLayers: hierarchy.length });
          return mcpTextResult({ success: true });
        }
      }
    };
    let result;
    try {
      result = await executor.execute({ params: route.skillParams, callbacks: {} });
    } finally {
      global.window = previousWindow;
    }

    const layerHierarchyCall = toolCalls.find((call) => call.toolName === 'getLayerHierarchy');
    assert(layerHierarchyCall?.params?.includeHidden === true, 'color count must read hidden layers');
    assert(result.success === true, `inspect execution should succeed: ${result.message || result.error}`);
    assert(result.data?.colorLayerCount === 8, `expected 8 color layers, got ${result.data?.colorLayerCount}`);
    assert(result.data?.hiddenColorLayerCount === 2, `expected 2 hidden color layers, got ${result.data?.hiddenColorLayerCount}`);
    assert(result.data.colorLayers.some((layer) => layer.layerName === '藏青'), '藏青 should be counted as a product color');
    assert(result.data.colorLayers.some((layer) => layer.layerName === '浅卡其'), '浅卡其 should be counted as a product color');
    assert(!result.data.colorLayers.some((layer) => layer.layerName === '矩形选取'), 'selection helper must not be counted as product color');
    assert(!result.data.colorLayers.some((layer) => layer.layerName === '背景'), 'background must not be counted as product color');
    assert(result.message.includes('共 8 个'), `message should expose exact color count: ${result.message}`);
    return {
      message: result.message,
      colorLayerCount: result.data.colorLayerCount,
      hiddenColorLayerCount: result.data.hiddenColorLayerCount
    };
  }));

  cases.push(await runCase('inspect-layer-hierarchy-keeps-technical-evidence-out-of-user-message', async () => {
    const executor = getSkillExecutor('layer-management');
    const toolCalls = [];
    const hierarchy = [
      {
        id: 2,
        name: '基础工具链验证组',
        kind: 'group',
        visible: true,
        children: [
          { id: 6, name: '中文文字', kind: 'text', visible: true },
          { id: 5, name: '红色圆形徽章', kind: 'solidColor', visible: true },
          { id: 4, name: '蓝色矩形底卡', kind: 'solidColor', visible: true }
        ]
      },
      { id: 1, name: '背景', kind: 'pixel', visible: true }
    ];
    const previousWindow = global.window;
    global.window = {
      designEcho: {
        callMcpToolCancellable: async (_requestKey, toolName, params) => {
          toolCalls.push({ toolName, params });
          const payload = toolName === 'getDocumentInfo'
            ? { success: true, documentName: 'Agent真实基础工具链验证-反馈修复' }
            : { success: true, documentName: 'Agent真实基础工具链验证-反馈修复', hierarchy, totalLayers: 5 };
          return mcpTextResult(payload);
        }
      }
    };
    let result;
    try {
      result = await executor.execute({
        params: {
          action: 'inspect',
          userIntent: '请确认图层结构里是否有“基础工具链验证组”“中文文字”“红色圆形徽章”“蓝色矩形底卡”。'
        },
        callbacks: {}
      });
    } finally {
      if (previousWindow === undefined) {
        delete global.window;
      } else {
        global.window = previousWindow;
      }
    }

    assert(result.success === true, `inspect should succeed: ${result.message || result.error}`);
    assert(!result.message.includes('实际工具：'), `user-facing message should not list internal tool evidence: ${result.message}`);
    assert(!/，id\s*\d+/.test(result.message), `user-facing message should not expose raw layer ids: ${result.message}`);
    for (const name of ['基础工具链验证组', '中文文字', '红色圆形徽章', '蓝色矩形底卡']) {
      assert(result.message.includes(name), `message should mention confirmed target ${name}: ${result.message}`);
    }
    assert(result.data?.requestedLayerChecks?.length === 4, `expected four requested layer checks: ${JSON.stringify(result.data)}`);
    assert(result.data.requestedLayerChecks.every((item) => item.found === true), `all requested layers should be found: ${JSON.stringify(result.data.requestedLayerChecks)}`);
    assert(toolCalls.map((call) => call.toolName).join(',') === 'getDocumentInfo,getLayerHierarchy', `unexpected tools: ${toolCalls.map((call) => call.toolName).join(',')}`);
    return {
      message: result.message,
      requestedLayerChecks: result.data.requestedLayerChecks
    };
  }));

  cases.push(await runCase('inspect-target-document-id-preserves-tool-evidence-in-data-not-user-message', async () => {
    const executor = getSkillExecutor('layer-management');
    const toolCalls = [];
    const hierarchy = [
      {
        id: 2,
        name: '基础工具链验证组',
        kind: 'group',
        visible: true,
        children: [
          { id: 6, name: '中文文字', kind: 'text', visible: true },
          { id: 5, name: '红色圆形徽章', kind: 'solidColor', visible: true },
          { id: 4, name: '蓝色矩形底卡', kind: 'solidColor', visible: true }
        ]
      },
      { id: 1, name: '背景', kind: 'pixel', visible: true }
    ];
    const previousWindow = global.window;
    global.window = {
      designEcho: {
        callMcpToolCancellable: async (_requestKey, toolName, params) => {
          toolCalls.push({ toolName, params });
          if (toolName === 'listDocuments') {
            return mcpTextResult({
              success: true,
              documents: [
                { id: 7334, name: 'Agent真实基础工具链验证-反馈修复', isActive: false },
                { id: 1001, name: '其他文档', isActive: true }
              ]
            });
          }
          if (toolName === 'switchDocument') {
            return mcpTextResult({ success: true, activeDocumentId: params.documentId });
          }
          if (toolName === 'getDocumentInfo') {
            return mcpTextResult({ success: true, id: 7334, documentName: 'Agent真实基础工具链验证-反馈修复' });
          }
          if (toolName === 'getLayerHierarchy') {
            return mcpTextResult({ success: true, documentName: 'Agent真实基础工具链验证-反馈修复', hierarchy, totalLayers: 5 });
          }
          return mcpTextResult({ success: true });
        }
      }
    };
    let result;
    try {
      result = await executor.execute({
        params: {
          action: 'inspect',
          userIntent: [
            '请直接操作 Photoshop：先列出当前打开的文档，切换到文档 id 7334（Agent真实基础工具链验证-反馈修复），然后读取图层结构。',
            '请确认图层结构里是否有“基础工具链验证组”“中文文字”“红色圆形徽章”“蓝色矩形底卡”。'
          ].join('\n')
        },
        callbacks: {}
      });
    } finally {
      if (previousWindow === undefined) {
        delete global.window;
      } else {
        global.window = previousWindow;
      }
    }

    const toolNames = toolCalls.map((call) => call.toolName);
    assert(result.success === true, `document-targeted inspect should succeed: ${result.message || result.error}`);
    assert(toolNames.join(',') === 'listDocuments,switchDocument,getDocumentInfo,getLayerHierarchy', `unexpected tool order: ${toolNames.join(',')}`);
    assert(toolCalls[0].params.includeDetails === true, 'listDocuments should include details for document id verification');
    assert(toolCalls[1].params.documentId === 7334, `switchDocument should use documentId 7334: ${JSON.stringify(toolCalls[1].params)}`);
    assert(result.toolResults.map((item) => item.toolName).join(',') === toolNames.join(','), 'result tool evidence should preserve actual tool order');
    assert(!result.message.includes('实际工具：'), `user-facing message should not list internal tool evidence: ${result.message}`);
    assert(!/，id\s*\d+/.test(result.message), `user-facing message should not expose raw layer ids: ${result.message}`);
    for (const name of ['基础工具链验证组', '中文文字', '红色圆形徽章', '蓝色矩形底卡']) {
      assert(result.message.includes(name), `message should mention confirmed target ${name}: ${result.message}`);
    }
    return {
      message: result.message,
      toolNames,
      requestedLayerChecks: result.data.requestedLayerChecks
    };
  }));

  cases.push(await runCase('text-copy-location-query-routes-to-readonly-layer-inspection', () => {
    const input = '波浪边缘，增添法式感。 的文案文本 在那个位置那个图层';
    const control = buildAgentIntentControlPlaneDecision({
      userInput: input,
      photoshopConnected: true,
      hasDocument: true
    });
    assert(control.requestKind === 'read_only_inspect', `expected read_only_inspect, got ${control.requestKind}: ${JSON.stringify(control)}`);

    const route = fastDeterministicRoute(input);
    assert(route, 'expected deterministic layer inspection route');
    assert(route.skillId === 'layer-management', `unexpected skill: ${route.skillId}`);
    assert(route.skillParams.action === 'inspect', `unexpected action: ${route.skillParams.action}`);
    assert(route.skillParams.inspectMode === 'text-layer-location', `unexpected inspectMode: ${route.skillParams.inspectMode}`);
    assert(route.skillParams.textContent === '波浪边缘，增添法式感。', `unexpected textContent: ${route.skillParams.textContent}`);
    return { requestKind: control.requestKind, route };
  }));

  cases.push(await runCase('text-copy-location-inspect-reads-text-layer-and-bounds', async () => {
    const executor = getSkillExecutor('layer-management');
    const toolCalls = [];
    const hierarchy = [
      {
        id: 186,
        name: '详情页',
        kind: 'group',
        visible: true,
        children: [
          {
            id: 177,
            name: '1',
            kind: 'group',
            visible: true,
            children: [
              { id: 176, name: '文案', kind: 'group', visible: true, children: [] },
              {
                id: 172,
                name: '图片',
                kind: 'group',
                visible: true,
                children: [
                  { id: 303, name: '波浪边缘，增添法式感。', kind: 'text', visible: true }
                ]
              }
            ]
          }
        ]
      }
    ];
    const textLayers = [
      {
        id: 303,
        name: '波浪边缘，增添法式感。',
        kind: 'text',
        text: '波浪边缘，增添法式感。',
        content: '波浪边缘，增添法式感。',
        visible: true
      }
    ];
    const previousWindow = global.window;
    global.window = {
      designEcho: {
        callMcpToolCancellable: async (_requestKey, toolName, params) => {
          toolCalls.push({ toolName, params });
          if (toolName === 'getDocumentInfo') return mcpTextResult({ success: true, documentName: '模板.psb' });
          if (toolName === 'getLayerHierarchy') return mcpTextResult({ success: true, documentName: '模板.psb', hierarchy, totalLayers: 5 });
          if (toolName === 'getAllTextLayers') return mcpTextResult({ success: true, layers: textLayers });
          if (toolName === 'getLayerBounds') {
            return mcpTextResult({
              success: true,
              bounds: { left: 128, top: 456, right: 498, bottom: 522, width: 370, height: 66 }
            });
          }
          return mcpTextResult({ success: true });
        }
      }
    };
    let result;
    try {
      result = await executor.execute({
        params: {
          action: 'inspect',
          inspectMode: 'text-layer-location',
          textContent: '波浪边缘，增添法式感。',
          userIntent: '波浪边缘，增添法式感。 的文案文本 在那个位置那个图层'
        },
        callbacks: {}
      });
    } finally {
      if (previousWindow === undefined) {
        delete global.window;
      } else {
        global.window = previousWindow;
      }
    }

    const toolNames = toolCalls.map((call) => call.toolName);
    assert(result.success === true, `text location inspect should succeed: ${result.message || result.error}`);
    assert(toolNames.join(',') === 'getDocumentInfo,getLayerHierarchy,getAllTextLayers,getLayerBounds', `unexpected tool order: ${toolNames.join(',')}`);
    assert(result.message.includes('波浪边缘，增添法式感。'), `message should mention matched copy: ${result.message}`);
    assert(result.message.includes('图片/波浪边缘，增添法式感。'), `message should mention layer path: ${result.message}`);
    assert(result.message.includes('x=128') && result.message.includes('y=456'), `message should mention bounds: ${result.message}`);
    assert(!result.message.includes('getAllTextLayers'), `user-facing message should not expose internal tool names: ${result.message}`);
    assert(!/layerId|图层 id|图层ID/i.test(result.message), `user-facing message should not expose raw ids: ${result.message}`);
    assert(result.data?.matchedTextLayer?.layerName === '波浪边缘，增添法式感。', `unexpected matched layer: ${JSON.stringify(result.data)}`);
    assert(result.data?.bounds?.left === 128 && result.data?.bounds?.top === 456, `unexpected bounds: ${JSON.stringify(result.data?.bounds)}`);
    return { message: result.message, toolNames, matchedTextLayer: result.data.matchedTextLayer, bounds: result.data.bounds };
  }));

  cases.push(await runCase('hidden-commercial-color-names-are-counted-for-lightness-sort', async () => {
    const route = fastDeterministicRoute('好的那现在你重新调整让他们从浅到深从上往下的排');
    assert(route, 'expected lightness reorder route');
    assert(route.skillId === 'layer-management', `unexpected skill: ${route.skillId}`);

    const executor = getSkillExecutor('layer-management');
    const toolCalls = [];
    let hierarchy = [
      { id: 10, name: '矩形选取', kind: 'solidColor', visible: false },
      { id: 7, name: '藏青', kind: 'pixel', visible: false },
      { id: 6, name: '白色', kind: 'pixel', visible: false },
      { id: 4, name: '浅蓝', kind: 'pixel', visible: true },
      { id: 3, name: '浅灰', kind: 'pixel', visible: true },
      { id: 8, name: '雾蓝', kind: 'pixel', visible: true },
      { id: 5, name: '深灰', kind: 'pixel', visible: true },
      { id: 9, name: '黑色', kind: 'pixel', visible: true },
      { id: 2, name: '浅卡其', kind: 'pixel', visible: true },
      { id: 1, name: '背景', kind: 'pixel', visible: true, locked: true }
    ];
    const previousWindow = global.window;
    global.window = {
      designEcho: {
        callMcpToolCancellable: async (_requestKey, toolName, params) => {
          toolCalls.push({ toolName, params });
          if (toolName === 'getDocumentInfo') return mcpTextResult({ success: true });
          if (toolName === 'getLayerHierarchy') return mcpTextResult({ success: true, hierarchy, totalLayers: hierarchy.length });
          if (toolName === 'reorderLayer') {
            const layerId = Number(params.layerId);
            const index = hierarchy.findIndex((layer) => Number(layer.id) === layerId);
            if (index < 0) return mcpTextResult({ success: false, error: `layer not found ${layerId}` });
            const [layer] = hierarchy.splice(index, 1);
            if (params.action === 'top') hierarchy = [layer, ...hierarchy];
            return mcpTextResult({ success: true });
          }
          if (toolName === 'getAcceptanceSnapshot') return mcpTextResult({ success: true });
          return mcpTextResult({ success: true });
        }
      }
    };
    let result;
    try {
      result = await executor.execute({ params: route.skillParams, callbacks: {} });
    } finally {
      global.window = previousWindow;
    }

    const reorderCalls = toolCalls.filter((call) => call.toolName === 'reorderLayer');
    assert(result.success === true, `sort execution should succeed: ${result.message || result.error}`);
    assert(result.data?.sortedLayers?.length === 8, `expected 8 color layers, got ${result.data?.sortedLayers?.length}`);
    assert(result.data?.hiddenColorLayerCount === 2, `expected 2 hidden color layers, got ${result.data?.hiddenColorLayerCount}`);
    assert(reorderCalls.length === 8, `expected 8 controlled top reorder calls for 8 color layers, got ${reorderCalls.length}`);
    assert(result.data?.controlledExecution?.status === 'completed_verified', `controlled execution should verify layer order: ${JSON.stringify(result.data?.controlledExecution)}`);
    assert(result.data?.controlledBenchmark?.canClaimRuntimeSpeedup === false, 'controlled benchmark must not claim runtime speedup');
    assert(result.data.sortedLayers.some((layer) => layer.layerName === '藏青'), '藏青 should be treated as a color layer');
    assert(result.data.sortedLayers.some((layer) => layer.layerName === '浅卡其'), '浅卡其 should be treated as a color layer');
    assert(!result.data.sortedLayers.some((layer) => layer.layerName === '矩形选取'), 'selection helper layer must not be treated as color layer');
    assert(!result.data.sortedLayers.some((layer) => layer.layerName === '背景'), 'background must not be treated as color layer');
    return {
      message: result.message,
      sortedCount: result.data.sortedLayers.length,
      hiddenColorLayerCount: result.data.hiddenColorLayerCount,
      reorderCalls: reorderCalls.length,
      controlledExecutionStatus: result.data.controlledExecution.status
    };
  }));

  cases.push(await runCase('simple-stack-order-does-not-route-to-autonomous', () => {
    const route = fastDeterministicRoute('把当前选中的图层置顶');
    assert(route, 'expected deterministic route');
    assert(route.skillId === 'layer-management', `unexpected skill: ${route.skillId}`);
    assert(route.skillParams.action === 'reorder', `unexpected action: ${route.skillParams.action}`);
    assert(route.skillParams.reorderAction === 'top', `unexpected reorderAction: ${route.skillParams.reorderAction}`);
    assert(route.skillParams.useCurrentSelection === true, 'current selected layer request should set useCurrentSelection');
    assert(!route.skillParams.layerName, `should not extract fake layerName: ${route.skillParams.layerName}`);
    return route;
  }));

  cases.push(await runCase('action-first-layer-operations-route-deterministically', () => {
    const copy = fastDeterministicRoute('复制当前选中的图层');
    const remove = fastDeterministicRoute('删除选中的图层');
    const ungroup = fastDeterministicRoute('取消当前图层组编组');

    assert(copy, 'expected copy route');
    assert(copy.skillId === 'layer-management', `unexpected copy skill: ${copy.skillId}`);
    assert(copy.skillParams.action === 'duplicate', `unexpected copy action: ${copy.skillParams.action}`);
    assert(copy.skillParams.useCurrentSelection === true, 'copy selected layer should use current selection');
    assert(!copy.skillParams.layerName, `copy should not extract generic layerName: ${copy.skillParams.layerName}`);

    assert(remove, 'expected delete route');
    assert(remove.skillId === 'layer-management', `unexpected delete skill: ${remove.skillId}`);
    assert(remove.skillParams.action === 'delete', `unexpected delete action: ${remove.skillParams.action}`);
    assert(remove.skillParams.useCurrentSelection === true, 'delete selected layer should use current selection');
    assert(!remove.skillParams.layerName, `delete should not extract generic layerName: ${remove.skillParams.layerName}`);

    assert(ungroup, 'expected ungroup route');
    assert(ungroup.skillId === 'layer-management', `unexpected ungroup skill: ${ungroup.skillId}`);
    assert(ungroup.skillParams.action === 'ungroup', `unexpected ungroup action: ${ungroup.skillParams.action}`);
    assert(ungroup.skillParams.useCurrentSelection === true, 'ungroup current group should use current selection');
    assert(!ungroup.skillParams.layerName, `ungroup should not extract generic layerName: ${ungroup.skillParams.layerName}`);

    return { copy, remove, ungroup };
  }));

  cases.push(await runCase('above-below-target-layer-name-is-extracted', () => {
    const above = fastDeterministicRoute('把图层A移到图层B上方');
    const below = fastDeterministicRoute('把图层A移到图层B下方');

    assert(above, 'expected above route');
    assert(above.skillId === 'layer-management', `unexpected above skill: ${above.skillId}`);
    assert(above.skillParams.action === 'reorder', `unexpected above action: ${above.skillParams.action}`);
    assert(above.skillParams.reorderAction === 'above', `unexpected above reorderAction: ${above.skillParams.reorderAction}`);
    assert(above.skillParams.layerName === 'A', `unexpected above layerName: ${above.skillParams.layerName}`);
    assert(above.skillParams.targetLayerName === 'B', `unexpected above targetLayerName: ${above.skillParams.targetLayerName}`);

    assert(below, 'expected below route');
    assert(below.skillId === 'layer-management', `unexpected below skill: ${below.skillId}`);
    assert(below.skillParams.action === 'reorder', `unexpected below action: ${below.skillParams.action}`);
    assert(below.skillParams.reorderAction === 'below', `unexpected below reorderAction: ${below.skillParams.reorderAction}`);
    assert(below.skillParams.layerName === 'A', `unexpected below layerName: ${below.skillParams.layerName}`);
    assert(below.skillParams.targetLayerName === 'B', `unexpected below targetLayerName: ${below.skillParams.targetLayerName}`);

    return { above, below };
  }));

  cases.push(await runCase('move-layer-to-named-group-routes-deterministically', () => {
    const route = fastDeterministicRoute('把“波浪边缘，增添法式感。”移动到“文案”组');
    assert(route, 'expected move-to-group route');
    assert(route.skillId === 'layer-management', `unexpected skill: ${route.skillId}`);
    assert(route.skillParams.action === 'move-to-group', `unexpected action: ${route.skillParams.action}`);
    assert(route.skillParams.layerName === '波浪边缘，增添法式感。', `unexpected layerName: ${route.skillParams.layerName}`);
    assert(route.skillParams.targetGroupName === '文案', `unexpected targetGroupName: ${route.skillParams.targetGroupName}`);
    return route;
  }));

  cases.push(await runCase('ambiguous-contextual-move-to-copy-group-does-not-invent-source-layer', () => {
    const route = fastDeterministicRoute('帮我移动图层顺序到文案图层');
    assert(route === null, `contextual move without source layer should stay model-led instead of inventing params: ${JSON.stringify(route)}`);
    return { route };
  }));

  cases.push(await runCase('move-layer-to-group-executes-with-default-inside-position', async () => {
    const executor = getSkillExecutor('layer-management');
    const toolCalls = [];
    const hierarchy = [
      {
        id: 186,
        name: '详情页',
        kind: 'group',
        visible: true,
        children: [
          {
            id: 177,
            name: '1',
            kind: 'group',
            visible: true,
            children: [
              { id: 176, name: '文案', kind: 'group', visible: true, children: [] },
              {
                id: 172,
                name: '图片',
                kind: 'group',
                visible: true,
                children: [
                  { id: 303, name: '波浪边缘，增添法式感。', kind: 'text', visible: true }
                ]
              }
            ]
          }
        ]
      }
    ];
    const previousWindow = global.window;
    global.window = {
      designEcho: {
        callMcpToolCancellable: async (_requestKey, toolName, params) => {
          toolCalls.push({ toolName, params });
          if (toolName === 'getDocumentInfo') return mcpTextResult({ success: true, documentName: '模板.psb' });
          if (toolName === 'getLayerHierarchy') return mcpTextResult({ success: true, documentName: '模板.psb', hierarchy, totalLayers: 5 });
          if (toolName === 'moveLayerToGroup') return mcpTextResult({ success: true, layerId: params.layerId, targetGroupId: params.targetGroupId });
          if (toolName === 'getAcceptanceSnapshot') return mcpTextResult({ success: true });
          return mcpTextResult({ success: true });
        }
      }
    };
    let result;
    try {
      result = await executor.execute({
        params: {
          action: 'move-to-group',
          layerName: '波浪边缘，增添法式感。',
          targetGroupName: '文案',
          userIntent: '把“波浪边缘，增添法式感。”移动到“文案”组'
        },
        callbacks: {}
      });
    } finally {
      if (previousWindow === undefined) {
        delete global.window;
      } else {
        global.window = previousWindow;
      }
    }

    const moveCall = toolCalls.find((call) => call.toolName === 'moveLayerToGroup');
    assert(result.success === true, `move-to-group should succeed: ${result.message || result.error}`);
    assert(moveCall, `expected moveLayerToGroup call: ${JSON.stringify(toolCalls)}`);
    assert(moveCall.params.layerId === 303, `unexpected source layer id: ${JSON.stringify(moveCall.params)}`);
    assert(moveCall.params.targetGroupId === 176, `unexpected target group id: ${JSON.stringify(moveCall.params)}`);
    assert(moveCall.params.position === 'inside', `move-to-group should default to inside without asking: ${JSON.stringify(moveCall.params)}`);
    return { message: result.message, moveCall };
  }));

  cases.push(await runCase('group-current-selection-routes-and-executes-without-layer-ids', async () => {
    const route = fastDeterministicRoute('把当前选中的图层编组');
    assert(route, 'expected group route');
    assert(route.skillId === 'layer-management', `unexpected group skill: ${route.skillId}`);
    assert(route.skillParams.action === 'group', `unexpected group action: ${route.skillParams.action}`);
    assert(route.skillParams.useCurrentSelection === true, 'group current selection should use current selection');
    assert(!route.skillParams.layerName, `group should not extract generic layerName: ${route.skillParams.layerName}`);

    const executor = getSkillExecutor('layer-management');
    const toolCalls = [];
    const previousWindow = global.window;
    global.window = {
      designEcho: {
        callMcpToolCancellable: async (_requestKey, toolName, params) => {
          toolCalls.push({ toolName, params });
          if (toolName === 'getDocumentInfo') return mcpTextResult({ success: true });
          if (toolName === 'getLayerHierarchy') {
            return mcpTextResult({
              success: true,
              layers: [
                { id: 1, name: '标题', kind: 'text' },
                { id: 2, name: '图片', kind: 'pixel' }
              ]
            });
          }
          if (toolName === 'groupLayers') return mcpTextResult({ success: true, group: { id: 99, name: '组 1', layerCount: 2 } });
          if (toolName === 'getAcceptanceSnapshot') return mcpTextResult({ success: true });
          return mcpTextResult({ success: true });
        }
      }
    };
    let result;
    try {
      result = await executor.execute({ params: route.skillParams, callbacks: {} });
    } finally {
      global.window = previousWindow;
    }

    const groupCall = toolCalls.find((call) => call.toolName === 'groupLayers');
    assert(result.success === true, `group execution should succeed: ${result.message || result.error}`);
    assert(groupCall, 'expected groupLayers call');
    assert(groupCall.params.useCurrentSelection === true, 'groupLayers should preserve useCurrentSelection');
    assert(!Array.isArray(groupCall.params.layerIds), 'groupLayers should not invent layerIds for current selection');
    return { route, groupCall, message: result.message };
  }));

  cases.push(await runCase('default-agent-tool-catalog-stays-consistent-for-simple-ops', () => {
    const names = new Set(getDefaultAgentTools().map((tool) => tool.name));
    for (const name of ['closeDocument', 'reorderLayer', 'deleteLayer', 'renameLayer', 'ungroupLayers']) {
      assert(names.has(name), `default agent tool list missing ${name}`);
    }
    return { checked: ['closeDocument', 'reorderLayer', 'deleteLayer', 'renameLayer', 'ungroupLayers'] };
  }));

  cases.push(await runCase('uxp-layer-property-tools-use-recursive-resolution', () => {
    const uxpToolPath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'layer', 'layer-properties.ts');
    const source = fs.readFileSync(uxpToolPath, 'utf8');
    assert(source.includes('function findLayerById'), 'UXP layer property tool must expose recursive findLayerById');
    assert(source.includes('function findLayerByName'), 'UXP layer property tool must expose recursive findLayerByName');
    assert(source.includes('function resolveLayer'), 'UXP layer property tool must resolve active, id, and name targets through one helper');
    assert(!source.includes('doc.layers.find'), 'UXP layer property tools must not use shallow doc.layers.find');
    return { uxpToolPath };
  }));

  cases.push(await runCase('completion-contract-covers-document-save-close-and-layer-management', () => {
    const save = buildTaskCompletionContract({
      task: '帮我把当前文档保存为 PSD',
      context: { skillId: 'document-management', intentMode: 'save' },
      toolCallLog: [
        { name: 'getDocumentInfo', arguments: {}, result: { success: true } },
        { name: 'saveDocument', arguments: { format: 'psd' }, result: { success: true, acceptance: { enabled: true, verified: true, assertionStatus: 'passed' } } }
      ]
    });
    const close = buildTaskCompletionContract({
      task: '帮我关闭文档不保存',
      context: { skillId: 'document-management', intentMode: 'close' },
      toolCallLog: [
        { name: 'closeDocument', arguments: { save: false }, result: { success: true, acceptance: { enabled: true, verified: true, assertionStatus: 'passed' } } }
      ]
    });
    const layer = buildTaskCompletionContract({
      task: '帮我重命名图层',
      context: { skillId: 'layer-management', intentMode: 'rename' },
      toolCallLog: [
        { name: 'getLayerHierarchy', arguments: {}, result: { success: true } },
        { name: 'renameLayer', arguments: { layerId: 1, newName: '标题' }, result: { success: true, acceptance: { enabled: true, verified: true, assertionStatus: 'passed' } } },
        { name: 'getAcceptanceSnapshot', arguments: {}, result: { success: true } }
      ]
    });

    assert(save && save.kind === 'document_save', `unexpected save kind: ${save && save.kind}`);
    assert(close && close.kind === 'document_close', `unexpected close kind: ${close && close.kind}`);
    assert(layer && layer.kind === 'layer_management', `unexpected layer kind: ${layer && layer.kind}`);
    return {
      save: save.summary,
      close: close.summary,
      layer: layer.summary
    };
  }));

  const payload = {
    success: cases.every((item) => item.status === 'pass'),
    cases
  };
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  if (!payload.success) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
