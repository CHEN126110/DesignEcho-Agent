/**
 * Eagle Inspector 写回 smoke（P2 双向编辑，离线 fake fetch）：
 * - diff → gate → 写前冲突检测 → 逐 op 执行 → 写后读回验证 的完整序列
 * - 冲突 / 离线 / 写失败 / 验证失败 / 危险操作拦截 全部如实返回
 * - 只走 Eagle API（/api/tools/call），永不写 .library JSON
 * - UI/IPC/preload 接线断言
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node', esModuleInterop: true }
});

const {
    executeEagleInspectorWriteback
} = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'eagle-writeback-executor-service.ts'));

const projectRoot = path.resolve(__dirname, '..');
const cases = [];

async function check(name, run) {
    try {
        await run();
        cases.push({ name, status: 'pass' });
    } catch (error) {
        cases.push({ name, status: 'fail', details: String((error && error.stack) || error) });
    }
}

/** 造一个可编程的 fake Eagle：记录调用序列，按脚本返回。 */
function createFakeEagle(initialItem) {
    const calls = [];
    let item = { ...initialItem };
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, tool: body.tool, params: body.params });
        if (body.tool === 'item_get') {
            return okJson({ success: true, data: [{ ...item }] });
        }
        if (body.tool === 'item_add_tags') {
            item.tags = Array.from(new Set([...(item.tags || []), ...body.params.tags]));
            return okJson({ success: true });
        }
        if (body.tool === 'item_remove_tags') {
            item.tags = (item.tags || []).filter((tag) => !body.params.tags.includes(tag));
            return okJson({ success: true });
        }
        if (body.tool === 'item_update') {
            for (const update of body.params.items || []) {
                if (update.id !== item.id) continue;
                if ('annotation' in update) item.annotation = update.annotation;
                if ('star' in update) item.star = update.star;
            }
            return okJson({ success: true });
        }
        return okJson({ success: false, message: `unexpected tool ${body.tool}` });
    };
    return {
        fetchImpl,
        calls,
        getItem: () => ({ ...item }),
        setItem: (next) => { item = { ...next }; }
    };
}

function okJson(payload) {
    return { ok: true, status: 200, json: async () => payload };
}

(async () => {
    await check('full-sequence-diff-gate-write-readback', async () => {
        const eagle = createFakeEagle({ id: 'it1', tags: ['旧标签', '保留'], annotation: '旧注释', star: 2 });
        const result = await executeEagleInspectorWriteback({
            itemId: 'it1',
            baseline: { tags: ['旧标签', '保留'], annotation: '旧注释', rating: 2 },
            edits: { tags: ['保留', '新标签'], annotation: '新注释', rating: 5 },
            userConfirmed: true
        }, eagle.fetchImpl);
        assert.equal(result.success, true, result.error);
        assert.equal(result.status, 'ok');
        assert.deepEqual(result.appliedOperations.sort(), ['add_tags', 'remove_tags', 'set_rating', 'update_annotation']);
        assert.equal(result.boundaries.readbackVerified, true);
        // 终值来自读回而非臆测
        assert.deepEqual(result.currentValues.tags.sort(), ['保留', '新标签']);
        assert.equal(result.currentValues.annotation, '新注释');
        assert.equal(result.currentValues.rating, 5);
        // 调用序列：写前读 → 写 ops → 写后读；全部打到 /api/tools/call
        assert.equal(eagle.calls[0].tool, 'item_get');
        assert.equal(eagle.calls[eagle.calls.length - 1].tool, 'item_get');
        assert.ok(eagle.calls.every((call) => call.url.endsWith('/api/tools/call')));
    });

    await check('no-changes-short-circuits-without-network', async () => {
        const eagle = createFakeEagle({ id: 'it1', tags: ['a'], annotation: 'x', star: 1 });
        const result = await executeEagleInspectorWriteback({
            itemId: 'it1',
            baseline: { tags: ['a'], annotation: 'x', rating: 1 },
            edits: { tags: ['a'], annotation: 'x', rating: 1 },
            userConfirmed: true
        }, eagle.fetchImpl);
        assert.equal(result.status, 'no_changes');
        assert.equal(eagle.calls.length, 0, '无变更不应发起任何网络调用');
    });

    await check('conflict-detected-before-any-write', async () => {
        const eagle = createFakeEagle({ id: 'it1', tags: ['被别人改过'], annotation: '旧注释', star: 2 });
        const result = await executeEagleInspectorWriteback({
            itemId: 'it1',
            baseline: { tags: ['旧标签'], annotation: '旧注释', rating: 2 },
            edits: { tags: ['旧标签', '新标签'], annotation: '旧注释', rating: 2 },
            userConfirmed: true
        }, eagle.fetchImpl);
        assert.equal(result.success, false);
        assert.equal(result.status, 'conflict');
        assert.deepEqual(result.currentValues.tags, ['被别人改过'], '冲突时返回 Eagle 实时值');
        assert.equal(eagle.calls.length, 1, '检测到冲突后不得执行任何写调用');
        assert.equal(eagle.calls[0].tool, 'item_get');
    });

    await check('offline-returns-eagle-offline-for-draft-flow', async () => {
        const failingFetch = async () => { throw new Error('ECONNREFUSED 127.0.0.1:41596'); };
        const result = await executeEagleInspectorWriteback({
            itemId: 'it1',
            baseline: { tags: [], annotation: '', rating: 0 },
            edits: { tags: ['新'], annotation: '', rating: 0 },
            userConfirmed: true
        }, failingFetch);
        assert.equal(result.success, false);
        assert.equal(result.status, 'eagle_offline');
        assert.ok(result.error.includes('草稿'), '离线错误应指路草稿');
    });

    await check('missing-confirmation-blocked-by-gate', async () => {
        const eagle = createFakeEagle({ id: 'it1', tags: [], annotation: '', star: 0 });
        const result = await executeEagleInspectorWriteback({
            itemId: 'it1',
            baseline: { tags: [], annotation: '', rating: 0 },
            edits: { tags: ['新'], annotation: '', rating: 0 },
            userConfirmed: false
        }, eagle.fetchImpl);
        assert.equal(result.status, 'blocked_by_gate');
        assert.equal(result.gateStatus, 'blocked_pending_user_confirmation');
        assert.equal(eagle.calls.length, 0, '闸门拦截不得发起任何网络调用');
    });

    await check('write-failure-reports-partial-progress-honestly', async () => {
        const eagle = createFakeEagle({ id: 'it1', tags: ['旧'], annotation: '', star: 0 });
        const baseFetch = eagle.fetchImpl;
        let writeCount = 0;
        const flakyFetch = async (url, init) => {
            const body = JSON.parse(init.body);
            if (body.tool !== 'item_get') {
                writeCount += 1;
                if (writeCount > 1) return okJson({ success: false, message: '磁盘写入被拒绝' });
            }
            return baseFetch(url, init);
        };
        const result = await executeEagleInspectorWriteback({
            itemId: 'it1',
            baseline: { tags: ['旧'], annotation: '', rating: 0 },
            edits: { tags: ['新'], annotation: '', rating: 0 },
            userConfirmed: true
        }, flakyFetch);
        assert.equal(result.success, false);
        assert.equal(result.status, 'write_failed');
        assert.equal(result.appliedOperations.length, 1, '应如实报告已执行的部分操作');
        assert.ok(result.error.includes('磁盘写入被拒绝'));
    });

    await check('readback-mismatch-reports-verify-failed', async () => {
        const eagle = createFakeEagle({ id: 'it1', tags: [], annotation: '', star: 0 });
        const baseFetch = eagle.fetchImpl;
        // 写入"成功"但 Eagle 实际没改（模拟静默失败）
        const silentFetch = async (url, init) => {
            const body = JSON.parse(init.body);
            if (body.tool !== 'item_get') return okJson({ success: true });
            return baseFetch(url, init);
        };
        const result = await executeEagleInspectorWriteback({
            itemId: 'it1',
            baseline: { tags: [], annotation: '', rating: 0 },
            edits: { tags: ['应有但没写上'], annotation: '', rating: 0 },
            userConfirmed: true
        }, silentFetch);
        assert.equal(result.success, false);
        assert.equal(result.status, 'verify_failed');
        assert.equal(result.boundaries.readbackVerified, false);
    });

    await check('ui-ipc-preload-wiring-present', async () => {
        const page = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/EagleLibraryPage.tsx'), 'utf8');
        const pageStyles = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/EagleLibraryPage.css'), 'utf8');
        const preload = fs.readFileSync(path.join(projectRoot, 'src/main/preload.ts'), 'utf8');
        const handlers = fs.readFileSync(path.join(projectRoot, 'src/main/ipc-handlers/eagle-library-handlers.ts'), 'utf8');
        const executor = fs.readFileSync(path.join(projectRoot, 'src/main/services/eagle-writeback-executor-service.ts'), 'utf8');
        assert.ok(page.includes('startInspectorEdit'), '页面缺编辑入口');
        assert.ok(page.includes('handleInspectorSave'), '页面缺保存处理');
        assert.ok(page.includes('eagle-writeback-draft:'), '页面缺离线草稿键');
        assert.ok(page.includes("result.status === 'conflict'"), '页面缺冲突处理');
        assert.ok(pageStyles.includes('.eagle-inspector-edit'), '样式缺编辑面板');
        assert.ok(preload.includes('executeEagleInspectorWriteback'), 'preload 缺写回桥');
        assert.ok(handlers.includes("'eagleLibrary:executeInspectorWriteback'"), 'IPC 缺写回通道');
        // 写回执行器必须复用安全闸门，且不是 Agent 工具
        assert.ok(executor.includes('buildEagleWritebackGate'), '执行器必须过安全闸门');
        const schemas = fs.readFileSync(path.join(projectRoot, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
        assert.ok(!schemas.includes('executeEagleInspectorWriteback'), '写回不得暴露为 Agent 工具（Agent 对 Eagle 保持只读）');
    });

    const failed = cases.filter((entry) => entry.status !== 'pass');
    console.log(JSON.stringify({ suite: 'eagle-inspector-writeback', cases }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
