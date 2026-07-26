#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  extractSkuComboSizesFromText,
  isSkuCardSourceOnlyText,
  isSkuExecutionRequestText,
  isSkuTemplateDesignRequestText,
  isSkuNoteOnlyText,
  inferSkuIntentParamsFromText
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'sku-intent-params.ts'));
const {
  applySharedSkillParamDefaults
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-param-defaults.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const routing = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getToolsListString
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const skuBatchSkill = getSkillById('sku-batch');
  assert(skuBatchSkill?.description?.includes('execution skill'), 'sku-batch declaration must describe itself as execution-only.');
  assert(Array.isArray(skuBatchSkill?.whenNotToUse) && skuBatchSkill.whenNotToUse.length > 0, 'sku-batch declaration must include whenNotToUse boundaries.');
  assert(!skuBatchSkill.routing.intentSignals.includes('SKU'), 'sku-batch must not use bare SKU as a routing signal.');
  assert(
    skuBatchSkill.routing.decisionGuidance.some((line) => /看到 SKU.+不代表执行授权/.test(line)),
    'sku-batch decisionGuidance must state that bare SKU wording is not execution authorization.'
  );

  const toolExecutorSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'), 'utf8');
  const skillToolsSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts'), 'utf8');
  assert(toolExecutorSource.includes('buildPhotoshopToolSkillPromptSection'), 'tool-executor must build tool prompts through the shared Photoshop skill boundary.');
  const toolPrompt = getToolsListString();
  assert(toolPrompt.includes('Adobe Photoshop 技能使用边界'), 'Photoshop tool list must expose an umbrella skill boundary.');
  assert(toolPrompt.includes('能力问答、SKU 说明、只读查看、规划讨论不要调用'), 'skuLayout tool description must block capability/Q&A misuse.');
  assert(
    skillToolsSource.indexOf('options.context?.userInput') >= 0
      && skillToolsSource.indexOf('options.context?.userInput') < skillToolsSource.indexOf('params?.userIntent'),
    'autonomous skill-tool defaults must prefer the original user request over model-supplied shorthand userIntent.'
  );

  assert(sameJson(extractSkuComboSizesFromText('帮我做2-3-4的自选备注'), [2, 3, 4]), '2-3-4 must map to [2,3,4]');
  assert(sameJson(extractSkuComboSizesFromText('帮我做单双装备注'), [1]), '单双装 must map to [1]');
  assert(sameJson(extractSkuComboSizesFromText('帮我做一双 SKU'), [1]), '一双 must map to [1]');

  const plainSku = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '帮我做SKU',
    params: {}
  });
  assert(plainSku.generateNotes === true, 'plain SKU should generate self-select notes by default');
  assert(plainSku.countPerSize === 5, 'plain SKU should keep default countPerSize=5');

  const plainSkuRoute = routing.fastDeterministicRoute('帮我做 SKU');
  assert(plainSkuRoute?.skillId === 'sku-batch', 'plain SKU request with spaces should route to sku-batch');
  assert(plainSkuRoute.skillParams.generateNotes === true, 'plain SKU route should generate self-select notes by default');
  assert(plainSkuRoute.skillParams.onlyNotes === false, 'plain SKU route should not become note-only');
  assert(plainSkuRoute.skillParams.countPerSize === 5, 'plain SKU route should keep countPerSize=5');

  assert(routing.fastDeterministicRoute('SKU 怎么做比较好') === null, 'SKU planning questions must not route to sku-batch');
  assert(routing.fastDeterministicRoute('我想了解一下 SKU 自选备注是什么') === null, 'SKU knowledge questions must not route to sku-batch');
  assert(routing.fastDeterministicRoute('只说明理解，不执行工具：帮我做 SKU') === null, 'explicit no-tool SKU requests must not route to sku-batch');
  assert(routing.fastDeterministicRoute('是否可以开始做 SKU') === null, 'SKU readiness questions must not route to sku-batch');
  assert(routing.fastDeterministicRoute('SKU 执行方案怎么设计') === null, 'SKU execution-plan discussions must not route to sku-batch');
  assert(routing.fastDeterministicRoute('你会做 SKU 吗') === null, 'SKU capability question must not route to sku-batch');
  assert(routing.fastDeterministicRoute('你能做 SKU 吗') === null, 'SKU ability question must not route to sku-batch');
  assert(routing.fastDeterministicRoute('你会怎么做 SKU') === null, 'SKU procedure question must not route to sku-batch');
  assert(routing.fastDeterministicRoute('我问你会不会做 SKU') === null, 'explicit SKU ability question must not route to sku-batch');
  assert(routing.fastDeterministicRoute('你现在支持哪些 SKU 能力') === null, 'SKU capability scope question must not route to sku-batch');
  assert(routing.fastDeterministicRoute('SKU') === null, 'bare SKU keyword must not route to sku-batch');
  assert(isSkuExecutionRequestText('帮我做 SKU') === true, 'plain SKU production request must authorize SKU execution');
  assert(isSkuExecutionRequestText('我还需要对应的 SKU 自选备注') === true, 'corresponding self-select note request must authorize SKU execution');
  assert(isSkuExecutionRequestText('SKU 怎么做比较好') === false, 'SKU planning question must not authorize SKU execution');
  assert(isSkuExecutionRequestText('是否可以开始做 SKU') === false, 'SKU readiness question must not authorize SKU execution');
  assert(isSkuExecutionRequestText('你会做 SKU 吗') === false, 'SKU capability question must not authorize SKU execution');
  assert(isSkuExecutionRequestText('你能做 SKU 吗') === false, 'SKU ability question must not authorize SKU execution');
  assert(isSkuExecutionRequestText('你会怎么做 SKU') === false, 'SKU procedure question must not authorize SKU execution');
  assert(isSkuExecutionRequestText('我问你会不会做 SKU') === false, 'explicit SKU ability question must not authorize SKU execution');
  assert(isSkuExecutionRequestText('你现在支持哪些 SKU 能力') === false, 'SKU capability scope question must not authorize SKU execution');
  assert(isSkuExecutionRequestText('SKU') === false, 'bare SKU keyword must not authorize SKU execution');

  const cardSkuExamBrief = '请使用当前项目 E:\\DesignEchoDemo\\C-1194 的图片，先完成卡片式 SKU：规格为 2双装、3双装、4双装，并生成对应自选备注。请先看项目里的图片，选出适合做 SKU 的平铺或单品图；参考 D:\\DesignEchoDemo\\C-1137 的成品风格，但不要复制参考项目文件。完成后请读回导出的结果，并说明哪些文件可以验收。';
  assert(isSkuExecutionRequestText(cardSkuExamBrief) === true, 'card SKU exam brief must authorize SKU execution even when it says not to copy the reference project.');
  const stagedSkuExecutionBrief = '请基于当前项目图片做卡片式 SKU：规格 2双装、3双装、4双装，并生成对应自选备注。请先确认候选图是否适合作为 SKU 卡片素材，再整理 SKU 源文档和模板执行。完成后读回结果并说明哪些文件可验收。';
  assert(isSkuExecutionRequestText(stagedSkuExecutionBrief) === true, 'staged SKU execution brief with visual confirmation and readback must still authorize SKU execution.');
  const stagedSkuControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: stagedSkuExecutionBrief,
    hasDocument: true,
    photoshopConnected: true
  });
  assert(stagedSkuControlPlane.requestKind === 'autonomous_execution', 'staged SKU execution brief must enter autonomous_execution (SKU 已 ReAct 化交给 Agent；sku-batch 仅作循环内受控工作流桥，不由引擎直执).');
  const stagedSkuRoute = routing.fastDeterministicRoute(stagedSkuExecutionBrief);
  assert(stagedSkuRoute?.skillId === 'sku-batch', 'staged SKU execution brief must route to sku-batch.');
  assert(stagedSkuRoute.skillParams.runSkuCardVisualConfirmationBeforeSourcePreparation === true, 'staged SKU route must enable SKU candidate visual confirmation.');
  const cardSkuControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: cardSkuExamBrief,
    hasDocument: true,
    photoshopConnected: true
  });
  assert(cardSkuControlPlane.requestKind === 'autonomous_execution', 'card SKU exam brief must enter autonomous_execution (SKU 已 ReAct 化交给 Agent；sku-batch 仅作循环内受控工作流桥，不由引擎直执).');
  assert(cardSkuControlPlane.executionAuthorization === 'confirmed_tool_required', 'card SKU exam brief must authorize confirmed tool execution.');
  const cardSkuRoute = routing.fastDeterministicRoute(cardSkuExamBrief);
  assert(cardSkuRoute?.skillId === 'sku-batch', 'card SKU exam brief must route to sku-batch instead of project-image-analysis.');
  assert(sameJson(cardSkuRoute.skillParams.comboSizes, [2, 3, 4]), 'card SKU exam brief must preserve comboSizes=[2,3,4].');
  assert(cardSkuRoute.skillParams.generateNotes === true, 'card SKU exam brief must generate self-select notes.');
  assert(cardSkuRoute.skillParams.requireSkuComboConfirmation === true, 'card SKU exam brief must ask for editable SKU combo confirmation before writes.');
  assert(cardSkuRoute.skillParams.requireSkuCardTemplateDesignConfirmation === true, 'card SKU exam brief must ask for template design confirmation before preparing missing card templates.');
  assert(cardSkuRoute.skillParams.skuSourcePreparationMode === 'card-source-from-project-images', 'card SKU exam brief must enable project-image source preparation.');
  assert(cardSkuRoute.skillParams.runSkuCardVisualConfirmationBeforeSourcePreparation === true, 'card SKU exam brief must enable bounded SKU candidate visual confirmation before source preparation.');
  assert(cardSkuRoute.skillParams.skuTemplatePreparationMode === 'card-placeholder-templates', 'card SKU exam brief must enable card placeholder template preparation.');
  const cardSkuDefaultsFromSparseModelToolCall = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: cardSkuExamBrief,
    mode: 'execute',
    params: {
      comboSizes: [],
      userIntent: ''
    }
  });
  assert(
    sameJson(cardSkuDefaultsFromSparseModelToolCall.comboSizes, [2, 3, 4]),
    'sparse autonomous SKU tool params with empty comboSizes must still bind explicit user-requested sizes.'
  );
  assert(
    cardSkuDefaultsFromSparseModelToolCall.userIntent === cardSkuExamBrief,
    'sparse autonomous SKU tool params with empty userIntent must keep the original user request.'
  );
  assert(
    cardSkuDefaultsFromSparseModelToolCall.skuTemplatePreparationMode === 'card-placeholder-templates',
    'sparse autonomous SKU tool params must still enable card template preparation from the original request.'
  );
  assert(
    cardSkuDefaultsFromSparseModelToolCall.requireSkuCardTemplateDesignConfirmation === true,
    'sparse autonomous SKU tool params must still require template design confirmation from the original request.'
  );
  assert(
    cardSkuDefaultsFromSparseModelToolCall.runSkuCardVisualConfirmationBeforeSourcePreparation === true,
    'sparse autonomous SKU tool params must still enable SKU candidate visual confirmation from the original request.'
  );
  assert(
    cardSkuDefaultsFromSparseModelToolCall.skuSourceOutputRelativePath === 'PSD/SKU-card-source.psb',
    'card SKU source preparation must use a non-destructive stable source document path.'
  );

  const existingSkuSourceTemplateBrief = '请基于当前项目 E:\\DesignEchoDemo\\C-1194 中已经准备好的 SKU 色卡素材，创建卡片式 SKU 排版模板并生成 2双装、3双装、4双装组合图，以及对应的 2双、3双、4双自选备注。优先使用项目已有的 SKU 色卡源文件和模板文件，不要重新选图，不要重新制作色卡素材。完成后读取导出结果，说明生成了哪些文件可以验收。';
  assert(isSkuExecutionRequestText(existingSkuSourceTemplateBrief) === true, 'existing SKU source template brief must authorize SKU execution.');
  assert(isSkuTemplateDesignRequestText(existingSkuSourceTemplateBrief) === true, 'existing SKU source template brief must be recognized as template design work.');
  const existingSkuSourceControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: existingSkuSourceTemplateBrief,
    hasDocument: false,
    photoshopConnected: true
  });
  assert(existingSkuSourceControlPlane.requestKind === 'autonomous_execution', 'existing SKU source template brief must stay in autonomous design execution.');
  assert(existingSkuSourceControlPlane.matchedSignals.includes('sku_template_design_autonomy'), 'existing SKU source template brief must carry the SKU template design autonomy signal.');
  const existingSkuSourceRoute = routing.fastDeterministicRoute(existingSkuSourceTemplateBrief);
  assert(existingSkuSourceRoute == null, 'existing SKU source template brief must not route to sku-batch before Agent designs the template.');

  const skuComboConfirmationCardBrief = '请基于当前项目 E:\\DesignEchoDemo\\C-1194 中名为 SKU 的文档生成 2双装、3双装、4双装的 SKU 组合候选，并创建确认卡片让我确认；不要重新做色卡源素材，不要出图。按照文档名称区分：SKU 就是 SKU，不要使用自选备注或双装模板作为 SKU 源。';
  assert(isSkuExecutionRequestText(skuComboConfirmationCardBrief) === true, 'SKU combo confirmation-card brief must authorize sku-batch even when final export is disabled.');
  assert(isSkuCardSourceOnlyText(skuComboConfirmationCardBrief) === false, 'SKU combo confirmation-card brief must not be treated as source-only just because it mentions not rebuilding source material.');
  const skuComboConfirmationCardRoute = routing.fastDeterministicRoute(skuComboConfirmationCardBrief);
  assert(skuComboConfirmationCardRoute?.skillId === 'sku-batch', 'SKU combo confirmation-card brief must route to sku-batch.');
  assert(sameJson(skuComboConfirmationCardRoute.skillParams.comboSizes, [2, 3, 4]), 'SKU combo confirmation-card brief must preserve 2/3/4 sizes.');
  assert(skuComboConfirmationCardRoute.skillParams.requireSkuComboConfirmation === true, 'SKU combo confirmation-card brief must require the editable confirmation card.');
  assert(skuComboConfirmationCardRoute.skillParams.preferExistingSkuSourceForCardPreparation === true, 'SKU combo confirmation-card brief must reuse the document named SKU instead of rebuilding source material.');
  assert(skuComboConfirmationCardRoute.skillParams.sourceOnly !== true, 'SKU combo confirmation-card route must not set sourceOnly.');

  const confirmedSkuComboContinuation = '我已确认 SKU 组合：2双：颜色1+颜色2；3双：颜色1+颜色2+颜色3；4双：颜色1+颜色2+颜色3+颜色4。需要生成自选备注。请基于确认后的组合继续执行。';
  const confirmedSkuComboRoute = routing.fastDeterministicRoute(confirmedSkuComboContinuation);
  assert(confirmedSkuComboRoute?.skillId === 'sku-batch', 'confirmed SKU combo card continuation must route back to sku-batch.');
  assert(sameJson(confirmedSkuComboRoute.skillParams.comboSizes, [2, 3, 4]), 'confirmed SKU combo card continuation must preserve combo sizes.');
  assert(confirmedSkuComboRoute.skillParams.generateNotes === true, 'confirmed SKU combo card continuation must preserve self-select note request.');
  assert(confirmedSkuComboRoute.skillParams.requireSkuComboConfirmation === false, 'confirmed SKU combo card continuation must not ask for the same confirmation card again.');

  const sourceOnlySkuCardBrief = [
    '请只基于当前项目 E:\\DesignEchoDemo\\C-1194 创建 SKU 色卡素材，不生成 SKU 组合图，不导出成品 SKU，不生成自选备注。',
    '要求：',
    '1. 先识别哪些项目图片适合作为 SKU 色卡素材，优先选择单只/单双袜子的清晰图片。',
    '2. 创建卡片式 SKU 色卡源文档，保存到项目目录的 PSD/SKU-card-source.psb。',
    '3. 色卡需要包含编号、色名、商品图、色卡底；商品图必须剪切到色卡底，不能溢出。',
    '4. 完成后读回文档信息或验收快照，只说明色卡素材是否已准备好，以及保存到了哪个文件。',
    '5. 本轮只做色卡素材，不继续生成 2双、3双、4双组合图。'
  ].join('\n');
  assert(isSkuCardSourceOnlyText(sourceOnlySkuCardBrief) === true, 'source-only SKU card brief must be recognized as source-only.');
  assert(isSkuExecutionRequestText(sourceOnlySkuCardBrief) === true, 'source-only SKU card brief must authorize SKU execution.');
  const sourceOnlyControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: sourceOnlySkuCardBrief,
    hasDocument: false,
    photoshopConnected: true
  });
  assert(sourceOnlyControlPlane.requestKind === 'autonomous_execution', 'source-only SKU card brief must enter autonomous_execution (SKU 已 ReAct 化交给 Agent；sku-batch 仅作循环内受控工作流桥，不由引擎直执).');
  const sourceOnlyRoute = routing.fastDeterministicRoute(sourceOnlySkuCardBrief);
  assert(sourceOnlyRoute?.skillId === 'sku-batch', 'source-only SKU card brief must route to sku-batch.');
  assert(sourceOnlyRoute.skillParams.sourceOnly === true, 'source-only SKU card route must set sourceOnly=true.');
  assert(sourceOnlyRoute.skillParams.generateNotes === false, 'source-only SKU card route must not generate self-select notes.');
  assert(!sourceOnlyRoute.skillParams.comboSizes || sourceOnlyRoute.skillParams.comboSizes.length === 0, 'source-only SKU card route must not extract combo sizes from "do not generate 2/3/4".');
  assert(sourceOnlyRoute.skillParams.countPerSize === 0, 'source-only SKU card route must not plan combo counts.');
  assert(sourceOnlyRoute.skillParams.skuSourcePreparationMode === 'card-source-from-project-images', 'source-only SKU card route must enable card source preparation.');
  assert(sourceOnlyRoute.skillParams.allowSkuCardSourcePreparation === true, 'source-only SKU card route must allow card source preparation.');
  assert(sourceOnlyRoute.skillParams.allowSkuCardTemplatePreparation === false, 'source-only SKU card route must not prepare combo templates.');
  assert(!sourceOnlyRoute.skillParams.skuTemplatePreparationMode || sourceOnlyRoute.skillParams.skuTemplatePreparationMode === 'disabled', 'source-only SKU card route must keep template preparation disabled.');

  const cardSkuDefaultsFromWrongModelToolCall = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: cardSkuExamBrief,
    mode: 'execute',
    params: {
      comboSizes: [1, 2],
      userIntent: '使用当前项目图片制作卡片式 SKU',
      skuSourceOutputRelativePath: 'SKU/源文件.psb',
      skuTemplateOutputRelativeDir: 'SKU'
    }
  });
  assert(
    sameJson(cardSkuDefaultsFromWrongModelToolCall.comboSizes, [2, 3, 4]),
    'explicit user-requested SKU sizes must override non-empty model-extracted comboSizes.'
  );
  assert(
    cardSkuDefaultsFromWrongModelToolCall.userIntent === cardSkuExamBrief,
    'explicit SKU execution must preserve original user intent even when the model supplies a shortened userIntent.'
  );
  assert(
    cardSkuDefaultsFromWrongModelToolCall.skuSourceOutputRelativePath === 'PSD/SKU-card-source.psb',
    'explicit card SKU execution must override model-supplied source paths that would put PSD/PSB files in the SKU export folder.'
  );
  assert(
    cardSkuDefaultsFromWrongModelToolCall.skuTemplateOutputRelativeDir === '模板文件',
    'explicit card SKU execution must override model-supplied template output dirs that would mix templates into exports.'
  );

  const skuReadOnlyRequests = [
    '查看SKU素材',
    '帮我查看 SKU 素材',
    '看一下 SKU 配置',
    '帮我看看 SKU 有哪些颜色'
  ];
  for (const request of skuReadOnlyRequests) {
    assert(routing.fastDeterministicRoute(request) === null, `read-only SKU inspection must not route to sku-batch: ${request}`);
    assert(isSkuExecutionRequestText(request) === false, `read-only SKU inspection must not authorize SKU execution: ${request}`);
  }

  const genericSku = inferSkuIntentParamsFromText('帮我做SKU');
  assert(genericSku.generateNotes === true, 'generic SKU should include self-select notes by default');
  assert(genericSku.onlyNotes === false, 'generic SKU should still generate combo images');

  const fourSku = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '帮我做4双的SKU组合，需要3个',
    params: {}
  });
  assert(sameJson(fourSku.comboSizes, [4]), '4双 SKU must extract comboSizes=[4]');
  assert(fourSku.countPerSize === 3, '需要3个 must extract countPerSize=3');
  assert(fourSku.generateNotes === true, 'explicit combo SKU should still generate notes unless disabled');

  const noNotesSku = inferSkuIntentParamsFromText('帮我做SKU，不需要自选备注');
  assert(noNotesSku.generateNotes === false, 'explicit no-note SKU should disable self-select notes');
  assert(noNotesSku.onlyNotes === false, 'explicit no-note SKU should keep combo work enabled');

  const comboOnlySku = inferSkuIntentParamsFromText('只要组合，帮我做SKU');
  assert(comboOnlySku.generateNotes === false, 'combo-only SKU should disable self-select notes');
  assert(comboOnlySku.onlyNotes === false, 'combo-only SKU should not become note-only');

  const noteOnly = routing.fastDeterministicRoute('帮我做2-3-4的自选备注');
  assert(noteOnly?.skillId === 'sku-batch', '2-3-4 self-select note should route to sku-batch');
  assert(noteOnly.skillParams.onlyNotes === true, '2-3-4 self-select note must set onlyNotes=true');
  assert(sameJson(noteOnly.skillParams.comboSizes, [2, 3, 4]), '2-3-4 self-select note must preserve combo sizes');
  assert(noteOnly.skillParams.generateNotes === true, 'explicit self-select note must set generateNotes=true');

  const singleNote = routing.fastDeterministicRoute('帮我做单双装自选备注');
  assert(singleNote?.skillId === 'sku-batch', '单双装自选备注 should route to sku-batch');
  assert(singleNote.skillParams.onlyNotes === true, '单双装自选备注 must set onlyNotes=true');
  assert(sameJson(singleNote.skillParams.comboSizes, [1]), '单双装自选备注 must preserve comboSizes=[1]');

  const inferred = inferSkuIntentParamsFromText('帮我做4双的SKU组合，需要3个，不需要自选备注');
  assert(sameJson(inferred.comboSizes, [4]), 'inferred comboSizes should include 4');
  assert(inferred.countPerSize === 3, 'inferred countPerSize should be 3');
  assert(inferred.generateNotes === false, 'explicit no-note request should keep generateNotes=false');
  assert(inferred.onlyNotes === false, 'explicit no-note request must not become onlyNotes=true');

  const comboPlusNotes = inferSkuIntentParamsFromText('帮我做SKU，每个规格6个组合以及对应自选备注');
  assert(comboPlusNotes.countPerSize === 6, 'combined SKU+note request should preserve countPerSize=6');
  assert(comboPlusNotes.generateNotes === true, 'combined SKU+note request should generate notes');
  assert(comboPlusNotes.onlyNotes === false, 'combined SKU+note request must not become onlyNotes=true');

  const correspondingNoteOnly = routing.fastDeterministicRoute('我还需要对应的SKU自选备注');
  assert(correspondingNoteOnly?.skillId === 'sku-batch', 'corresponding SKU self-select note should route to sku-batch');
  assert(correspondingNoteOnly.skillParams.onlyNotes === true, 'corresponding SKU self-select note must be note-only');
  assert(correspondingNoteOnly.skillParams.generateNotes === true, 'corresponding SKU self-select note must generate notes');
  assert(isSkuNoteOnlyText('我还需要对应的SKU自选备注') === true, 'SKU自选备注 should not be treated as color-combo work');

  const spacedCorrespondingNoteOnly = routing.fastDeterministicRoute('我还需要对应的 SKU 自选备注');
  assert(spacedCorrespondingNoteOnly?.skillId === 'sku-batch', 'spaced corresponding SKU self-select note should route to sku-batch');
  assert(spacedCorrespondingNoteOnly.skillParams.onlyNotes === true, 'spaced corresponding SKU self-select note must be note-only');
  assert(spacedCorrespondingNoteOnly.skillParams.generateNotes === true, 'spaced corresponding SKU self-select note must generate notes');
  assert(!spacedCorrespondingNoteOnly.skillParams.specifiedColors, 'note-only route must not invent specified colors');
  assert(isSkuNoteOnlyText('我还需要对应的 SKU 自选备注') === true, 'spaced SKU self-select note should not be treated as color-combo work');

  const skuNoteOnly = routing.fastDeterministicRoute('只做 SKU 备注');
  assert(skuNoteOnly?.skillId === 'sku-batch', 'explicit SKU note request should route to sku-batch');
  assert(skuNoteOnly.skillParams.onlyNotes === true, 'explicit SKU note request must set onlyNotes=true');
  assert(skuNoteOnly.skillParams.generateNotes === true, 'explicit SKU note request must generate notes');
  assert(isSkuExecutionRequestText('只做 SKU 备注') === true, 'explicit SKU note request must authorize SKU execution');
  assert(isSkuNoteOnlyText('只做 SKU 备注') === true, 'explicit SKU note request should be note-only');

  const supplementalSkuNote = routing.fastDeterministicRoute('补 SKU 备注');
  assert(supplementalSkuNote?.skillId === 'sku-batch', 'supplemental SKU note request should route to sku-batch');
  assert(supplementalSkuNote.skillParams.onlyNotes === true, 'supplemental SKU note request must set onlyNotes=true');
  assert(supplementalSkuNote.skillParams.generateNotes === true, 'supplemental SKU note request must generate notes');

  const sizedSkuNote = routing.fastDeterministicRoute('只做 2-3-4 SKU备注');
  assert(sizedSkuNote?.skillId === 'sku-batch', 'sized SKU note request should route to sku-batch');
  assert(sizedSkuNote.skillParams.onlyNotes === true, 'sized SKU note request must set onlyNotes=true');
  assert(sameJson(sizedSkuNote.skillParams.comboSizes, [2, 3, 4]), 'sized SKU note request must preserve combo sizes');

  assert(routing.fastDeterministicRoute('只做备注') === null, 'bare note request without SKU context must not route to sku-batch');
  assert(isSkuExecutionRequestText('只做备注') === false, 'bare note request without SKU context must not authorize SKU execution');

  console.log(JSON.stringify({
    success: true,
    cases: {
      plainSku,
      fourSku,
      noteOnly: noteOnly.skillParams,
      singleNote: singleNote.skillParams,
      inferred,
      comboPlusNotes,
      genericSku,
      noNotesSku,
      comboOnlySku,
      plainSkuRoute: plainSkuRoute.skillParams,
      correspondingNoteOnly: correspondingNoteOnly.skillParams,
      spacedCorrespondingNoteOnly: spacedCorrespondingNoteOnly.skillParams,
      skuNoteOnly: skuNoteOnly.skillParams,
      supplementalSkuNote: supplementalSkuNote.skillParams,
      sizedSkuNote: sizedSkuNote.skillParams
    },
    boundary: [
      '普通 SKU 默认包含自选备注，除非用户明确说只要组合或不要备注。',
      '用户明确自选备注时才生成备注；1双/单双仍由 self-select note policy 跳过。',
      '单双/一双/1双都归一为 comboSizes=[1]。'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
