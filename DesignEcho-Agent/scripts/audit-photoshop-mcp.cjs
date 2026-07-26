/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UXP_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP');
const REGISTRY_PATH = path.join(UXP_ROOT, 'src', 'tools', 'registry.ts');
const AGENT_TOOL_SCHEMAS_PATH = path.join(ROOT, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts');
const AGENT_TOOL_EXECUTOR_PATH = path.join(ROOT, 'src', 'renderer', 'services', 'tool-executor.service.ts');
const SKILL_DECLARATIONS_PATH = path.join(ROOT, 'src', 'shared', 'skills', 'skill-declarations.ts');
const OUT_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(OUT_DIR, 'photoshop-mcp-inventory.json');
const MD_OUT = path.join(OUT_DIR, 'photoshop-mcp-inventory.md');
const ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const RUNTIME_SMOKE = process.argv.includes('--runtime-smoke');

const AGENT_LOCAL_TOOL_NAMES = new Set([
  'createInteractiveCard',
  'renderLayout',
  'listProjectResources',
  'searchProjectResources',
  'openProjectFile',
  'getProjectStructure',
  'getResourceSummary',
  'getAssetPreview',
  'getResourcesByCategory',
  'createProjectContactSheetOverview',
  'analyzeProjectContactSheetOverview',
  'analyzeProjectForDetailPage',
  'matchDetailPageContent',
  'describeImage',
  'analyzeAssetContent',
  'recommendAssets',
  'generateImage',
  'getDesignProjectState',
  'updateDesignProjectState',
  'getMainImageDesignFramework',
  'getDetailPageDesignFramework',
  'searchDesignKnowledge',
  'searchDesigns',
  'searchEagleReferences',
  'fetchWebPageDesignContent',
  'delegateToAgent',
  'runDesignTeamPipeline'
]);

const AGENT_TOOL_PREFIXES_WITHOUT_PHOTOSHOP_RUNTIME = [
  'mcp:',
  'visual:'
];

async function rpc(method, params = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${ENDPOINT}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }

  return payload.result;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function extractArrayBlockAfterMarker(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return '';
  const assignmentIndex = text.indexOf('=', markerIndex);
  const searchStart = assignmentIndex >= 0 ? assignmentIndex : markerIndex;
  const start = text.indexOf('[', searchStart);
  if (start < 0) return '';

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return '';
}

function extractStringLiterals(text) {
  return [...text.matchAll(/['"]([A-Za-z][\w:-]*)['"]/g)].map((match) => match[1]);
}

function extractToolNamesFromObjectArray(text, marker) {
  return uniqueSorted(
    [...extractArrayBlockAfterMarker(text, marker).matchAll(/\bname\s*:\s*['"]([A-Za-z][\w:-]*)['"]/g)]
      .map((match) => match[1])
  );
}

function extractStringArrayAssignment(text, marker) {
  return uniqueSorted(extractStringLiterals(extractArrayBlockAfterMarker(text, marker)));
}

function extractSkillRequiredToolNames(text) {
  const names = [];
  for (const match of text.matchAll(/requiredTools\s*:\s*\[([\s\S]*?)\]/g)) {
    names.push(...extractStringLiterals(match[1]));
  }
  return uniqueSorted(names);
}

function extractToolAliases(text) {
  const marker = 'const TOOL_NAME_ALIASES';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return {};
  const start = text.indexOf('{', markerIndex);
  const end = text.indexOf('};', start);
  if (start < 0 || end < 0) return {};

  const aliases = {};
  const block = text.slice(start, end + 1);
  for (const match of block.matchAll(/([A-Za-z][\w]*)\s*:\s*['"]([A-Za-z][\w:-]*)['"]/g)) {
    aliases[match[1]] = match[2];
  }
  return aliases;
}

function isAgentLocalToolName(toolName) {
  return AGENT_LOCAL_TOOL_NAMES.has(toolName)
    || AGENT_TOOL_PREFIXES_WITHOUT_PHOTOSHOP_RUNTIME.some((prefix) => toolName.startsWith(prefix));
}

function toRuntimeCandidates(toolNames, source, aliases) {
  return uniqueSorted(toolNames)
    .filter((toolName) => !isAgentLocalToolName(toolName))
    .map((toolName) => ({
      toolName,
      runtimeName: aliases[toolName] || toolName,
      sources: [source]
    }));
}

function jsonText(result) {
  const text = result?.content?.[0]?.text;
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function parseImports(registryText) {
  const imports = new Map();
  const importRegex = /import\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"];?/g;
  let match;
  while ((match = importRegex.exec(registryText))) {
    const names = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const name of names) {
      imports.set(name, match[2]);
    }
  }
  return imports;
}

function parseRegisteredClasses(registryText) {
  const classes = [];
  const registerRegex = /this\.register\(\s*new\s+([A-Za-z0-9_]+)\s*\(/g;
  let match;
  while ((match = registerRegex.exec(registryText))) {
    classes.push(match[1]);
  }

  const registerManyRegex = /this\.registerMany\(\s*\[([\s\S]*?)\]\s*\)/g;
  while ((match = registerManyRegex.exec(registryText))) {
    const block = match[1];
    const newClassRegex = /new\s+([A-Za-z0-9_]+)\s*\(/g;
    let classMatch;
    while ((classMatch = newClassRegex.exec(block))) {
      classes.push(classMatch[1]);
    }
  }

  const assignedInstances = new Map();
  const assignRegex = /this\.([A-Za-z0-9_]+)\s*=\s*new\s+([A-Za-z0-9_]+)\s*\(/g;
  while ((match = assignRegex.exec(registryText))) {
    assignedInstances.set(match[1], match[2]);
  }

  const registerVarRegex = /this\.register\(\s*this\.([A-Za-z0-9_]+)\s*\)/g;
  while ((match = registerVarRegex.exec(registryText))) {
    const className = assignedInstances.get(match[1]);
    if (className) {
      classes.push(className);
    }
  }

  return Array.from(new Set(classes));
}

function resolveModulePath(importPath, fromFile = REGISTRY_PATH) {
  const base = path.resolve(path.dirname(fromFile), importPath);
  const candidates = [
    `${base}.ts`,
    path.join(base, 'index.ts')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function extractClassBlock(fileText, className) {
  const classRegex = new RegExp(
    `export\\s+class\\s+${className}\\b[\\s\\S]*?(?=\\nexport\\s+class\\s+|\\nexport\\s+\\{|$)`
  );
  const match = fileText.match(classRegex);
  return match ? match[0] : null;
}

function extractToolName(classBlock) {
  if (!classBlock) {
    return null;
  }

  const direct = classBlock.match(/readonly\s+name\s*=\s*['"]([^'"]+)['"]/);
  if (direct) {
    return direct[1];
  }

  const plain = classBlock.match(/\bname\s*=\s*['"]([^'"]+)['"]/);
  if (plain) {
    return plain[1];
  }

  const getter = classBlock.match(/get\s+name\s*\(\)\s*:\s*[A-Za-z0-9_<>\[\]\s|]+?\{\s*return\s*['"]([^'"]+)['"]/);
  if (getter) {
    return getter[1];
  }

  const schema = classBlock.match(/schema\s*:\s*ToolSchema\s*=\s*\{[\s\S]*?name\s*:\s*['"]([^'"]+)['"]/);
  if (schema) {
    return schema[1];
  }

  return null;
}

function resolveReExportTarget(modulePath, className) {
  if (!fs.existsSync(modulePath)) {
    return modulePath;
  }

  const fileText = readUtf8(modulePath);
  const reExportRegex = /export\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"];?/g;
  let match;
  while ((match = reExportRegex.exec(fileText))) {
    const names = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.split(/\s+as\s+/i)[0].trim());
    if (names.includes(className)) {
      return resolveModulePath(match[2], modulePath);
    }
  }

  return modulePath;
}

function hasNoDialogBatchPlayGuard(classBlock, fileText = '') {
  if (/dialogOptions\s*:\s*['"]dontDisplay['"]/.test(classBlock)) {
    return true;
  }

  return classBlock.includes('buildSelectionReadDescriptor(')
    && /function\s+buildSelectionReadDescriptor\b[\s\S]*?dialogOptions\s*:\s*['"]dontDisplay['"]/.test(fileText);
}

function detectPopupRisk(classBlock, fileText = '') {
  if (!classBlock) {
    return 'unknown';
  }

  if (/alert\s*\(/.test(classBlock) || /showAlert/i.test(classBlock)) {
    return 'explicit-alert';
  }

  const hasBatchPlay = /batchPlay\s*\(/.test(classBlock);
  const hasDontDisplay = hasNoDialogBatchPlayGuard(classBlock, fileText);
  const hasExecuteAsModal = /executeAsModal\s*\(/.test(classBlock);

  if (hasBatchPlay && !hasDontDisplay) {
    return 'possible-dialog';
  }

  if (hasExecuteAsModal || hasBatchPlay) {
    return 'modal-safe';
  }

  return 'low';
}

function classifySourceFile(filePath) {
  const rel = path.relative(path.join(UXP_ROOT, 'src', 'tools'), filePath).replace(/\\/g, '/');
  const category = rel.split('/')[0] || 'unknown';
  return { category, relativePath: rel };
}

async function getHostSummary() {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'audit-photoshop-mcp', version: '1.0.0' }
  });
  const tools = await rpc('tools/list');
  const resources = await rpc('resources/list');
  const prompts = await rpc('prompts/list');
  const systemStatus = jsonText(await rpc('tools/call', { name: 'system.status', arguments: {} }));
  const connectionStatus = jsonText(
    await rpc('tools/call', { name: 'photoshop.connection_status', arguments: {} })
  );
  const runtimeTools = jsonText(
    await rpc('tools/call', { name: 'photoshop.tools.list', arguments: {} })
  );

  return {
    initialize: init,
    hostTools: Array.isArray(tools?.tools) ? tools.tools : [],
    resources: Array.isArray(resources?.resources) ? resources.resources : [],
    prompts: Array.isArray(prompts?.prompts) ? prompts.prompts : [],
    systemStatus,
    connectionStatus,
    runtimeTools: Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : []
  };
}

// 判断是否为"端点根本不可达"这一层的失败（本机没起 Photoshop MCP 桥）。
// Node fetch 对连接失败统一抛 TypeError: fetch failed，真实原因（ECONNREFUSED 等）在 cause 里。
// 只有这一类失败允许降级为离线静态模式；端点可达但协议/服务报错属真实故障，必须照常失败。
function isConnectionLevelFailure(error) {
  const codes = new Set([
    'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT',
    'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'
  ]);
  const cause = error?.cause;
  if (cause?.code && codes.has(cause.code)) return true;
  if (Array.isArray(cause?.errors) && cause.errors.some((item) => codes.has(item?.code))) return true;
  return error instanceof TypeError && /fetch failed/i.test(String(error?.message || ''));
}

// 本审计脚本唯一的判定断言（uxpToolsMissingFromAgent → exit 1）是纯静态核对，
// 不依赖真机端点；端点只服务于运行时暴露核对与清单富化。历史结构把静态判定
// 挡在 getHostSummary() 的 fetch 后面，导致无 Photoshop 的环境连静态核对都跑不了。
// 这里解耦：端点不可达时降级为离线模式，静态判定照常执行并保持 exit 语义；
// 运行时相关核对显式标记为 skipped-offline（不产出假的 "None/no" 结论），需真机复跑。
async function getHostSummaryOrOffline() {
  try {
    const summary = await getHostSummary();
    return { online: true, offlineReason: null, ...summary };
  } catch (error) {
    if (!isConnectionLevelFailure(error)) {
      throw error;
    }
    const causeCode = error?.cause?.code
      || (Array.isArray(error?.cause?.errors) ? error.cause.errors.map((item) => item?.code).filter(Boolean).join('/') : '')
      || error?.message
      || String(error);
    return {
      online: false,
      offlineReason: `Photoshop MCP 端点 ${ENDPOINT} 不可达（${causeCode}）。`
        + '通常表示本机没有运行 Photoshop + MCP 桥。静态一致性核对（UXP registry vs Agent 声明）不依赖该端点，已照常执行；'
        + '运行时暴露核对已跳过，需在真机（Photoshop + MCP 桥就绪）复跑本审计补验。',
      initialize: null,
      hostTools: [],
      resources: [],
      prompts: [],
      systemStatus: null,
      connectionStatus: null,
      runtimeTools: []
    };
  }
}

async function runRuntimeSmoke(runtimeNames) {
  const allowlist = [
    'getDocumentInfo',
    'listDocuments',
    'diagnoseState'
  ].filter((name) => runtimeNames.has(name));

  const results = [];
  for (const name of allowlist) {
    try {
      const result = await rpc('tools/call', {
        name: 'photoshop.tools.call',
        arguments: { name, arguments: {} }
      });
      const parsed = jsonText(result);
      results.push({
        name,
        status: 'ok',
        detail: parsed?.error || null
      });
    } catch (error) {
      results.push({
        name,
        status: 'error',
        detail: error?.message || String(error)
      });
    }
  }
  return results;
}

function buildInventory(hostSummary) {
  const online = hostSummary.online !== false;
  const registryText = readUtf8(REGISTRY_PATH);
  const imports = parseImports(registryText);
  const registeredClasses = parseRegisteredClasses(registryText);
  const runtimeToolMap = new Map(
    hostSummary.runtimeTools.map((tool) => [tool.name, tool])
  );

  const entries = [];
  for (const className of registeredClasses) {
    const importPath = imports.get(className);
    const initialModulePath = importPath ? resolveModulePath(importPath) : null;
    const modulePath = initialModulePath ? resolveReExportTarget(initialModulePath, className) : null;
    const exists = modulePath ? fs.existsSync(modulePath) : false;
    const fileText = exists ? readUtf8(modulePath) : null;
    const classBlock = exists ? extractClassBlock(fileText, className) : null;
    const toolName = extractToolName(classBlock);
    const meta = modulePath ? classifySourceFile(modulePath) : { category: 'unknown', relativePath: null };
    const runtimeTool = toolName ? runtimeToolMap.get(toolName) : null;

    entries.push({
      className,
      toolName,
      category: meta.category,
      sourceFile: meta.relativePath,
      sourceResolved: modulePath,
      importPath: importPath || null,
      sourceExists: exists,
      // 离线时无法核对运行时暴露，用 null 表示"未验证"，不产出假的 false
      runtimeExposed: online ? Boolean(runtimeTool) : null,
      runtimeDescription: runtimeTool?.description || null,
      inputSchemaRequired: runtimeTool?.inputSchema?.required || [],
      popupRisk: detectPopupRisk(classBlock, fileText || ''),
      issues: [
        ...(importPath ? [] : ['missing_import']),
        ...(exists ? [] : ['missing_source_file']),
        ...(toolName ? [] : ['missing_tool_name']),
        // missing_in_runtime 是运行时判定，离线时不产出（否则全量假阳性）
        ...(online && toolName && !runtimeTool ? ['missing_in_runtime'] : [])
      ]
    });
  }

  const sourceNames = new Set(entries.map((item) => item.toolName).filter(Boolean));
  const runtimeOnly = hostSummary.runtimeTools
    .filter((tool) => !sourceNames.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description || null
    }));

  return {
    entries,
    runtimeOnly,
    runtimeVerification: online ? 'verified' : 'skipped-offline',
    missingInRuntime: online ? entries.filter((item) => item.toolName && !item.runtimeExposed) : [],
    brokenSource: entries.filter((item) => item.issues.length > 0)
  };
}

// 治理审计(2026-07-01)补齐：反向 diff——UXP registry.ts 已注册但 Agent 四个来源(tool-schemas/
// default-agent/tool-executor/skill-declarations)都未声明的工具。此前脚本只算了两个单向 diff
// (UXP声明→运行时暴露、Agent声明→运行时暴露)，均不能发现"UXP有、Agent从未听说过"这类缺口，
// 历史上曾造成约40个已实现工具(形态变形/智能对象写操作/模板渲染/SKU配置等)对模型完全不可见。
// 见项目记忆 design-agent-governance-audit-20260701 与 tool-registration-coupling。
//
// EXPLICITLY_NOT_EXPOSED_TO_AGENT：经评审后故意不开放给模型的工具，不计入缺口，避免产生
// "永远清不掉的假阳性红线"。新增时必须写明理由，不能只是图省事排除。
const EXPLICITLY_NOT_EXPOSED_TO_AGENT = new Map([
  ['applyDisplacement', 'Agent 内部专用二进制位移场协议(SPARSE:xxx)，普通模型无法生成合法参数值，只服务 Agent 内部算法管线'],
  ['warpExplorer', '研究/调试用探索性工具，commands 参数允许执行任意未受限 batchPlay 命令，暴露给模型等同开放原生命令执行后门'],
  ['rasterizeSmartObject', '当前实现无条件返回失败(见 getNativeRasterizeBlockedReason)，暴露给模型只会产生误导性的失败调用']
]);

function buildUxpToolsMissingFromAgent(inventory, allAgentTools, aliases = {}) {
  const uxpRegisteredNames = new Set(
    inventory.entries.map((item) => item.toolName).filter(Boolean)
  );
  // Agent 侧声明名与 UXP 运行时名可能经 TOOL_NAME_ALIASES 映射（如 harmonizeLayer →
  // harmonize_layer，tool-executor.service.ts 派发时解析别名）。正向 diff(toRuntimeCandidates)
  // 一直应用了别名，反向 diff 此前漏了，导致对已接线的别名工具产生假阳性缺口。
  // 这里把"原始声明名 + 别名解析后的运行时名"都算作 Agent 已声明。
  const agentDeclaredNames = new Set();
  for (const name of allAgentTools) {
    agentDeclaredNames.add(name);
    if (aliases[name]) {
      agentDeclaredNames.add(aliases[name]);
    }
  }
  const missing = [];
  const excluded = [];
  for (const name of uxpRegisteredNames) {
    if (agentDeclaredNames.has(name)) continue;
    if (EXPLICITLY_NOT_EXPOSED_TO_AGENT.has(name)) {
      excluded.push({ name, reason: EXPLICITLY_NOT_EXPOSED_TO_AGENT.get(name) });
      continue;
    }
    missing.push(name);
  }
  return {
    missing: missing.sort(),
    excluded: excluded.sort((a, b) => a.name.localeCompare(b.name))
  };
}

function buildAgentToolCoverage(runtimeTools, online = true) {
  const toolSchemasText = readUtf8(AGENT_TOOL_SCHEMAS_PATH);
  const toolExecutorText = readUtf8(AGENT_TOOL_EXECUTOR_PATH);
  const skillDeclarationsText = readUtf8(SKILL_DECLARATIONS_PATH);
  const aliases = extractToolAliases(toolExecutorText);
  const runtimeNames = new Set(runtimeTools.map((tool) => String(tool.name || '').trim()).filter(Boolean));

  const modelToolSchemas = extractToolNamesFromObjectArray(toolSchemasText, 'const RAW_TOOL_CATALOG');
  const defaultAgentTools = extractStringArrayAssignment(toolSchemasText, 'const DEFAULT_AGENT_TOOL_NAMES');
  const executorAvailableTools = extractToolNamesFromObjectArray(toolExecutorText, 'export const AVAILABLE_TOOLS');
  const skillRequiredTools = extractSkillRequiredToolNames(skillDeclarationsText);
  const sourceRuntimeCandidates = {
    modelSchema: toRuntimeCandidates(modelToolSchemas, 'model-schema', aliases),
    defaultAgent: toRuntimeCandidates(defaultAgentTools, 'default-agent', aliases),
    toolExecutor: toRuntimeCandidates(executorAvailableTools, 'tool-executor', aliases),
    skillRequired: toRuntimeCandidates(skillRequiredTools, 'skill-required', aliases)
  };
  const allAgentTools = uniqueSorted([
    ...modelToolSchemas,
    ...defaultAgentTools,
    ...executorAvailableTools,
    ...skillRequiredTools
  ]);

  const runtimeCandidates = allAgentTools
    .filter((toolName) => !isAgentLocalToolName(toolName))
    .map((toolName) => ({
      toolName,
      runtimeName: aliases[toolName] || toolName,
      sources: [
        ...(modelToolSchemas.includes(toolName) ? ['model-schema'] : []),
        ...(defaultAgentTools.includes(toolName) ? ['default-agent'] : []),
        ...(executorAvailableTools.includes(toolName) ? ['tool-executor'] : []),
        ...(skillRequiredTools.includes(toolName) ? ['skill-required'] : [])
      ]
    }));

  return {
    counts: {
      modelToolSchemas: modelToolSchemas.length,
      defaultAgentTools: defaultAgentTools.length,
      executorAvailableTools: executorAvailableTools.length,
      skillRequiredTools: skillRequiredTools.length,
      allAgentTools: allAgentTools.length,
      photoshopRuntimeCandidates: runtimeCandidates.length,
      agentLocalTools: allAgentTools.filter(isAgentLocalToolName).length
    },
    aliases,
    allAgentTools,
    agentLocalTools: allAgentTools.filter(isAgentLocalToolName),
    // 运行时缺失核对依赖真机端点返回的工具清单；离线时置空并显式标记 skipped-offline，
    // 避免"全部候选都不在空清单里"这种全量假阳性
    runtimeVerification: online ? 'verified' : 'skipped-offline',
    missingRuntimeTools: online
      ? runtimeCandidates.filter((tool) => !runtimeNames.has(tool.runtimeName))
      : [],
    runtimeCandidates,
    sourceRuntimeCandidates,
    missingRuntimeToolsBySource: Object.fromEntries(
      Object.entries(sourceRuntimeCandidates).map(([source, candidates]) => [
        source,
        online ? candidates.filter((tool) => !runtimeNames.has(tool.runtimeName)) : []
      ])
    )
  };
}

function renderMarkdown(report) {
  const offline = report.online === false;
  const offlineNote = 'Skipped — endpoint unreachable (offline static mode)，需真机复跑本审计补验';
  const lines = [];
  lines.push('# Photoshop MCP Inventory');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Host tools: ${offline ? 'unverified (offline)' : report.hostTools.length}`);
  lines.push(`- Photoshop runtime tools: ${offline ? 'unverified (offline)' : report.runtimeTools.length}`);
  lines.push(`- Registry entries: ${report.inventory.entries.length}`);
  lines.push(`- Missing in runtime: ${offline ? 'unverified (offline)' : report.inventory.missingInRuntime.length}`);
  lines.push(`- Runtime-only tools: ${offline ? 'unverified (offline)' : report.inventory.runtimeOnly.length}`);
  lines.push(`- Agent Photoshop runtime candidates: ${report.agentToolCoverage.counts.photoshopRuntimeCandidates}`);
  lines.push(`- Agent runtime missing: ${offline ? 'unverified (offline)' : report.agentToolCoverage.missingRuntimeTools.length}`);
  lines.push(`- Photoshop connected: ${report.connectionStatus?.connected === true ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Default mode is static inventory plus safe host preflight.');
  lines.push('- No bulk runtime tool execution is performed by default.');
  lines.push('- Use `--runtime-smoke` only on a disposable Photoshop session.');
  if (offline) {
    lines.push(`- OFFLINE: ${report.offlineReason}`);
  }
  lines.push('');

  if (report.runtimeSmoke.length) {
    lines.push('## Runtime Smoke');
    lines.push('');
    lines.push('| Tool | Status | Detail |');
    lines.push('|---|---|---|');
    for (const item of report.runtimeSmoke) {
      lines.push(`| ${item.name} | ${item.status} | ${String(item.detail || '').replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }

  lines.push('## Missing In Runtime');
  lines.push('');
  if (offline) {
    lines.push(`- ${offlineNote}`);
  } else if (!report.inventory.missingInRuntime.length) {
    lines.push('- None');
  } else {
    for (const item of report.inventory.missingInRuntime) {
      lines.push(`- \`${item.toolName}\` from \`${item.sourceFile}\``);
    }
  }
  lines.push('');

  lines.push('## Runtime Only');
  lines.push('');
  if (offline) {
    lines.push(`- ${offlineNote}`);
  } else if (!report.inventory.runtimeOnly.length) {
    lines.push('- None');
  } else {
    for (const item of report.inventory.runtimeOnly) {
      lines.push(`- \`${item.name}\``);
    }
  }
  lines.push('');

  lines.push('## Agent Runtime Coverage');
  lines.push('');
  lines.push(`- Model schemas: ${report.agentToolCoverage.counts.modelToolSchemas}`);
  lines.push(`- Default tools: ${report.agentToolCoverage.counts.defaultAgentTools}`);
  lines.push(`- Executor available tools: ${report.agentToolCoverage.counts.executorAvailableTools}`);
  lines.push(`- Skill required tools: ${report.agentToolCoverage.counts.skillRequiredTools}`);
  lines.push(`- Agent-local tools: ${report.agentToolCoverage.counts.agentLocalTools}`);
  lines.push(`- Photoshop runtime candidates: ${report.agentToolCoverage.counts.photoshopRuntimeCandidates}`);
  if (report.agentToolCoverage.sourceRuntimeCandidates) {
    lines.push(`- Model-schema runtime candidates: ${report.agentToolCoverage.sourceRuntimeCandidates.modelSchema?.length || 0}`);
    lines.push(`- Default-agent runtime candidates: ${report.agentToolCoverage.sourceRuntimeCandidates.defaultAgent?.length || 0}`);
    lines.push(`- Tool-executor runtime candidates: ${report.agentToolCoverage.sourceRuntimeCandidates.toolExecutor?.length || 0}`);
    lines.push(`- Skill-required runtime candidates: ${report.agentToolCoverage.sourceRuntimeCandidates.skillRequired?.length || 0}`);
  }
  lines.push('');
  if (offline) {
    lines.push(`- Missing runtime tools: ${offlineNote}`);
  } else if (!report.agentToolCoverage.missingRuntimeTools.length) {
    lines.push('- Missing runtime tools: none');
  } else {
    lines.push('| Agent Tool | Runtime Name | Sources |');
    lines.push('|---|---|---|');
    for (const item of report.agentToolCoverage.missingRuntimeTools) {
      lines.push(`| ${item.toolName} | ${item.runtimeName} | ${item.sources.join(', ')} |`);
    }
  }
  lines.push('');

  lines.push('## UXP Tools Missing From Agent');
  lines.push('');
  lines.push('反向 diff：UXP registry.ts 已注册，但 tool-schemas.ts/default-agent/tool-executor/skill-declarations 四个 Agent 侧来源都未声明的工具。这是模型自主 ReAct 循环里永远调用不到的能力缺口。');
  lines.push('');
  if (!report.uxpToolsMissingFromAgent?.missing.length) {
    lines.push('- None — no gap detected.');
  } else {
    for (const name of report.uxpToolsMissingFromAgent.missing) {
      lines.push(`- \`${name}\``);
    }
  }
  lines.push('');
  if (report.uxpToolsMissingFromAgent?.excluded.length) {
    lines.push('已评审、故意不暴露给模型的工具（不计入缺口）：');
    lines.push('');
    for (const item of report.uxpToolsMissingFromAgent.excluded) {
      lines.push(`- \`${item.name}\`: ${item.reason}`);
    }
    lines.push('');
  }

  lines.push('## Tool Table');
  lines.push('');
  lines.push('| Tool | Category | Runtime | Popup Risk | Issues | Source |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of report.inventory.entries.sort((a, b) => String(a.toolName).localeCompare(String(b.toolName)))) {
    const runtimeCell = item.runtimeExposed === null ? 'unverified' : (item.runtimeExposed ? 'yes' : 'no');
    lines.push(
      `| ${item.toolName || item.className} | ${item.category} | ${runtimeCell} | ${item.popupRisk} | ${item.issues.join(', ') || ''} | ${item.sourceFile || ''} |`
    );
  }
  lines.push('');

  return lines.join('\n');
}

async function main() {
  ensureDir(OUT_DIR);

  const hostSummary = await getHostSummaryOrOffline();

  if (!hostSummary.online && RUNTIME_SMOKE) {
    // --runtime-smoke 的意图就是执行真机工具，端点不可达时不存在"降级"的语义，必须失败
    throw new Error(
      `--runtime-smoke 需要可用的 Photoshop MCP 端点，但 ${ENDPOINT} 不可达。`
      + '请先启动 Photoshop 与 MCP 桥（或用 MCP_ENDPOINT 指向正确端点）后重跑。'
    );
  }

  const inventory = buildInventory(hostSummary);
  const agentToolCoverage = buildAgentToolCoverage(hostSummary.runtimeTools, hostSummary.online);
  const uxpToolsMissingFromAgent = buildUxpToolsMissingFromAgent(
    inventory,
    agentToolCoverage.allAgentTools,
    agentToolCoverage.aliases
  );
  const runtimeSmoke = RUNTIME_SMOKE
    ? await runRuntimeSmoke(new Set(hostSummary.runtimeTools.map((tool) => tool.name)))
    : [];

  const report = {
    generatedAt: new Date().toISOString(),
    mode: hostSummary.online
      ? (RUNTIME_SMOKE ? 'static+runtime-smoke' : 'static-only')
      : 'static-offline',
    online: hostSummary.online,
    offlineReason: hostSummary.offlineReason,
    endpoint: ENDPOINT,
    hostTools: hostSummary.hostTools,
    resources: hostSummary.resources,
    prompts: hostSummary.prompts,
    systemStatus: hostSummary.systemStatus,
    connectionStatus: hostSummary.connectionStatus,
    runtimeTools: hostSummary.runtimeTools,
    inventory,
    agentToolCoverage,
    uxpToolsMissingFromAgent,
    runtimeSmoke
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  if (report.online) {
    console.log(`Photoshop connected: ${report.connectionStatus?.connected === true}`);
    console.log(`Runtime tools: ${report.runtimeTools.length}`);
    console.log(`Missing in runtime: ${report.inventory.missingInRuntime.length}`);
    console.log(`Agent runtime missing: ${report.agentToolCoverage.missingRuntimeTools.length}`);
  } else {
    console.warn(`[audit:photoshop-mcp] OFFLINE 静态模式：${report.offlineReason}`);
    console.warn('[audit:photoshop-mcp] 已跳过（需真机复跑）：运行时暴露核对 / runtime-only 清单 / 连接状态。');
  }
  console.log(`UXP tools missing from Agent (gap this audit closes): ${report.uxpToolsMissingFromAgent.missing.length}`);
  console.log(`UXP tools explicitly excluded (reviewed, not exposed): ${report.uxpToolsMissingFromAgent.excluded.length}`);

  if (report.uxpToolsMissingFromAgent.missing.length > 0) {
    console.error(
      `[audit:photoshop-mcp] Gap: ${report.uxpToolsMissingFromAgent.missing.length} UXP-registered tool(s) `
      + `are missing from Agent tool-schemas.ts: ${report.uxpToolsMissingFromAgent.missing.join(', ')}. `
      + 'Either register them in tool-schemas.ts (+ tool-display-info.ts + photoshop-tool-skill.ts) '
      + 'or add them to EXPLICITLY_NOT_EXPOSED_TO_AGENT in this script with a documented reason.'
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
