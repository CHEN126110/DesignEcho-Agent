#!/usr/bin/env node
/**
 * 工具注册一致性校验
 *
 * 一个工具的"身份"目前散在多个文件：tool-schemas(模型可见的定义)、tool-display-info(显示名)、
 * agent-tool-execution-preflight + photoshop-tool-skill(权限 scope)、tool-executor(执行)。
 * 散布导致"漏登记 = 能力半隐身"——例如工具显示英文名(差体验)，或写操作漏了 scope 不受"读后写"保护。
 *
 * 本校验交叉检查 tool-schemas 里每个工具在「显示名 / 权限 scope」两个最易漏的切面是否都登记。
 * 退出码非 0 表示存在缺口，可接入构建/CI 防回归。
 *
 * 运行：node scripts/audit-tool-registry.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 1. tool-schemas：模型能看到、能调用的工具
const schemas = read('src/renderer/services/agent-runtime/tool-schemas.ts');
const schemaTools = [...new Set([...schemas.matchAll(/name: ['"]([a-zA-Z][\w]*)['"]/g)].map((m) => m[1]))];

// 2. 显示名 TOOL_NAME_MAP 的 key（4 空格缩进的 key: {）
const display = read('src/renderer/services/tool-display-info.ts');
const displayKeys = new Set([...display.matchAll(/^\s{4}([a-zA-Z]\w*):\s*\{/gm)].map((m) => m[1]));

// 3. 权限 scope：散在两个文件——preflight 的分类 Set + photoshop-tool-skill 的 PHOTOSHOP_WRITE_TOOLS
const preflight = read('src/shared/agent-tool-execution-preflight.ts');
const photoshopSkill = read('src/shared/photoshop-tool-skill.ts');
const scopeClassified = new Set([
    ...[...preflight.matchAll(/^\s{4}['"]([a-zA-Z][\w]*)['"],?\s*$/gm)].map((m) => m[1]),
    ...[...photoshopSkill.matchAll(/^\s{4}['"]([a-zA-Z][\w]*)['"],?\s*$/gm)].map((m) => m[1])
]);

// 少数工具的 scope 来自动态逻辑（getSkillById / acceptance evidence）而非静态 Set，列为已知例外避免误报
const DYNAMIC_SCOPE_EXEMPT = new Set([
    'delegateToAgent',
    // getPhotoshopToolSkillSemantics 对 skuLayout 按运行时 action 参数特判(buildSkuLayoutSemantics)，
    // 不进任何静态 Set，见 photoshop-tool-skill.ts
    'skuLayout'
]);

// 4. scope 分类散在两个文件，重叠的具名 Set 必须成员一致（否则会出现不同步隐患）
function extractNamedSet(src, setName) {
    const m = src.match(new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    if (!m) return null;
    return new Set([...m[1].matchAll(/['"]([a-zA-Z][\w]*)['"]/g)].map((x) => x[1]));
}
const SHARED_SCOPE_SETS = ['KNOWLEDGE_SEARCH_TOOLS', 'SAVE_EXPORT_TOOLS', 'EXTERNAL_GENERATION_TOOLS'];
const setMismatches = [];
for (const setName of SHARED_SCOPE_SETS) {
    const a = extractNamedSet(preflight, setName);
    const b = extractNamedSet(photoshopSkill, setName);
    if (!a || !b) continue;
    const onlyA = [...a].filter((t) => !b.has(t));
    const onlyB = [...b].filter((t) => !a.has(t));
    if (onlyA.length || onlyB.length) {
        setMismatches.push(`${setName}: preflight 独有[${onlyA.join(', ')}] · photoshop-tool-skill 独有[${onlyB.join(', ')}]`);
    }
}

const missingDisplay = schemaTools.filter((t) => !displayKeys.has(t));
const missingScope = schemaTools.filter((t) => !scopeClassified.has(t) && !DYNAMIC_SCOPE_EXEMPT.has(t));

// 5. 反向校验：UXP DesignEcho-UXP/src/tools 下声明过 name 的工具，tool-schemas 里有没有漏收。
// 治理审计(2026-07-01)之前，本脚本的比对基准全部取自 Agent 侧文件互相校验，从未读取 UXP 侧
// 工具真实注册表，导致约 40 个已实现工具(形态变形/智能对象写操作/模板渲染/SKU配置等)长期
// 对模型不可见，而这份"全绿"报告完全没能发现。见项目记忆 design-agent-governance-audit-20260701。
//
// 已评审、故意不开放给模型的工具：新增时必须写明理由，不能只是图省事排除。
const EXPLICITLY_NOT_EXPOSED_TO_AGENT = new Map([
    ['applyDisplacement', 'Agent 内部专用二进制位移场协议(SPARSE:xxx)，普通模型无法生成合法参数值'],
    ['warpExplorer', '研究/调试用探索性工具，commands 参数允许执行任意未受限 batchPlay 命令'],
    ['rasterizeSmartObject', '当前实现无条件返回失败，暴露给模型只会产生误导性的失败调用'],
    ['harmonize_layer', '工具路径从未接线(不导出图层像素、依赖不存在的 wsClient.request)，已从 UXP 注册表下架；面板 harmonize 路径不受影响'],
    ['quick_harmonize', '同 harmonize_layer：未接线的包装工具，已从 UXP 注册表下架']
]);

const UXP_TOOLS_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools');

function collectTsFiles(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(collectTsFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

const uxpDeclaredTools = new Set();
if (fs.existsSync(UXP_TOOLS_ROOT)) {
    for (const filePath of collectTsFiles(UXP_TOOLS_ROOT)) {
        const text = fs.readFileSync(filePath, 'utf8');
        // 覆盖 `readonly name = 'xxx'` 与 `name = 'xxx'` 两种最常见的工具类身份声明写法
        for (const m of text.matchAll(/(?:readonly\s+)?name\s*=\s*['"]([a-zA-Z][\w]*)['"]/g)) {
            uxpDeclaredTools.add(m[1]);
        }
    }
}
const schemaToolSet = new Set(schemaTools);
const missingFromAgent = [...uxpDeclaredTools]
    .filter((name) => !schemaToolSet.has(name) && !EXPLICITLY_NOT_EXPOSED_TO_AGENT.has(name))
    .sort();
const excludedFromAgent = [...uxpDeclaredTools]
    .filter((name) => EXPLICITLY_NOT_EXPOSED_TO_AGENT.has(name))
    .sort();

console.log(`工具总数 (tool-schemas): ${schemaTools.length}`);
console.log(`缺中文显示名: ${missingDisplay.length}${missingDisplay.length ? '  -> ' + missingDisplay.join(', ') : ''}`);
console.log(`缺权限 scope: ${missingScope.length}${missingScope.length ? '  -> ' + missingScope.join(', ') : ''}`);
console.log(`scope 两源不同步: ${setMismatches.length}`);
setMismatches.forEach((m) => console.log('  -> ' + m));
console.log(`UXP 已声明但 tool-schemas 未收录: ${missingFromAgent.length}${missingFromAgent.length ? '  -> ' + missingFromAgent.join(', ') : ''}`);
console.log(`已评审故意不开放给模型: ${excludedFromAgent.length}${excludedFromAgent.length ? '  -> ' + excludedFromAgent.join(', ') : ''}`);

if (missingDisplay.length || missingScope.length || setMismatches.length || missingFromAgent.length) {
    console.error('\n[FAIL] 工具注册存在缺口。新增/修改工具时请同步登记：');
    if (missingDisplay.length) console.error('  - 显示名 -> src/renderer/services/tool-display-info.ts (TOOL_NAME_MAP)');
    if (missingScope.length) console.error('  - 权限 scope -> src/shared/photoshop-tool-skill.ts 或 src/shared/agent-tool-execution-preflight.ts');
    if (setMismatches.length) console.error('  - scope 两源的同名 Set 必须保持成员一致(preflight ↔ photoshop-tool-skill)');
    if (missingFromAgent.length) console.error('  - UXP 已注册但模型不可见 -> src/renderer/services/agent-runtime/tool-schemas.ts (RAW_TOOL_CATALOG + DEFAULT_AGENT_TOOL_NAMES)，或加入本脚本 EXPLICITLY_NOT_EXPOSED_TO_AGENT 并写明理由');
    process.exit(1);
}
console.log('\n[OK] 工具注册一致性校验通过。');
