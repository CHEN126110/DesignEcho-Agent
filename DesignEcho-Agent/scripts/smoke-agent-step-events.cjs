#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { Agent } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-step-events-smoke.json');
  const mdPath = path.join(outDir, 'agent-step-events-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Agent Step Events Smoke',
      '',
      `- success: ${payload.success}`,
      '',
      '## Events',
      ...(payload.events || []).map((event) => `- ${event.kind}: ${event.title}`)
    ].join('\n'),
    'utf8'
  );
  return { json: jsonPath, md: mdPath };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const events = [];
  let modelCalls = 0;
  const agent = new Agent(
    {
      systemPrompt: 'Use tools and verify.',
      tools: [
        { name: 'getDocumentInfo', description: 'Read document', inputSchema: { type: 'object', properties: {} } },
        { name: 'getAcceptanceSnapshot', description: 'Verify document', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations: 4,
      requireInitialToolCall: true,
      callbacks: {
        onStep: (event) => events.push(event)
      }
    },
    async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'read-doc', name: 'getDocumentInfo', arguments: { includeLayers: true, apiKey: 'SHOULD_NOT_APPEAR' } }
          ]
        };
      }
      return { content: '已完成检查。', toolCalls: [] };
    },
    async () => ({
      success: true,
      acceptance: {
        enabled: true,
        verified: true,
        assertionStatus: 'passed',
        noDocumentChangeRisk: false,
        summaryText: '验收通过'
      }
    })
  );

  const result = await agent.run('检查当前文档并汇报');
  const kinds = events.map((event) => event.kind);
  const text = JSON.stringify(events);

  for (const kind of ['task_started', 'iteration_started', 'model_request', 'model_response', 'tool_planned', 'tool_started', 'tool_completed', 'observation', 'verification']) {
    assert(kinds.includes(kind), `missing step event: ${kind}`);
  }
  assert(result.success === true, `expected success, got ${result.success}: ${result.message}`);
  assert(!text.includes('SHOULD_NOT_APPEAR'), 'step event details must not leak api/key/token/secret argument values');
  assert(events.some((event) => event.kind === 'tool_completed' && event.detail.includes('验收')), 'tool completion should summarize acceptance evidence');
  assert(events.some((event) => event.kind === 'verification' && event.title.includes('任务验收结论')), 'verification event should expose final task result');

  const payload = {
    success: true,
    events,
    result: {
      success: result.success,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary?.status
    },
    generatedAt: new Date().toISOString()
  };
  const files = writeReport(payload);
  console.log(`Agent step events smoke passed. Report: ${files.md}`);
}

main().catch((error) => {
  const payload = {
    success: false,
    error: error?.stack || error?.message || String(error),
    generatedAt: new Date().toISOString()
  };
  writeReport(payload);
  console.error(payload.error);
  process.exit(1);
});
