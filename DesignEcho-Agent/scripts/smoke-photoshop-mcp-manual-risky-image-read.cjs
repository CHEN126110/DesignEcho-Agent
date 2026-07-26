/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'tmp');
const JSON_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-image-read.json');
const MD_OUT = path.join(TMP_DIR, 'photoshop-mcp-manual-risky-image-read.md');
const endpoint = process.env.MCP_ENDPOINT || 'http://127.0.0.1:8768/mcp';

const IMAGE_READ_TOOLS = [
  'getSubjectBounds',
  'getMattingImage',
  'getOptimizedImage'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function asJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function rpc(method, params = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.random(), method, params })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${method} failed: ${asJson(payload.error)}`);
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
  return parseToolResult(await rpc('tools/call', { name, arguments: args }));
}

async function batchCall(calls) {
  return callTool('photoshop.tools.batch_call', {
    calls,
    continueOnError: true,
    allowWrites: false,
    allowRisky: true,
    delayMs: 200
  });
}

function hasPreflightFailure(result, patterns = []) {
  const first = Array.isArray(result?.results) ? result.results[0] : null;
  if (!first || first.stage !== 'preflight') {
    return false;
  }
  if (!patterns.length) {
    return true;
  }
  const error = String(first.error || '');
  return patterns.some(pattern => error.includes(pattern));
}

function findFirstLayerId(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (typeof node.id === 'number' && node.id > 0) {
    return node.id;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const id = findFirstLayerId(item);
      if (id) return id;
    }
    return null;
  }
  for (const value of Object.values(node)) {
    const id = findFirstLayerId(value);
    if (id) return id;
  }
  return null;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Photoshop MCP Manual-Risky Image Read Preflight Smoke');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Endpoint: ${report.endpoint}`);
  lines.push(`- Plugin connected: ${report.systemStatus?.pluginConnected ? 'yes' : 'no'}`);
  lines.push(`- Active document: ${report.diagnose?.state?.documentInfo?.name || 'none'}`);
  lines.push('');
  lines.push('## Policy');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.policy, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.name}`);
    lines.push('');
    lines.push(`- Expected: ${scenario.expected}`);
    lines.push(`- Outcome: ${scenario.outcome}`);
    if (scenario.notes) {
      lines.push(`- Notes: ${scenario.notes}`);
    }
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(scenario.payload, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  ensureDir(TMP_DIR);

  const systemStatus = await callTool('system.status', {});
  if (!systemStatus?.pluginConnected) {
    throw new Error('Photoshop UXP plugin is not connected');
  }

  const diagnose = await callTool('photoshop.tools.call', {
    name: 'diagnoseState',
    arguments: { verbose: false }
  });
  const policy = await callTool('photoshop.batch_policy', { names: IMAGE_READ_TOOLS });
  const scenarios = [];

  const invalidSubjectLayer = await batchCall([
    { name: 'getSubjectBounds', arguments: { layerId: 0, method: 'alpha' } }
  ]);
  scenarios.push({
    name: 'invalid-subject-layer-id',
    expected: 'Preflight should reject getSubjectBounds when layerId is not greater than 0',
    outcome: hasPreflightFailure(invalidSubjectLayer, ['getSubjectBounds requires layerId greater than 0']) ? 'pass' : 'fail',
    payload: invalidSubjectLayer
  });

  const invalidSubjectMethod = await batchCall([
    { name: 'getSubjectBounds', arguments: { layerId: 1, method: 'bogus' } }
  ]);
  scenarios.push({
    name: 'invalid-subject-method',
    expected: 'Preflight should reject getSubjectBounds when method is not alpha or smart',
    outcome: hasPreflightFailure(invalidSubjectMethod, ['getSubjectBounds method must be one of: alpha, smart']) ? 'pass' : 'fail',
    payload: invalidSubjectMethod
  });

  const invalidMattingMaxSize = await batchCall([
    { name: 'getMattingImage', arguments: { maxSize: 0 } }
  ]);
  scenarios.push({
    name: 'invalid-matting-max-size',
    expected: 'Preflight should reject getMattingImage when maxSize is not greater than 0',
    outcome: hasPreflightFailure(invalidMattingMaxSize, ['getMattingImage maxSize must be greater than 0']) ? 'pass' : 'fail',
    payload: invalidMattingMaxSize
  });

  const invalidMattingFormat = await batchCall([
    { name: 'getMattingImage', arguments: { outputFormat: 'tiff' } }
  ]);
  scenarios.push({
    name: 'invalid-matting-output-format',
    expected: 'Preflight should reject getMattingImage when outputFormat is unsupported',
    outcome: hasPreflightFailure(invalidMattingFormat, ['getMattingImage outputFormat must be one of: jpeg, raw']) ? 'pass' : 'fail',
    payload: invalidMattingFormat
  });

  const smartLayerId = findFirstLayerId(diagnose?.state?.selectedLayers) || findFirstLayerId(diagnose?.state?.activeLayer);
  if (smartLayerId) {
    const smartSubject = await callTool('photoshop.tools.call', {
      name: 'getSubjectBounds',
      arguments: {
        layerId: smartLayerId,
        method: 'smart'
      }
    });
    const smartSubjectOutcome =
      smartSubject?.success === true
        ? smartSubject?.data?.method === 'smart'
          ? 'pass'
          : 'fail'
        : /fallback/i.test(String(smartSubject?.error || ''))
          ? 'fail'
          : 'pass';
    scenarios.push({
      name: 'smart-subject-strict',
      expected: 'Smart mode should not silently fall back to layer bounds',
      outcome: smartSubjectOutcome,
      payload: smartSubject
    });
  } else {
    scenarios.push({
      name: 'smart-subject-strict',
      expected: 'Smart mode should not silently fall back to layer bounds',
      outcome: 'skip',
      notes: 'No layer id was available from diagnoseState',
      payload: null
    });
  }

  const invalidOptimizedBoundary = await batchCall([
    { name: 'getOptimizedImage', arguments: { boundary: { left: 10, top: 10, right: 5, bottom: 5 } } }
  ]);
  scenarios.push({
    name: 'invalid-optimized-boundary',
    expected: 'Preflight should reject getOptimizedImage when boundary right/bottom do not exceed left/top',
    outcome: hasPreflightFailure(invalidOptimizedBoundary, [
      'getOptimizedImage boundary right must be greater than left',
      'getOptimizedImage boundary bottom must be greater than top'
    ]) ? 'pass' : 'fail',
    payload: invalidOptimizedBoundary
  });

  const invalidOptimizedQuality = await batchCall([
    { name: 'getOptimizedImage', arguments: { quality: 101 } }
  ]);
  scenarios.push({
    name: 'invalid-optimized-quality',
    expected: 'Preflight should reject getOptimizedImage when quality is outside 1-100',
    outcome: hasPreflightFailure(invalidOptimizedQuality, ['getOptimizedImage quality must be between 1 and 100']) ? 'pass' : 'fail',
    payload: invalidOptimizedQuality
  });

  const invalidOptimizedAlpha = await batchCall([
    { name: 'getOptimizedImage', arguments: { includeAlpha: 'yes' } }
  ]);
  scenarios.push({
    name: 'invalid-optimized-include-alpha',
    expected: 'Preflight should reject getOptimizedImage when includeAlpha is not boolean',
    outcome: hasPreflightFailure(invalidOptimizedAlpha, ['getOptimizedImage includeAlpha must be a boolean']) ? 'pass' : 'fail',
    payload: invalidOptimizedAlpha
  });

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    systemStatus,
    diagnose,
    policy,
    scenarios
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MD_OUT, renderMarkdown(report));

  console.log(`Wrote ${JSON_OUT}`);
  console.log(`Wrote ${MD_OUT}`);
  console.log(JSON.stringify({
    connected: systemStatus?.pluginConnected === true,
    scenarios: scenarios.map(item => ({ name: item.name, outcome: item.outcome }))
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || String(error)}`);
  process.exit(1);
});
