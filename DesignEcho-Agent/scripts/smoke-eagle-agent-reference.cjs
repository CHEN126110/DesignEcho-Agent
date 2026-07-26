/**
 * Eagle Agent 参考与素材 smoke（P3，离线）：
 * - observeEagleAsset：从不透明 assetRef 观察素材图像（回包无本地路径、base64 与画布快照同形）
 * - importEagleAssetToProject：复制进项目 + 来源追踪 + 路径逃逸/未开库/无效项目防护
 * - 工具登记链：schema/allow-list/preflight 分类/参考输入集/显示名/capability bridge/preload/IPC
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

const { EagleLibraryService } = require(path.resolve(
    __dirname, '..', 'src', 'main', 'services', 'eagle-library-service.ts'
));
const {
    containsLocalPathSignal,
    parseEagleAssetRefToken
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-asset-ref.ts'));

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

function writeJson(targetPath, value) {
    fs.writeFileSync(targetPath, JSON.stringify(value), 'utf8');
}

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAcP3NfUAAAAASUVORK5CYII=',
    'base64'
);

function createFixture() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-eagle-agent-ref-'));
    const libraryPath = path.join(tempRoot, '参考素材.library');
    fs.mkdirSync(path.join(libraryPath, 'images'), { recursive: true });
    writeJson(path.join(libraryPath, 'metadata.json'), { applicationVersion: '4.0.0', folders: [] });
    writeJson(path.join(libraryPath, 'mtime.json'), { updatedAt: 1720000100 });
    writeJson(path.join(libraryPath, 'tags.json'), {});

    const itemDir = path.join(libraryPath, 'images', 'ref-image.info');
    fs.mkdirSync(itemDir, { recursive: true });
    writeJson(path.join(itemDir, 'metadata.json'), {
        id: 'ref-image',
        name: '春季参考图',
        ext: 'png',
        size: PNG.length,
        width: 2,
        height: 2,
        btime: 1720000000,
        mtime: 1720000100,
        folders: [],
        tags: ['参考'],
        annotation: '打样参考',
        palettes: [],
        star: 5,
        isDeleted: false
    });
    fs.writeFileSync(path.join(itemDir, '春季参考图.png'), PNG);

    const psdDir = path.join(libraryPath, 'images', 'tpl-psd.info');
    fs.mkdirSync(psdDir, { recursive: true });
    writeJson(path.join(psdDir, 'metadata.json'), {
        id: 'tpl-psd',
        name: '模板源文件',
        ext: 'psd',
        size: 10,
        width: 750,
        height: 8000,
        folders: [],
        tags: ['分类:设计模板'],
        palettes: [],
        isDeleted: false
    });
    fs.writeFileSync(path.join(psdDir, '模板源文件.psd'), Buffer.from('fake-psd'));
    fs.writeFileSync(path.join(psdDir, '模板源文件_thumbnail.png'), PNG);

    const projectDir = path.join(tempRoot, '测试项目');
    fs.mkdirSync(projectDir, { recursive: true });
    return { tempRoot, libraryPath, projectDir };
}

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

(async () => {
    const fixture = createFixture();
    const service = new EagleLibraryService();
    // eagle-asset-import-service 引用单例 eagleLibraryService；为让导入走本 smoke 的索引，
    // 用同一份模块单例：先经单例 openLibrary 建注册表。
    const { eagleLibraryService } = require(path.resolve(
        __dirname, '..', 'src', 'main', 'services', 'eagle-library-service.ts'
    ));
    const { importEagleAssetToProject } = require(path.resolve(
        __dirname, '..', 'src', 'main', 'services', 'eagle-asset-import-service.ts'
    ));
    try {
        let library;
        await check('open-library-registers-resolution', async () => {
            const response = await eagleLibraryService.openLibrary(fixture.libraryPath);
            assert.equal(response.success, true, response.error);
            library = response.library;
        });

        await check('observe-returns-image-without-any-local-path', async () => {
            const observation = await eagleLibraryService.observeAssetForAgent({
                libraryId: library.libraryId,
                itemId: 'ref-image',
                maxSize: 256
            });
            assert.equal(observation.success, true, observation.error);
            assert.equal(observation.status, 'ok');
            assert.equal(observation.name, '春季参考图');
            assert.equal(observation.observedFrom, 'source');
            assert.equal(observation.format, 'image/webp');
            assert.ok(observation.base64 && observation.base64.length > 50, '应返回图像数据');
            assert.equal(observation.boundaries.entersAgentContext, true);
            assert.equal(observation.boundaries.localPathRedacted, true);
            const serialized = JSON.stringify(observation);
            assert.ok(!serialized.includes(fixture.libraryPath.replace(/\\/g, '\\\\')), '回包不得含库路径');
            const { base64: _omit, ...withoutImage } = observation;
            assert.equal(containsLocalPathSignal(JSON.stringify(withoutImage)), false, '除图像数据外不得有路径特征');
        });

        await check('observe-design-source-uses-thumbnail', async () => {
            const observation = await eagleLibraryService.observeAssetForAgent({
                libraryId: library.libraryId,
                itemId: 'tpl-psd'
            });
            assert.equal(observation.success, true, observation.error);
            assert.equal(observation.observedFrom, 'thumbnail');
            assert.equal(observation.role, 'design_template');
        });

        await check('observe-unopened-library-fails-with-guidance', async () => {
            const observation = await eagleLibraryService.observeAssetForAgent({
                libraryId: 'deadbeefdeadbeef0000',
                itemId: 'ref-image'
            });
            assert.equal(observation.success, false);
            assert.equal(observation.status, 'library_not_opened');
            assert.ok(observation.error.includes('Eagle 素材库'), '错误应指路先打开素材库');
        });

        let importedPath;
        await check('import-copies-into-project-with-provenance', async () => {
            const result = await importEagleAssetToProject({
                libraryId: library.libraryId,
                itemId: 'ref-image',
                projectPath: fixture.projectDir
            });
            assert.equal(result.success, true, result.error);
            assert.equal(result.status, 'ok');
            assert.equal(result.fileName, '春季参考图.png');
            assert.equal(result.projectRelativePath, 'Eagle素材/春季参考图.png');
            importedPath = result.importedPath;
            assert.ok(fs.existsSync(importedPath), '文件应已复制进项目');
            assert.equal(fs.readFileSync(importedPath).equals(PNG), true, '内容应与源一致');
            assert.equal(result.provenance.assetRef, `${library.libraryId}:ref-image`);
            assert.equal(result.provenance.libraryName, '参考素材');
            assert.equal(result.boundaries.provenanceRecorded, true);
            const registry = JSON.parse(fs.readFileSync(
                path.join(fixture.projectDir, '.designecho', 'eagle-imports.json'), 'utf8'
            ));
            assert.equal(registry.schemaVersion, 'eagle-imports/v0');
            assert.equal(registry.imports.length, 1);
            assert.equal(registry.imports[0].itemId, 'ref-image');
        });

        await check('import-collision-appends-suffix', async () => {
            const result = await importEagleAssetToProject({
                libraryId: library.libraryId,
                itemId: 'ref-image',
                projectPath: fixture.projectDir
            });
            assert.equal(result.success, true, result.error);
            assert.equal(result.fileName, '春季参考图-2.png');
            const registry = JSON.parse(fs.readFileSync(
                path.join(fixture.projectDir, '.designecho', 'eagle-imports.json'), 'utf8'
            ));
            assert.equal(registry.imports.length, 2);
        });

        await check('import-rejects-escape-and-library-targets', async () => {
            const escape = await importEagleAssetToProject({
                libraryId: library.libraryId,
                itemId: 'ref-image',
                projectPath: fixture.projectDir,
                targetSubdir: '../外面'
            });
            // sanitizeSubdir 会剥掉 ..，落回项目内子目录，绝不逃出项目
            assert.equal(escape.success, true);
            assert.ok(escape.importedPath.startsWith(fixture.projectDir), '目标必须在项目内');

            const intoLibrary = await importEagleAssetToProject({
                libraryId: library.libraryId,
                itemId: 'ref-image',
                projectPath: fixture.libraryPath
            });
            assert.equal(intoLibrary.success, false);
            assert.equal(intoLibrary.status, 'invalid_project');

            const noProject = await importEagleAssetToProject({
                libraryId: library.libraryId,
                itemId: 'ref-image',
                projectPath: ''
            });
            assert.equal(noProject.success, false);
            assert.equal(noProject.status, 'invalid_project');

            const unopened = await importEagleAssetToProject({
                libraryId: 'deadbeefdeadbeef0000',
                itemId: 'ref-image',
                projectPath: fixture.projectDir
            });
            assert.equal(unopened.success, false);
            assert.equal(unopened.status, 'library_not_opened');
        });

        await check('asset-ref-token-parses-for-dispatch', async () => {
            const parsed = parseEagleAssetRefToken(`${library.libraryId}:ref-image`);
            assert.deepEqual(parsed, { libraryId: library.libraryId, itemId: 'ref-image' });
        });

        await check('tool-registration-chain-is-complete', async () => {
            const schemas = readProjectFile('src/renderer/services/agent-runtime/tool-schemas.ts');
            const executor = readProjectFile('src/renderer/services/tool-executor.service.ts');
            const preflight = readProjectFile('src/shared/agent-tool-execution-preflight.ts');
            const discipline = readProjectFile('src/shared/design-discipline-runtime.ts');
            const skill = readProjectFile('src/shared/photoshop-tool-skill.ts');
            const display = readProjectFile('src/renderer/services/tool-display-info.ts');
            const bridge = readProjectFile('src/shared/agent-runtime-v5/tool-capability-bridge.ts');
            const preload = readProjectFile('src/main/preload.ts');
            const handlers = readProjectFile('src/main/ipc-handlers/eagle-library-handlers.ts');
            for (const tool of ['observeEagleAsset', 'importEagleAssetToProject']) {
                assert.ok(schemas.includes(`name: '${tool}'`), `tool-schemas 缺 ${tool}`);
                assert.ok(executor.includes(`toolName === '${tool}'`), `tool-executor 缺 ${tool} 分发`);
                assert.ok(display.includes(`${tool}:`), `tool-display-info 缺 ${tool}`);
                assert.ok(preload.includes(tool), `preload 缺 ${tool}`);
                assert.ok(bridge.includes(`'${tool}'`), `capability bridge 缺 ${tool}`);
            }
            assert.ok(preflight.includes("'observeEagleAsset'"), 'preflight 只读集缺 observeEagleAsset');
            assert.ok(preflight.includes("'importEagleAssetToProject'"), 'preflight 状态集缺 importEagleAssetToProject');
            assert.ok(discipline.includes("'observeEagleAsset'"), '纪律参考输入集缺 observeEagleAsset');
            assert.ok(skill.includes("'observeEagleAsset'"), 'photoshop-tool-skill 缺 observeEagleAsset');
            assert.ok(skill.includes("'importEagleAssetToProject'"), 'photoshop-tool-skill 缺 importEagleAssetToProject');
            assert.ok(handlers.includes("'eagleLibrary:observeAsset'"), 'IPC 缺 observeAsset');
            assert.ok(handlers.includes("'eagleLibrary:importAssetToProject'"), 'IPC 缺 importAssetToProject');
        });

        void service;
    } finally {
        fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }

    const failed = cases.filter((entry) => entry.status !== 'pass');
    console.log(JSON.stringify({ suite: 'eagle-agent-reference', cases }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
