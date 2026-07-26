#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp', 'photoshop-bridge-health');
const REPORT_JSON = path.join(TMP_DIR, 'report.json');
const REPORT_MD = path.join(TMP_DIR, 'report.md');
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const DEFAULT_TIMEOUT_MS = parsePositiveInteger(
  process.env.DESIGNECHO_PHOTOSHOP_BRIDGE_HEALTH_TIMEOUT_MS,
  12_000
);
const DEFAULT_STALE_PLUGIN_ACTIVITY_MS = parsePositiveInteger(
  process.env.DESIGNECHO_PHOTOSHOP_BRIDGE_STALE_ACTIVITY_MS,
  120_000
);
const FAIL_ON_NOT_READY = process.argv.includes('--fail-on-not-ready');

const DEFAULT_REQUIRED_TOOL_NAMES = [
  'listDocuments',
  'getDocumentInfo',
  'getLayerHierarchy',
  'getLayerProperties',
  'getAcceptanceSnapshot'
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertJsonEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected: ${expectedJson}\nactual: ${actualJson}`);
  }
}

function getRepeatedArg(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (value && !value.startsWith('--')) values.push(value);
  }
  return values;
}

function getRequiredToolNames() {
  const explicitTools = getRepeatedArg('--required-tool')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (explicitTools.length > 0) return explicitTools;
  return DEFAULT_REQUIRED_TOOL_NAMES;
}

function parseRequiredToolProperty(value) {
  const text = String(value || '').trim();
  const dotIndex = text.indexOf('.');
  if (dotIndex <= 0 || dotIndex >= text.length - 1) {
    throw new Error(`Invalid --required-tool-property "${text}". Expected format: toolName.propertyName`);
  }
  return {
    toolName: text.slice(0, dotIndex),
    propertyName: text.slice(dotIndex + 1)
  };
}

function getRequiredToolProperties() {
  return getRepeatedArg('--required-tool-property').map(parseRequiredToolProperty);
}

function getRequiredRuntimeFeatures() {
  return getRepeatedArg('--required-runtime-feature')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function isTimeoutMessage(message) {
  return /timed out after|request timeout|timeout/i.test(String(message || ''));
}

function getTimestampAgeMs(value, nowMs = Date.now()) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, nowMs - parsed);
}

function summarizePluginActivityDiagnostics(systemStatus, nowMs = Date.now()) {
  const diagnostics = systemStatus.ok
    ? systemStatus.result?.pluginConnectionDiagnostics || {}
    : {};
  const lastActivityAgeMs = getTimestampAgeMs(diagnostics.lastActivityAt, nowMs);
  const lastPingReceivedAgeMs = getTimestampAgeMs(diagnostics.lastPingReceivedAt, nowMs);
  const lastNativePongAgeMs = getTimestampAgeMs(diagnostics.lastNativePongAt, nowMs);
  const staleSignals = [];

  if (lastActivityAgeMs !== null && lastActivityAgeMs > DEFAULT_STALE_PLUGIN_ACTIVITY_MS) {
    staleSignals.push('last_activity_stale');
  }
  if (lastPingReceivedAgeMs !== null && lastPingReceivedAgeMs > DEFAULT_STALE_PLUGIN_ACTIVITY_MS) {
    staleSignals.push('uxp_ping_stale');
  }

  return {
    staleThresholdMs: DEFAULT_STALE_PLUGIN_ACTIVITY_MS,
    lastActivityAgeMs,
    lastPingReceivedAgeMs,
    lastNativePongAgeMs,
    stale: staleSignals.length > 0,
    staleSignals
  };
}

function isPluginMessageLoopStale(systemStatus) {
  return systemStatus.ok
    && systemStatus.result?.pluginConnected === true
    && summarizePluginActivityDiagnostics(systemStatus).stale;
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'string') return parsed;
    try {
      return JSON.parse(parsed);
    } catch {
      return parsed;
    }
  } catch {
    return text;
  }
}

function normalizeToolNames(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools
    .map((tool) => String(tool?.name || '').trim())
    .filter(Boolean)
    .sort();
}

function normalizePhotoshopTools(result) {
  return Array.isArray(result?.tools) ? result.tools : [];
}

function buildMissingPhotoshopToolNames(requiredToolNames, photoshopTools) {
  if (!photoshopTools?.ok) return [];
  const photoshopToolNames = normalizeToolNames(photoshopTools.result);
  return requiredToolNames.filter((toolName) => !photoshopToolNames.includes(toolName));
}

function buildMissingPhotoshopToolProperties(requiredToolProperties, photoshopTools) {
  if (!photoshopTools?.ok) return [];
  const tools = normalizePhotoshopTools(photoshopTools.result);
  return requiredToolProperties
    .filter((requirement) => {
      const tool = tools.find((item) => item?.name === requirement.toolName);
      const properties = tool?.inputSchema?.properties || {};
      return !Object.prototype.hasOwnProperty.call(properties, requirement.propertyName);
    })
    .map((requirement) => `${requirement.toolName}.${requirement.propertyName}`);
}

function normalizeRuntimeFeatures(diagnoseState) {
  if (!diagnoseState?.ok) return [];
  const features = diagnoseState.result?.state?.runtime?.features;
  if (!Array.isArray(features)) return [];
  return features.map((item) => String(item || '').trim()).filter(Boolean).sort();
}

function buildMissingRuntimeFeatures(requiredRuntimeFeatures, diagnoseState) {
  if (!diagnoseState?.ok) return [];
  const available = new Set(normalizeRuntimeFeatures(diagnoseState));
  return requiredRuntimeFeatures.filter((feature) => !available.has(feature));
}

function summarizeSystemStatus(systemStatus) {
  if (!systemStatus.ok) return { ok: false, error: systemStatus.error };
  const result = systemStatus.result || {};
  return {
    ok: true,
    pluginConnected: result.pluginConnected === true,
    pluginConnectionState: result.pluginConnectionState || null,
    pluginClientCount: result.pluginClientCount ?? null,
    pluginConnectionDiagnostics: result.pluginConnectionDiagnostics || null
  };
}

function shouldCollectPostPhotoshopToolsSystemStatus(systemStatus, photoshopTools) {
  return systemStatus.ok
    && systemStatus.result?.pluginConnected === true
    && !photoshopTools.ok
    && isTimeoutMessage(photoshopTools.error);
}

function selectDiagnosticSystemStatus(systemStatus, postPhotoshopToolsSystemStatus) {
  return postPhotoshopToolsSystemStatus?.ok ? postPhotoshopToolsSystemStatus : systemStatus;
}

function buildBridgeBlockerHints(systemStatus, photoshopTools) {
  const hints = [];
  const status = systemStatus.ok ? systemStatus.result || {} : {};
  const diagnostics = status.pluginConnectionDiagnostics || {};
  const pendingRequestDiagnosticsAvailable = typeof diagnostics.pendingRequestCount === 'number'
    && Array.isArray(diagnostics.pendingRequests);

  if (systemStatus.ok && status.pluginConnected === true && !photoshopTools.ok && isTimeoutMessage(photoshopTools.error)) {
    hints.push('plugin_connected_but_photoshop_tools_call_timeout');
    if (isPluginMessageLoopStale(systemStatus)) {
      hints.push('uxp_plugin_message_loop_stale');
    }
    if (!pendingRequestDiagnosticsAvailable) {
      hints.push('desktop_host_pending_request_diagnostics_unavailable');
    }
  }

  if (diagnostics.pendingRequestCount > 0) {
    hints.push('uxp_bridge_has_pending_requests');
  }

  if (diagnostics.readyState === 'open' && diagnostics.missedNativePongs > 0) {
    hints.push('websocket_open_but_native_pong_missing');
  }

  return hints;
}

async function rpc(method, params = {}, options = {}) {
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now() + Math.random(),
        method,
        params
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${method} timed out after ${requestTimeoutMs}ms at ${MCP_ENDPOINT}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function safeRpc(method, params = {}, options = {}) {
  try {
    return { ok: true, result: await rpc(method, params, options) };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function callTool(name, args = {}, options = {}) {
  const result = await rpc('tools/call', {
    name,
    arguments: args
  }, options);
  return parseToolResult(result);
}

async function safeCallTool(name, args = {}, options = {}) {
  try {
    return { ok: true, result: await callTool(name, args, options) };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

function classifyBridgeHealth(input) {
  if (!input.toolsList.ok) {
    if (isTimeoutMessage(input.toolsList.error)) return 'mcp_endpoint_timeout';
    return 'mcp_endpoint_unavailable';
  }

  if (!input.systemStatus.ok) {
    if (isTimeoutMessage(input.systemStatus.error)) return 'mcp_system_status_timeout';
    return 'mcp_system_status_unavailable';
  }

  if (input.systemStatus.result?.pluginConnected !== true) {
    return 'photoshop_plugin_not_connected';
  }

  if (!input.photoshopTools.ok) {
    if (isTimeoutMessage(input.photoshopTools.error) && isPluginMessageLoopStale(input.systemStatus)) {
      return 'photoshop_plugin_message_loop_stale';
    }
    if (isTimeoutMessage(input.photoshopTools.error)) return 'photoshop_bridge_unresponsive';
    return 'photoshop_tool_registry_unavailable';
  }

  if (
    input.missingTools.length > 0
    || input.missingToolProperties?.length > 0
    || input.missingRuntimeFeatures?.length > 0
  ) {
    return 'photoshop_runtime_tool_mismatch';
  }

  return 'ready';
}

function buildRecoveryActions(healthStatus, bridgeBlockerHints = []) {
  let actions;

  switch (healthStatus) {
    case 'ready':
      actions = [];
      break;
    case 'mcp_endpoint_timeout':
    case 'mcp_endpoint_unavailable':
      actions = [
        '确认 Agent 桌面端与 MCP Host 已启动。',
        `确认 MCP_ENDPOINT 指向当前桌面端地址：${MCP_ENDPOINT}。`
      ];
      break;
    case 'mcp_system_status_timeout':
    case 'mcp_system_status_unavailable':
      actions = [
        '重启 Agent 桌面端，确认 MCP Host 可以响应 system.status。',
        '在 system.status 恢复前不要运行任何 Photoshop 写入验收。'
      ];
      break;
    case 'photoshop_plugin_not_connected':
      actions = [
        '确认 Photoshop 已打开并加载 DesignEcho UXP 插件。',
        '先运行 npm run maintenance:photoshop-uxp-plugin:load 通过本地服务受控加载插件；仍失败时重启 Photoshop。'
      ];
      break;
    case 'photoshop_bridge_unresponsive':
      actions = [
        'Photoshop 插件显示已连接，但 photoshop.tools.list 无响应。',
        '检查 Photoshop 是否弹出了原生错误窗口或确认对话框；这类弹窗会阻塞 UXP 工具通道，但心跳仍可能显示已连接。',
        '优先重载 UXP 插件；仍无响应时重启 Photoshop 与 Agent 桌面端。',
        '恢复前不要重复运行 live 写入脚本，避免留下临时文档。'
      ];
      break;
    case 'photoshop_plugin_message_loop_stale':
      actions = [
        'Photoshop 插件的 WebSocket 仍显示 open，但 UXP 应用层心跳已经陈旧，说明 UXP JS 消息循环没有正常处理请求。',
        '优先运行 npm run maintenance:photoshop-uxp-plugin:load 刷新插件运行时；如果仍无响应，再重启 Photoshop。',
        '恢复前不要运行 SKU 或主图 live 写入，避免请求继续堆积或留下临时文档。'
      ];
      break;
    case 'photoshop_tool_registry_unavailable':
      actions = [
        '检查 UXP 插件是否成功注册 photoshop.tools.list。',
        '重新构建并重载 UXP 插件后再运行只读健康检查。'
      ];
      break;
    case 'photoshop_runtime_tool_mismatch':
      actions = [
        '当前 Photoshop 运行时工具列表或工具 schema 与本地期望不一致。',
        '先运行 npm run maintenance:photoshop-uxp-plugin:load 刷新 DesignEcho 插件；仍不一致时先重新构建 UXP，再运行受控加载。',
        '重载后重新运行本健康检查，确认缺失工具和缺失 schema 字段都恢复。'
      ];
      break;
    default:
      actions = ['查看 blockers 字段，先恢复桥接健康状态，再进入 live 或业务验收。'];
      break;
  }

  if (bridgeBlockerHints.includes('desktop_host_pending_request_diagnostics_unavailable')) {
    actions.push('当前 Agent 桌面端未暴露 pending request 诊断，优先重启桌面端以加载最新主进程代码，再复查桥接状态。');
  }

  return actions;
}

async function buildBridgeHealthReport(options = {}) {
  const requiredToolNames = options.requiredToolNames || DEFAULT_REQUIRED_TOOL_NAMES;
  const requiredToolProperties = options.requiredToolProperties || [];
  const requiredRuntimeFeatures = options.requiredRuntimeFeatures || [];
  const requestTimeoutMs = parsePositiveInteger(options.requestTimeoutMs, DEFAULT_TIMEOUT_MS);
  const toolsList = await safeRpc('tools/list', {}, { requestTimeoutMs });
  const systemStatus = toolsList.ok
    ? await safeCallTool('system.status', {}, { requestTimeoutMs })
    : { ok: false, error: 'tools/list failed; system.status skipped.' };
  const photoshopTools = systemStatus.ok && systemStatus.result?.pluginConnected === true
    ? await safeCallTool('photoshop.tools.list', {}, { requestTimeoutMs })
    : { ok: false, error: 'Photoshop plugin is not connected; photoshop.tools.list skipped.' };
  const diagnoseState = photoshopTools.ok
    ? await safeCallTool('photoshop.tools.call', {
      name: 'diagnoseState',
      arguments: { verbose: false }
    }, { requestTimeoutMs })
    : { ok: false, error: 'Photoshop tools are unavailable; diagnoseState skipped.' };
  const postPhotoshopToolsSystemStatus = shouldCollectPostPhotoshopToolsSystemStatus(systemStatus, photoshopTools)
    ? await safeCallTool('system.status', {}, { requestTimeoutMs: Math.min(requestTimeoutMs, 3_000) })
    : null;
  const diagnosticSystemStatus = selectDiagnosticSystemStatus(systemStatus, postPhotoshopToolsSystemStatus);

  const mcpToolNames = toolsList.ok ? normalizeToolNames(toolsList.result) : [];
  const photoshopToolNames = photoshopTools.ok ? normalizeToolNames(photoshopTools.result) : [];
  const missingTools = buildMissingPhotoshopToolNames(requiredToolNames, photoshopTools);
  const missingToolProperties = buildMissingPhotoshopToolProperties(requiredToolProperties, photoshopTools);
  const missingRuntimeFeatures = buildMissingRuntimeFeatures(requiredRuntimeFeatures, diagnoseState);
  const blockers = [];

  if (!toolsList.ok) blockers.push(`MCP tools/list failed: ${toolsList.error}`);
  if (!systemStatus.ok) blockers.push(`system.status failed: ${systemStatus.error}`);
  if (systemStatus.ok && systemStatus.result?.pluginConnected !== true) {
    blockers.push('Photoshop UXP plugin is not connected.');
  }
  if (!photoshopTools.ok) blockers.push(`photoshop.tools.list failed: ${photoshopTools.error}`);
  if (requiredRuntimeFeatures.length > 0 && !diagnoseState.ok) {
    blockers.push(`diagnoseState failed: ${diagnoseState.error}`);
  }
  if (missingTools.length > 0) {
    blockers.push(`Missing Photoshop tools: ${missingTools.join(', ')}`);
  }
  if (missingToolProperties.length > 0) {
    blockers.push(`Missing Photoshop tool schema properties: ${missingToolProperties.join(', ')}`);
  }
  if (missingRuntimeFeatures.length > 0) {
    blockers.push(`Missing Photoshop runtime features: ${missingRuntimeFeatures.join(', ')}`);
  }

  const healthStatus = classifyBridgeHealth({
    toolsList,
    systemStatus: diagnosticSystemStatus,
    photoshopTools,
    missingTools,
    missingToolProperties,
    missingRuntimeFeatures
  });
  const bridgeBlockerHints = buildBridgeBlockerHints(diagnosticSystemStatus, photoshopTools);
  const pluginActivity = summarizePluginActivityDiagnostics(diagnosticSystemStatus);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'read-only-photoshop-bridge-health',
    endpoint: MCP_ENDPOINT,
    requestTimeoutMs,
    ready: blockers.length === 0,
    healthStatus,
    boundaries: {
      readOnly: true,
      writesPhotoshop: false,
      createsDocument: false,
      claimsDesignQuality: false
    },
    requiredTools: requiredToolNames,
    requiredToolProperties: requiredToolProperties.map((item) => `${item.toolName}.${item.propertyName}`),
    requiredRuntimeFeatures,
    mcpToolCount: mcpToolNames.length,
    photoshopToolCount: photoshopToolNames.length,
    currentBridgeReady: systemStatus.ok
      && systemStatus.result?.pluginConnected === true
      && photoshopTools.ok
      && missingTools.length === 0
      && missingToolProperties.length === 0
      && missingRuntimeFeatures.length === 0,
    runtime: diagnoseState.ok ? diagnoseState.result?.state?.runtime || null : null,
    systemStatus: summarizeSystemStatus(systemStatus),
    postPhotoshopToolsSystemStatus: postPhotoshopToolsSystemStatus
      ? summarizeSystemStatus(postPhotoshopToolsSystemStatus)
      : null,
    diagnostics: {
      toolsList: toolsList.ok ? { ok: true, toolCount: mcpToolNames.length } : { ok: false, error: toolsList.error },
      photoshopTools: photoshopTools.ok
        ? { ok: true, toolCount: photoshopToolNames.length }
        : { ok: false, error: photoshopTools.error },
      diagnoseState: diagnoseState.ok
        ? {
          ok: true,
          runtime: diagnoseState.result?.state?.runtime || null
        }
        : { ok: false, error: diagnoseState.error },
      missingTools,
      missingToolProperties,
      missingRuntimeFeatures,
      hostDiagnostics: {
        source: diagnosticSystemStatus === postPhotoshopToolsSystemStatus
          ? 'post_photoshop_tools_timeout_system_status'
          : 'initial_system_status',
        postPhotoshopToolsSystemStatusCollected: Boolean(postPhotoshopToolsSystemStatus),
        pendingRequestDiagnosticsAvailable: diagnosticSystemStatus.ok
          && typeof diagnosticSystemStatus.result?.pluginConnectionDiagnostics?.pendingRequestCount === 'number'
          && Array.isArray(diagnosticSystemStatus.result?.pluginConnectionDiagnostics?.pendingRequests)
      },
      pluginActivity,
      bridgeBlockerHints
    },
    blockers,
    recoveryActions: buildRecoveryActions(healthStatus, bridgeBlockerHints)
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Photoshop Bridge Health',
    '',
    `- ready: ${report.ready}`,
    `- healthStatus: ${report.healthStatus}`,
    `- endpoint: ${report.endpoint}`,
    `- requestTimeoutMs: ${report.requestTimeoutMs}`,
    `- readOnly: ${report.boundaries.readOnly}`,
    `- writesPhotoshop: ${report.boundaries.writesPhotoshop}`,
    `- createsDocument: ${report.boundaries.createsDocument}`,
    `- claimsDesignQuality: ${report.boundaries.claimsDesignQuality}`,
    '',
    '## Blockers',
    ''
  ];

  if (report.blockers.length === 0) {
    lines.push('- none');
  } else {
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }

  lines.push('', '## Recovery Actions', '');
  if (report.recoveryActions.length === 0) {
    lines.push('- none');
  } else {
    for (const action of report.recoveryActions) lines.push(`- ${action}`);
  }

  lines.push('', '## Runtime', '');
  if (report.runtime) {
    lines.push(`- buildId: ${report.runtime.buildId || ''}`);
    lines.push(`- loadedAt: ${report.runtime.loadedAt || ''}`);
    lines.push(`- requiredRuntimeFeatures: ${report.requiredRuntimeFeatures.join(', ') || 'none'}`);
    lines.push(`- availableRuntimeFeatures: ${(report.runtime.features || []).join(', ') || 'none'}`);
  } else {
    lines.push('- unavailable');
  }

  lines.push('', '## Diagnostics', '', '```json', JSON.stringify(report.diagnostics, null, 2), '```', '');
  return `${lines.join('\n')}\n`;
}

function writeReport(report) {
  ensureDir(TMP_DIR);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(report), 'utf8');
}

function runSelfTest() {
  const readyToolsList = { ok: true, result: { tools: [] } };
  const connectedStatus = { ok: true, result: { pluginConnected: true } };
  const timeoutToolError = {
    ok: false,
    error: 'tools/call failed: {"code":-32000,"message":"MCP request timeout: tools/list"}'
  };

  assert(isTimeoutMessage(timeoutToolError.error), 'MCP request timeout must be recognized as timeout.');
  assert(
    classifyBridgeHealth({
      toolsList: readyToolsList,
      systemStatus: connectedStatus,
      photoshopTools: timeoutToolError,
      missingTools: []
    }) === 'photoshop_bridge_unresponsive',
    'photoshop.tools.list timeout must be classified as photoshop_bridge_unresponsive.'
  );
  assert(
    classifyBridgeHealth({
      toolsList: readyToolsList,
      systemStatus: {
        ok: true,
        result: {
          pluginConnected: true,
          pluginConnectionDiagnostics: {
            connected: true,
            readyState: 'open',
            lastActivityAt: new Date(Date.now() - 240000).toISOString(),
            lastPingReceivedAt: new Date(Date.now() - 240000).toISOString(),
            lastNativePongAt: new Date().toISOString(),
            pendingRequestCount: 0,
            pendingRequests: []
          }
        }
      },
      photoshopTools: timeoutToolError,
      missingTools: []
    }) === 'photoshop_plugin_message_loop_stale',
    'Stale UXP app heartbeat plus photoshop.tools.list timeout must be classified as photoshop_plugin_message_loop_stale.'
  );
  assert(
    buildMissingPhotoshopToolNames(DEFAULT_REQUIRED_TOOL_NAMES, timeoutToolError).length === 0,
    'photoshop.tools.list timeout must not produce missing runtime tool blockers.'
  );
  assertJsonEqual(
    buildMissingPhotoshopToolProperties([
      { toolName: 'skuLayout', propertyName: 'autoLayoutWithoutPlaceholders' }
    ], {
      ok: true,
      result: {
        tools: [
          {
            name: 'skuLayout',
            inputSchema: { properties: { action: { type: 'string' } } }
          }
        ]
      }
    }),
    ['skuLayout.autoLayoutWithoutPlaceholders'],
    'Runtime schema property guard must report missing skuLayout.autoLayoutWithoutPlaceholders.'
  );
  assertJsonEqual(
    buildMissingPhotoshopToolProperties([
      { toolName: 'skuLayout', propertyName: 'autoLayoutWithoutPlaceholders' }
    ], {
      ok: true,
      result: {
        tools: [
          {
            name: 'skuLayout',
            inputSchema: {
              properties: {
                action: { type: 'string' },
                autoLayoutWithoutPlaceholders: { type: 'boolean' }
              }
            }
          }
        ]
      }
    }),
    [],
    'Runtime schema property guard should pass when the property exists.'
  );
  assertJsonEqual(
    buildMissingRuntimeFeatures(['getSubjectBounds.smartLayerKindGuard'], {
      ok: true,
      result: {
        state: {
          runtime: {
            features: ['getSubjectBounds.smartLayerKindGuard']
          }
        }
      }
    }),
    [],
    'Runtime feature guard should pass when diagnoseState exposes the required feature.'
  );
  assertJsonEqual(
    buildMissingRuntimeFeatures(['getSubjectBounds.smartLayerKindGuard'], {
      ok: true,
      result: {
        state: {
          runtime: {
            features: ['selectionRead.noDialogSynchronousBatchPlay']
          }
        }
      }
    }),
    ['getSubjectBounds.smartLayerKindGuard'],
    'Runtime feature guard should report stale UXP runtimes missing required features.'
  );
  assert(
    buildBridgeBlockerHints(connectedStatus, timeoutToolError).includes('plugin_connected_but_photoshop_tools_call_timeout'),
    'Connected plugin plus photoshop.tools.list timeout must expose a bridge blocker hint.'
  );
  assert(
    buildBridgeBlockerHints(connectedStatus, timeoutToolError).includes('desktop_host_pending_request_diagnostics_unavailable'),
    'Connected plugin timeout without pending request diagnostics must expose stale host diagnostic hint.'
  );
  assert(
    !buildBridgeBlockerHints({
      ok: true,
      result: {
        pluginConnected: true,
        pluginConnectionDiagnostics: {
          pendingRequestCount: 0,
          pendingRequests: []
        }
      }
    }, timeoutToolError).includes('desktop_host_pending_request_diagnostics_unavailable'),
    'Connected plugin timeout with pending request diagnostics must not expose stale host diagnostic hint.'
  );
  assert(
    buildRecoveryActions('photoshop_bridge_unresponsive', [
      'desktop_host_pending_request_diagnostics_unavailable'
    ]).some((action) => action.includes('重启桌面端')),
    'Recovery actions must mention desktop restart when pending request diagnostics are unavailable.'
  );
  assert(
    shouldCollectPostPhotoshopToolsSystemStatus(connectedStatus, timeoutToolError) === true,
    'Connected plugin timeout should collect a post-timeout system.status snapshot.'
  );
  assert(
    shouldCollectPostPhotoshopToolsSystemStatus({ ok: true, result: { pluginConnected: false } }, timeoutToolError) === false,
    'Disconnected plugin should not collect a post-timeout system.status snapshot.'
  );
  assert(
    selectDiagnosticSystemStatus(connectedStatus, {
      ok: true,
      result: {
        pluginConnected: true,
        pluginConnectionDiagnostics: {
          pendingRequestCount: 1,
          pendingRequests: [{ id: '1', method: 'tools/list', ageMs: 12000 }]
        }
      }
    }).result.pluginConnectionDiagnostics.pendingRequestCount === 1,
    'Post-timeout system.status snapshot should become the diagnostic source when available.'
  );
  assert(
    classifyBridgeHealth({
      toolsList: readyToolsList,
      systemStatus: { ok: true, result: { pluginConnected: false } },
      photoshopTools: { ok: false, error: 'skipped' },
      missingTools: DEFAULT_REQUIRED_TOOL_NAMES
    }) === 'photoshop_plugin_not_connected',
    'Disconnected plugin must be classified as photoshop_plugin_not_connected.'
  );
  assert(
    classifyBridgeHealth({
      toolsList: readyToolsList,
      systemStatus: connectedStatus,
      photoshopTools: { ok: true, result: { tools: [] } },
      missingTools: ['getLayerHierarchy'],
      missingToolProperties: []
    }) === 'photoshop_runtime_tool_mismatch',
    'Successful registry read with missing tools must be classified as photoshop_runtime_tool_mismatch.'
  );
  assert(
    classifyBridgeHealth({
      toolsList: readyToolsList,
      systemStatus: connectedStatus,
      photoshopTools: { ok: true, result: { tools: [] } },
      missingTools: [],
      missingToolProperties: ['skuLayout.autoLayoutWithoutPlaceholders']
    }) === 'photoshop_runtime_tool_mismatch',
    'Successful registry read with missing schema properties must be classified as photoshop_runtime_tool_mismatch.'
  );
  assert(
    classifyBridgeHealth({
      toolsList: readyToolsList,
      systemStatus: connectedStatus,
      photoshopTools: { ok: true, result: { tools: [] } },
      missingTools: [],
      missingToolProperties: [],
      missingRuntimeFeatures: ['getSubjectBounds.smartLayerKindGuard']
    }) === 'photoshop_runtime_tool_mismatch',
    'Successful registry read with missing runtime features must be classified as photoshop_runtime_tool_mismatch.'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'MCP request timeout is recognized as timeout',
      'photoshop.tools.list timeout maps to photoshop_bridge_unresponsive',
      'stale UXP app heartbeat maps to photoshop_plugin_message_loop_stale',
      'connected plugin plus photoshop.tools.list timeout exposes bridge blocker hint',
      'runtime schema property guard detects stale UXP tool schema',
      'runtime feature guard detects stale UXP bundles missing required fixes',
      'stale host diagnostics are visible when pending request diagnostics are absent',
      'stale host diagnostics add a desktop restart recovery action',
      'post-timeout system.status snapshot is collected and used for diagnostics',
      'disconnected plugin maps to photoshop_plugin_not_connected',
      'successful registry with missing tools or schema properties maps to photoshop_runtime_tool_mismatch'
    ]
  }, null, 2));
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const report = await buildBridgeHealthReport({
    requestTimeoutMs: DEFAULT_TIMEOUT_MS,
    requiredToolNames: getRequiredToolNames(),
    requiredToolProperties: getRequiredToolProperties(),
    requiredRuntimeFeatures: getRequiredRuntimeFeatures()
  });
  writeReport(report);

  console.log(JSON.stringify({
    success: true,
    ready: report.ready,
    healthStatus: report.healthStatus,
    blockers: report.blockers,
    recoveryActions: report.recoveryActions,
    report: REPORT_JSON
  }, null, 2));

  if (FAIL_ON_NOT_READY && !report.ready) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
