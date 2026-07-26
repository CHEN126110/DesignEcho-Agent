/**
 * Eagle 素材引用与活动库握手 smoke（P0 安全与契约，纯逻辑）：
 * - EagleAssetRef 从结构化输入派生，剥离一切本地路径，模型安全；
 * - 不透明句柄 libraryId:itemId 可格式化 / 解析往返；
 * - 模型安全护栏能识别 sourceFilePath / libraryPath / 盘符路径；
 * - 活动库握手对账：实时优先，磁盘其次，无信号判 none，冲突如实标注。
 */
const assert = require('assert');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node', esModuleInterop: true }
});

const {
    EAGLE_ASSET_REF_VERSION,
    buildEagleAssetRef,
    formatEagleAssetRefToken,
    parseEagleAssetRefToken,
    isModelSafeEagleAssetRef,
    buildEagleAssetRefPromptLines,
    containsLocalPathSignal
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-asset-ref.ts'));
const {
    EAGLE_ACTIVE_LIBRARY_VERSION,
    reconcileEagleActiveLibrary,
    normalizePathKey
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-active-library.ts'));

const cases = [];
function check(name, run) {
    try {
        run();
        cases.push({ name, status: 'pass' });
    } catch (error) {
        cases.push({ name, status: 'fail', details: String((error && error.stack) || error) });
    }
}

check('asset-ref-strips-local-paths-and-is-model-safe', () => {
    const ref = buildEagleAssetRef({
        libraryId: 'lib123',
        libraryName: '设计参考',
        itemId: 'item789',
        name: '春季主图',
        ext: 'PNG',
        fileKind: 'image',
        role: 'reference',
        tags: ['主图', '主图', '春季'],
        folderPaths: ['电商设计 / 主图参考'],
        width: 800,
        height: 800,
        selectedAt: '2026-07-23T10:00:00.000Z'
    });
    assert.equal(ref.schemaVersion, EAGLE_ASSET_REF_VERSION);
    assert.equal(ref.ext, 'png');
    assert.deepEqual(ref.tags, ['主图', '春季']);
    assert.equal(ref.width, 800);
    assert.equal(isModelSafeEagleAssetRef(ref), true);
    assert.equal('sourceFilePath' in ref, false);
    assert.equal('libraryPath' in ref, false);
    assert.equal(containsLocalPathSignal(JSON.stringify(ref)), false);
});

check('asset-ref-token-round-trips', () => {
    const ref = buildEagleAssetRef({ libraryId: 'lib123', itemId: 'item789', name: 'x' });
    const token = formatEagleAssetRefToken(ref);
    assert.equal(token, 'lib123:item789');
    assert.deepEqual(parseEagleAssetRefToken(token), { libraryId: 'lib123', itemId: 'item789' });
    assert.equal(parseEagleAssetRefToken(''), null);
    assert.equal(parseEagleAssetRefToken('no-separator'), null);
    assert.equal(parseEagleAssetRefToken(':itemonly'), null);
    assert.equal(parseEagleAssetRefToken('libonly:'), null);
});

check('model-safety-guard-detects-path-shaped-payloads', () => {
    assert.equal(isModelSafeEagleAssetRef({ libraryId: 'a', itemId: 'b' }), true);
    assert.equal(isModelSafeEagleAssetRef({ sourceFilePath: 'x' }), false);
    assert.equal(isModelSafeEagleAssetRef({ libraryPath: 'x' }), false);
    assert.equal(isModelSafeEagleAssetRef({ path: 'x' }), false);
    assert.equal(isModelSafeEagleAssetRef({ note: 'E:\\Software\\未闻花名.library\\images' }), false);
    assert.equal(isModelSafeEagleAssetRef({ note: 'file:///Users/a/x.png' }), false);
    assert.equal(isModelSafeEagleAssetRef(null), false);
    assert.equal(containsLocalPathSignal('C:\\Users\\a'), true);
    assert.equal(containsLocalPathSignal('普通中文文本 无路径'), false);
});

check('prompt-lines-never-print-a-local-path', () => {
    const ref = buildEagleAssetRef({
        libraryId: 'lib123', libraryName: '设计参考', itemId: 'item789',
        name: '详情页排版', ext: 'psd', fileKind: 'design', role: 'detail_page_template',
        tags: ['分类:详情页'], folderPaths: ['电商设计 / 详情页模板'], width: 750, height: 8000
    });
    const lines = buildEagleAssetRefPromptLines(ref);
    const text = lines.join('\n');
    assert.ok(text.includes('assetRef=lib123:item789'));
    assert.ok(text.includes('详情页排版'));
    assert.ok(text.includes('libraryId=lib123'));
    assert.ok(text.includes('尺寸=750×8000'));
    assert.equal(containsLocalPathSignal(text), false);
});

check('handshake-prefers-live-eagle-when-it-reports-a-library', () => {
    const handshake = reconcileEagleActiveLibrary({
        live: { available: true, appVersion: '4.0.0', libraryName: '未闻花名', libraryPath: 'E:/Software/未闻花名.library' },
        disk: { libraryId: 'diskid', libraryName: '未闻花名', libraryPath: 'E:/Software/未闻花名.library' },
        resolveLibraryId: (p) => `hash(${normalizePathKey(p)})`,
        now: '2026-07-23T10:00:00.000Z'
    });
    assert.equal(handshake.schemaVersion, EAGLE_ACTIVE_LIBRARY_VERSION);
    assert.equal(handshake.source, 'live_eagle');
    assert.equal(handshake.eagleAvailable, true);
    assert.equal(handshake.matchesDiskSelection, true);
    assert.equal(handshake.libraryId, 'hash(e:/software/未闻花名.library)');
    assert.equal(handshake.reconciledAt, '2026-07-23T10:00:00.000Z');
});

check('handshake-flags-conflict-between-live-and-disk', () => {
    const handshake = reconcileEagleActiveLibrary({
        live: { available: true, libraryName: 'A', libraryPath: 'E:/A.library' },
        disk: { libraryId: 'diskid', libraryName: 'B', libraryPath: 'E:/B.library' }
    });
    assert.equal(handshake.source, 'live_eagle');
    assert.equal(handshake.matchesDiskSelection, false);
    assert.ok(handshake.notes.includes('active_library_differs_from_disk_selection'));
});

check('handshake-does-not-fabricate-identity-when-live-is-name-only-and-conflicts', () => {
    // 实时只报库名、且与磁盘选择不同名：不得借用磁盘 id/path 拼出矛盾身份。
    const conflict = reconcileEagleActiveLibrary({
        live: { available: true, libraryName: 'LiveOnlyLib' },
        disk: { libraryId: 'diskid', libraryName: 'DiskLib', libraryPath: 'E:/Disk.library' }
    });
    assert.equal(conflict.source, 'live_eagle');
    assert.equal(conflict.matchesDiskSelection, false);
    assert.equal(conflict.libraryId, undefined);
    assert.equal(conflict.libraryPath, undefined);
    assert.ok(conflict.notes.includes('active_library_differs_from_disk_selection'));
    assert.ok(conflict.notes.includes('live_library_path_unavailable'));

    // 实时只报库名、且与磁盘同名：可安全借用磁盘 id/path。
    const matched = reconcileEagleActiveLibrary({
        live: { available: true, libraryName: 'DiskLib' },
        disk: { libraryId: 'diskid', libraryName: 'DiskLib', libraryPath: 'E:/Disk.library' }
    });
    assert.equal(matched.source, 'live_eagle');
    assert.equal(matched.matchesDiskSelection, true);
    assert.equal(matched.libraryId, 'diskid');
    assert.equal(matched.libraryPath, 'E:/Disk.library');
});

check('handshake-falls-back-to-disk-selection-when-eagle-offline', () => {
    const handshake = reconcileEagleActiveLibrary({
        live: { available: false, error: 'ECONNREFUSED' },
        disk: { libraryId: 'diskid', libraryName: '未闻花名', libraryPath: 'E:/Software/未闻花名.library' }
    });
    assert.equal(handshake.source, 'disk_selection');
    assert.equal(handshake.eagleAvailable, false);
    assert.equal(handshake.libraryId, 'diskid');
    assert.ok(handshake.notes.some((note) => note.startsWith('live_eagle_unavailable:')));
});

check('handshake-degrades-to-none-with-no-signals', () => {
    const handshake = reconcileEagleActiveLibrary({});
    assert.equal(handshake.source, 'none');
    assert.equal(handshake.eagleAvailable, false);
    assert.equal(handshake.libraryId, undefined);
    // 实时可用但未报告库时也如实标注，而不是伪造一个活动库。
    const availableNoLibrary = reconcileEagleActiveLibrary({ live: { available: true } });
    assert.equal(availableNoLibrary.source, 'none');
    assert.equal(availableNoLibrary.eagleAvailable, true);
    assert.ok(availableNoLibrary.notes.includes('live_eagle_available_without_active_library'));
});

check('normalize-path-key-is-case-and-separator-insensitive', () => {
    assert.equal(normalizePathKey('E:\\Software\\X.library\\'), 'e:/software/x.library');
    assert.equal(normalizePathKey('E:/Software/X.library'), 'e:/software/x.library');
});

const failed = cases.filter((entry) => entry.status !== 'pass');
console.log(JSON.stringify({ suite: 'eagle-asset-ref', cases }, null, 2));
if (failed.length > 0) process.exitCode = 1;
