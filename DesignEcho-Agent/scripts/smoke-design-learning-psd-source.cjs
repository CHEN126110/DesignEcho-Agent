/**
 * PSD/PSB 设计源学习通道 smoke（离线）：
 * - 项目结构里的 PSD/PSB 被收集为学习源（视觉链排除的部分由本通道接住）
 * - design-source-profile → 待复核设计记忆候选（needs_review，不凑数）
 * - entry 集成：不依赖视觉模型也能产出；视觉链阻断时 PSD 产出仍如实算学习成功
 * - UI 接线断言
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
    collectDesignLearningPsdSourcePaths,
    psdDesignProfileToDesignMemoryItems
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-learning-psd-source.ts'));
const {
    createDesignLearningRuntimeEntryController
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-learning-runtime-entry.service.ts'));

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

const STRUCTURE = {
    projectName: 'C-测试项目',
    folders: [{
        name: 'PSD',
        type: 'psd',
        images: [
            { name: '详情页模板', path: 'X:/proj/PSD/详情页模板.psd', ext: '.psd', type: 'psd' },
            { name: '主图源', path: 'X:/proj/PSD/主图源.psb', ext: '.psb', type: 'psd' },
            { name: '产品图', path: 'X:/proj/PSD/产品图.png', ext: '.png', type: 'product' }
        ],
        children: [{
            name: '归档',
            type: 'psd',
            images: [{ name: '旧版', path: 'X:/proj/PSD/旧/旧版.psd', ext: '.psd', type: 'psd' }]
        }]
    }]
};

const FULL_PROFILE = {
    version: 'psd-design-source-profile/v0',
    source: { fileName: '详情页模板.psd', format: 'psd', fileSizeBytes: 1024, parseMs: 40 },
    canvas: { width: 750, height: 28000 },
    structure: {
        totalLayers: 120, groupCount: 14, textCount: 40, shapeCount: 10, pixelCount: 50, smartObjectCount: 6,
        groupTree: [], groupTreeTruncated: false,
        namingHealth: { businessNamedRatio: 0.8, genericNameSamples: [] },
        screenPattern: { screenCount: 8, avgScreenHeightPx: 3500, inference: '按分组高度推断' }
    },
    typography: {
        samples: [], sampleTruncated: false,
        fontFamilies: ['思源黑体', '阿里巴巴普惠体'],
        fontSizeLevels: [96, 48, 28, 18]
    },
    palette: { textColors: ['#FF3C2F', '#222222', '#FFFFFF'] },
    metrics: { leftEdgeClusterPx: 64, safeMarginRatio: 0.085 },
    boundaries: { noPixelDataRead: true, contentPolicy: 'patterns_not_content', notPersisted: true }
};

(async () => {
    await check('collects-psd-psb-and-skips-raster', async () => {
        const records = collectDesignLearningPsdSourcePaths(STRUCTURE);
        assert.equal(records.length, 3);
        assert.deepEqual(records.map((record) => record.name), ['详情页模板', '主图源', '旧版']);
        assert.ok(records.every((record) => /\.(psd|psb)$/i.test(record.path)));
        const limited = collectDesignLearningPsdSourcePaths(STRUCTURE, { limit: 1 });
        assert.equal(limited.length, 1);
    });

    await check('profile-converts-to-three-needs-review-candidates', async () => {
        const items = psdDesignProfileToDesignMemoryItems(FULL_PROFILE, {
            scope: { type: 'project', id: 'C-1231' },
            now: '2026-07-23T10:00:00.000Z',
            folderType: 'detail'
        });
        assert.equal(items.length, 3);
        for (const item of items) {
            assert.equal(item.status, 'needs_review', '候选必须待复核，不得直接 active');
            assert.equal(item.kind, 'approved_recipe');
            assert.ok(item.tags.includes('psd-design-source'));
            assert.ok(item.summary.length > 20);
        }
        const typography = items.find((item) => item.title.includes('版式字号'));
        assert.ok(typography.summary.includes('96px'));
        assert.ok(typography.summary.includes('思源黑体'));
        assert.ok(typography.summary.includes('64px'));
        const palette = items.find((item) => item.title.includes('色板'));
        assert.ok(palette.summary.includes('#FF3C2F'));
        const structure = items.find((item) => item.title.includes('结构与分屏'));
        assert.ok(structure.summary.includes('8 屏'));
    });

    await check('sparse-profile-does-not-pad-candidates', async () => {
        const sparse = {
            ...FULL_PROFILE,
            typography: { samples: [], sampleTruncated: false, fontFamilies: [], fontSizeLevels: [24] },
            palette: { textColors: ['#000000'] },
            structure: { ...FULL_PROFILE.structure, groupCount: 1, screenPattern: undefined }
        };
        const items = psdDesignProfileToDesignMemoryItems(sparse);
        assert.equal(items.length, 0, '单一字号/单色/无结构信号不得凑数产出');
        assert.deepEqual(psdDesignProfileToDesignMemoryItems(null), []);
    });

    await check('entry-queues-psd-candidates-without-visual-model', async () => {
        const reviewed = [];
        const fakeMemoryService = {
            recordDesignLearningMemoryReview: (input) => { reviewed.push(input); },
            listPersistedDesignMemoryItems: () => []
        };
        // 视觉链完全阻断（无参考、无视觉分析）——模拟用户当前环境
        const fakeOrchestrator = async () => ({
            status: 'runtime_blocked',
            blockers: ['visual_analysis_adapter_required'],
            warnings: [],
            reviewQueueResult: { queuedCount: 0 },
            reviewPersistence: { enabled: true, queuedCount: 0, persistedNeedsReviewCount: 0 },
            boundaries: {}
        });
        const controller = createDesignLearningRuntimeEntryController({
            memoryService: fakeMemoryService,
            runOrchestrator: fakeOrchestrator
        });
        const result = await controller.runManual({
            currentProject: { id: 'C-1231', name: '测试项目', path: 'X:/proj' },
            ecommerceStructure: STRUCTURE,
            now: '2026-07-23T10:00:00.000Z',
            analyzePsdDesignSourceBridge: async (filePath) => {
                assert.ok(/\.(psd|psb)$/i.test(filePath));
                return { success: true, profile: { ...FULL_PROFILE, source: { ...FULL_PROFILE.source, fileName: filePath.split('/').pop() } } };
            }
        });
        assert.equal(result.psdSources.candidateCount, 3);
        assert.equal(result.psdSources.parsedCount, 3);
        assert.ok(result.psdSources.queuedCount >= 6, '3 份源文件应产出至少 6 条候选');
        assert.equal(result.reviewQueue.queuedCount, result.psdSources.queuedCount);
        // 视觉链阻断但 PSD 有产出：这次学习如实算成功
        assert.equal(result.status, 'manual_review_queued');
        assert.ok(reviewed.every((entry) => entry.decision === 'needs_review'));
        assert.ok(reviewed.every((entry) => entry.reviewer === 'design-learning-psd-source'));
    });

    await check('entry-degrades-honestly-without-bridge', async () => {
        const fakeMemoryService = {
            recordDesignLearningMemoryReview: () => { throw new Error('不应入队'); },
            listPersistedDesignMemoryItems: () => []
        };
        const controller = createDesignLearningRuntimeEntryController({
            memoryService: fakeMemoryService,
            runOrchestrator: async () => ({
                status: 'runtime_blocked', blockers: ['x'], warnings: [],
                reviewQueueResult: { queuedCount: 0 },
                reviewPersistence: { enabled: true, queuedCount: 0, persistedNeedsReviewCount: 0 },
                boundaries: {}
            })
        });
        const result = await controller.runManual({
            ecommerceStructure: STRUCTURE,
            now: '2026-07-23T10:00:00.000Z'
            // 不注入桥且无 window.designEcho
        });
        assert.equal(result.psdSources.queuedCount, 0);
        assert.ok(result.warnings.includes('psd_design_source_bridge_unavailable'));
        assert.equal(result.status, 'blocked');
    });

    await check('ui-panels-reflect-psd-learning', async () => {
        const panel = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/DesignLearningRuntimeSettingsPanel.tsx'), 'utf8');
        assert.ok(panel.includes('PSD/PSB 设计源'), '学习面板应说明 PSD 学习能力');
        assert.ok(panel.includes('psdSources'), '结果文案应消费 psdSources');
        const preferences = fs.readFileSync(path.join(projectRoot, 'src/renderer/components/UserPreferencesPanel.tsx'), 'utf8');
        assert.ok(preferences.includes("item.status !== 'archived'"), '偏好「全部」视图应排除已归档');
    });

    const failed = cases.filter((entry) => entry.status !== 'pass');
    console.log(JSON.stringify({ suite: 'design-learning-psd-source', cases }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
