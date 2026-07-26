#!/usr/bin/env node

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

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { DebugBridgeService } = require('../src/main/services/debug-bridge-service.ts');
const { MCPHostService } = require('../src/main/services/mcp-host-service.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: raw ? JSON.parse(raw) : null
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const previousToken = process.env.DESIGNECHO_DEBUG_TOKEN;
  process.env.DESIGNECHO_DEBUG_TOKEN = 'test-token';

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-debug-bridge-'));
  const port = 19000 + Math.floor(Math.random() * 1000);
  const service = new DebugBridgeService({
    host: '127.0.0.1',
    port,
    dataDir
  });

  try {
    const session = service.createSession({
      id: 'redaction-test',
      title: 'Redaction Test',
      metadata: {
        secret: 'metadata-secret'
      }
    });
    service.appendMessage(session.id, {
      role: 'assistant',
      direction: 'outbound',
      content: '执行 Photoshop 写操作并生成验收证据。',
      agent: 'smoke',
      metadata: {
        hidden: 'message-secret'
      },
      trace: {
        internalPrompt: 'trace-secret'
      },
      toolCalls: [
        {
          name: 'setTextStyle',
          arguments: {
            font: 'SourceHanSans'
          }
        }
      ],
      errors: [
        {
          message: 'error-secret'
        }
      ],
      executionSummary: {
        status: 'failed',
        stopReason: 'max_iterations',
        iterations: 25,
        toolCallCount: 4,
        successfulToolCalls: 2,
        failedToolCalls: 2,
        acceptanceVerified: 1,
        acceptanceFailed: 1,
        acceptanceNeedsReview: 0,
        noDocumentChangeRisks: 0,
        lastToolName: 'setTextStyle',
        lastError: 'execution-summary-secret',
        blockers: ['字体写入未通过验收'],
        warnings: ['存在未验证的文档变更'],
        summaryText: '任务未完成：达到最大迭代次数，并且验收失败。'
      }
    });

    const redacted = service.readSessionForDebugOutput(session.id, { includeFull: true, debugToken: 'wrong-token' });
    const redactedText = JSON.stringify(redacted);
    assert(redacted.risk?.redacted === true, `session should be redacted without token: ${redactedText}`);
    assert(redacted.messages?.[0]?.toolCallCount === 1, `redacted summary should keep counts: ${redactedText}`);
    assert(redacted.messages?.[0]?.executionSummary?.status === 'failed', `redacted summary should keep execution status: ${redactedText}`);
    assert(redacted.messages?.[0]?.executionSummary?.blockerCount === 1, `redacted summary should keep blocker counts: ${redactedText}`);
    assert(!redactedText.includes('metadata-secret'), 'redacted summary must not expose session metadata values');
    assert(!redactedText.includes('trace-secret'), 'redacted summary must not expose trace payload');
    assert(!redactedText.includes('error-secret'), 'redacted summary must not expose error payload');
    assert(!redactedText.includes('execution-summary-secret'), 'redacted summary must not expose full execution errors');

    const full = service.readSessionForDebugOutput(session.id, { includeFull: true, debugToken: 'test-token' });
    const fullText = JSON.stringify(full);
    assert(full.messages?.[0]?.trace?.internalPrompt === 'trace-secret', `full session should be available with token: ${fullText}`);
    assert(fullText.includes('metadata-secret'), 'full session should retain metadata for authorized debug');

    delete process.env.DESIGNECHO_DEBUG_TOKEN;
    const noConfiguredToken = service.readSessionForDebugOutput(session.id, { includeFull: true, debugToken: 'test-token' });
    assert(noConfiguredToken.risk?.redacted === true, 'full debug read must stay redacted when DESIGNECHO_DEBUG_TOKEN is not configured');
    process.env.DESIGNECHO_DEBUG_TOKEN = 'test-token';

    const noMessages = service.summarizeSession(service.readSession(session.id), { messageLimit: 0 });
    assert(!noMessages.messages, 'messageLimit=0 should omit message summaries');

    const mcpHost = new MCPHostService({
      host: '127.0.0.1',
      port: 0,
      wsServer: {
        isPluginConnected: () => false
      },
      debugBridge: service
    });

    const mcpWrongToken = await mcpHost.callTool('debug.session_get', {
      sessionId: session.id,
      includeFull: true,
      debugToken: 'wrong-token'
    });
    const mcpWrongText = JSON.stringify(mcpWrongToken);
    assert(mcpWrongToken.session?.risk?.redacted === true, `MCP wrong-token read should be redacted: ${mcpWrongText}`);
    assert(!mcpWrongText.includes('trace-secret'), 'MCP wrong-token read must not expose trace payload');

    const mcpFull = await mcpHost.callTool('debug.session_get', {
      sessionId: session.id,
      includeFull: true,
      debugToken: 'test-token'
    });
    assert(JSON.stringify(mcpFull).includes('trace-secret'), 'MCP valid token read should return full debug session');

    const mcpTraceWrong = await mcpHost.callTool('runtime.get_recent_task_trace', {
      sessionId: session.id,
      includeFull: true,
      debugToken: 'wrong-token'
    });
    const mcpTraceWrongText = JSON.stringify(mcpTraceWrong);
    assert(mcpTraceWrong.session?.redacted === true, `recent task trace should be redacted without valid token: ${mcpTraceWrongText}`);
    assert(mcpTraceWrong.messages?.[0]?.executionSummary?.status === 'failed', 'recent task trace should expose redacted execution summary');
    assert(!mcpTraceWrongText.includes('trace-secret'), 'recent task trace wrong-token read must not expose trace payload');
    assert(!mcpTraceWrongText.includes('execution-summary-secret'), 'recent task trace wrong-token read must not expose full execution errors');

    const mcpTraceFull = await mcpHost.callTool('runtime.get_recent_task_trace', {
      sessionId: session.id,
      includeFull: true,
      debugToken: 'test-token'
    });
    assert(JSON.stringify(mcpTraceFull).includes('trace-secret'), 'recent task trace valid token read should return full messages');

    const resource = await mcpHost.readResource(`designecho://debug/sessions/${session.id}`);
    const resourceText = resource.contents[0].text;
    assert(resourceText.includes('"redacted": true'), 'MCP debug session resource should always return redacted summary');
    assert(!resourceText.includes('trace-secret'), 'MCP debug session resource must not expose full trace payload');

    service.start();
    await wait(80);

    const publicResponse = await requestJson(`http://127.0.0.1:${port}/sessions/${session.id}?include=full`, {
      headers: {
        Origin: 'https://evil.example'
      }
    });
    const publicText = JSON.stringify(publicResponse.body);
    assert(publicResponse.statusCode === 200, `public redacted read should stay available: ${publicResponse.statusCode}`);
    assert(!publicResponse.headers['access-control-allow-origin'], 'untrusted origin must not receive CORS allow-origin');
    assert(publicResponse.body.session?.risk?.redacted === true, `HTTP read without token should be redacted: ${publicText}`);
    assert(!publicText.includes('trace-secret'), 'HTTP redacted read must not expose trace payload');

    const authorizedResponse = await requestJson(`http://127.0.0.1:${port}/sessions/${session.id}?include=full`, {
      headers: {
        Origin: `http://127.0.0.1:${port}`,
        'X-DesignEcho-Debug-Token': 'test-token'
      }
    });
    const authorizedText = JSON.stringify(authorizedResponse.body);
    assert(
      authorizedResponse.headers['access-control-allow-origin'] === `http://127.0.0.1:${port}`,
      'trusted same debug bridge origin should receive CORS allow-origin'
    );
    assert(authorizedText.includes('trace-secret'), 'HTTP full read should require and honor debug token');

    return {
      success: true,
      checks: [
        'method read is redacted without token',
        'method read returns full session with valid token',
        'unset DESIGNECHO_DEBUG_TOKEN denies full read',
        'MCP debug.session_get is redacted without valid token',
        'MCP debug.session_get returns full session with valid token',
        'MCP recent task trace follows the same token gate',
        'MCP debug session resource always returns redacted summary',
        'HTTP read is redacted without token',
        'untrusted Origin does not receive CORS permission',
        'trusted Origin with token can read full session'
      ]
    };
  } finally {
    service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousToken === undefined) {
      delete process.env.DESIGNECHO_DEBUG_TOKEN;
    } else {
      process.env.DESIGNECHO_DEBUG_TOKEN = previousToken;
    }
  }
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
