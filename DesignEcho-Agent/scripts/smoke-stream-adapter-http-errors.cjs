#!/usr/bin/env node

const assert = require('assert');
const http = require('http');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST_STREAM_ADAPTER = path.join(ROOT, 'dist/main/main/services/stream-adapter.js');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function startErrorServer(statusCode, payload) {
  return new Promise(async (resolve, reject) => {
    const port = await findFreePort();
    const server = http.createServer((_req, res) => {
      const body = JSON.stringify(payload);
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      });
      res.end(body);
    });

    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
    server.on('error', reject);
  });
}

function collectChunks(adapter, start) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for stream error. chunks=${JSON.stringify(chunks)}`));
    }, 5000);

    adapter.on('chunk', (chunk) => {
      chunks.push(chunk);
      if (chunk.type === 'error') {
        clearTimeout(timeout);
        resolve(chunks);
      }
      if (chunk.type === 'done') {
        clearTimeout(timeout);
        reject(new Error(`Stream completed instead of surfacing HTTP error. chunks=${JSON.stringify(chunks)}`));
      }
    });

    start();
  });
}

async function runCase(label, createAdapter, startStream) {
  const { server, port } = await startErrorServer(429, {
    error: {
      message: `${label} quota exceeded`
    }
  });

  try {
    const adapter = createAdapter(port);
    const chunks = await collectChunks(adapter, () => startStream(adapter, port));
    const errorChunk = chunks.find((chunk) => chunk.type === 'error');

    assert(errorChunk, `${label} should emit an error chunk`);
    assert(
      String(errorChunk.error || '').includes('HTTP 429'),
      `${label} error should include HTTP status: ${JSON.stringify(errorChunk)}`
    );
    assert(
      String(errorChunk.error || '').includes(`${label} quota exceeded`),
      `${label} error should include compact provider message: ${JSON.stringify(errorChunk)}`
    );

    return `${label} HTTP error is surfaced as stream error`;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const {
    OllamaStreamAdapter,
    OpenAICompatibleStreamAdapter
  } = require(DIST_STREAM_ADAPTER);

  const messages = [{ role: 'user', content: 'hello' }];
  const checks = [];

  checks.push(await runCase(
    'Ollama',
    (port) => new OllamaStreamAdapter(`http://127.0.0.1:${port}`),
    (adapter) => adapter.stream('test-model', messages, { maxTokens: 8 })
  ));

  checks.push(await runCase(
    'TestProvider',
    (port) => new OpenAICompatibleStreamAdapter('test-key', `http://127.0.0.1:${port}/v1`, 'TestProvider'),
    (adapter) => adapter.stream('test-model', messages, { maxTokens: 8 })
  ));

  console.log(JSON.stringify({
    success: true,
    checks
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error?.message || String(error)
  }, null, 2));
  process.exit(1);
});
