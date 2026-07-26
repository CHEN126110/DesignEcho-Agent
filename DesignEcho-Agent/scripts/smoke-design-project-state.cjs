/**
 * Design Project State（DPS-1）smoke：
 * - 契约规范化 / 增量合并 / 追加语义 / 列表封顶
 * - 状态摘要构建（有界、空态、用户指令优先说明）
 * - 队友产出写穿映射（design_plan / review_report / execution_report / 失败与未知类型）
 * - 工具 schema 暴露与执行分类
 * - 主图框架知识模块分面检索
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
});

const {
    createEmptyDesignProjectState,
    normalizeDesignProjectState,
    applyDesignProjectStatePatch,
    buildDesignProjectStateSummary,
    buildTaskStateDisciplineSection
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-project-state.ts'));
const {
    buildStatePatchForTeammateOutput
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'state-sync.ts'));
const { classifyAgentToolExecution } = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const { getDefaultAgentTools } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));
const { buildMainImageFrameworkSummary } = require(path.resolve(__dirname, '..', 'src', 'shared', 'knowledge', 'main-image-framework.ts'));
const { DesignProjectStateStore } = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'design-project-state-store.ts'));
const { ArtifactRepositoryService } = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'artifact-repository-service.ts'));

const cases = [];
function check(name, fn) {
    try {
        const ok = fn();
        cases.push({ name, status: ok ? 'pass' : 'fail', details: ok ? undefined : 'assertion returned false' });
    } catch (error) {
        cases.push({ name, status: 'fail', details: String(error && error.message || error) });
    }
}

async function checkAsync(name, fn) {
    try {
        const ok = await fn();
        cases.push({ name, status: ok ? 'pass' : 'fail', details: ok ? undefined : 'assertion returned false' });
    } catch (error) {
        cases.push({ name, status: 'fail', details: String(error && error.message || error) });
    }
}

// ==================== 契约与合并 ====================

check('state-normalize-tolerates-garbage', () => {
    const fromNull = normalizeDesignProjectState(null);
    const fromArray = normalizeDesignProjectState([1, 2]);
    const fromBadFields = normalizeDesignProjectState({ sellingPoints: '不是数组', painPoints: ['ok'] });
    return fromNull.schemaVersion === 'design-project-state/v0'
        && fromArray.schemaVersion === 'design-project-state/v0'
        && fromBadFields.sellingPoints === undefined
        && Array.isArray(fromBadFields.painPoints);
});

check('state-normalize-drops-unknown-artifact-carrier-fields', () => {
    const normalized = normalizeDesignProjectState({
        schemaVersion: 'design-project-state/v0',
        targetUser: '保留的合法字段',
        artifactPayload: { secret: '不得进入项目记忆' },
        artifactPath: 'C:\\private\\runtime-plan.json',
        artifactRepositoryReadProjection: { refs: [] },
        unknownField: 'drop-me'
    });
    return normalized.targetUser === '保留的合法字段'
        && !Object.prototype.hasOwnProperty.call(normalized, 'artifactPayload')
        && !Object.prototype.hasOwnProperty.call(normalized, 'artifactPath')
        && !Object.prototype.hasOwnProperty.call(normalized, 'artifactRepositoryReadProjection')
        && !Object.prototype.hasOwnProperty.call(normalized, 'unknownField');
});

check('state-patch-set-replaces-fields', () => {
    const next = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
        set: { targetUser: '北方冬季年轻女性', sellingPoints: ['加厚保暖', '不掉跟'] },
        updatedBy: 'smoke'
    });
    return next.targetUser === '北方冬季年轻女性'
        && next.sellingPoints.length === 2
        && next.updatedBy === 'smoke'
        && Boolean(next.updatedAt);
});

check('state-patch-set-cannot-touch-protected-fields', () => {
    const next = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
        set: {
            schemaVersion: 'hacked',
            learnings: [{ note: '注入', timestamp: 'x' }],
            artifactRefs: [{
                artifactId: 'caller-spoof',
                artifactType: 'runtime_action_plan',
                contentHash: `sha256-jcs-v1:${'a'.repeat(64)}`
            }],
            targetUser: '正常字段'
        }
    });
    return next.schemaVersion === 'design-project-state/v0'
        && (next.learnings === undefined || next.learnings.length === 0)
        && next.artifactRefs === undefined
        && next.targetUser === '正常字段';
});

check('state-patch-set-is-exact-allowlist', () => {
    const next = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
        set: {
            targetUser: '允许写入',
            artifactPayload: { secret: '不得持久化' },
            artifactPath: 'C:\\private\\preview.psd',
            artifactRepositoryReadProjection: { refs: [] },
            arbitraryExtension: true
        }
    });
    return next.targetUser === '允许写入'
        && !Object.prototype.hasOwnProperty.call(next, 'artifactPayload')
        && !Object.prototype.hasOwnProperty.call(next, 'artifactPath')
        && !Object.prototype.hasOwnProperty.call(next, 'artifactRepositoryReadProjection')
        && !Object.prototype.hasOwnProperty.call(next, 'arbitraryExtension');
});

check('state-append-learning-and-version-accumulate', () => {
    let state = createEmptyDesignProjectState();
    state = applyDesignProjectStatePatch(state, { appendLearning: '第一条复盘', updatedBy: 'critic' });
    state = applyDesignProjectStatePatch(state, { appendVersion: { reason: '初版填充' } });
    state = applyDesignProjectStatePatch(state, { appendVersion: { reason: '按评审修订' } });
    return state.learnings.length === 1
        && state.learnings[0].source === 'critic'
        && state.versionHistory.length === 2
        && state.versionHistory[0].version === 'V01'
        && state.versionHistory[1].version === 'V02';
});

check('state-list-fields-are-capped', () => {
    const next = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
        set: { sellingPoints: Array.from({ length: 80 }, (_, i) => `卖点${i}`) }
    });
    return next.sellingPoints.length === 50 && next.sellingPoints[49] === '卖点79';
});

// ==================== 摘要 ====================

check('state-summary-empty-returns-empty-string', () => {
    return buildDesignProjectStateSummary(createEmptyDesignProjectState()) === ''
        && buildDesignProjectStateSummary(null) === '';
});

check('state-summary-contains-key-facts-and-priority-note', () => {
    const state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
        set: {
            projectName: 'C-1183 袜子',
            taskType: '主图',
            targetUser: '年轻女性',
            sellingPoints: ['不掉跟', '新疆棉'],
            visualDirection: '温暖治愈风'
        }
    });
    const summary = buildDesignProjectStateSummary(state);
    return summary.includes('C-1183 袜子')
        && summary.includes('不掉跟')
        && summary.includes('温暖治愈风')
        && summary.includes('用户当前指令优先');
});

check('state-summary-is-bounded', () => {
    const state = applyDesignProjectStatePatch(createEmptyDesignProjectState(), {
        set: { layoutPlan: '长'.repeat(10000), visualDirection: '风'.repeat(3000) }
    });
    return buildDesignProjectStateSummary(state).length <= 3600;
});

// ==================== 写穿映射 ====================

check('sync-design-plan-maps-to-layout-plan', () => {
    const patch = buildStatePatchForTeammateOutput({
        role: 'design-strategist', outputType: 'design_plan', stage: 'plan', success: true, content: '首屏放痛点对比，第二屏卖点特写'
    });
    return patch && patch.set && patch.set.layoutPlan.includes('首屏') && patch.updatedBy.includes('design-strategist');
});

check('sync-review-report-parses-verdict', () => {
    const patch = buildStatePatchForTeammateOutput({
        role: 'critic', outputType: 'review_report', stage: 'review', success: true,
        content: '主体偏小。\n{"verdict":"needs_fix","issues":[{"target":"产品主体","problem":"占比不足","suggestion":"放大到 65%"}]}'
    });
    return patch && patch.set && patch.set.reviewResult.verdict === 'needs_fix'
        && patch.set.reviewResult.issues.length === 1
        && patch.set.reviewResult.summary.includes('主体偏小');
});

check('sync-execution-report-appends-version', () => {
    const patch = buildStatePatchForTeammateOutput({
        role: 'executor', outputType: 'execution_report', stage: 'execute', success: true,
        content: '已完成首屏填充与文字替换\n详情略'
    });
    return patch && patch.appendVersion && patch.appendVersion.reason.includes('首屏填充');
});

check('sync-failed-or-unmapped-outputs-return-null', () => {
    return buildStatePatchForTeammateOutput({ role: 'executor', outputType: 'execution_report', stage: 'x', success: false, content: '失败' }) === null
        && buildStatePatchForTeammateOutput({ role: 'scene-analyst', outputType: 'scene_summary', stage: 'analyze', success: true, content: '画面分析' }) === null;
});

// ==================== 工具暴露与分类 ====================

check('state-tools-exposed-in-default-toolbox', () => {
    const names = new Set(getDefaultAgentTools().map(t => t.name));
    return names.has('getDesignProjectState') && names.has('updateDesignProjectState') && names.has('getMainImageDesignFramework');
});

check('state-tools-classified-correctly', () => {
    return classifyAgentToolExecution('getDesignProjectState') === 'read_only_observation'
        && classifyAgentToolExecution('updateDesignProjectState') === 'stateful_context'
        && classifyAgentToolExecution('getMainImageDesignFramework') === 'knowledge_search';
});

// ==================== 主图框架知识 ====================

check('main-image-framework-focus-sections', () => {
    const click = buildMainImageFrameworkSummary('click');
    const conversion = buildMainImageFrameworkSummary('conversion');
    const review = buildMainImageFrameworkSummary('review');
    return click.includes('产品主体 + 一个核心钩子')
        && conversion.includes('第1张讲痛点')
        && review.includes('一眼看懂卖什么')
        && buildMainImageFrameworkSummary('all').includes('卖点提炼');
});

// ==================== 任务状态归家（2026-07-07 系统改造④：任务真相源） ====================

check('summary-shows-production-tasks', () => {
    const summary = buildDesignProjectStateSummary({
        schemaVersion: 'design-project-state/v0',
        projectName: '测试项目',
        productionTasks: [
            { title: '置入产品信息图', status: 'done', note: '图层 4294「产品信息图」' },
            { title: '建立剪切蒙版到 00 拷贝', status: 'in_progress' },
            { title: '导出成品', status: 'pending' }
        ]
    });
    return summary.includes('任务清单')
        && summary.includes('[已完成] 置入产品信息图（图层 4294「产品信息图」）')
        && summary.includes('[进行中] 建立剪切蒙版到 00 拷贝')
        && summary.includes('[待做] 导出成品');
});

check('task-state-discipline-teaches-truth-source', () => {
    const section = buildTaskStateDisciplineSection();
    return section.includes('任务进度纪律')
        && section.includes('productionTasks')
        && section.includes('updateDesignProjectState')
        && section.includes('不重做 done 项')
        && section.includes('note');
});

check('executor-injects-task-state-discipline', () => {
    const executorSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
        'utf8'
    );
    return executorSource.includes('buildTaskStateDisciplineSection')
        && executorSource.includes("id: 'policy.task-state-discipline'")
        && executorSource.includes('content: taskStateDisciplineSection');
});

check('resume-brief-defers-to-state-tasks', () => {
    const resumeSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'shared', 'agent-run-resume.ts'),
        'utf8'
    );
    return resumeSource.includes('以它的进度为准')
        && resumeSource.includes('本档案只是上一轮的审计记录');
});

// ==================== 主进程唯一持久化 owner 与竞态 ====================

check('state-consumers-use-repository-verified-coordinator', () => {
    const ipcSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'main', 'ipc-handlers', 'design-state-handlers.ts'),
        'utf8'
    );
    const mcpSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'main', 'services', 'mcp-host-service.ts'),
        'utf8'
    );
    const coordinatorSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'main', 'services', 'design-project-state-coordinator.ts'),
        'utf8'
    );
    return ipcSource.includes('designProjectStateCoordinator.get')
        && ipcSource.includes('designProjectStateCoordinator.update')
        && mcpSource.includes('designProjectStateCoordinator.get')
        && mcpSource.includes('designProjectStateCoordinator.update')
        && !ipcSource.includes('designProjectStateStore')
        && !mcpSource.includes('designProjectStateStore')
        && coordinatorSource.includes('getVerifiedDesignProjectState')
        && coordinatorSource.includes('updateVerifiedDesignProjectState')
        && !ipcSource.includes('function readState(')
        && !ipcSource.includes('function writeState(')
        && !mcpSource.includes('function readDesignState(')
        && !mcpSource.includes('function writeDesignState(');
});

async function runStateStoreRaceChecks() {
    await checkAsync('state-store-does-not-launder-unknown-artifact-fields', async () => {
        const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-state-boundary-'));
        const stateDir = path.join(projectPath, '.designecho');
        const stateFile = path.join(stateDir, 'design-state.json');
        const ref = {
            artifactId: 'runtime-plan-boundary-verified',
            artifactType: 'runtime_action_plan',
            contentHash: `sha256-jcs-v1:${'c'.repeat(64)}`
        };
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({
            schemaVersion: 'design-project-state/v0',
            targetUser: '合法历史字段',
            artifactPayload: { secret: '历史污染' },
            artifactPath: 'C:\\private\\artifact.bin',
            artifactRepositoryReadProjection: { refs: [ref] }
        }), 'utf8');
        const store = new DesignProjectStateStore();
        try {
            const read = await store.get(projectPath);
            await store.replaceArtifactRefs(projectPath, [ref]);
            const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            return read.targetUser === '合法历史字段'
                && !Object.prototype.hasOwnProperty.call(read, 'artifactPayload')
                && !Object.prototype.hasOwnProperty.call(read, 'artifactPath')
                && !Object.prototype.hasOwnProperty.call(read, 'artifactRepositoryReadProjection')
                && persisted.targetUser === '合法历史字段'
                && persisted.artifactRefs?.length === 1
                && !Object.prototype.hasOwnProperty.call(persisted, 'artifactPayload')
                && !Object.prototype.hasOwnProperty.call(persisted, 'artifactPath')
                && !Object.prototype.hasOwnProperty.call(persisted, 'artifactRepositoryReadProjection');
        } finally {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
    });

    await checkAsync('state-store-artifact-refs-have-main-only-write-path', async () => {
        const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-state-artifacts-'));
        const store = new DesignProjectStateStore();
        const ref = {
            artifactId: 'runtime-plan-g1-verified',
            artifactType: 'runtime_action_plan',
            contentHash: `sha256-jcs-v1:${'b'.repeat(64)}`
        };
        try {
            await store.update(projectPath, {
                set: { artifactRefs: [{ ...ref, artifactId: 'renderer-spoof' }] },
                updatedBy: 'renderer'
            });
            const afterRenderer = await store.get(projectPath);
            const afterRepository = await store.replaceArtifactRefs(projectPath, [ref]);
            return afterRenderer.artifactRefs === undefined
                && afterRepository.updatedBy === 'artifact_repository'
                && afterRepository.artifactRefs?.length === 1
                && JSON.stringify(afterRepository.artifactRefs[0]) === JSON.stringify(ref);
        } finally {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
    });

    await checkAsync('state-store-does-not-trust-disk-artifact-refs-before-repository-verification', async () => {
        const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-state-forged-ref-'));
        const stateDir = path.join(projectPath, '.designecho');
        const stateFile = path.join(stateDir, 'design-state.json');
        const forgedRef = {
            artifactId: 'plausible-but-not-published',
            artifactType: 'runtime_action_plan',
            contentHash: `sha256-jcs-v1:${'d'.repeat(64)}`
        };
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({
            schemaVersion: 'design-project-state/v0',
            targetUser: '应保留',
            artifactRefs: [forgedRef]
        }), 'utf8');
        const store = new DesignProjectStateStore();
        const service = new ArtifactRepositoryService(store);
        try {
            const rawStoreRead = await store.get(projectPath);
            const verifiedRead = await service.getVerifiedDesignProjectState(projectPath);
            const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            return rawStoreRead.targetUser === '应保留'
                && rawStoreRead.artifactRefs === undefined
                && verifiedRead.targetUser === '应保留'
                && verifiedRead.artifactRefs === undefined
                && persisted.artifactRefs === undefined
                && persisted.updatedBy === 'artifact_repository';
        } finally {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
    });

    await checkAsync('state-store-serializes-same-project-updates-without-lost-data', async () => {
        const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-state-race-'));
        const store = new DesignProjectStateStore();
        try {
            await Promise.all(Array.from({ length: 24 }, (_, index) => store.update(projectPath, {
                appendLearning: `并发写入-${index}`,
                updatedBy: `writer-${index}`
            })));
            await Promise.all([
                store.update(projectPath, { set: { targetUser: '年轻女性' }, updatedBy: 'target-writer' }),
                store.update(projectPath, { set: { visualDirection: '低饱和自然光' }, updatedBy: 'visual-writer' })
            ]);

            const state = await store.get(projectPath);
            const notes = new Set((state.learnings || []).map((item) => item.note));
            const stateDir = path.join(projectPath, '.designecho');
            const temporaryFiles = fs.readdirSync(stateDir).filter((name) => name.includes('.tmp-'));
            return notes.size === 24
                && Array.from({ length: 24 }, (_, index) => notes.has(`并发写入-${index}`)).every(Boolean)
                && state.targetUser === '年轻女性'
                && state.visualDirection === '低饱和自然光'
                && temporaryFiles.length === 0;
        } finally {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
    });

    await checkAsync('state-store-realpath-and-junction-alias-share-one-update-queue', async () => {
        const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-state-alias-race-'));
        const projectPath = path.join(temporaryRoot, 'project');
        const aliasPath = path.join(temporaryRoot, 'project-alias');
        fs.mkdirSync(projectPath, { recursive: true });
        fs.symlinkSync(projectPath, aliasPath, process.platform === 'win32' ? 'junction' : 'dir');
        const store = new DesignProjectStateStore();
        const ref = {
            artifactId: 'runtime-plan-alias-verified',
            artifactType: 'runtime_action_plan',
            contentHash: `sha256-jcs-v1:${'e'.repeat(64)}`
        };
        try {
            await Promise.all([
                ...Array.from({ length: 20 }, (_, index) => store.update(
                    index % 2 === 0 ? projectPath : aliasPath,
                    { appendLearning: `别名并发-${index}`, updatedBy: `alias-writer-${index}` }
                )),
                store.replaceArtifactRefs(aliasPath, [ref])
            ]);
            const state = await store.get(projectPath);
            const persisted = JSON.parse(fs.readFileSync(
                path.join(projectPath, '.designecho', 'design-state.json'),
                'utf8'
            ));
            const notes = new Set((state.learnings || []).map((item) => item.note));
            return notes.size === 20
                && Array.from({ length: 20 }, (_, index) => notes.has(`别名并发-${index}`)).every(Boolean)
                && persisted.artifactRefs?.length === 1;
        } finally {
            fs.unlinkSync(aliasPath);
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });

    await checkAsync('state-store-never-overwrites-corrupt-state-during-update', async () => {
        const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-state-corrupt-'));
        const stateDir = path.join(projectPath, '.designecho');
        const stateFile = path.join(stateDir, 'design-state.json');
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(stateFile, '{broken-json', 'utf8');
        const store = new DesignProjectStateStore();
        let rejected = false;
        try {
            await store.update(projectPath, { set: { targetUser: '不应写入' } });
        } catch (error) {
            rejected = String(error && error.message || error).includes('本次更新已停止');
        }
        const preserved = fs.readFileSync(stateFile, 'utf8') === '{broken-json';
        fs.rmSync(projectPath, { recursive: true, force: true });
        return rejected && preserved;
    });
}

// ==================== 报告 ====================

async function main() {
    await runStateStoreRaceChecks();
    const pass = cases.filter(c => c.status === 'pass').length;
    const report = {
        name: 'design-project-state-smoke',
        generatedAt: new Date().toISOString(),
        summary: { total: cases.length, pass, fail: cases.length - pass },
        cases
    };
    const outDir = path.resolve(__dirname, '..', 'tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'design-project-state-smoke.json'), JSON.stringify(report, null, 2), 'utf8');

    console.log(`design-project-state smoke: ${pass}/${cases.length} 通过`);
    for (const c of cases.filter(x => x.status === 'fail')) {
        console.log(`  FAIL: ${c.name} — ${c.details || ''}`);
    }
    process.exit(pass === cases.length ? 0 : 1);
}

void main();
