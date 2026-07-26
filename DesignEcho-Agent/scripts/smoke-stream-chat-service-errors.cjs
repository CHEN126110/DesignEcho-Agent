#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(ROOT, 'src/renderer/services/stream-chat.service.ts');

function loadStreamChatExports() {
  const previousTypeScriptLoader = Module._extensions['.ts'];
  Module._extensions['.ts'] = (targetModule, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true
      },
      fileName: filename
    });
    targetModule._compile(compiled.outputText, `${filename}.js`);
  };

  try {
    delete require.cache[SERVICE_PATH];
    return require(SERVICE_PATH);
  } finally {
    if (previousTypeScriptLoader) {
      Module._extensions['.ts'] = previousTypeScriptLoader;
    } else {
      delete Module._extensions['.ts'];
    }
  }
}

let listener = null;
const requests = [];
const abortedRequestIds = [];

global.window = {
  designEcho: {
    onStreamChunk(callback) {
      listener = callback;
    },
    chatStream(request) {
      requests.push(request);
      if (request.modelId === 'test-progress') {
        setTimeout(() => {
          listener({
            requestId: request.requestId,
            chunk: {
              type: 'thinking',
              thinking: '正在读取项目'
            }
          });
        }, 20);
        setTimeout(() => {
          listener({
            requestId: request.requestId,
            chunk: {
              type: 'content',
              content: 'A'
            }
          });
        }, 55);
        setTimeout(() => {
          listener({
            requestId: request.requestId,
            chunk: {
              type: 'content',
              content: 'B'
            }
          });
        }, 90);
        setTimeout(() => {
          listener({
            requestId: request.requestId,
            chunk: {
              type: 'content',
              content: 'C'
            }
          });
        }, 125);
        setTimeout(() => {
          listener({
            requestId: request.requestId,
            chunk: {
              type: 'done',
              fullResponse: {
                text: 'ABC',
                thinking: '正在读取项目'
              }
            }
          });
        }, 150);
        return Promise.resolve({ success: true });
      }
      if (request.modelId === 'test-stall') {
        return Promise.resolve({ success: true });
      }
      if (request.modelId === 'test-empty-heartbeat') {
        [10, 25, 40, 55, 70, 85].forEach((delay) => {
          setTimeout(() => {
            listener({
              requestId: request.requestId,
              chunk: {
                type: 'content',
                content: ''
              }
            });
          }, delay);
        });
        setTimeout(() => {
          listener({
            requestId: request.requestId,
            chunk: {
              type: 'done',
              fullResponse: {
                text: ''
              }
            }
          });
        }, 100);
        return Promise.resolve({ success: true });
      }
      setImmediate(() => {
        listener({
          requestId: request.requestId,
          chunk: {
            type: 'error',
            error: 'OpenRouter HTTP 429: quota exceeded. Please retry in 40s.'
          }
        });
      });
      return Promise.resolve({ success: true });
    },
    abortStream(requestId) {
      abortedRequestIds.push(requestId);
      return Promise.resolve({ success: true });
    }
  }
};

async function run() {
  const { streamChatAsync } = loadStreamChatExports();

  let rejected = null;
  try {
    await streamChatAsync('test-model', [
      { role: 'user', content: '你好' }
    ]);
  } catch (error) {
    rejected = error;
  }

  assert(rejected instanceof Error, 'streamChatAsync must reject when an error chunk arrives');
  assert(
    rejected.message.includes('HTTP 429') && rejected.message.includes('quota exceeded'),
    'streamChatAsync must preserve the compact provider error message'
  );
  assert.strictEqual(requests.length, 1, 'streamChatAsync should make exactly one stream request');
  assert(requests[0].requestId, 'stream request must contain a requestId');

  const progressive = await streamChatAsync('test-progress', [
    { role: 'user', content: '持续输出' }
  ], {
    timeoutMs: 70
  });
  assert.strictEqual(
    progressive.text,
    'ABC',
    'streamChatAsync must not abort a stream whose total duration exceeds timeoutMs while chunks continue arriving'
  );
  assert.strictEqual(
    progressive.thinking,
    '正在读取项目',
    'streamChatAsync must preserve Thinking received before progressive content'
  );

  let timeoutError = null;
  try {
    await streamChatAsync('test-stall', [
      { role: 'user', content: '等待停滞超时' }
    ], {
      timeoutMs: 30
    });
  } catch (error) {
    timeoutError = error;
  }
  assert(timeoutError instanceof Error, 'streamChatAsync must reject a stream that produces no activity');
  assert(
    timeoutError.message.includes('Stream chat timeout after 30ms'),
    'streamChatAsync must preserve the configured inactivity timeout in its error'
  );
  assert.strictEqual(abortedRequestIds.length, 1, 'stalled stream timeout must abort exactly one request');
  assert.strictEqual(
    abortedRequestIds[0],
    requests.find((request) => request.modelId === 'test-stall')?.requestId,
    'stalled stream timeout must abort the matching requestId'
  );

  let emptyHeartbeatError = null;
  try {
    await streamChatAsync('test-empty-heartbeat', [
      { role: 'user', content: '空 chunk 不应续命' }
    ], {
      timeoutMs: 35
    });
  } catch (error) {
    emptyHeartbeatError = error;
  }
  assert(
    emptyHeartbeatError instanceof Error,
    'empty content chunks must not keep an otherwise inactive stream alive'
  );
  assert.strictEqual(abortedRequestIds.length, 2, 'empty-heartbeat timeout must abort one additional request');
  assert.strictEqual(
    abortedRequestIds[1],
    requests.find((request) => request.modelId === 'test-empty-heartbeat')?.requestId,
    'empty-heartbeat timeout must abort the matching requestId'
  );
}

run()
  .then(() => {
    console.log(JSON.stringify({
      success: true,
      checks: [
        'renderer streamChatAsync rejects on stream error chunks',
        'renderer streamChatAsync preserves compact provider error cause',
        'renderer stream service sends requestId for callback correlation',
        'active Thinking/content chunks refresh the inactivity timeout beyond its total duration',
        'stalled streams reject at the configured inactivity timeout and abort the matching request',
        'empty content heartbeats cannot keep an otherwise inactive stream alive'
      ]
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
