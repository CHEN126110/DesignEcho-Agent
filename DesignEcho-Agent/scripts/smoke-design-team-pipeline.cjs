/**
 * 设计团队多智能体增量 smoke：
 * - 评审裁决解析（pass / needs_fix / 嵌入文本 / 不可解析 / 异常 issues 过滤）
 * - 团队共享工作区（沉淀、摘要注入、角色排除、超长截断、最新产出）
 * - 流水线工具的执行分类与 schema 暴露
 */
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

const { parseCriticVerdict } = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-team-verdict.ts'));
const { DesignTeamWorkspace } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'workspace.ts'));
const { classifyAgentToolExecution } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const { TEAM_PIPELINE_TOOL, DELEGATE_TOOL } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
const {
    sanitizeToolOutputForModel,
    extractImageFromToolResult
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-result-sanitizer.ts'));
const {
    isParallelSafeToolCall,
    partitionToolCallsForParallelExecution,
    PARALLEL_SAFE_TEAMMATE_ROLES
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-parallel-execution-policy.ts'));
const {
    listDesignTeammateDefinitions
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'registry.ts'));
const {
    buildStatePatchForTeammateOutput
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'state-sync.ts'));

const cases = [];
function check(name, fn) {
    try {
        const ok = fn();
        cases.push({ name, status: ok ? 'pass' : 'fail', details: ok ? undefined : 'assertion returned false' });
    } catch (error) {
        cases.push({ name, status: 'fail', details: String(error && error.message || error) });
    }
}

// ==================== 裁决解析 ====================

check('verdict-pass-parses', () => {
    const v = parseCriticVerdict('整体布局合理，层级清晰。\n{"verdict":"pass"}');
    return v.status === 'pass' && v.issues.length === 0 && v.reviewText.includes('整体布局合理');
});

check('verdict-needs-fix-with-issues', () => {
    const v = parseCriticVerdict([
        '价格区块对比不足。',
        '{"verdict":"needs_fix","issues":[{"target":"价格图层","problem":"字号过小","suggestion":"提升到 48px"},{"target":"主标题","problem":"与背景对比不足","suggestion":"加深底色"}]}'
    ].join('\n'));
    return v.status === 'needs_fix'
        && v.issues.length === 2
        && v.issues[0].target === '价格图层'
        && v.issues[1].suggestion === '加深底色';
});

check('verdict-needs-fix-preserves-reroute-owner', () => {
    const v = parseCriticVerdict([
        '主标题卖点不聚焦，需要文案队友重出方案。',
        '{"verdict":"needs_fix","issues":[{"owner":"copy","target":"主标题","problem":"卖点泛泛","suggestion":"改成不掉跟场景钩子"}]}'
    ].join('\n'));
    return v.status === 'needs_fix'
        && v.issues.length === 1
        && v.issues[0].owner === 'copy'
        && v.issues[0].target === '主标题';
});

check('verdict-owner-alias-normalized', () => {
    const v = parseCriticVerdict('{"verdict":"needs_fix","issues":[{"owner":"copywriter","target":"副标题","problem":"不够口语","suggestion":"压短"}]}');
    return v.status === 'needs_fix' && v.issues[0].owner === 'copy';
});

check('verdict-embedded-in-prose', () => {
    const v = parseCriticVerdict('评审结论如下 {"verdict":"pass"} 以上。');
    return v.status === 'pass';
});

check('verdict-unparseable-returns-honest-status', () => {
    const v = parseCriticVerdict('画面还行，但价格不够醒目，建议加强。');
    return v.status === 'unparseable' && v.issues.length === 0 && v.reviewText.length > 0;
});

check('verdict-malformed-issues-filtered', () => {
    const v = parseCriticVerdict('{"verdict":"needs_fix","issues":[null,{"foo":1},{"target":"标题","problem":"溢出"}]}');
    return v.status === 'needs_fix' && v.issues.length === 1 && v.issues[0].problem === '溢出';
});

check('verdict-invalid-verdict-value-ignored', () => {
    const v = parseCriticVerdict('{"verdict":"maybe"}');
    return v.status === 'unparseable';
});

// ==================== 团队工作区 ====================

check('workspace-digest-includes-prior-outputs', () => {
    const ws = new DesignTeamWorkspace();
    ws.record({ role: 'scene-analyst', outputType: 'scene_summary', stage: 'analyze', success: true, content: '画面含三个模块', toolsUsed: ['getLayerHierarchy'] });
    const digest = ws.buildContextDigest();
    return digest.includes('画面含三个模块') && digest.includes('场景分析') && digest.includes('analyze');
});

check('workspace-digest-excludes-own-role', () => {
    const ws = new DesignTeamWorkspace();
    ws.record({ role: 'scene-analyst', outputType: 'scene_summary', stage: 'analyze', success: true, content: 'A-内容', toolsUsed: [] });
    ws.record({ role: 'design-strategist', outputType: 'design_plan', stage: 'plan', success: true, content: 'B-计划', toolsUsed: [] });
    const digest = ws.buildContextDigest({ excludeRole: 'design-strategist' });
    return digest.includes('A-内容') && !digest.includes('B-计划');
});

check('workspace-failed-entries-not-in-digest', () => {
    const ws = new DesignTeamWorkspace();
    ws.record({ role: 'executor', outputType: 'execution_report', stage: 'execute', success: false, content: '失败内容', toolsUsed: [] });
    return ws.buildContextDigest() === '';
});

check('workspace-long-entry-truncated', () => {
    const ws = new DesignTeamWorkspace();
    ws.record({ role: 'scene-analyst', outputType: 'scene_summary', stage: 'analyze', success: true, content: '长'.repeat(5000), toolsUsed: [] });
    const digest = ws.buildContextDigest();
    return digest.includes('已截断') && digest.length < 4000;
});

check('workspace-latest-of-type-picks-newest-success', () => {
    const ws = new DesignTeamWorkspace();
    ws.record({ role: 'executor', outputType: 'execution_report', stage: 'execute', success: true, content: '第一次执行', toolsUsed: [] });
    ws.record({ role: 'executor', outputType: 'execution_report', stage: 'revise-1', success: true, content: '修订后执行', toolsUsed: [] });
    const latest = ws.latestOfType('execution_report');
    return latest && latest.content === '修订后执行' && latest.stage === 'revise-1';
});

check('workspace-digest-labels-market-and-copy-outputs', () => {
    const ws = new DesignTeamWorkspace();
    ws.record({ role: 'market-researcher', outputType: 'market_research', stage: 'market', success: true, content: '痛点：袜口勒脚', toolsUsed: [] });
    ws.record({ role: 'copywriter', outputType: 'copy_strategy', stage: 'copy', success: true, content: '主文案：软糯不勒脚', toolsUsed: [] });
    const digest = ws.buildContextDigest();
    return digest.includes('市场洞察')
        && digest.includes('文案策略')
        && digest.includes('袜口勒脚')
        && digest.includes('软糯不勒脚');
});

// ==================== Design Project State 写穿 ====================

check('state-sync-market-research-maps-to-pain-points-and-competitor-notes', () => {
    const patch = buildStatePatchForTeammateOutput({
        role: 'market-researcher',
        outputType: 'market_research',
        stage: 'market',
        success: true,
        content: '{"painPoints":["袜口勒脚","冬天脚冷"],"competitorNotes":["竞品常强调厚度但少讲不勒脚"]}'
    });
    return patch
        && patch.set
        && patch.set.painPoints.length === 2
        && patch.set.competitorNotes[0].includes('竞品')
        && patch.updatedBy.includes('market-researcher');
});

check('state-sync-copy-strategy-maps-to-selling-points-and-copywriting', () => {
    const patch = buildStatePatchForTeammateOutput({
        role: 'copywriter',
        outputType: 'copy_strategy',
        stage: 'copy',
        success: true,
        content: '{"sellingPoints":["软糯不勒脚"],"copywriting":[{"slot":"点击图主标题","text":"软糯包脚，不勒不掉","basis":"袜口勒脚"}]}'
    });
    return patch
        && patch.set
        && patch.upsertFacts[0].statement === '软糯不勒脚'
        && patch.upsertFacts[0].claimType === 'selling_point'
        && patch.factWriteAuthority === 'agent_proposal'
        && patch.set.copywriting[0].slot === '点击图主标题'
        && patch.set.copywriting[0].text.includes('不勒');
});

// ==================== 执行分类与工具暴露 ====================

check('pipeline-tool-classified-as-photoshop-write', () => {
    return classifyAgentToolExecution('runDesignTeamPipeline') === 'photoshop_write';
});

check('delegate-tool-classified-as-stateful-context', () => {
    return classifyAgentToolExecution('delegateToAgent') === 'stateful_context';
});

check('skill-tools-classified-by-behavior', () => {
    return classifyAgentToolExecution('sku-batch') === 'photoshop_write'
        && classifyAgentToolExecution('visual-analysis') === 'read_only_observation'
        && classifyAgentToolExecution('design-reference-search') === 'knowledge_search';
});

check('pipeline-tool-schema-requires-goal', () => {
    return TEAM_PIPELINE_TOOL.name === 'runDesignTeamPipeline'
        && Array.isArray(TEAM_PIPELINE_TOOL.inputSchema.required)
        && TEAM_PIPELINE_TOOL.inputSchema.required.includes('goal')
        && Boolean(TEAM_PIPELINE_TOOL.inputSchema.properties.maxRevisions);
});

check('delegate-tool-mentions-shared-workspace', () => {
    return /workspace/i.test(DELEGATE_TOOL.description);
});

// ==================== Eagle 创意参考接入（EGL-1） ====================

check('eagle-search-tool-classified-as-knowledge-search', () => {
    return classifyAgentToolExecution('searchEagleReferences') === 'knowledge_search';
});

check('eagle-search-tool-in-default-toolbox-with-required-query', () => {
    const { getDefaultAgentTools } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
    const tool = getDefaultAgentTools().find(t => t.name === 'searchEagleReferences');
    return Boolean(tool)
        && Array.isArray(tool.inputSchema.required)
        && tool.inputSchema.required.includes('query')
        && /eagle/i.test(tool.description)
        && /来自 Eagle 素材库|cite/i.test(tool.description);
});

check('eagle-search-tool-allowed-for-research-roles', () => {
    const defs = listDesignTeammateDefinitions();
    const byRole = Object.fromEntries(defs.map(d => [d.role, new Set(d.allowedTools)]));
    return byRole['market-researcher'].has('searchEagleReferences')
        && byRole['design-strategist'].has('searchEagleReferences')
        && byRole['scene-analyst'].has('searchEagleReferences')
        // 执行/精修类角色不需要外部参考检索，保持白名单最小化
        && !byRole['executor'].has('searchEagleReferences');
});

check('eagle-readonly-boundary-blocks-raw-images', () => {
    const {
        buildEagleReadonlyBoundary,
        isEagleReadonlyKnowledgePayloadSafe
    } = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-readonly-knowledge.ts'));
    const boundary = buildEagleReadonlyBoundary();
    return boundary.readonly === true
        && boundary.doesNotWriteEagle === true
        && boundary.doesNotReturnRawImages === true
        && isEagleReadonlyKnowledgePayloadSafe({ results: [{ summary: '极简袜子排版参考' }] }) === true
        && isEagleReadonlyKnowledgePayloadSafe({ results: [{ summary: 'data:image/png;base64,AAAA' }] }) === false
        && isEagleReadonlyKnowledgePayloadSafe({ results: [{ rawImage: 'x' }] }) === false;
});

// ==================== 工具结果证据（截断 + 图像提取） ====================

const FAKE_BASE64 = 'iVBORw0KGgoAAAANSUhEUg'.repeat(40); // ~880 字符的合法 base64 字符集

check('sanitize-truncates-long-base64-in-tool-output', () => {
    const out = sanitizeToolOutputForModel({ success: true, base64: 'A'.repeat(60000), note: '正常字段' });
    return out.base64.length < 2000 && out.base64.includes('已截断') && out.note === '正常字段';
});

check('sanitize-caps-huge-arrays', () => {
    const out = sanitizeToolOutputForModel({ items: Array.from({ length: 200 }, (_, i) => i) });
    return out.items.length === 51 && String(out.items[50]).includes('200');
});

check('extract-image-from-raw-base64-field', () => {
    const img = extractImageFromToolResult({ success: true, base64: FAKE_BASE64, format: 'jpeg' });
    return img && img.mediaType === 'image/jpeg' && img.data === FAKE_BASE64;
});

check('extract-image-from-data-url', () => {
    const img = extractImageFromToolResult({ imageData: `data:image/png;base64,${FAKE_BASE64}` });
    return img && img.mediaType === 'image/png' && img.data === FAKE_BASE64;
});

check('extract-image-rejects-plain-text-and-short-strings', () => {
    const longText = '这是一段很长的中文说明文字。'.repeat(100);
    return extractImageFromToolResult({ base64: longText }) === null
        && extractImageFromToolResult({ base64: 'short' }) === null
        && extractImageFromToolResult('字符串结果') === null
        && extractImageFromToolResult(null) === null;
});

check('extract-image-from-nested-data-field', () => {
    const img = extractImageFromToolResult({ success: true, data: { imageData: FAKE_BASE64 } });
    return img && img.mediaType === 'image/png';
});

// ==================== 并行执行策略 ====================

check('parallel-consecutive-reads-are-batched', () => {
    const batches = partitionToolCallsForParallelExecution([
        { name: 'getDocumentInfo' },
        { name: 'getLayerHierarchy' },
        { name: 'getCanvasSnapshot' }
    ]);
    return batches.length === 1 && batches[0].parallel === true && batches[0].calls.length === 3;
});

check('parallel-write-breaks-batch-and-stays-sequential', () => {
    const batches = partitionToolCallsForParallelExecution([
        { name: 'getDocumentInfo' },
        { name: 'setTextContent', arguments: { layerId: 1, content: 'x' } },
        { name: 'getLayerBounds' }
    ]);
    // 写调用单独成串行批；前后读调用各自成批（单调用批不并发）
    return batches.length === 3
        && batches.every(b => b.parallel === false)
        && batches[1].calls[0].name === 'setTextContent';
});

check('parallel-readonly-delegates-batch-but-executor-delegate-is-sequential', () => {
    const batches = partitionToolCallsForParallelExecution([
        { name: 'delegateToAgent', arguments: { role: 'scene-analyst', task: 'a' } },
        { name: 'delegateToAgent', arguments: { role: 'critic', task: 'b' } },
        { name: 'delegateToAgent', arguments: { role: 'executor', task: 'c' } }
    ]);
    return batches.length === 2
        && batches[0].parallel === true && batches[0].calls.length === 2
        && batches[1].parallel === false && batches[1].calls[0].arguments.role === 'executor';
});

check('parallel-unknown-and-stateful-tools-are-sequential', () => {
    return !isParallelSafeToolCall({ name: 'selectLayer', arguments: { layerId: 1 } })
        && !isParallelSafeToolCall({ name: 'someUnknownTool' })
        && !isParallelSafeToolCall({ name: 'runDesignTeamPipeline', arguments: { goal: 'x' } });
});

check('parallel-batch-respects-max-cap', () => {
    const calls = Array.from({ length: 7 }, () => ({ name: 'getLayerBounds' }));
    const batches = partitionToolCallsForParallelExecution(calls, 3);
    return batches.length === 3
        && batches[0].calls.length === 3 && batches[0].parallel === true
        && batches[2].calls.length === 1 && batches[2].parallel === false;
});

check('parallel-safe-roles-match-registry-write-permissions', () => {
    // 防漂移交叉校验：策略中的只读角色必须与 registry 的 canWriteToPhotoshop:false 一致
    const defs = listDesignTeammateDefinitions();
    return defs.every(def => PARALLEL_SAFE_TEAMMATE_ROLES.has(def.role) === !def.canWriteToPhotoshop);
});

// ==================== 报告 ====================

const pass = cases.filter(c => c.status === 'pass').length;
const report = {
    name: 'design-team-pipeline-smoke',
    generatedAt: new Date().toISOString(),
    summary: { total: cases.length, pass, fail: cases.length - pass },
    cases
};

const outDir = path.resolve(__dirname, '..', 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'design-team-pipeline-smoke.json'), JSON.stringify(report, null, 2), 'utf8');

console.log(`design-team-pipeline smoke: ${pass}/${cases.length} 通过`);
for (const c of cases.filter(x => x.status === 'fail')) {
    console.log(`  FAIL: ${c.name} — ${c.details || ''}`);
}
process.exit(pass === cases.length ? 0 : 1);
