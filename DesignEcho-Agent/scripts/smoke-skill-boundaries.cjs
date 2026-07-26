const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  getSkillById,
  getUserFacingSkills
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  applySharedSkillParamDefaults
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-param-defaults.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'skill-boundaries-smoke.json');
  const mdPath = path.join(outDir, 'skill-boundaries-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Skill Boundaries Smoke',
    '',
    `- success: ${payload.success}`,
    ''
  ];

  for (const testCase of payload.cases) {
    lines.push(`## ${testCase.name}`);
    lines.push(`- status: ${testCase.status}`);
    if (testCase.details) {
      lines.push(`- details: ${testCase.details}`);
    }
    lines.push('');
  }

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

function run() {
  const cases = [];

  const bridgeSkill = getSkillById('agent-panel-bridge');
  cases.push({
    name: 'agent-panel-bridge-is-internal-debug',
    status:
      bridgeSkill
      && bridgeSkill.visibility === 'internal-debug'
      && bridgeSkill.kind === 'debug'
        ? 'pass'
        : 'fail',
    details: bridgeSkill ? JSON.stringify({ visibility: bridgeSkill.visibility, kind: bridgeSkill.kind }) : 'missing skill'
  });

  const autonomousSkill = getSkillById('autonomous-agent');
  cases.push({
    name: 'autonomous-agent-is-system-only',
    status:
      autonomousSkill
      && autonomousSkill.visibility === 'system-only'
        ? 'pass'
        : 'fail',
    details: autonomousSkill ? JSON.stringify({ visibility: autonomousSkill.visibility, kind: autonomousSkill.kind }) : 'missing skill'
  });

  const documentSkill = getSkillById('document-management');
  cases.push({
    name: 'document-management-is-user-facing-operation',
    status:
      documentSkill
      && documentSkill.visibility === 'user-facing'
      && documentSkill.kind === 'operation'
        ? 'pass'
        : 'fail',
    details: documentSkill ? JSON.stringify({ visibility: documentSkill.visibility, kind: documentSkill.kind }) : 'missing skill'
  });

  const shapeMorphingSkill = getSkillById('shape-morphing');
  cases.push({
    name: 'shape-morphing-is-system-only-operation',
    status:
      shapeMorphingSkill
      && shapeMorphingSkill.visibility === 'system-only'
      && shapeMorphingSkill.kind === 'operation'
        ? 'pass'
        : 'fail',
    details: shapeMorphingSkill ? JSON.stringify({ visibility: shapeMorphingSkill.visibility, kind: shapeMorphingSkill.kind }) : 'missing skill'
  });

  const shapeMorphingExecutor = getSkillExecutor('shape-morphing');
  cases.push({
    name: 'shape-morphing-has-no-agent-executor',
    status: !shapeMorphingExecutor ? 'pass' : 'fail',
    details: shapeMorphingExecutor ? 'executor still registered' : 'not registered'
  });

  const visibleSkillIds = new Set(getUserFacingSkills().map((skill) => skill.id));
  cases.push({
    name: 'user-facing-skill-list-excludes-internal-and-system',
    status:
      !visibleSkillIds.has('agent-panel-bridge')
      && !visibleSkillIds.has('autonomous-agent')
      && !visibleSkillIds.has('shape-morphing')
        ? 'pass'
        : 'fail',
    details: JSON.stringify(Array.from(visibleSkillIds).slice(0, 20))
  });

  const mainImageSkill = getSkillById('main-image-design');
  const mainImageSizeParam = mainImageSkill?.parameters?.find((param) => param.name === 'size');
  const defaultMainImageParams = applySharedSkillParamDefaults({
    skillId: 'main-image-design',
    userInput: '帮我做主图',
    mode: 'execute',
    params: {}
  });
  const explicitMainImageSizeParams = applySharedSkillParamDefaults({
    skillId: 'main-image-design',
    userInput: '帮我做一张800主图',
    mode: 'execute',
    params: { size: '800' }
  });
  cases.push({
    name: 'main-image-default-entry-plans-three-delivery-sizes',
    status:
      mainImageSkill
      && mainImageSizeParam
      && mainImageSizeParam.default === undefined
      && JSON.stringify(defaultMainImageParams.sizes) === JSON.stringify(['800', '750', '1200'])
      && defaultMainImageParams.size === undefined
      && defaultMainImageParams.mainImageExecutionMode === 'strategy-only'
      && defaultMainImageParams.executionScope === 'disposable-document'
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      sizeParamDefault: mainImageSizeParam?.default,
      defaultMainImageParams
    })
  });
  cases.push({
    name: 'main-image-explicit-single-size-does-not-expand-to-three-sizes',
    status:
      explicitMainImageSizeParams.size === '800'
      && explicitMainImageSizeParams.sizes === undefined
        ? 'pass'
        : 'fail',
    details: JSON.stringify(explicitMainImageSizeParams)
  });

  // 新设计：创意主图（「帮我做主图」）不再被硬路由到规格化生产脚本（main-image-design），
  // 而是落到自主设计循环真实创作（基于设计方向+素材）。规格化术语（白底图/点击图/转化图）
  // 仍命中 main-image-design——下一个断言守护。
  const mainImageRoute = fastDeterministicRoute('帮我做主图');
  cases.push({
    name: 'creative-main-image-falls-through-to-autonomous-design-not-spec-script',
    status:
      (!mainImageRoute || mainImageRoute.skillId !== 'main-image-design')
        ? 'pass'
        : 'fail',
    details: mainImageRoute
      ? JSON.stringify({ skillId: mainImageRoute.skillId, skillParams: mainImageRoute.skillParams })
      : 'no deterministic route → autonomous design'
  });

  const projectMainImageBrief = '请使用当前项目 E:\\DesignEchoDemo\\C-1194 的图片，完成一张可验收的电商袜子主图：画布 800x800，适合淘宝商品首图，主体要清楚，风格参考项目素材本身的温柔浅色调，可以有简短卖点文案，但不要做模板占位图。请把结果导出到项目的“主图”目录，完成后读回导出文件并说明哪个文件可以验收。';
  const projectMainImageRoute = fastDeterministicRoute(projectMainImageBrief);
  const projectMainImageControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: projectMainImageBrief,
    hasDocument: true,
    photoshopConnected: true
  });
  // 治理审计(2026-07-01)阶段3a：main-image-design 补齐 controlledRouteEntry 后，与
  // detail-page-design 统一——deterministic route 的参数抽取（fastDeterministicRoute）仍然
  // 照常产出丰富的 skillParams（供自主循环内调用 main-image-design 技能工具时使用），但
  // control-plane 的最终 requestKind 从 execute_skill 改判为 autonomous_execution，不再直接
  // 短路进固定流水线执行器。
  cases.push({
    name: 'project-context-main-image-delivery-routes-to-controlled-main-image-skill',
    status:
      projectMainImageRoute
      && projectMainImageRoute.skillId === 'main-image-design'
      && projectMainImageRoute.skillParams?.mainImageExecutionMode === 'product-disposable-live'
      && projectMainImageRoute.skillParams?.executionScope === 'disposable-document'
      && projectMainImageRoute.skillParams?.sourceAssetKind === 'selected-project-image'
      && projectMainImageRoute.skillParams?.outputDirPolicy === 'project-main-image-dir'
      && projectMainImageRoute.skillParams?.size === 'custom'
      && projectMainImageRoute.skillParams?.customSize?.width === 800
      && projectMainImageRoute.skillParams?.customSize?.height === 800
      && projectMainImageRoute.skillParams?.approvedLiveExecution !== true
      && projectMainImageRoute.skillParams?.approvedLiveAdapterRun !== true
      && projectMainImageRoute.skillParams?.userCheckpointApproved !== true
      && projectMainImageControlPlane.requestKind === 'autonomous_execution'
      && projectMainImageControlPlane.executionAuthorization === 'confirmed_tool_required'
      && projectMainImageControlPlane.matchedSignals?.includes('shared_skill_routing:main-image-design')
      && projectMainImageControlPlane.matchedSignals?.includes('controlled_skill_autonomous_entry')
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      deterministicRoute: projectMainImageRoute
        ? { skillId: projectMainImageRoute.skillId, skillParams: projectMainImageRoute.skillParams }
        : null,
      controlPlane: {
        requestKind: projectMainImageControlPlane.requestKind,
        executionAuthorization: projectMainImageControlPlane.executionAuthorization,
        matchedSignals: projectMainImageControlPlane.matchedSignals
      }
    })
  });

  const whiteBgMainImageRoute = fastDeterministicRoute('帮我做白底图');
  cases.push({
    name: 'main-image-white-background-intent-routes-with-white-bg-type',
    status:
      whiteBgMainImageRoute
      && whiteBgMainImageRoute.skillId === 'main-image-design'
      && whiteBgMainImageRoute.skillParams?.imageType === 'white-bg'
      && JSON.stringify(whiteBgMainImageRoute.skillParams?.sizes) === JSON.stringify(['800', '750', '1200'])
        ? 'pass'
        : 'fail',
    details: whiteBgMainImageRoute ? JSON.stringify({
      skillId: whiteBgMainImageRoute.skillId,
      skillParams: whiteBgMainImageRoute.skillParams
    }) : 'no route'
  });

  const existingSkuCardTemplateBrief = '项目中已经有 SKU 色卡素材，请基于我们项目中的 SKU 色卡素材创建一个卡片式 SKU 排版模板，并生成 2双装、3双装、4双装组合图以及对应自选备注。不要重新做色卡源素材，先使用当前 Photoshop 中名为 SKU 的文档作为 SKU。';
  const existingSkuCardTemplateRoute = fastDeterministicRoute(existingSkuCardTemplateBrief);
  const existingSkuCardTemplateControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: existingSkuCardTemplateBrief,
    hasDocument: true,
    photoshopConnected: true
  });
  cases.push({
    name: 'existing-sku-card-template-design-routes-to-autonomous-agent-not-sku-batch',
    status:
      existingSkuCardTemplateRoute === null
      && existingSkuCardTemplateControlPlane.requestKind === 'autonomous_execution'
      && existingSkuCardTemplateControlPlane.executionAuthorization === 'confirmed_tool_required'
      && existingSkuCardTemplateControlPlane.matchedSignals.includes('sku_template_design_autonomy')
      && existingSkuCardTemplateControlPlane.matchedSignals.includes('stage:design_template')
      && /模板排版属于设计判断/.test(existingSkuCardTemplateControlPlane.reason)
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      deterministicRoute: existingSkuCardTemplateRoute
        ? { skillId: existingSkuCardTemplateRoute.skillId, skillParams: existingSkuCardTemplateRoute.skillParams }
        : null,
      controlPlane: {
        requestKind: existingSkuCardTemplateControlPlane.requestKind,
        executionAuthorization: existingSkuCardTemplateControlPlane.executionAuthorization,
        matchedSignals: existingSkuCardTemplateControlPlane.matchedSignals,
        reason: existingSkuCardTemplateControlPlane.reason
      }
    })
  });

  const detailPageDeliveryBrief = '请使用当前项目 E:\\DesignEchoDemo\\C-1194 的图片，完成一个可验收的电商袜子详情页长图：宽度 790px，高度按内容自然展开，至少包含首屏氛围、核心卖点、材质/透气、弹力贴合、耐磨不易滑、颜色/搭配建议这几个模块。不要做空模板或占位图，不要直接套脚本模板；请根据项目素材选择合适图片并排版。请把结果导出到项目的“详情页”目录，完成后读回导出文件并说明哪个文件可以验收。';
  const detailPageDeliveryRoute = fastDeterministicRoute(detailPageDeliveryBrief);
  const detailPageDeliveryControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: detailPageDeliveryBrief,
    hasDocument: true,
    photoshopConnected: true
  });
  cases.push({
    name: 'fresh-detail-page-delivery-routes-to-autonomous-design-not-template-skill',
    status:
      (!detailPageDeliveryRoute || detailPageDeliveryRoute.skillId !== 'detail-page-design')
      && detailPageDeliveryControlPlane.requestKind === 'autonomous_execution'
      && detailPageDeliveryControlPlane.executionAuthorization === 'confirmed_tool_required'
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      deterministicRoute: detailPageDeliveryRoute
        ? { skillId: detailPageDeliveryRoute.skillId, skillParams: detailPageDeliveryRoute.skillParams }
        : null,
      controlPlane: {
        requestKind: detailPageDeliveryControlPlane.requestKind,
        executionAuthorization: detailPageDeliveryControlPlane.executionAuthorization,
        matchedSignals: detailPageDeliveryControlPlane.matchedSignals
      }
    })
  });

  const closeRoute = fastDeterministicRoute('帮我关闭文档不保存');
  cases.push({
    name: 'document-close-does-not-route-to-bridge',
    status:
      closeRoute
      && closeRoute.skillId === 'document-management'
      && closeRoute.skillParams?.action === 'close'
      && closeRoute.skillParams?.save === false
        ? 'pass'
        : 'fail',
    details: closeRoute ? JSON.stringify(closeRoute.skillParams) : 'no route'
  });

  const saveDetailPageRoute = fastDeterministicRoute('帮我把详情页文档保存到项目的PSD中');
  cases.push({
    name: 'save-detail-page-document-routes-to-document-save',
    status:
      saveDetailPageRoute
      && saveDetailPageRoute.skillId === 'document-management'
      && saveDetailPageRoute.skillParams?.action === 'save'
      && saveDetailPageRoute.skillParams?.format === 'psd'
      && saveDetailPageRoute.skillParams?.saveAs === true
      && saveDetailPageRoute.skillParams?.projectSubdir === 'PSD'
        ? 'pass'
        : 'fail',
    details: saveDetailPageRoute ? JSON.stringify({
      skillId: saveDetailPageRoute.skillId,
      skillParams: saveDetailPageRoute.skillParams
    }) : 'no route'
  });

  const exportDetailPageRoute = fastDeterministicRoute('帮我把详情页文档导出成PNG');
  cases.push({
    name: 'export-detail-page-document-routes-to-document-save',
    status:
      exportDetailPageRoute
      && exportDetailPageRoute.skillId === 'document-management'
      && exportDetailPageRoute.skillParams?.action === 'save'
      && exportDetailPageRoute.skillParams?.format === 'png'
      && exportDetailPageRoute.skillParams?.saveAs === true
        ? 'pass'
        : 'fail',
    details: exportDetailPageRoute ? JSON.stringify({
      skillId: exportDetailPageRoute.skillId,
      skillParams: exportDetailPageRoute.skillParams
    }) : 'no route'
  });

  const bridgeRoute = fastDeterministicRoute('帮我和面板一起调试详情页文案溢出');
  cases.push({
    name: 'explicit-debug-still-routes-to-bridge',
    status:
      bridgeRoute
      && bridgeRoute.skillId === 'agent-panel-bridge'
        ? 'pass'
        : 'fail',
    details: bridgeRoute ? JSON.stringify(bridgeRoute.skillParams) : 'no route'
  });

  const bridgeExecutorPath = path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'agent-panel-bridge.executor.ts');
  const bridgeExecutorSource = fs.readFileSync(bridgeExecutorPath, 'utf8');
  cases.push({
    name: 'agent-panel-bridge-message-no-longer-dumps-debug-payload',
    status:
      !bridgeExecutorSource.includes('**面板消息（可直接发送）**')
      && !bridgeExecutorSource.includes('**MCP工具总数**')
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      dumpsPanelMessage: bridgeExecutorSource.includes('**面板消息（可直接发送）**'),
      dumpsToolCount: bridgeExecutorSource.includes('**MCP工具总数**')
    })
  });

  const chatPanelPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx');
  const chatPanelSource = fs.readFileSync(chatPanelPath, 'utf8');
  cases.push({
    name: 'chat-panel-does-not-promote-reasoning-to-user-content',
    status:
      !chatPanelSource.includes('if (json.reasoning) return json.reasoning;')
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      promotesReasoning: chatPanelSource.includes('if (json.reasoning) return json.reasoning;')
    })
  });

  const parserPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'message', 'parser.ts');
  const thinkingBlockPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'message', 'blocks', 'ThinkingBlock.tsx');
  const thinkingProcessPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ThinkingProcess.tsx');
  const legacySystemPromptPath = path.resolve(__dirname, '..', 'src', 'renderer', 'prompts', 'agent-system-prompt.ts');
  const parserSource = fs.readFileSync(parserPath, 'utf8');
  const thinkingBlockSource = fs.readFileSync(thinkingBlockPath, 'utf8');
  const thinkingProcessSource = fs.readFileSync(thinkingProcessPath, 'utf8');
  const legacySystemPromptSource = fs.readFileSync(legacySystemPromptPath, 'utf8');
  cases.push({
    name: 'thinking-ui-uses-neutral-chinese-labels',
    status:
      !parserSource.includes("title: hasRealThinking ? 'Pondering' : 'Processing'")
      && !thinkingBlockSource.includes("block.title || 'Pondering'")
      && !thinkingProcessSource.includes("const panelTitle = hasRealThinking ? 'Thinking' : 'Processing';")
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      parserHasOldTitle: parserSource.includes("title: hasRealThinking ? 'Pondering' : 'Processing'"),
      blockHasOldTitle: thinkingBlockSource.includes("block.title || 'Pondering'"),
      processHasOldTitle: thinkingProcessSource.includes("const panelTitle = hasRealThinking ? 'Thinking' : 'Processing';")
    })
  });

  cases.push({
    name: 'legacy-renderer-agent-system-prompt-does-not-require-think-tags',
    status:
      !legacySystemPromptSource.includes('你必须先展示你的思维过程')
      && !legacySystemPromptSource.includes('<think>')
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      requiresThinkingDisplay: legacySystemPromptSource.includes('你必须先展示你的思维过程'),
      containsThinkTag: legacySystemPromptSource.includes('<think>')
    })
  });

  const legacyPromptForbiddenRouteInstructions = [
    '只输出最终决策 JSON',
    '请用 JSON 格式输出你的决策',
    '"type": "tool_call"',
    '"skill_execution"',
    '"direct_response"',
    '"clarification_needed"',
    '行动优先',
    '能做就做，不要问问题',
    '始终返回 JSON'
  ];
  const legacyPromptRouteLeaks = legacyPromptForbiddenRouteInstructions.filter((marker) => legacySystemPromptSource.includes(marker));
  cases.push({
    name: 'legacy-renderer-agent-system-prompt-does-not-carry-json-route-protocol',
    status: legacyPromptRouteLeaks.length === 0 ? 'pass' : 'fail',
    details: JSON.stringify({
      forbiddenRouteInstructionLeaks: legacyPromptRouteLeaks
    })
  });

  const success = cases.every((item) => item.status === 'pass');
  const payload = { success, cases };
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run();
