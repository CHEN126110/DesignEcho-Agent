/**
 * Eagle 素材库直读 smoke：
 * - 不启动 Eagle，直接索引 .library / 文件夹 / 标签 / 设计用途
 * - 查询、分页、缩略图和只读边界
 * - 选择素材进入 Operating Context，但元数据不冒充视觉观察
 * - 页面注册、IPC/preload 与 Agent 上下文接线
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node', esModuleInterop: true }
});

const {
    EagleLibraryService,
    computeEagleLibraryId
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'main',
    'services',
    'eagle-library-service.ts'
));
const {
    buildEagleLibrarySelectionContext,
    EAGLE_LIBRARY_WRITE_POLICY
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-library.ts'));
const {
    formatEagleAssetRefToken,
    isModelSafeEagleAssetRef,
    containsLocalPathSignal
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-asset-ref.ts'));
const {
    buildEagleJustifiedRows,
    resolveEagleGalleryContentWidth
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-justified-layout.ts'));
const {
    resolveEagleFolderIconColor
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-library-appearance.ts'));
const {
    buildOperatingContextPromptSection,
    buildOperatingContextSnapshot
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'shared',
    'agent-runtime-v5',
    'operating-context-snapshot.ts'
));

const projectRoot = path.resolve(__dirname, '..');
const cases = [];

async function check(name, run) {
    try {
        await run();
        cases.push({ name, status: 'pass' });
    } catch (error) {
        cases.push({ name, status: 'fail', details: String(error && error.stack || error) });
    }
}

function writeJson(targetPath, value) {
    fs.writeFileSync(targetPath, JSON.stringify(value), 'utf8');
}

function writeFixtureItem(libraryPath, input) {
    const itemDirectory = path.join(libraryPath, 'images', `${input.id}.info`);
    fs.mkdirSync(itemDirectory, { recursive: true });
    writeJson(path.join(itemDirectory, 'metadata.json'), {
        id: input.id,
        name: input.name,
        ext: input.ext,
        size: input.size || 2048,
        width: input.width || 800,
        height: input.height || 800,
        btime: 1720000000,
        mtime: 1720000100,
        folders: input.folders || [],
        tags: input.tags || [],
        annotation: input.annotation || '',
        palettes: input.palettes || [{ color: [122, 91, 205], ratio: 0.4 }],
        star: input.star || 0,
        isDeleted: input.isDeleted === true
    });
    fs.writeFileSync(path.join(itemDirectory, `${input.name}.${input.ext}`), input.source || Buffer.from('fixture'));
    if (input.thumbnail) {
        fs.writeFileSync(path.join(itemDirectory, `${input.name}_thumbnail.png`), input.thumbnail);
    }
}

function createFixture() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-eagle-library-'));
    const libraryPath = path.join(tempRoot, '设计参考.library');
    fs.mkdirSync(path.join(libraryPath, 'images'), { recursive: true });
    writeJson(path.join(libraryPath, 'metadata.json'), {
        applicationVersion: '4.0.0',
        folders: [{
            id: 'commerce',
            name: '电商设计',
            description: '',
            children: [
                { id: 'detail', name: '详情页模板', description: '', children: [] },
                { id: 'main', name: '主图参考', description: '', children: [] },
                { id: 'sku', name: 'SKU模板', description: '', children: [] }
            ]
        }]
    });
    writeJson(path.join(libraryPath, 'mtime.json'), { updatedAt: 1720000100 });
    writeJson(path.join(libraryPath, 'tags.json'), {});
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAcP3NfUAAAAASUVORK5CYII=',
        'base64'
    );
    writeFixtureItem(libraryPath, {
        id: 'detail-template',
        name: '详情页排版',
        ext: 'psd',
        folders: ['detail'],
        tags: ['分类:设计模板', '分类:详情页'],
        width: 750,
        height: 8000,
        thumbnail: png
    });
    writeFixtureItem(libraryPath, {
        id: 'main-reference',
        name: '春季主图参考',
        ext: 'png',
        folders: ['main'],
        tags: ['分类:主图参考'],
        source: png,
        width: 800,
        height: 800,
        star: 4,
        palettes: [{ color: [45, 92, 206], ratio: 64 }]
    });
    writeFixtureItem(libraryPath, {
        id: 'sku-template',
        name: '袜子SKU模板',
        ext: 'psb',
        folders: ['sku'],
        tags: ['分类:设计模板', '分类:SKU'],
        width: 1500,
        height: 1500,
        thumbnail: png
    });
    writeFixtureItem(libraryPath, {
        id: 'deleted-item',
        name: '旧版',
        ext: 'png',
        source: png,
        isDeleted: true
    });
    return { tempRoot, libraryPath };
}

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

(async () => {
    const fixture = createFixture();
    const service = new EagleLibraryService();
    try {
        let library;
        await check('opens-library-without-eagle-process-and-preserves-boundaries', async () => {
            const response = await service.openLibrary(fixture.libraryPath);
            assert.equal(response.success, true);
            library = response.library;
            assert.equal(library.name, '设计参考');
            assert.equal(library.itemCount, 4);
            assert.equal(library.activeItemCount, 3);
            assert.equal(library.deletedCount, 1);
            assert.equal(library.boundaries.readonly, true);
            assert.equal(library.boundaries.requiresEagleProcess, false);
            assert.equal(library.boundaries.writesEagle, false);
            assert.ok(library.roleCounts.detail_page_template >= 1);
            assert.ok(library.roleCounts.sku_template >= 1);
            assert.ok(library.roleCounts.reference >= 1);
            assert.equal(library.extensionCounts.png, 1);
            assert.equal(library.extensionCounts.psd, 1);
        });

        let detailItem;
        await check('queries-folders-descendants-search-and-role', async () => {
            const folderResponse = await service.queryLibrary({
                libraryPath: fixture.libraryPath,
                folderId: 'commerce',
                includeDescendants: true,
                role: 'detail_page_template',
                query: '排版',
                limit: 10
            });
            assert.equal(folderResponse.success, true);
            assert.equal(folderResponse.total, 1);
            detailItem = folderResponse.items[0];
            assert.equal(detailItem.id, 'detail-template');
            assert.equal(detailItem.role, 'detail_page_template');
            assert.equal(detailItem.libraryId, library.libraryId);
            assert.ok(detailItem.sourceFilePath.endsWith(`${path.sep}详情页排版.psd`));
        });

        await check('excludes-deleted-by-default-and-includes-on-request', async () => {
            const active = await service.queryLibrary({ libraryPath: fixture.libraryPath, limit: 10 });
            const deleted = await service.queryLibrary({
                libraryPath: fixture.libraryPath,
                includeDeleted: true,
                deletedOnly: true,
                limit: 10
            });
            assert.equal(active.total, 3);
            assert.equal(deleted.total, 1);
            assert.equal(deleted.items[0].isDeleted, true);
        });

        await check('filters-shape-rating-extension-and-dominant-color-before-pagination', async () => {
            const response = await service.queryLibrary({
                libraryPath: fixture.libraryPath,
                extension: 'png',
                shape: 'square',
                minimumRating: 4,
                dominantColor: 'blue',
                limit: 1
            });
            assert.equal(response.success, true);
            assert.equal(response.total, 1);
            assert.equal(response.items[0].id, 'main-reference');
            assert.equal(response.items[0].rating, 4);
        });

        await check('queries-support-tri-state-multi-tag-and-dynamic-facets', async () => {
            const included = await service.queryLibrary({
                libraryPath: fixture.libraryPath,
                includeTags: ['分类:设计模板'],
                limit: 10
            });
            assert.equal(included.total, 2);
            assert.deepEqual(included.items.map((item) => item.id).sort(), ['detail-template', 'sku-template']);

            const intersected = await service.queryLibrary({
                libraryPath: fixture.libraryPath,
                includeTags: ['分类:设计模板'],
                excludeTags: ['分类:SKU'],
                limit: 10
            });
            assert.equal(intersected.total, 1);
            assert.equal(intersected.items[0].id, 'detail-template');

            const onlyExclude = await service.queryLibrary({
                libraryPath: fixture.libraryPath,
                excludeTags: ['分类:设计模板'],
                limit: 10
            });
            assert.equal(onlyExclude.total, 1);
            assert.equal(onlyExclude.items[0].id, 'main-reference');

            // 动态 facet 反映整个活动集
            const all = await service.queryLibrary({ libraryPath: fixture.libraryPath, limit: 10 });
            assert.ok(all.facets, '查询应返回动态 facet 计数');
            const allTags = Object.fromEntries(all.facets.tags.map((tag) => [tag.name, tag.count]));
            assert.equal(allTags['分类:设计模板'], 2);
            assert.equal(allTags['分类:主图参考'], 1);
            assert.equal(all.facets.extensions.psd, 1);
            assert.equal(all.facets.extensions.png, 1);

            // facet 随筛选收窄：设计模板结果集内不含「主图参考」标签，但含「分类:SKU」
            const scopedTags = Object.fromEntries(included.facets.tags.map((tag) => [tag.name, tag.count]));
            assert.equal(scopedTags['分类:SKU'], 1);
            assert.equal(scopedTags['分类:主图参考'], undefined);
        });

        await check('justified-gallery-keeps-row-height-ratios-and-width-boundaries', async () => {
            const rows = buildEagleJustifiedRows([
                { id: 'portrait-a', width: 750, height: 1000 },
                { id: 'portrait-b', width: 750, height: 1000 },
                { id: 'landscape-a', width: 1400, height: 1000 },
                { id: 'portrait-c', width: 750, height: 1000 },
                { id: 'last', width: 800, height: 800 }
            ], {
                containerWidth: 1400,
                itemsPerRow: 4,
                gap: 10,
                minimumRowHeight: 96,
                maximumRowHeight: 520
            });
            assert.equal(rows.length, 2);
            assert.equal(rows[0].complete, true);
            assert.equal(rows[1].complete, false);
            const fullWidth = rows[0].entries.reduce((sum, entry) => sum + entry.width, 0) + 30;
            assert.ok(Math.abs(fullWidth - 1400) <= 0.001);
            const firstRatio = rows[0].entries[0].width / rows[0].height;
            assert.ok(Math.abs(firstRatio - 0.75) <= 0.001);
            assert.ok(rows[1].entries[0].width < 1400);
        });

        await check('gallery-width-follows-results-content-box', async () => {
            assert.equal(resolveEagleGalleryContentWidth(1400, 10, 10), 1380);
            assert.equal(resolveEagleGalleryContentWidth(2048, 12.5, 8.5), 2027);
            assert.equal(resolveEagleGalleryContentWidth(0, 10, 10), 280);
        });

        await check('justified-gallery-bounds-extreme-aspect-ratios', async () => {
            const containerWidth = 1400;
            const gap = 10;
            const rows = buildEagleJustifiedRows([
                { id: 'tall-a', width: 1, height: 1_000_000 },
                { id: 'tall-b', width: 1, height: 1_000_000 },
                { id: 'tall-c', width: 1, height: 1_000_000 },
                { id: 'tall-d', width: 1, height: 1_000_000 },
                { id: 'wide-a', width: 1_000_000, height: 1 },
                { id: 'wide-b', width: 1_000_000, height: 1 },
                { id: 'wide-c', width: 1_000_000, height: 1 },
                { id: 'wide-d', width: 1_000_000, height: 1 },
                { id: 'last-tall-a', width: 1, height: 1_000_000 },
                { id: 'last-tall-b', width: 1, height: 1_000_000 }
            ], {
                containerWidth,
                itemsPerRow: 4,
                gap,
                minimumRowHeight: 96,
                maximumRowHeight: 520
            });

            assert.equal(rows.length, 3);
            for (const row of rows.slice(0, 2)) {
                assert.equal(row.complete, true);
                const usedWidth = row.entries.reduce((sum, entry) => sum + entry.width, 0)
                    + gap * (row.entries.length - 1);
                assert.ok(Math.abs(usedWidth - containerWidth) <= 0.001);
                assert.ok(row.height >= 96 && row.height <= 520);
            }

            const lastRow = rows[2];
            const lastUsedWidth = lastRow.entries.reduce((sum, entry) => sum + entry.width, 0)
                + gap * (lastRow.entries.length - 1);
            assert.equal(lastRow.complete, false);
            assert.ok(lastUsedWidth < containerWidth);

            const constrainedLastRow = buildEagleJustifiedRows([
                { id: 'last-wide-a', width: 1_000_000, height: 1 },
                { id: 'last-wide-b', width: 1_000_000, height: 1 }
            ], {
                containerWidth: 200,
                itemsPerRow: 4,
                gap,
                minimumRowHeight: 96,
                maximumRowHeight: 520
            })[0];
            const constrainedWidth = constrainedLastRow.entries.reduce((sum, entry) => sum + entry.width, 0)
                + gap * (constrainedLastRow.entries.length - 1);
            assert.equal(constrainedLastRow.complete, false);
            assert.ok(constrainedWidth <= 200.001);
        });

        await check('folder-semantic-colors-resolve-to-eagle-palette', async () => {
            assert.equal(resolveEagleFolderIconColor('purple'), '#c499ff');
            assert.equal(resolveEagleFolderIconColor('blue'), '#00aaff');
            assert.equal(resolveEagleFolderIconColor('pink'), '#ff99cc');
            assert.equal(resolveEagleFolderIconColor('green'), '#30d159');
            assert.equal(resolveEagleFolderIconColor('yellow'), '#ffd60a');
            assert.equal(resolveEagleFolderIconColor(undefined), '#cccdcf');
            assert.equal(resolveEagleFolderIconColor('#123abc'), '#123abc');
            assert.equal(resolveEagleFolderIconColor('unknown'), '#cccdcf');
        });

        await check('creates-bounded-ui-only-preview', async () => {
            const response = await service.getPreview({
                libraryPath: fixture.libraryPath,
                itemId: 'detail-template',
                maxSize: 160,
                purpose: 'eagle_library_ui'
            });
            assert.equal(response.success, true);
            assert.ok(response.dataUrl.startsWith('data:image/webp;base64,'));
            assert.equal(response.boundaries.uiOnly, true);
            assert.equal(response.boundaries.doesNotEnterAgentContext, true);
            assert.equal(response.boundaries.doesNotGrantExecution, true);
        });

        await check('rejects-non-library-directory', async () => {
            const response = await service.openLibrary(fixture.tempRoot);
            assert.equal(response.success, false);
            assert.equal(response.status, 'invalid_library');
        });

        await check('operating-context-uses-opaque-asset-ref-and-never-leaks-raw-path', async () => {
            const selection = buildEagleLibrarySelectionContext(library, detailItem, '2026-07-23T10:00:00.000Z');
            // 选择上下文的 assetRef 面向模型：必须不含任何本地路径字段。
            assert.equal(selection.assetRef.itemId, 'detail-template');
            assert.equal(selection.assetRef.libraryId, library.libraryId);
            assert.equal(isModelSafeEagleAssetRef(selection.assetRef), true);
            assert.equal(containsLocalPathSignal(JSON.stringify(selection.assetRef)), false);
            // 完整选择上下文仍携带 sourceFilePath（供 renderer/main），因此它本身不是模型安全对象。
            assert.equal(isModelSafeEagleAssetRef(selection), false);

            const snapshot = buildOperatingContextSnapshot({
                snapshotId: 'operating:eagle-smoke',
                capturedAt: '2026-07-23T10:00:01.000Z',
                correlationId: 'eagle-smoke',
                workspace: {
                    revision: 'eagle:fixture',
                    activePage: 'eagle',
                    selectedLibraryAsset: selection
                },
                photoshop: {
                    revision: 'disconnected',
                    connection: 'disconnected',
                    documentState: 'unknown'
                }
            });
            // 快照存储的 Eagle 素材现在就是路径安全的 EagleAssetRef 本身（不再承载完整含路径的选择上下文）。
            assert.equal(snapshot.workspace.selectedLibraryAsset.itemId, 'detail-template');
            assert.equal(snapshot.workspace.selectedLibraryAsset.schemaVersion, 'eagle-asset-ref/v0');
            assert.equal(isModelSafeEagleAssetRef(snapshot.workspace.selectedLibraryAsset), true);
            assert.equal(containsLocalPathSignal(JSON.stringify(snapshot.workspace.selectedLibraryAsset)), false);
            assert.equal(snapshot.issues.includes('multiple_primary_selections'), false);

            const prompt = buildOperatingContextPromptSection(snapshot);
            assert.ok(prompt.includes('提交时选中 Eagle 素材'));
            assert.ok(prompt.includes('元数据，不等于已看过图像'));
            // 提示词用不透明引用指代素材……
            assert.ok(prompt.includes(`assetRef=${formatEagleAssetRefToken(selection.assetRef)}`));
            // ……并且绝不出现真实源文件路径或库磁盘路径（P0 核心翻转）。
            assert.ok(!prompt.includes(detailItem.sourceFilePath));
            assert.ok(!prompt.includes(library.path));
            assert.equal(containsLocalPathSignal(prompt), false);
        });

        await check('multi-asset-group-is-path-safe-capped-and-exclusive', async () => {
            const detailSelection = buildEagleLibrarySelectionContext(library, detailItem, '2026-07-23T10:00:00.000Z');
            const allItems = await service.queryLibrary({ libraryPath: fixture.libraryPath, limit: 10 });
            const groupRefs = allItems.items.map((item) => buildEagleLibrarySelectionContext(library, item).assetRef);

            // 组快照：每项路径安全，提示词列出 assetRef 且无本地路径
            const groupSnapshot = buildOperatingContextSnapshot({
                snapshotId: 'operating:eagle-group-smoke',
                capturedAt: '2026-07-23T10:00:01.000Z',
                correlationId: 'eagle-group-smoke',
                workspace: {
                    revision: 'eagle:fixture-group',
                    activePage: 'eagle',
                    selectedLibraryAssetGroup: groupRefs
                },
                photoshop: { revision: 'disconnected', connection: 'disconnected', documentState: 'unknown' }
            });
            const group = groupSnapshot.workspace.selectedLibraryAssetGroup;
            assert.ok(Array.isArray(group) && group.length === groupRefs.length);
            assert.equal(groupSnapshot.issues.includes('multiple_primary_selections'), false);
            const groupPrompt = buildOperatingContextPromptSection(groupSnapshot);
            assert.ok(groupPrompt.includes(`Eagle 素材集（${groupRefs.length} 项）`));
            assert.ok(groupPrompt.includes(`assetRef=${library.libraryId}:detail-template`));
            assert.equal(containsLocalPathSignal(groupPrompt), false, '组提示词不得含本地路径');
            // 模板素材在提示词中带工作副本指路
            const singleSnapshot = buildOperatingContextSnapshot({
                snapshotId: 'operating:eagle-template-smoke',
                capturedAt: '2026-07-23T10:00:01.000Z',
                correlationId: 'eagle-template-smoke',
                workspace: {
                    revision: 'eagle:fixture-template',
                    activePage: 'eagle',
                    selectedLibraryAsset: detailSelection
                },
                photoshop: { revision: 'disconnected', connection: 'disconnected', documentState: 'unknown' }
            });
            const templatePrompt = buildOperatingContextPromptSection(singleSnapshot);
            assert.ok(templatePrompt.includes('importEagleAssetToProject'), '模板素材应指路工作副本流程');
            assert.ok(templatePrompt.includes('openTemplate'));

            // 唯一主选与组同时出现：唯一优先、组被丢弃，不产生互斥误报
            const conflictSnapshot = buildOperatingContextSnapshot({
                snapshotId: 'operating:eagle-conflict-smoke',
                capturedAt: '2026-07-23T10:00:01.000Z',
                correlationId: 'eagle-conflict-smoke',
                workspace: {
                    revision: 'eagle:fixture-conflict',
                    activePage: 'eagle',
                    selectedLibraryAsset: detailSelection,
                    selectedLibraryAssetGroup: groupRefs
                },
                photoshop: { revision: 'disconnected', connection: 'disconnected', documentState: 'unknown' }
            });
            assert.equal(conflictSnapshot.workspace.selectedLibraryAssetGroup, undefined);
            assert.equal(conflictSnapshot.issues.includes('multiple_primary_selections'), false);

            // 上限与去重：超量与重复引用被裁剪
            const oversized = Array.from({ length: 30 }, (_, index) => ({
                ...groupRefs[0],
                itemId: `dup-${index % 15}`
            }));
            const cappedSnapshot = buildOperatingContextSnapshot({
                snapshotId: 'operating:eagle-cap-smoke',
                capturedAt: '2026-07-23T10:00:01.000Z',
                correlationId: 'eagle-cap-smoke',
                workspace: {
                    revision: 'eagle:fixture-cap',
                    activePage: 'eagle',
                    selectedLibraryAssetGroup: oversized
                },
                photoshop: { revision: 'disconnected', connection: 'disconnected', documentState: 'unknown' }
            });
            assert.ok(cappedSnapshot.workspace.selectedLibraryAssetGroup.length <= 12);
        });

        await check('resolve-asset-source-bridges-ref-to-real-path-main-only', async () => {
            const selection = buildEagleLibrarySelectionContext(library, detailItem, '2026-07-23T10:00:00.000Z');
            const resolved = await service.resolveAssetSource({
                libraryId: selection.assetRef.libraryId,
                itemId: selection.assetRef.itemId
            });
            assert.ok(resolved, '已打开的库应能从引用反查真实路径');
            assert.equal(resolved.itemId, 'detail-template');
            assert.equal(resolved.libraryPath, library.path);
            assert.equal(resolved.sourceFilePath, detailItem.sourceFilePath);
            // 未知 libraryId 不猜测，返回 null。
            const unknown = await service.resolveAssetSource({ libraryId: 'deadbeefdeadbeef0000', itemId: 'detail-template' });
            assert.equal(unknown, null);
            const missingItem = await service.resolveAssetSource({ libraryId: library.libraryId, itemId: 'no-such-item' });
            assert.equal(missingItem, null);
        });

        await check('active-library-handshake-reports-disk-selection-source', async () => {
            const response = await service.openLibrary(fixture.libraryPath);
            assert.equal(response.success, true);
            const handshake = response.activeLibrary;
            assert.ok(handshake, 'openLibrary 应返回活动库握手');
            assert.equal(handshake.source, 'disk_selection');
            assert.equal(handshake.eagleAvailable, false);
            assert.equal(handshake.libraryId, library.libraryId);
            assert.equal(handshake.libraryPath, library.path);
            assert.equal(computeEagleLibraryId(library.path), library.libraryId);
            // 实时 Eagle 报告不同库时，握手以实时为准并标注冲突。
            const liveOther = service.reconcileActiveLibrary({
                live: { available: true, appVersion: '4.0.0', libraryName: '另一个库', libraryPath: 'D:/Other/其他.library' },
                disk: { libraryId: library.libraryId, libraryName: library.name, libraryPath: library.path }
            });
            assert.equal(liveOther.source, 'live_eagle');
            assert.equal(liveOther.eagleAvailable, true);
            assert.equal(liveOther.matchesDiskSelection, false);
            assert.ok(liveOther.notes.includes('active_library_differs_from_disk_selection'));
            assert.equal(liveOther.libraryId, computeEagleLibraryId('D:/Other/其他.library'));
        });

        await check('static-disk-service-forbids-direct-library-json-writes', async () => {
            assert.equal(EAGLE_LIBRARY_WRITE_POLICY.directLibraryJsonWrite, 'forbidden');
            assert.equal(EAGLE_LIBRARY_WRITE_POLICY.writeChannel, 'eagle_api_only');
            const serviceSource = readProjectFile('src/main/services/eagle-library-service.ts');
            const forbiddenWriteVectors = [
                'fs.writeFile', 'fs.appendFile', 'fs.unlink', 'fs.rm(', 'fs.rmdir', 'fs.mkdir',
                'fs.copyFile', 'fs.cp(', 'fs.rename', 'fs.truncate', 'fs.createWriteStream',
                'writeFileSync', 'copyFileSync', 'appendFileSync', 'renameSync', 'writeJson',
                '.toFile('
            ];
            for (const forbidden of forbiddenWriteVectors) {
                assert.ok(
                    !serviceSource.includes(forbidden),
                    `静态磁盘服务不得出现写文件调用：${forbidden}`
                );
            }
        });

        await check('workspace-ui-ipc-and-agent-wiring-are-present', async () => {
            const tabBar = readProjectFile('src/renderer/components/WorkspaceTabBar.tsx');
            const workbench = readProjectFile('src/renderer/components/DesignAgentWorkbench.tsx');
            const page = readProjectFile('src/renderer/components/EagleLibraryPage.tsx');
            const pageStyles = readProjectFile('src/renderer/components/EagleLibraryPage.css');
            const preload = readProjectFile('src/main/preload.ts');
            const handlers = readProjectFile('src/main/ipc-handlers/eagle-library-handlers.ts');
            const chat = readProjectFile('src/renderer/components/ChatPanel.tsx');
            assert.ok(tabBar.includes("'eagle'"));
            assert.ok(workbench.includes('EagleLibraryPage'));
            assert.ok(page.includes('eagle-library-sidebar'));
            assert.ok(page.includes('eagle-inspector'));
            assert.ok(page.includes('eagle-justified-row'));
            assert.ok(page.includes('eagle-preview-overlay'));
            assert.ok(page.includes('ref={resultsRef} className="eagle-library-results"'));
            assert.ok(!page.includes('ref={galleryRef}'));
            assert.ok(page.includes('resolveEagleFolderIconColor(folder.iconColor)'));
            assert.ok(pageStyles.includes('--eagle-hover-bg: #2a2b2e'));
            assert.ok(pageStyles.includes('--eagle-selection-bg: #353639'));
            assert.ok(!pageStyles.includes('--eagle-purple-soft'));
            assert.match(
                pageStyles,
                /\.eagle-zoom-control input::\-webkit-slider-runnable-track\s*\{[\s\S]*?height:\s*3px;/
            );
            assert.match(
                pageStyles,
                /\.eagle-zoom-control input::\-webkit-slider-thumb\s*\{[\s\S]*?width:\s*12px;[\s\S]*?height:\s*12px;/
            );
            assert.ok(page.includes('nextIds.size !== 1'));
            assert.ok(page.includes('externalSelectionIdRef'));
            assert.ok(page.includes('isGalleryKeyboardTarget'));
            assert.ok(page.includes('handlePreviewKeyDown'));
            assert.ok(page.includes("navigationMode: 'random'"));
            assert.ok(page.includes('randomSeed'));
            assert.ok(preload.includes('getEagleLibraryPreview'));
            assert.ok(handlers.includes("'eagleLibrary:query'"));
            assert.ok(chat.includes('selectedLibraryAsset'));
        });

        const realLibraryPath = process.env.EAGLE_LIBRARY_PATH;
        if (realLibraryPath) {
            await check('optional-real-library-index', async () => {
                const response = await service.openLibrary(realLibraryPath, true);
                assert.equal(response.success, true, response.error);
                assert.ok(response.library.activeItemCount > 0);
                const templates = await service.queryLibrary({
                    libraryPath: realLibraryPath,
                    role: 'design_template',
                    limit: 1
                });
                assert.equal(templates.success, true, templates.error);
            });
        }
    } finally {
        fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }

    const failed = cases.filter((entry) => entry.status !== 'pass');
    console.log(JSON.stringify({ suite: 'eagle-library-direct-import', cases }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
