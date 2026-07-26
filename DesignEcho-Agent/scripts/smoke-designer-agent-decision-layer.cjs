const fs = require('fs');
const path = require('path');
const assert = require('assert');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildDesignerAgentDecisionContract,
  resolveDesignerAgentProjectVisualObservation
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'designer-agent-decision-contract.ts'));
const {
  buildDesignerAgentAutonomyPrinciplesPromptSection
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'designer-agent-autonomy-principles.ts'));

const cases = [];

function record(name, fn) {
  try {
    const details = fn();
    cases.push({ name, status: 'pass', details });
  } catch (error) {
    cases.push({
      name,
      status: 'fail',
      details: {
        message: error && error.message ? error.message : String(error)
      }
    });
  }
}

record('visual-observation-readiness-requires-asset-bound-structured-content', () => {
  assert.strictEqual(resolveDesignerAgentProjectVisualObservation({ explicit: true }), false);
  assert.strictEqual(resolveDesignerAgentProjectVisualObservation({
    visualInsightCache: {
      source: 'provided-options',
      entries: [{ insight: { assetId: 'asset-1', path: 'C:/project/sock.png', summary: '袜子', modelId: 'vision' } }]
    }
  }), false);
  assert.strictEqual(resolveDesignerAgentProjectVisualObservation({
    visualInsightCache: {
      source: 'provided-options',
      entries: [{ insight: { assetId: 'asset-1', path: 'C:/project/sock.png', material: '针织面料' } }]
    }
  }), true);
});

record('builds-public-design-decision-contract-for-main-image', () => {
  const contract = buildDesignerAgentDecisionContract({
    userTask: '帮我做一个袜子主图',
    scenario: 'main-image',
    visualInsightCache: {
      source: 'provided-options',
      entries: [{ insight: { assetId: 'asset-1', path: 'C:/project/sock.png', productType: '短筒圆点袜' } }]
    },
    agentDecision: {
      source: 'model-agent',
      designGoal: '做一张突出透气和弹力的袜子主图',
      productUnderstanding: ['短筒圆点袜', '袜口颜色不同'],
      hierarchy: {
        primarySubject: '单只袜子实拍图',
        informationPriority: ['主视觉', '标题', '三条卖点']
      },
      color: {
        paletteIntent: '深色背景搭配清爽蓝色点缀'
      },
      typography: {
        tone: '清晰直接'
      },
      assetSelection: {
        selectionPrinciples: ['优先选择单只或单双袜子的清晰原片']
      },
      toolWorkflow: [
        { phase: 'inspect', goal: '确认素材和卖点' },
        { phase: 'compose', goal: '生成当前阶段草稿' },
        { phase: 'verify', goal: '检查图片和文字是否成立' }
      ],
      acceptanceCriteria: ['画面有真实产品', '文字可读', '不直接导出未复核画面']
    }
  });

  assert.strictEqual(contract.status, 'ready');
  assert(contract.publicDesignIntent.includes('突出透气和弹力'));
  assert(contract.publicDesignIntent.includes('单只袜子实拍图'));
  assert(contract.publicObservationGoals.some((item) => item.intent === 'image_fit'));
  assert(contract.publicObservationGoals.some((item) => item.intent === 'text_readability'));
  assert(contract.decisionOptions.some((item) => item.id === 'make_stage_draft'), 'contract should expose stage-draft as an Agent option');
  assert(contract.decisionOptions.some((item) => item.id === 'ask_or_advise_user'), 'contract should allow Agent to advise or ask user');
  assert(contract.promptSection.includes('可选决策路径'));
  assert(contract.promptSection.includes('由主 Agent 自己选择'));
  assert(!contract.boundaries.join('\n').includes('直接调用 Photoshop'));
  assert(contract.boundaries.some((item) => item.includes('不替主 Agent 决定设计路线')));
  assert(contract.toolUseGuidance.some((item) => item.includes('先判断')));
  return contract;
});

record('blocks-write-guidance-when-design-decision-is-missing', () => {
  const contract = buildDesignerAgentDecisionContract({
    userTask: '做一个详情页',
    scenario: 'detail-page'
  });

  assert.strictEqual(contract.status, 'needs_design_decision');
  assert(contract.blockers.some((item) => item.includes('设计判断')));
  assert(contract.decisionOptions.some((item) => item.id === 'form_design_decision'));
  assert(contract.toolUseGuidance.some((item) => item.includes('不要直接生成最终稿')));
  return contract;
});

record('requires-visual-observation-for-design-write-work', () => {
  const contract = buildDesignerAgentDecisionContract({
    userTask: '做一个 SKU 色卡',
    scenario: 'sku',
    agentDecision: {
      source: 'model-agent',
      designGoal: '做一组卡片式 SKU 色卡',
      hierarchy: { informationPriority: ['商品图', '色名', '组合说明'] },
      color: { paletteIntent: '保留商品原图色彩' },
      typography: { tone: '清楚标注颜色' },
      assetSelection: { selectionPrinciples: ['优先使用单只或单双袜子清晰图'] },
      toolWorkflow: [
        { phase: 'inspect', goal: '识别 SKU 图' },
        { phase: 'compose', goal: '创建色卡卡片' },
        { phase: 'verify', goal: '检查剪切和编号' }
      ],
      acceptanceCriteria: ['商品图在卡片内', '色名正确', '图片不溢出']
    }
  });

  assert.strictEqual(contract.status, 'needs_visual_observation');
  assert(contract.blockers.some((item) => item.includes('素材')));
  assert(contract.publicObservationGoals.some((item) => item.intent === 'image_fit'));
  return contract;
});

record('sku-template-design-keeps-agent-choice-space', () => {
  const contract = buildDesignerAgentDecisionContract({
    userTask: '基于已有 SKU 色卡素材创建卡片式 SKU 排版模板，规格是 2-3-4 双装以及对应自选备注。',
    scenario: 'sku'
  });

  const optionIds = contract.decisionOptions.map((item) => item.id);
  assert.strictEqual(contract.status, 'needs_design_decision');
  assert(optionIds.includes('inspect_sku_resources'), 'SKU template work should let Agent inspect existing resources first.');
  assert(optionIds.includes('design_sku_template'), 'SKU template work should expose autonomous template design.');
  assert(optionIds.includes('confirm_sku_combos'), 'SKU template work should expose editable combo confirmation.');
  assert(optionIds.includes('run_sku_batch_production'), 'SKU template work should keep production as an option after design is ready.');
  assert(contract.promptSection.includes('模板排版属于设计判断') || contract.promptSection.includes('自主设计 SKU 排版模板'));
  assert(contract.promptSection.includes('不是固定流程'));
  return {
    status: contract.status,
    optionIds,
    promptSection: contract.promptSection
  };
});

record('sku-generic-template-request-has-default-design-path-instead-of-clarification-loop', () => {
  const contract = buildDesignerAgentDecisionContract({
    userTask: '就是通用的 SKU 设计模板',
    scenario: 'sku'
  });

  const prompt = contract.promptSection;
  assert(prompt.includes('通用 SKU 模板默认推进方式'), 'generic SKU template work should expose a default design path.');
  assert(prompt.includes('平台、模块数量、风格偏好不是开工前必问项'), 'generic SKU preferences should not become blocking questions.');
  assert(prompt.includes('先检查当前 Photoshop 文档、项目目录和 PSD/SKU.psb'), 'SKU work should inspect existing resources before asking.');
  assert(prompt.includes('只有缺少项目路径') && prompt.includes('才向用户提问'), 'clarification should be limited to real blockers.');
  assert(prompt.includes('普通设计偏好应先给推荐并推进'), 'Agent should advise and continue for non-blocking preferences.');
  return { promptSection: prompt };
});

record('autonomous-agent-is-wired-to-designer-decision-contract', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  assert(source.includes('buildDesignerAgentDecisionContract'));
  assert(source.includes('buildDesignerAgentPromptSection'));
  assert(source.includes('设计判断准备'));
  assert(source.includes('可选路径：'));
  return { checked: 'autonomous-agent.executor.ts' };
});

record('autonomous-agent-prompt-keeps-design-principles-not-fixed-script', () => {
  const executorSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
    'utf8'
  );
  const principlesSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'shared', 'designer-agent-autonomy-principles.ts'),
    'utf8'
  );
  // 2026-07-02 命名残留清零：契约字段 freshDetailPageTask → designDisciplineTask（品类无关），
  // 注入行为不变（纪律激活时追加详情页项目级策略文案）。
  const prompt = buildDesignerAgentAutonomyPrinciplesPromptSection({
    designDisciplineTask: true,
    hasPhotoshopDocument: false
  });

  assert(executorSource.includes('buildDesignerAgentAutonomyPrinciplesPromptSection'), 'executor should compose the autonomy principles module.');
  assert(!executorSource.includes('【设计工作原则】'), 'executor should not inline large design-principle prompt text.');
  assert(!executorSource.includes('【设计执行工作流】'), 'executor must not present visual design as a fixed workflow.');
  assert(!executorSource.includes('0. 先做设计调研'), 'executor must not encode numbered design script steps.');
  assert(!executorSource.includes('你的第一个工具调用必须是 createDocument'), 'executor must not force a single first tool for all design tasks.');

  assert(principlesSource.includes('【设计工作原则】'), 'principles module should describe design principles.');
  assert(principlesSource.includes('主 Agent 自己选择'), 'principles module should keep route selection owned by the main Agent.');
  assert(principlesSource.includes('可以选择'), 'principles module should expose optional choices instead of one mandatory route.');
  assert(!principlesSource.includes('【设计执行工作流】'), 'principles module must not revive a fixed workflow heading.');
  assert(!principlesSource.includes('0. 先做设计调研'), 'principles module must not encode numbered design script steps.');
  assert(!principlesSource.includes('你的第一个工具调用必须是 createDocument'), 'principles module must not force one first tool.');

  assert(prompt.includes('【设计工作原则】'));
  assert(prompt.includes('当前没有打开的 Photoshop 文档。'));
  assert(prompt.includes('主 Agent 自己选择'));
  assert(prompt.includes('可以选择'));
  assert(!prompt.includes('【设计执行工作流】'));
  assert(!prompt.includes('0. 先做设计调研'));
  assert(!prompt.includes('你的第一个工具调用必须是 createDocument'));

  return { checked: 'autonomous-agent prompt autonomy module' };
});

const failed = cases.filter((item) => item.status !== 'pass');
const report = {
  success: failed.length === 0,
  cases
};

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(
  path.join(tmpDir, 'designer-agent-decision-layer-smoke.json'),
  JSON.stringify(report, null, 2),
  'utf8'
);

console.log(JSON.stringify({
  success: report.success,
  cases: cases.map(({ name, status }) => ({ name, status }))
}, null, 2));

process.exit(report.success ? 0 : 1);
