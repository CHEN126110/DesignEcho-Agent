/* eslint-disable no-console */
// V0-6 病灶A 回归守卫：只读证据类 export* 工具（exportLayerAsBase64 / exportColorConfig）
// 必须被 mcp-host-service.inferToolKind 判为 'read'，从而不被 runPhotoshopBatch 的
// allowWrites 门禁（mcp-host-service.ts 内 `policy.kind === 'write' || policy.kind === 'export'`）误拦；
// 且真正的写盘 export*（exportMainImageDocuments/quickExport/exportGroup/...）必须仍判非 read（保持门禁）。
// 同时断言 inferToolKind 的判定与权威分类源 photoshop-tool-skill.classifyPhotoshopToolSkillExecution 一致。
//
// 说明：inferToolKind 是 MCPHostService 的私有方法，且该服务 transitively 依赖 electron/sharp，
// 无法在 node 下直接实例化。因此本 smoke 从源码文本中提取 inferToolKind 的**真实方法体**并执行，
// 运行的是仓库里真实的字符，不是手抄副本；若补丁被回退，断言会真实失败。

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(ROOT, 'tsconfig.main.json')
});

const {
  classifyPhotoshopToolSkillExecution
} = require(path.resolve(ROOT, 'src', 'shared', 'photoshop-tool-skill.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

// 从 mcp-host-service.ts 源码中提取 inferToolKind 的真实方法体（大括号配平），构造可调用函数执行。
function extractRealInferToolKind() {
  const sourcePath = path.resolve(ROOT, 'src', 'main', 'services', 'mcp-host-service.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const signature = "private inferToolKind(toolName: string): 'read' | 'write' | 'export' {";
  const sigIndex = source.indexOf(signature);
  assert(sigIndex >= 0, 'Could not locate inferToolKind signature in mcp-host-service.ts', { signature });

  // 从签名末尾的 '{' 开始做大括号配平，取出完整方法体（不含最外层大括号）。
  const bodyStart = sigIndex + signature.length; // 紧跟在开括号之后
  let depth = 1;
  let i = bodyStart;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  assert(depth === 0, 'Failed to balance braces while extracting inferToolKind body');
  const body = source.slice(bodyStart, i);

  // 结构守卫：修复后的 export 分支必须委托给权威分类源，避免第三份并行清单再次漂移。
  assert(
    /\/\^export\//.test(body),
    'inferToolKind body must still special-case export-prefixed tools'
  );
  assert(
    body.includes('classifyPhotoshopToolSkillExecution'),
    'inferToolKind must delegate export-prefixed tools to classifyPhotoshopToolSkillExecution (V0-6 病灶A fix missing/reverted)',
    { bodyPreview: body.trim().slice(0, 400) }
  );

  // 方法体仅引用 toolName 与自由变量 classifyPhotoshopToolSkillExecution；以参数形式注入真实分类器后执行真实源码。
  // eslint-disable-next-line no-new-func
  const fn = new Function('toolName', 'classifyPhotoshopToolSkillExecution', body);
  return (toolName) => fn(toolName, classifyPhotoshopToolSkillExecution);
}

const inferToolKind = extractRealInferToolKind();

// allowWrites 门禁复刻（mcp-host-service.ts runPhotoshopBatch 内）：write/export 且未 allowWrites 即拦。
function isGatedByAllowWrites(toolName) {
  const kind = inferToolKind(toolName);
  return kind === 'write' || kind === 'export';
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) throw new Error(`FAIL ${name}: ${detail}`);
}

// 1) 权威分类源真值（真实执行 photoshop-tool-skill）——两个只读证据 export 工具。
record(
  'skill-classifies-exportLayerAsBase64-readonly',
  classifyPhotoshopToolSkillExecution('exportLayerAsBase64') === 'read_only_observation',
  `got ${classifyPhotoshopToolSkillExecution('exportLayerAsBase64')}`
);
record(
  'skill-classifies-exportColorConfig-readonly',
  classifyPhotoshopToolSkillExecution('exportColorConfig') === 'read_only_observation',
  `got ${classifyPhotoshopToolSkillExecution('exportColorConfig')}`
);
// 权威分类源真值——真正写盘 export 工具仍是 save_export。
for (const w of ['exportMainImageDocuments', 'quickExport', 'exportGroup', 'exportDetailPageSlices', 'exportWhiteBgFromSkuMaterial', 'exportToSkuDir', 'batchExport']) {
  record(
    `skill-classifies-${w}-save_export`,
    classifyPhotoshopToolSkillExecution(w) === 'save_export',
    `got ${classifyPhotoshopToolSkillExecution(w)}`
  );
}

// 2) 核心：inferToolKind 对只读证据 export 工具判 'read'（等价非 write），不再被 allowWrites 误拦。
record(
  'inferToolKind-exportLayerAsBase64-read',
  inferToolKind('exportLayerAsBase64') === 'read',
  `got ${inferToolKind('exportLayerAsBase64')}`
);
record(
  'inferToolKind-exportColorConfig-read',
  inferToolKind('exportColorConfig') === 'read',
  `got ${inferToolKind('exportColorConfig')}`
);
record(
  'exportLayerAsBase64-not-allowWrites-gated',
  isGatedByAllowWrites('exportLayerAsBase64') === false,
  `gated=${isGatedByAllowWrites('exportLayerAsBase64')}`
);
record(
  'exportColorConfig-not-allowWrites-gated',
  isGatedByAllowWrites('exportColorConfig') === false,
  `gated=${isGatedByAllowWrites('exportColorConfig')}`
);

// 3) 反向：真正写盘 export 工具仍判非 read，且仍被 allowWrites 门禁保护（无回归）。
const realWriteExports = {
  exportMainImageDocuments: 'export',
  exportGroup: 'export',
  exportDetailPageSlices: 'export',
  exportWhiteBgFromSkuMaterial: 'export',
  exportToSkuDir: 'export',
  quickExport: 'write', // 不以 export 开头 → 落到默认 write 分支
  batchExport: 'write'
};
for (const [tool, expectedKind] of Object.entries(realWriteExports)) {
  record(
    `inferToolKind-${tool}-${expectedKind}`,
    inferToolKind(tool) === expectedKind,
    `got ${inferToolKind(tool)}`
  );
  record(
    `${tool}-still-allowWrites-gated`,
    isGatedByAllowWrites(tool) === true,
    `gated=${isGatedByAllowWrites(tool)}`
  );
}

// 4) 常规读/写工具不受影响（无回归）。
record('inferToolKind-getDocumentInfo-read', inferToolKind('getDocumentInfo') === 'read', `got ${inferToolKind('getDocumentInfo')}`);
record('inferToolKind-setTextContent-write', inferToolKind('setTextContent') === 'write', `got ${inferToolKind('setTextContent')}`);
record('inferToolKind-resolveFontName-read', inferToolKind('resolveFontName') === 'read', `got ${inferToolKind('resolveFontName')}`);

// 5) 一致性契约：对每个 export 前缀工具，inferToolKind 判 read 当且仅当权威分类源判 read_only_observation。
const exportPrefixed = [
  'exportLayerAsBase64', 'exportColorConfig',
  'exportMainImageDocuments', 'exportGroup', 'exportDetailPageSlices',
  'exportWhiteBgFromSkuMaterial', 'exportToSkuDir'
];
for (const tool of exportPrefixed) {
  const isRead = inferToolKind(tool) === 'read';
  const isReadOnlyObservation = classifyPhotoshopToolSkillExecution(tool) === 'read_only_observation';
  record(
    `consistency-${tool}`,
    isRead === isReadOnlyObservation,
    `inferToolKind=${inferToolKind(tool)} skill=${classifyPhotoshopToolSkillExecution(tool)}`
  );
}

// 6) V1-1：读判定改走权威分类源后，非 get/list 前缀的只读工具不再被名字启发式误判为 write
//    （此前落默认 write 分支被 allowWrites 门禁误拦）。
const v11FixedReadOnlyTools = [
  'extractShapePath',
  'inspectDetailPageLivePlacements',
  'sockLayoutConfig'
];
for (const tool of v11FixedReadOnlyTools) {
  record(
    `v1-1-${tool}-read`,
    inferToolKind(tool) === 'read',
    `got ${inferToolKind(tool)} (skill=${classifyPhotoshopToolSkillExecution(tool)})`
  );
  record(
    `v1-1-${tool}-not-allowWrites-gated`,
    isGatedByAllowWrites(tool) === false,
    `gated=${isGatedByAllowWrites(tool)}`
  );
}

// 7) 单一事实源不变量：凡权威分类源判 read_only_observation / knowledge_search 的工具，
//    inferToolKind 必判 read（读判定不再有第二套会漂移的名字规则）。
const v11InvariantSamples = [
  'extractShapePath', 'inspectDetailPageLivePlacements', 'sockLayoutConfig',
  'exportLayerAsBase64', 'exportColorConfig', 'getDocumentInfo', 'auditTextReplacement',
  'analyzeAssetContent', 'recommendAssets', 'matchDetailPageContent',
  'searchDesignKnowledge', 'searchDesigns', 'readBrowserPage', 'listBrowserTabs', 'getDesignPrinciples'
];
for (const tool of v11InvariantSamples) {
  const skillKind = classifyPhotoshopToolSkillExecution(tool);
  if (skillKind !== 'read_only_observation' && skillKind !== 'knowledge_search') continue;
  record(
    `v1-1-invariant-${tool}-read`,
    inferToolKind(tool) === 'read',
    `skill=${skillKind} but inferToolKind=${inferToolKind(tool)}`
  );
}

// 8) 无回归：真正写盘 save_export 工具仍非 read，仍受 allowWrites 门禁保护。
for (const tool of ['quickExport', 'batchExport', 'saveDocument', 'smartSave', 'exportGroup', 'exportMainImageDocuments']) {
  record(
    `v1-1-noregress-${tool}-nonread-gated`,
    inferToolKind(tool) !== 'read' && isGatedByAllowWrites(tool) === true,
    `kind=${inferToolKind(tool)} gated=${isGatedByAllowWrites(tool)}`
  );
}

console.log(JSON.stringify({
  smoke: 'photoshop-mcp:export-tool-kind',
  total: results.length,
  passed: results.filter(r => r.ok).length,
  checks: results.map(r => r.name)
}, null, 2));
console.log(`PASS: ${results.length} assertions green`);
