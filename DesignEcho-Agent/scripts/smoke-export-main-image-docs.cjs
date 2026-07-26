/**
 * smoke: exportMainImageDocuments（用户导出规范 4.0 移植）双侧登记与语义 pin
 *
 * 守护点：
 * 1. UXP 工具实现保真：JSX 语义与用户脚本一致（质量 12→10 自适应、主图/<尺寸> 目录、
 *    详情页 SaveForWeb 切片、历史状态恢复、SEP=fromCharCode(1) 两侧一致）
 * 2. UXP registry 注册
 * 3. Agent 侧全链登记：tool-schemas（schema+暴露）、tool-executor 目录+长超时、
 *    preflight/photoshop-tool-skill 的 SAVE_EXPORT、完成契约 DOCUMENT_SAVE_TOOLS
 *    （教训：新增写工具必查所属分类集，否则该类任务完成即误判）、
 *    设计纪律 EXPORT 集、显示名
 */
const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const uxpRoot = path.resolve(agentRoot, '..', 'DesignEcho-UXP');

function read(rel, base) {
    return fs.readFileSync(path.join(base || agentRoot, rel), 'utf8');
}

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok, detail: detail || '' });
    console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${ok ? '' : `  ${detail || ''}`}`);
}

// ── 1. UXP 工具实现语义 pin ──
const uxpTool = read('src/tools/image/export-main-image-docs.ts', uxpRoot);
check('UXP 工具名', uxpTool.includes("name = 'exportMainImageDocuments'"));
check('JPEG 质量自适应起点 12', uxpTool.includes('jpegOptions.quality = 12'));
check('JPEG 质量下限 10', uxpTool.includes('jpegOptions.quality > 10'));
check('主图目录结构 主图/<尺寸>', uxpTool.includes("'/主图/' + docKey"));
check('详情页走 SaveForWeb 切片', uxpTool.includes('ExportType.SAVEFORWEB'));
check('详情页导出到导出目录本身（不入主图子目录）', /docKey === '详情页'[\s\S]{0,40}exportFolders\[docKey\] = baseFolder/.test(uxpTool));
check('历史状态恢复（不污染文档）', uxpTool.includes('doc.activeHistoryState = startState'));
check('未打开文档记 notFound 不中断', uxpTool.includes('report.notFound.push(docName)') && uxpTool.includes('continue'));
check('空子组跳过（isEmptyLayerSet 递归）', uxpTool.includes('function isEmptyLayerSet'));
check('默认文档集 800/750/1200/详情页', uxpTool.includes("['800', '750', '1200', '详情页']"));
check('默认父组 转化图/点击图', uxpTool.includes("['转化图', '点击图']"));
check('列表分隔符两侧一致（fromCharCode(1)）',
    uxpTool.includes('const LIST_SEPARATOR = String.fromCharCode(1)')
    && uxpTool.includes('var SEP = String.fromCharCode(1)'));
check('失败清单进 error（部分失败要可见）', uxpTool.includes('部分导出失败'));

// ── 2. UXP registry 注册 ──
const uxpRegistry = read('src/tools/registry.ts', uxpRoot);
check('UXP registry import', uxpRegistry.includes("from './image/export-main-image-docs'"));
check('UXP registry 实例注册', uxpRegistry.includes('new ExportMainImageDocumentsTool()'));

// ── 3. Agent 侧全链登记 ──
const schemas = read('src/renderer/services/agent-runtime/tool-schemas.ts');
check('tool-schemas schema 定义', schemas.includes("name: 'exportMainImageDocuments'"));
check('tool-schemas 暴露列表', /'exportGroup',\s*\n\s*'exportMainImageDocuments',/.test(schemas));
check('schema 必填 outputDir', /exportMainImageDocuments'[\s\S]{0,1600}\['outputDir'\]/.test(schemas));

const executor = read('src/renderer/services/tool-executor.service.ts');
check('tool-executor 工具目录行', executor.includes("{ name: 'exportMainImageDocuments'"));
check('tool-executor 长超时（批量导出按长任务）', /exportMainImageDocuments'\) return LONG_RUNNING_TOOL_TIMEOUT/.test(executor));

const preflight = read('src/shared/agent-tool-execution-preflight.ts');
check('preflight SAVE_EXPORT 分类', /SAVE_EXPORT_TOOLS = new Set\(\[[\s\S]{0,400}'exportMainImageDocuments'/.test(preflight));

const toolSkill = read('src/shared/photoshop-tool-skill.ts');
check('photoshop-tool-skill SAVE_EXPORT 同步', /SAVE_EXPORT_TOOLS = new Set\(\[[\s\S]{0,400}'exportMainImageDocuments'/.test(toolSkill));

const contract = read('src/renderer/services/agent-runtime/task-completion-contract.ts');
check('完成契约 DOCUMENT_SAVE_TOOLS（防 0/N 误判重跑）', /DOCUMENT_SAVE_TOOLS = new Set\(\[[\s\S]{0,400}'exportMainImageDocuments'/.test(contract));

// 纪律运行时只保留真实约束：导出前必须满足写后观察。
require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(agentRoot, 'tsconfig.main.json')
});
const D = require(path.resolve(agentRoot, 'src/shared/design-discipline-runtime.ts'));
check('纪律 EXPORT 集（改后未复核不许导出）', D.DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES.has('exportMainImageDocuments'));

const displayInfo = read('src/renderer/services/tool-display-info.ts');
check('中文显示名', displayInfo.includes('exportMainImageDocuments: {'));

// ── 4. 契约行为级：批量导出应记录为成功保存结果 ──
delete require.cache[require.resolve('crypto')];
const contractPath = path.join(agentRoot, 'src/renderer/services/agent-runtime/task-completion-contract.ts');
const contractSource = fs.readFileSync(contractPath, 'utf8');
const saveSetMatch = contractSource.match(/DOCUMENT_SAVE_TOOLS = new Set\(\[([\s\S]*?)\]\)/);
const saveSetBody = saveSetMatch ? saveSetMatch[1] : '';
check('契约 save 集合含 exportDetailPageSlices（原有成员未被挤掉）', saveSetBody.includes("'exportDetailPageSlices'"));
check('契约 save 集合含 saveDocument（原有成员未被挤掉）', saveSetBody.includes("'saveDocument'"));

const failed = results.filter((r) => !r.ok);
const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed };
const outDir = path.join(agentRoot, 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke-export-main-image-docs.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${summary.passed}/${summary.total} 通过`);
if (failed.length > 0) {
    process.exit(1);
}
