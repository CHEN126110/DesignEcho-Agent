#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  buildAgentRunDebugBundle,
  evaluateAgentAcceptance
} = require('../src/shared/agent-acceptance-contracts.ts');

const ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(ROOT, 'tmp', 'acceptance', 'agent-live-photoshop-acceptance.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'acceptance', 'agent-live-photoshop-acceptance.md');
const DISPOSABLE_DOC_NAME_PREFIX = `DesignEchoLiveAgentAcceptance-${Date.now()}`;
const DOCUMENT_CREATE_DOC_NAME = `${DISPOSABLE_DOC_NAME_PREFIX}-Create`;
const LAYER_ORDER_DOC_NAME = `${DISPOSABLE_DOC_NAME_PREFIX}-LayerOrder`;
const LAYER_ORDER_NAMES = ['验收-白色', '验收-中灰', '验收-黑色'];
const DEFAULT_PORTS = [8765, 8766, 8767, 8768];
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';
const REQUIRED_PHOTOSHOP_RUNTIME_FEATURES = [
  'getSubjectBounds.smartLayerKindGuard',
  'getSubjectBounds.avoidsEmptySelectionDeselect',
  'selectionRead.noDialogSynchronousBatchPlay'
];
const PREFLIGHT_REQUIRE_READY = process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_PREFLIGHT_REQUIRE_READY === '1';
const PREFLIGHT_REQUIRE_TAKEOVER_READY = process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_PREFLIGHT_REQUIRE_TAKEOVER_READY === '1';
const LIVE_PLUGIN_WAIT_TIMEOUT_MS = normalizePositiveInteger(
  process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_PLUGIN_WAIT_MS,
  120000
);
const INCLUDE_LAYER_ORDER_CASE = process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_INCLUDE_LAYER_ORDER === '1';

const debugState = {
  stage: 'not-started',
  lastToolCall: null,
  lastPhotoshopTool: null,
  lastReport: null,
  lastSnapshot: null
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isArmed() {
  return process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE === '1'
    && process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER === '1'
    && process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT === '1';
}

function isPreflightMode() {
  return process.env.DESIGNECHO_LIVE_AGENT_ACCEPTANCE_PREFLIGHT === '1'
    || process.argv.includes('--preflight');
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  return Math.floor(normalized);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHostModalMessage(message) {
  return /host is in a modal state|modal state/i.test(String(message || ''));
}

function isHostModalResult(result) {
  return result?.success === false && isHostModalMessage(result.error || result.message);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReports(result) {
  ensureDir(REPORT_JSON);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, renderMarkdown(result), 'utf8');
}

function renderMarkdown(result) {
  const lines = [
    '# Agent Live Photoshop Acceptance',
    '',
    `- success: ${result.success}`,
    `- skipped: ${Boolean(result.skipped)}`,
    `- mode: ${result.mode || 'live-photoshop'}`,
    result.error ? `- error: ${result.error}` : '',
    '',
    '## Cases',
    ''
  ].filter(Boolean);

  for (const item of result.cases || []) {
    lines.push(`- ${item.id}: ${item.status} | ${item.summary || ''}`);
  }

  if (Array.isArray(result.liveAssertions)) {
    lines.push('', '## Live Assertions', '');
    for (const item of result.liveAssertions) {
      lines.push(`- ${item.name}: ${item.passed ? 'passed' : 'failed'}`);
    }
  }

  if (result.agentFeedback) {
    lines.push('', '## Agent Feedback', '');
    lines.push(`- runCount: ${result.agentFeedback.runCount}`);
    lines.push(`- toolCount: ${result.agentFeedback.toolUsage?.toolCount || 0}`);
    lines.push(`- successfulToolCount: ${result.agentFeedback.toolUsage?.successfulToolCount || 0}`);
    lines.push(`- failedToolCount: ${result.agentFeedback.toolUsage?.failedToolCount || 0}`);
    if (Array.isArray(result.agentFeedback.toolUsage?.toolNames) && result.agentFeedback.toolUsage.toolNames.length > 0) {
      lines.push(`- toolNames: ${result.agentFeedback.toolUsage.toolNames.join(', ')}`);
    }
    lines.push('');
    for (const run of result.agentFeedback.runs || []) {
      lines.push(`### ${run.caseId}`);
      lines.push('');
      lines.push(`- status: ${run.reportStatus || 'unknown'}`);
      lines.push(`- route: ${run.lifecycle?.route || 'unknown'}`);
      lines.push(`- executionKind: ${run.lifecycle?.executionKind || 'unknown'}`);
      lines.push(`- executionStatus: ${run.executionSummary?.status || 'unknown'}`);
      lines.push(`- toolCount: ${run.toolUsage?.toolCount || 0}`);
      if (Array.isArray(run.toolUsage?.tools)) {
        for (const tool of run.toolUsage.tools) {
          lines.push(`- tool: ${tool.name} | ${tool.success ? 'success' : 'failed'}${tool.error ? ` | ${tool.error}` : ''}`);
        }
      }
      lines.push('');
    }
  }

  if (result.preflight) {
    lines.push('', '## Preflight', '');
    lines.push(`- ready: ${Boolean(result.preflight.ready)}`);
    lines.push(`- currentBridgeReady: ${Boolean(result.preflight.currentBridgeReady)}`);
    lines.push(`- takeoverReady: ${Boolean(result.preflight.takeoverReady)}`);
    lines.push(`- endpoint: ${result.preflight.endpoint || MCP_ENDPOINT}`);
    if (Array.isArray(result.preflight.blockers)) {
      for (const blocker of result.preflight.blockers) {
        lines.push(`- blocker: ${blocker}`);
      }
    }
    if (Array.isArray(result.preflight.takeoverBlockers)) {
      for (const blocker of result.preflight.takeoverBlockers) {
        lines.push(`- takeover blocker: ${blocker}`);
      }
    }
    lines.push('', '```json');
    lines.push(JSON.stringify(result.preflight.summary || result.preflight, null, 2));
    lines.push('```');
  }

  if (Array.isArray(result.boundaries)) {
    lines.push('', '## Boundaries', '');
    for (const item of result.boundaries) {
      lines.push(`- ${item}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function probeHttpJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 500);
    }
    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

async function safeRpc(method, params = {}) {
  try {
    return {
      ok: true,
      result: await rpc(method, params)
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

async function safeCallTool(name, args = {}) {
  try {
    return {
      ok: true,
      result: await callTool(name, args)
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

async function safeCallPhotoshopTool(name, args = {}) {
  try {
    return {
      ok: true,
      result: await callPhotoshopTool(name, args)
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

function summarizeToolList(payload) {
  let tools = [];
  if (Array.isArray(payload?.tools)) {
    tools = payload.tools;
  } else if (Array.isArray(payload?.result?.tools)) {
    tools = payload.result.tools;
  }
  return {
    count: tools.length,
    names: tools
      .map((tool) => String(tool?.name || '').trim())
      .filter(Boolean)
      .slice(0, 40)
  };
}

function summarizeDocumentsResult(payload) {
  const documents = normalizeDocuments(payload);
  return {
    count: documents.length,
    names: documents.map((doc) => String(doc?.name || '').trim()).filter(Boolean).slice(0, 20)
  };
}

function normalizeRuntimeFeatures(diagnoseState) {
  const features = diagnoseState?.state?.runtime?.features;
  if (!Array.isArray(features)) return [];
  return features.map((item) => String(item || '').trim()).filter(Boolean).sort();
}

function buildMissingRuntimeFeatures(diagnoseState) {
  const available = new Set(normalizeRuntimeFeatures(diagnoseState));
  return REQUIRED_PHOTOSHOP_RUNTIME_FEATURES.filter((feature) => !available.has(feature));
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value)))).sort();
}

function shortenFeedbackText(value, maxLength = 180) {
  const text = String(value || '')
    .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '[redacted:data-uri]')
    .replace(/RAW_[A-Z]+:[^"\s]+/g, '[redacted:raw-image]');
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function summarizeToolEvents(tools) {
  const events = Array.isArray(tools) ? tools : [];
  const summarized = events.map((tool) => ({
    name: String(tool?.name || tool?.toolName || 'unknown'),
    success: tool?.success === true,
    durationMs: typeof tool?.durationMs === 'number' ? tool.durationMs : undefined,
    acceptanceStatus: typeof tool?.acceptanceStatus === 'string' ? tool.acceptanceStatus : undefined,
    error: tool?.error ? shortenFeedbackText(tool.error) : undefined
  }));
  return {
    toolCount: summarized.length,
    successfulToolCount: summarized.filter((tool) => tool.success).length,
    failedToolCount: summarized.filter((tool) => tool.success === false).length,
    toolNames: uniqueSorted(summarized.map((tool) => tool.name)),
    tools: summarized
  };
}

function summarizeAgentExecution(execution) {
  const bundle = execution?.bundle || {};
  const lifecycle = bundle.lifecycle || {};
  const executionSummary = bundle.executionSummary || {};
  const report = execution?.report || {};
  return {
    caseId: bundle.caseId || report.caseId || 'unknown',
    reportStatus: report.status || 'unknown',
    model: bundle.model || null,
    lifecycle: {
      route: lifecycle.decision?.route || null,
      routeSource: lifecycle.decision?.source || null,
      executionKind: lifecycle.execution?.kind || null,
      executionStatus: lifecycle.execution?.status || null
    },
    executionSummary: {
      status: executionSummary.status || null,
      stopReason: executionSummary.stopReason || null,
      iterations: executionSummary.iterations,
      toolCallCount: executionSummary.toolCallCount,
      successfulToolCalls: executionSummary.successfulToolCalls,
      failedToolCalls: executionSummary.failedToolCalls,
      acceptanceVerified: executionSummary.acceptanceVerified,
      acceptanceFailed: executionSummary.acceptanceFailed,
      acceptanceNeedsReview: executionSummary.acceptanceNeedsReview,
      blockers: Array.isArray(executionSummary.blockers) ? executionSummary.blockers.map(shortenFeedbackText) : [],
      warnings: Array.isArray(executionSummary.warnings) ? executionSummary.warnings.map(shortenFeedbackText) : []
    },
    toolUsage: summarizeToolEvents(bundle.tools),
    runRecords: report.runRecords || null
  };
}

function buildAgentFeedback(executions) {
  const runs = (Array.isArray(executions) ? executions : [])
    .filter(Boolean)
    .map(summarizeAgentExecution);
  const allTools = runs.flatMap((run) => run.toolUsage.tools);
  return {
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    toolUsage: summarizeToolEvents(allTools),
    runs,
    boundaries: [
      'This feedback is generated from the real ChatPanel and Agent engine debug bundle.',
      'The live acceptance runner uses deterministic fake model output to avoid provider cost; Photoshop tool calls are real when the runner is armed.',
      'Tool success proves execution and readback evidence only; it does not claim visual design quality.'
    ]
  };
}

function runSelfTest() {
  const feedback = buildAgentFeedback([{
    bundle: {
      caseId: 'self-test-case',
      model: { provider: 'fake', modelId: 'deterministic' },
      lifecycle: {
        decision: { route: 'skill', source: 'agent' },
        execution: { kind: 'photoshop_write', status: 'completed' }
      },
      executionSummary: {
        status: 'completed_verified',
        toolCallCount: 2,
        successfulToolCalls: 2,
        failedToolCalls: 0
      },
      tools: [
        { name: 'createDocument', success: true, durationMs: 120 },
        { name: 'getAcceptanceSnapshot', success: true, durationMs: 80 }
      ]
    },
    report: {
      status: 'passed',
      runRecords: {
        toolCount: 2,
        hasPhotoshopSnapshot: true
      }
    }
  }]);

  assert(feedback.runCount === 1, 'Agent feedback self-test should include one run.');
  assert(feedback.toolUsage.toolCount === 2, 'Agent feedback should count tool events.');
  assert(feedback.toolUsage.successfulToolCount === 2, 'Agent feedback should count successful tools.');
  assert(feedback.toolUsage.toolNames.includes('createDocument'), 'Agent feedback should expose tool names.');
  assert(feedback.runs[0].lifecycle.executionKind === 'photoshop_write', 'Agent feedback should preserve execution kind.');
  console.log(JSON.stringify({
    success: true,
    checks: [
      'Agent feedback counts runs',
      'Agent feedback summarizes tool usage',
      'Agent feedback preserves route and execution status',
      'Agent feedback keeps quality-claim boundaries explicit'
    ]
  }, null, 2));
}

async function buildLivePreflight() {
  const portStatuses = await Promise.all(DEFAULT_PORTS.map(async (port) => ({
    port,
    open: await isPortOpen(port)
  })));
  const occupiedDefaultPorts = portStatuses.filter((item) => item.open).map((item) => item.port);
  const portOwners = getPortOwners(occupiedDefaultPorts);
  const healthUrl = MCP_ENDPOINT.replace(/\/mcp$/i, '/health');
  const health = await probeHttpJson(healthUrl);
  const mcpGet = await probeHttpJson(MCP_ENDPOINT);
  const toolsList = await safeRpc('tools/list', {});
  const systemStatus = toolsList.ok
    ? await safeCallTool('system.status', {})
    : { ok: false, error: 'tools/list failed; system.status skipped.' };
  const pluginConnected = systemStatus.ok && systemStatus.result?.pluginConnected === true;
  const documents = pluginConnected
    ? await safeCallPhotoshopTool('listDocuments', { includeDetails: false })
    : { ok: false, error: 'Photoshop plugin is not connected; listDocuments skipped.' };
  const diagnoseState = pluginConnected
    ? await safeCallPhotoshopTool('diagnoseState', { verbose: false })
    : { ok: false, error: 'Photoshop plugin is not connected; diagnoseState skipped.' };
  const missingRuntimeFeatures = diagnoseState.ok
    ? buildMissingRuntimeFeatures(diagnoseState.result)
    : [...REQUIRED_PHOTOSHOP_RUNTIME_FEATURES];

  const blockers = [];
  if (!health.ok) blockers.push('MCP Host health endpoint is not reachable.');
  if (!toolsList.ok) blockers.push('MCP tools/list failed.');
  if (!systemStatus.ok) blockers.push('system.status tool failed.');
  if (!pluginConnected) blockers.push('Photoshop UXP plugin is not connected to this MCP endpoint.');
  if (pluginConnected && !diagnoseState.ok) blockers.push(`diagnoseState failed: ${diagnoseState.error}`);
  if (missingRuntimeFeatures.length > 0) {
    blockers.push(`Photoshop UXP runtime is missing required features: ${missingRuntimeFeatures.join(', ')}`);
  }
  const takeoverBlockers = occupiedDefaultPorts.length > 0
    ? [`Default DesignEcho ports are occupied: ${occupiedDefaultPorts.join(', ')}. Close the normal Agent desktop app before isolated takeover acceptance.`]
    : [];

  const currentBridgeReady = blockers.length === 0;
  const takeoverReady = takeoverBlockers.length === 0;
  return {
    ready: currentBridgeReady,
    currentBridgeReady,
    takeoverReady,
    endpoint: MCP_ENDPOINT,
    healthUrl,
    blockers,
    takeoverBlockers,
    summary: {
      ports: portStatuses,
      occupiedDefaultPorts,
      portOwners,
      health: {
        ok: health.ok,
        status: health.status,
        service: health.body?.service || null
      },
      mcpGet: {
        ok: mcpGet.ok,
        status: mcpGet.status,
        service: mcpGet.body?.service || null,
        endpoint: mcpGet.body?.endpoint || null
      },
      tools: toolsList.ok ? summarizeToolList(toolsList.result) : { error: toolsList.error },
      systemStatus: systemStatus.ok
        ? {
          pluginConnected: systemStatus.result?.pluginConnected === true,
          websocketConnected: systemStatus.result?.websocketConnected ?? null,
          ports: systemStatus.result?.ports || null
        }
        : { error: systemStatus.error },
      documents: documents.ok ? summarizeDocumentsResult(documents.result) : { error: documents.error },
      runtime: diagnoseState.ok
        ? {
          buildId: diagnoseState.result?.state?.runtime?.buildId || null,
          loadedAt: diagnoseState.result?.state?.runtime?.loadedAt || null,
          features: normalizeRuntimeFeatures(diagnoseState.result),
          requiredFeatures: REQUIRED_PHOTOSHOP_RUNTIME_FEATURES,
          missingFeatures: missingRuntimeFeatures
        }
        : {
          error: diagnoseState.error,
          requiredFeatures: REQUIRED_PHOTOSHOP_RUNTIME_FEATURES,
          missingFeatures: missingRuntimeFeatures
        }
    }
  };
}

async function writePreflightReport() {
  const preflight = await buildLivePreflight();
  const requiredReady = PREFLIGHT_REQUIRE_READY ? preflight.currentBridgeReady : true;
  const requiredTakeoverReady = PREFLIGHT_REQUIRE_TAKEOVER_READY ? preflight.takeoverReady : true;
  const success = requiredReady && requiredTakeoverReady;
  const result = {
    success,
    skipped: false,
    mode: 'live-photoshop-preflight',
    preflight,
    cases: [{
      id: 'live-photoshop-preflight',
      status: preflight.currentBridgeReady ? 'ready' : 'blocked',
      summary: preflight.currentBridgeReady
        ? 'MCP Host and Photoshop UXP plugin are connected on the current bridge.'
        : preflight.blockers.join(' ')
    }],
    boundaries: [
      'Preflight is read-only and does not launch Electron or create/modify Photoshop documents.',
      'currentBridgeReady means the current Agent/MCP/UXP bridge is reachable and exposes required runtime safety features; it does not prove any design task or aesthetic quality.',
      'takeoverReady only means default ports are free for isolated acceptance; it does not prove the UXP plugin will reconnect after launch.',
      'Blocked preflight should be treated as live-environment evidence before running takeover acceptance.'
    ],
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
  writeReports(result);
  console.log(JSON.stringify({
    success: result.success,
    mode: result.mode,
    currentBridgeReady: preflight.currentBridgeReady,
    takeoverReady: preflight.takeoverReady,
    blockers: preflight.blockers,
    takeoverBlockers: preflight.takeoverBlockers,
    report: result.report
  }, null, 2));
  if (!result.success) process.exit(1);
}

function writeSkippedReport(reason) {
  const result = {
    success: true,
    skipped: true,
    mode: 'guarded-live-photoshop',
    reason,
    requiredEnv: [
      'DESIGNECHO_LIVE_AGENT_ACCEPTANCE=1',
      'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_TAKEOVER=1',
      'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_DISPOSABLE_DOCUMENT=1'
    ],
    optionalEnv: [
      'DESIGNECHO_LIVE_AGENT_ACCEPTANCE_INCLUDE_LAYER_ORDER=1'
    ],
    boundaries: [
      'Default execution must not launch Electron or touch Photoshop.',
      'Live mode requires a disposable document and explicit takeover flags.',
      'Passing this runner proves a guarded Agent-to-Photoshop acceptance path only, not design quality.'
    ],
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
  writeReports(result);
  console.log(JSON.stringify(result, null, 2));
}

function resetDir(name) {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const dir = path.resolve(tmpRoot, name);
  if (!dir.startsWith(tmpRoot + path.sep)) {
    throw new Error('Refusing to remove unsafe test directory: ' + dir);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resetTestProjectDir() {
  const projectDir = resetDir('agent-live-photoshop-acceptance-project');
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '素材'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '输出'), { recursive: true });
  return projectDir;
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function getPortOwners(ports) {
  if (!Array.isArray(ports) || ports.length === 0) return [];
  if (process.platform !== 'win32') {
    return ports.map((port) => ({
      port,
      pid: null,
      processName: null,
      commandLine: null,
      note: 'Port owner lookup is implemented for Windows only.'
    }));
  }

  const escapedPorts = ports.map((port) => Number(port)).filter(Number.isFinite);
  if (escapedPorts.length === 0) return [];

  const command = [
    '$ports = @(' + escapedPorts.join(',') + ');',
    '$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort };',
    '$items = foreach ($connection in $connections) {',
    '  $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $connection.OwningProcess) -ErrorAction SilentlyContinue;',
    '  [pscustomobject]@{',
    '    port = [int]$connection.LocalPort;',
    '    pid = [int]$connection.OwningProcess;',
    '    processName = $process.Name;',
    '    commandLine = $process.CommandLine',
    '  }',
    '}',
    '$items | ConvertTo-Json -Depth 4'
  ].join(' ');

  try {
    const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      port: Number(item.port),
      pid: Number(item.pid),
      processName: item.processName || null,
      commandLine: item.commandLine || null
    }));
  } catch (error) {
    return ports.map((port) => ({
      port,
      pid: null,
      processName: null,
      commandLine: null,
      error: error?.message || String(error)
    }));
  }
}

async function assertDefaultPortsFree() {
  const checks = await Promise.all(DEFAULT_PORTS.map((port) => isPortOpen(port)));
  const occupied = DEFAULT_PORTS.filter((_port, index) => checks[index]);
  assert(
    occupied.length === 0,
    'Default DesignEcho ports are already in use: ' + occupied.join(', ')
      + '. Close the normal Agent desktop app before running live takeover acceptance.'
  );
}

async function rpc(method, params = {}) {
  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${MCP_ENDPOINT}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(name, args = {}) {
  debugState.lastToolCall = {
    name,
    args,
    startedAt: new Date().toISOString()
  };
  return parseToolResult(await rpc('tools/call', { name, arguments: args }));
}

async function callPhotoshopTool(name, args = {}) {
  debugState.lastPhotoshopTool = {
    name,
    args,
    startedAt: new Date().toISOString()
  };
  return callTool('photoshop.tools.call', { name, arguments: args });
}

async function callPhotoshopToolWithModalRetry(name, args = {}, options = {}) {
  const attempts = options.attempts || 5;
  const delayMs = options.delayMs || 900;
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await callPhotoshopTool(name, args);
      if (!isHostModalResult(result)) return result;
      lastResult = result;
    } catch (error) {
      if (!isHostModalMessage(error?.message || error)) throw error;
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(delayMs * attempt);
    }
  }

  if (lastError) throw lastError;
  return lastResult;
}

function extractSnapshot(payload) {
  if (payload && typeof payload === 'object' && payload.snapshot) return payload.snapshot;
  return payload;
}

function buildRunnerBaselineSnapshot(reason, documents = []) {
  const names = documents
    .map((doc) => String(doc?.name || '').trim())
    .filter(Boolean);
  return {
    success: true,
    hasDocument: false,
    generatedAt: new Date().toISOString(),
    warnings: [
      reason,
      names.length > 0
        ? `Live acceptance skipped deep snapshot of pre-existing documents: ${names.join(', ')}`
        : 'Live acceptance detected no pre-existing Photoshop documents.'
    ],
    openDocuments: names
  };
}

async function acceptanceSnapshot(stage = 'acceptance-snapshot') {
  debugState.stage = stage;
  return extractSnapshot(await callTool('photoshop.acceptance_snapshot', {
    includeHidden: true,
    includeBounds: true,
    includeText: true,
    maxLayers: 160
  }));
}

function normalizeDocuments(listResult) {
  return Array.isArray(listResult?.documents) ? listResult.documents : [];
}

async function waitForPluginConnected(timeoutMs = LIVE_PLUGIN_WAIT_TIMEOUT_MS) {
  const started = Date.now();
  let lastError = null;
  let lastStatus = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const status = await callTool('system.status', {});
      lastStatus = status;
      if (status?.pluginConnected === true) return status;
      lastError = new Error('Plugin is not connected yet.');
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const statusSummary = lastStatus ? ` Last status: ${JSON.stringify({
    pluginConnected: lastStatus.pluginConnected,
    websocketConnected: lastStatus.websocketConnected,
    ports: lastStatus.ports
  })}` : '';
  throw new Error(
    `Photoshop UXP plugin did not connect to the live acceptance runner within ${timeoutMs}ms: `
    + (lastError?.message || 'unknown')
    + statusSummary
  );
}

function buildDocumentCreateAcceptanceCase() {
    return {
        id: 'live-create-disposable-document',
        title: '真实 Photoshop 中创建一次性文档的 Agent 验收',
        userInput: `帮我新建一个 800x800 的文档，名称 ${DOCUMENT_CREATE_DOC_NAME}`,
        mode: 'live_photoshop',
        tags: ['live', 'photoshop', 'document-management'],
    expectation: {
      route: 'skill_execution',
      routeSource: 'deterministic_route',
      skillId: 'document-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true,
      shouldChangeDocument: false,
      maxIterations: 1,
      maxToolCalls: 2
    },
    notes: [
      'This case validates guarded Agent-to-Photoshop execution with a disposable document.',
      'Document change is asserted by the runner live assertions, not by aesthetic scoring.'
    ]
    };
}

function buildLayerOrderAcceptanceCase() {
  return {
    id: 'live-layer-color-order-light-to-dark',
    title: '真实 Photoshop 中颜色图层从浅到深排序的 Agent 验收',
    userInput: '把图层的颜色从浅到深，从上到下调整图层顺序',
    mode: 'live_photoshop',
    tags: ['live', 'photoshop', 'layer-management', 'simple-operation'],
    expectation: {
      route: 'skill_execution',
      routeSource: 'deterministic_route',
      skillId: 'layer-management',
      executionKind: 'deterministic_skill',
      shouldUseTools: true,
      shouldChangeDocument: false,
      maxIterations: 1,
      maxToolCalls: 8
    },
    notes: [
      'This case validates the simple layer-order path against real Photoshop layers.',
      'The test document and color layers are prepared by the runner; only the reorder request is submitted through ChatPanel and the Agent engine.'
    ]
  };
}

function summarizeSnapshot(snapshot) {
  return {
    hasDocument: snapshot?.hasDocument === true,
    documentId: snapshot?.document?.id ?? snapshot?.documentId ?? null,
    documentName: snapshot?.document?.name || snapshot?.documentName || null,
    totalLayers: snapshot?.summary?.totalLayers ?? null
  };
}

function assertLive(passed, name, details = {}) {
  return { name, passed: Boolean(passed), details };
}

function findDocumentByName(documents, documentName) {
  return documents.find((doc) => String(doc?.name || '') === documentName) || null;
}

async function cleanupDisposableDocument(documentId) {
  if (!documentId) return { attempted: false, closed: false };
  try {
    const result = await callPhotoshopToolWithModalRetry('closeDocument', {
      documentId,
      save: false
    });
    return {
      attempted: true,
      closed: result?.success === true,
      result
    };
  } catch (error) {
    return {
      attempted: true,
      closed: false,
      error: error?.message || String(error)
    };
  }
}

async function setupLayerOrderDocument() {
  debugState.stage = 'setup-layer-order-document';
  const documentResult = await callPhotoshopToolWithModalRetry('createDocument', {
    width: 640,
    height: 360,
    name: LAYER_ORDER_DOC_NAME
  });
  if (documentResult?.success === false) {
    throw new Error('Failed to create layer-order acceptance document: ' + (documentResult.error || 'unknown'));
  }

  const shapes = [
    { name: '验收-白色', fillColorHex: '#F5F5F5', x: 48, y: 48 },
    { name: '验收-黑色', fillColorHex: '#111111', x: 92, y: 78 },
    { name: '验收-中灰', fillColorHex: '#888888', x: 136, y: 108 }
  ];
  const createdLayers = [];
  for (const shape of shapes) {
    const result = await callPhotoshopToolWithModalRetry('createRectangle', {
      x: shape.x,
      y: shape.y,
      width: 180,
      height: 54,
      name: shape.name,
      fillColorHex: shape.fillColorHex
    });
    if (result?.success === false) {
      throw new Error(`Failed to create layer-order test layer ${shape.name}: ${result.error || 'unknown'}`);
    }
    createdLayers.push({
      name: shape.name,
      layerId: result?.layerId ?? result?.layer?.id ?? null
    });
    await sleep(200);
  }

  return {
    documentId: documentResult?.documentId ?? documentResult?.id ?? null,
    documentName: LAYER_ORDER_DOC_NAME,
    createdLayers,
    expectedOrder: LAYER_ORDER_NAMES
  };
}

function getTopLevelLayerNames(snapshot, names) {
  const wanted = new Set(names);
  return (Array.isArray(snapshot?.layers) ? snapshot.layers : [])
    .filter((layer) => layer.depth === 0 && wanted.has(layer.name))
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((layer) => layer.name);
}

function orderMatches(snapshot, expectedNames) {
  const actual = getTopLevelLayerNames(snapshot, expectedNames);
  return {
    passed: actual.length === expectedNames.length && actual.every((name, index) => name === expectedNames[index]),
    actual,
    expected: expectedNames
  };
}

async function submitAndExport(page, acceptanceCase, beforeSnapshot) {
  debugState.stage = 'submit-live-case';
  const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
  const after = await page.evaluate((input) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(input, { timeoutMs: 45000 })
  ), acceptanceCase.userInput);

  const debug = await page.evaluate((casePayload) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getLatestAcceptanceDebug(casePayload)
  ), acceptanceCase);

  const afterSnapshot = await acceptanceSnapshot(`after-${acceptanceCase.id}-snapshot`);
  const bundle = buildAgentRunDebugBundle({
    acceptanceCase,
    lifecycle: debug.bundle.lifecycle,
    executionSummary: debug.bundle.executionSummary,
    tools: debug.bundle.tools,
    beforeSnapshot,
    afterSnapshot,
    visibleThinking: debug.bundle.visibleThinking,
    visibleMessages: debug.bundle.visibleMessages,
    errors: debug.bundle.errors,
    warnings: debug.bundle.warnings,
    timings: debug.bundle.timings,
    model: debug.bundle.model
  });
  const report = evaluateAgentAcceptance(acceptanceCase, bundle);
  debugState.lastReport = report;
  debugState.lastSnapshot = summarizeSnapshot(afterSnapshot);

  const newMessages = after.messages.slice(before.messageCount);
  const visibleText = newMessages.map((message) => message.contentPreview || '').join('\n');
  const visibleThinking = newMessages.map((message) => message.thinkingPreview || '').join('\n');

  assert(
    newMessages.some((message) => message.role === 'user' && message.contentPreview.includes(acceptanceCase.userInput)),
    'Live case did not append the user message.'
  );
  assert(newMessages.some((message) => message.role === 'assistant'), 'Live case did not append an assistant message.');
  assert(!visibleText.includes('Agent 面板桥接消息已生成'), 'Live case leaked debug bridge copy.');
  assert(!visibleText.includes('"intent": "debug_or_implement"'), 'Live case leaked debug JSON.');

  return {
    beforeSnapshot,
    afterSnapshot,
    visibleThinking,
    bundle,
    report
  };
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  if (isPreflightMode()) {
    await writePreflightReport();
    return;
  }

  if (!isArmed()) {
    writeSkippedReport('Live Photoshop Agent acceptance is not armed.');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist', 'renderer', 'index.html');
  assert(fs.existsSync(mainEntry), 'Missing built Electron main entry: ' + mainEntry + '. Run npm run build first.');
  assert(fs.existsSync(rendererEntry), 'Missing built renderer entry: ' + rendererEntry + '. Run npm run build first.');
  await assertDefaultPortsFree();

  const userDataDir = resetDir('agent-live-photoshop-acceptance-user-data');
  const projectDir = resetTestProjectDir();
  let app;
  const cleanupDocumentIds = new Set();
  let cleanupComplete = false;

  try {
    debugState.stage = 'launch-electron';
    app = await electron.launch({
      args: [ROOT, '--user-data-dir=' + userDataDir],
      cwd: ROOT,
      env: {
        ...process.env,
        DESIGNECHO_CHAT_TEST_BRIDGE: '1',
        DESIGNECHO_CHAT_TEST_PROJECT_PATH: projectDir,
        DESIGNECHO_CHAT_TEST_FAKE_MODEL: '1',
        DESIGNECHO_SKIP_PORT_CLEANUP: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    debugState.stage = 'renderer-load';
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    debugState.stage = 'wait-photoshop-plugin';
    const systemStatus = await waitForPluginConnected();
    debugState.stage = 'baseline-documents';
    const baselineDocuments = normalizeDocuments(await callPhotoshopTool('listDocuments', { includeDetails: false }));
    const beforeSnapshot = buildRunnerBaselineSnapshot(
      'Live acceptance runner does not deep-snapshot pre-existing user documents before creating its disposable document.',
      baselineDocuments
    );
    const documentCreateCase = buildDocumentCreateAcceptanceCase();
    const documentExecution = await submitAndExport(page, documentCreateCase, beforeSnapshot);
    const afterDocuments = normalizeDocuments(await callPhotoshopTool('listDocuments', { includeDetails: false }));
    const disposable = findDocumentByName(afterDocuments, DOCUMENT_CREATE_DOC_NAME);
    if (disposable?.id) cleanupDocumentIds.add(disposable.id);
    const documentCreateId = disposable?.id || documentExecution.afterSnapshot?.document?.id || null;
    if (documentCreateId) cleanupDocumentIds.add(documentCreateId);

    const liveAssertions = [
      assertLive(systemStatus?.pluginConnected === true, 'photoshop-plugin-connected', { systemStatus }),
      assertLive(Boolean(disposable), 'disposable-document-created', { afterDocumentNames: afterDocuments.map((doc) => doc.name) }),
      assertLive(documentExecution.report.status === 'passed', 'document-create-acceptance-report-passed', { report: documentExecution.report }),
      assertLive(
        /createDocument|工具完成/.test(documentExecution.visibleThinking),
        'document-create-visible-tool-evidence-present',
        { visibleThinkingPreview: documentExecution.visibleThinking.slice(0, 500) }
      )
    ];

    const documentCleanup = await cleanupDisposableDocument(documentCreateId);
    cleanupDocumentIds.delete(documentCreateId);
    const afterDocumentCleanup = normalizeDocuments(await callPhotoshopTool('listDocuments', { includeDetails: false }));
    liveAssertions.push(assertLive(
      !findDocumentByName(afterDocumentCleanup, DOCUMENT_CREATE_DOC_NAME),
      'document-create-disposable-document-cleaned-up',
      { cleanup: documentCleanup, finalDocumentNames: afterDocumentCleanup.map((doc) => doc.name) }
    ));

    let layerSetup = null;
    let layerExecution = null;
    let layerOrder = null;
    let layerCleanup = null;
    if (INCLUDE_LAYER_ORDER_CASE) {
      layerSetup = await setupLayerOrderDocument();
      if (layerSetup.documentId) cleanupDocumentIds.add(layerSetup.documentId);
      const layerBeforeSnapshot = await acceptanceSnapshot();
      const layerOrderCase = buildLayerOrderAcceptanceCase();
      layerExecution = await submitAndExport(page, layerOrderCase, layerBeforeSnapshot);
      layerOrder = orderMatches(layerExecution.afterSnapshot, layerSetup.expectedOrder);
      const afterLayerDocuments = normalizeDocuments(await callPhotoshopTool('listDocuments', { includeDetails: false }));
      const layerDocument = findDocumentByName(afterLayerDocuments, LAYER_ORDER_DOC_NAME);

      liveAssertions.push(
        assertLive(Boolean(layerDocument), 'layer-order-document-created', { afterDocumentNames: afterLayerDocuments.map((doc) => doc.name) }),
        assertLive(layerExecution.report.status === 'passed', 'layer-order-acceptance-report-passed', { report: layerExecution.report }),
        assertLive(
          /reorderLayer|图层顺序|工具完成/.test(layerExecution.visibleThinking),
          'layer-order-visible-tool-evidence-present',
          { visibleThinkingPreview: layerExecution.visibleThinking.slice(0, 500) }
        ),
        assertLive(layerOrder.passed, 'layer-order-light-to-dark-verified', layerOrder)
      );

      layerCleanup = await cleanupDisposableDocument(layerSetup.documentId || layerDocument?.id);
      cleanupDocumentIds.delete(layerSetup.documentId || layerDocument?.id);
    }
    const finalDocuments = normalizeDocuments(await callPhotoshopTool('listDocuments', { includeDetails: false }));
    if (INCLUDE_LAYER_ORDER_CASE) {
      liveAssertions.push(assertLive(
        !findDocumentByName(finalDocuments, LAYER_ORDER_DOC_NAME),
        'layer-order-disposable-document-cleaned-up',
        { cleanup: layerCleanup, finalDocumentNames: finalDocuments.map((doc) => doc.name) }
      ));
    }
    cleanupComplete = true;

    const success = liveAssertions.every((item) => item.passed)
      && documentExecution.report.status === 'passed'
      && (!layerExecution || layerExecution.report.status === 'passed');
    const agentFeedback = buildAgentFeedback([documentExecution, layerExecution].filter(Boolean));
    const result = {
      success,
      skipped: false,
      mode: INCLUDE_LAYER_ORDER_CASE
        ? 'live-photoshop-deterministic-operations'
        : 'live-photoshop-disposable-document',
      endpoint: MCP_ENDPOINT,
      cases: [{
        id: documentCreateCase.id,
        status: documentExecution.report.status,
        summary: documentExecution.report.summary,
        issueLayers: documentExecution.report.issueLayers,
        runRecords: documentExecution.report.runRecords
      }],
      liveAssertions,
      beforeSnapshot: summarizeSnapshot(beforeSnapshot),
      afterSnapshot: summarizeSnapshot(layerExecution?.afterSnapshot || documentExecution.afterSnapshot),
      baselineDocuments: baselineDocuments.map((doc) => ({
        id: doc.id,
        name: doc.name,
        isActive: doc.isActive
      })),
      cleanup: {
        documentCreate: documentCleanup,
        layerOrder: layerCleanup
      },
      agentFeedback,
      layerSetup,
      projectDir,
      userDataDir,
      boundaries: [
        'This runner uses fake model output only to avoid live provider cost; deterministic routing is still exercised through the real ChatPanel and Agent engine.',
        'This runner touches real Photoshop only after explicit live, takeover and disposable-document flags are set.',
        'This runner validates disposable document-management by default; simple layer-order execution is opt-in via DESIGNECHO_LIVE_AGENT_ACCEPTANCE_INCLUDE_LAYER_ORDER=1.',
        'This runner does not validate open-ended design quality or reference replication fidelity.'
      ],
      report: {
        json: REPORT_JSON,
        md: REPORT_MD
      }
    };
    if (INCLUDE_LAYER_ORDER_CASE && layerExecution) {
      const layerOrderCase = buildLayerOrderAcceptanceCase();
      result.cases.push({
        id: layerOrderCase.id,
        status: layerExecution.report.status,
        summary: layerExecution.report.summary,
        issueLayers: layerExecution.report.issueLayers,
        runRecords: layerExecution.report.runRecords,
        liveOrder: layerOrder
      });
    }
    writeReports(result);
    console.log(JSON.stringify({
      success: result.success,
      skipped: result.skipped,
      mode: result.mode,
      cases: result.cases,
      agentFeedback: {
        runCount: result.agentFeedback.runCount,
        toolUsage: result.agentFeedback.toolUsage
      },
      liveAssertions: result.liveAssertions.map((item) => ({ name: item.name, passed: item.passed })),
      report: result.report
    }, null, 2));
    if (!success) process.exit(1);
  } finally {
    if (!cleanupComplete) {
      for (const documentId of cleanupDocumentIds) {
        await cleanupDisposableDocument(documentId).catch(() => undefined);
      }
    }
    if (app) {
      await app.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const result = {
    success: false,
    skipped: false,
    error: error?.stack || error?.message || String(error),
    debug: debugState,
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    },
    boundaries: [
      'Live Photoshop Agent acceptance failed before a quality claim could be made.',
      'Failure in this runner should be treated as infrastructure or live-environment evidence, not as design-quality evidence.'
    ]
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
