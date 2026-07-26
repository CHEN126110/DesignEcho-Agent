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
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const {
  EAGLE_READONLY_TOOL_NAMES,
  buildEagleMcpToolCallBody,
  isEagleReadonlyKnowledgePayloadSafe,
  normalizeEagleReadonlyKnowledgeResults
} = require('../src/shared/eagle-readonly-knowledge.ts');

const {
  EagleReadonlyKnowledgeService
} = require('../src/main/services/eagle-readonly-knowledge-service.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} should include ${needle}`);
}

function assertNoRawImagePayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    'data:image',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} should not expose raw image payloads: ${found.join(', ')}`, value);
}

function assertNoWriteTool(value, label) {
  const text = JSON.stringify(value);
  const writeTools = [
    'item_update',
    'item_add',
    'item_move_to_trash',
    'item_add_tags',
    'item_remove_tags',
    'item_add_to_folders',
    'item_remove_from_folders',
    'folder_create',
    'folder_update',
    'tag_update',
    'tag_merge',
    'tag_group_create',
    'tag_group_update',
    'tag_group_delete'
  ];
  const found = writeTools.filter((tool) => text.includes(tool));
  assert(found.length === 0, `${label} should not include Eagle write tools: ${found.join(', ')}`, value);
}

function sampleItems() {
  return [
    {
      id: 'eagle-item-1',
      name: 'sock-card-reference.jpg',
      ext: 'jpg',
      tags: ['socks', 'sku-card', 'clean-shadow'],
      folders: ['folder-a'],
      width: 1600,
      height: 1200,
      annotation: 'Five-color socks SKU card with clean spacing and natural soft shadow.',
      filePath: 'D:/Eagle/library/sock-card-reference.jpg',
      thumbnailPath: 'D:/Eagle/library/.thumb/sock-card-reference.jpg',
      url: 'https://example.com/reference',
      star: 5,
      score: 0.91,
      imageBase64: 'data:image/png;base64,should-not-leak'
    }
  ];
}

async function run() {
  const normalized = normalizeEagleReadonlyKnowledgeResults(
    {
      query: 'socks sku card clean shadow',
      limit: 5
    },
    sampleItems(),
    {
      nowIso: '2026-05-27T00:00:00.000Z',
      sourceTool: 'item_query'
    }
  );

  assert(normalized.results.length === 1, 'Eagle item should normalize into one knowledge result', normalized);
  const item = normalized.results[0];
  assert(item.sourceType === 'eagle_library', 'Eagle knowledge should use eagle_library source type', item);
  assert(item.sourceLevel === 'local_case', 'Eagle item is a local case, not a generated claim', item);
  assert(item.allowedUses.includes('prompt_context'), 'Eagle item should be usable as prompt context', item);
  assert(item.allowedUses.includes('user_reference'), 'Eagle item should be usable as user reference', item);
  assert(!item.allowedUses.includes('direct_photoshop_action'), 'Eagle item must not become a direct Photoshop action', item);
  assert(item.tags.includes('eagle'), 'Eagle provider tag should be preserved', item);
  assert(item.tags.includes('sku-card'), 'Eagle item tags should be preserved', item);
  assert(item.sourceNotes.some((line) => line.includes('eagle-item-1')), 'Eagle item id should be visible in source notes', item);
  assert(normalized.providerSummary.eagleLibrary === 1, 'provider summary should count Eagle library results', normalized.providerSummary);
  assert(normalized.boundaries.readonly === true, 'connector boundary should be readonly', normalized.boundaries);
  assert(normalized.boundaries.doesNotReturnRawImages === true, 'connector boundary should redact raw image data', normalized.boundaries);
  assert(isEagleReadonlyKnowledgePayloadSafe(normalized), 'normalized payload should pass raw image safety check', normalized);
  assertNoRawImagePayload(normalized, 'normalized Eagle knowledge');
  assert(!JSON.stringify(normalized).includes('D:/Eagle/'), 'renderer/model payload must redact Eagle local paths', normalized);

  const metadataInjection = normalizeEagleReadonlyKnowledgeResults(
    { query: 'metadata safety', limit: 2 },
    [{
      id: 'D:\\Eagle\\private\\id',
      name: 'D:\\Eagle\\private\\reference.jpg',
      tags: ['D:\\Eagle\\private\\tag'],
      annotation: 'file://D:/Eagle/private/note'
    }],
    { sourceTool: 'item_query' }
  );
  assert(!JSON.stringify(metadataInjection).includes('D:\\Eagle'), 'Eagle metadata values must not smuggle local paths into public results', metadataInjection);
  assert(!JSON.stringify(metadataInjection).includes('file://'), 'Eagle metadata values must redact file URLs', metadataInjection);

  const allowedBody = buildEagleMcpToolCallBody('item_query', { query: 'socks' });
  assert(allowedBody.tool === 'item_query', 'read-only tool call should preserve tool name', allowedBody);
  assertNoWriteTool(allowedBody, 'read-only tool call body');

  for (const tool of ['get_app_info', 'item_query', 'item_get', 'item_get_selected', 'item_count', 'folder_get', 'tag_get', 'tag_count', 'tag_group_get', 'ai_search_status', 'ai_search_by_text', 'ai_search_by_item']) {
    assert(EAGLE_READONLY_TOOL_NAMES.includes(tool), `read-only tool allowlist should include ${tool}`);
  }
  for (const tool of ['item_update', 'item_add', 'folder_create', 'tag_merge']) {
    let threw = false;
    try {
      buildEagleMcpToolCallBody(tool, {});
    } catch {
      threw = true;
    }
    assert(threw, `write tool should be rejected: ${tool}`);
  }

  const calls = [];
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(String(init.body || '{}'));
    calls.push(body.tool);
    if (body.tool === 'ai_search_status') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { status: 'not_installed', ready: false } })
      };
    }
    if (body.tool === 'item_query') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: sampleItems() })
      };
    }
    throw new Error(`unexpected Eagle tool call ${body.tool}`);
  };

  const service = await EagleReadonlyKnowledgeService.search(
    {
      query: 'socks sku card',
      limit: 2,
      preferAiSearch: true
    },
    {
      settings: {
        enabled: true,
        endpoint: 'http://127.0.0.1:41596'
      },
      fetchImpl: fakeFetch
    }
  );

  assert(calls.includes('ai_search_status'), 'service should check AI Search readiness before semantic search', calls);
  assert(calls.includes('item_query'), 'service should fall back to read-only item_query when AI Search is unavailable', calls);
  assertNoWriteTool(calls, 'service call sequence');
  assert(service.status === 'ok', 'service should return ok when fallback search succeeds', service);
  assert(service.results.length === 1, 'service should return normalized Eagle result', service);
  assert(service.warnings.some((line) => line.includes('AI Search')), 'fallback should explain AI Search boundary', service.warnings);
  assertNoRawImagePayload(service, 'service Eagle knowledge');

  let neverSettlesObservedSignal;
  const timeoutStartedAt = Date.now();
  const timedOut = await EagleReadonlyKnowledgeService.search(
    {
      query: 'startup transient',
      limit: 2
    },
    {
      settings: {
        enabled: true,
        endpoint: 'http://127.0.0.1:41596',
        timeoutMs: 1000
      },
      fetchImpl: async (_url, init) => {
        neverSettlesObservedSignal = init.signal;
        return await new Promise(() => {});
      }
    }
  );
  const timeoutElapsedMs = Date.now() - timeoutStartedAt;
  assert(timedOut.status === 'unavailable', 'a non-cooperative Eagle request should fail closed instead of hanging', timedOut);
  assert(timeoutElapsedMs < 2500, 'one Eagle search must respect its overall timeout budget', { timeoutElapsedMs, timedOut });
  assert(neverSettlesObservedSignal, 'Eagle requests should still receive an AbortSignal');
  assert(neverSettlesObservedSignal.aborted === true, 'Eagle timeout should abort the underlying request signal');

  const oversizedItems = Array.from({ length: 5000 }, (_value, index) => ({
    id: `large-library-${index}`,
    name: `Large library item ${index}`,
    tags: ['bounded']
  }));
  const boundedLargeLibrary = normalizeEagleReadonlyKnowledgeResults(
    { query: 'large library', limit: 3 },
    oversizedItems,
    { sourceTool: 'item_query' }
  );
  assert(boundedLargeLibrary.results.length === 3, 'large Eagle responses should be truncated before public normalization', boundedLargeLibrary);

  const filteredCalls = [];
  const filtered = await EagleReadonlyKnowledgeService.search(
    {
      query: 'socks',
      limit: 2,
      preferAiSearch: true,
      tags: ['sku-card']
    },
    {
      settings: { enabled: true, endpoint: 'http://127.0.0.1:41596' },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init.body || '{}'));
        filteredCalls.push(body.tool);
        assert(body.tool === 'item_get', 'explicit filters must use item_get instead of AI search', body);
        assert(Array.isArray(body.params.tags) && body.params.tags.includes('sku-card'), 'tag filter must reach Eagle MCP', body);
        return { ok: true, status: 200, json: async () => ({ result: sampleItems() }) };
      }
    }
  );
  assert(filtered.status === 'ok', 'filtered Eagle search should succeed', filtered);
  assert(JSON.stringify(filteredCalls) === JSON.stringify(['item_get']), 'AI readiness/search must not bypass explicit filters', filteredCalls);

  const resolved = await EagleReadonlyKnowledgeService.resolveItemForAnalysis(
    'eagle-item-1',
    {
      settings: { enabled: true, endpoint: 'http://127.0.0.1:41596' },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init.body || '{}'));
        assert(body.tool === 'item_get', 'visual analysis should resolve one item through readonly item_get', body);
        assert(JSON.stringify(body.params.ids) === JSON.stringify(['eagle-item-1']), 'item_get should receive the requested Eagle id', body);
        return { ok: true, status: 200, json: async () => ({ result: sampleItems() }) };
      }
    }
  );
  assert(resolved.success === true, 'Eagle item should resolve internally for visual analysis', resolved);
  assert(resolved.item.localImagePath.includes('.thumb'), 'analysis should prefer Eagle thumbnail internally', resolved);

  let previewLoaderPath = '';
  let previewLoaderMaxSize = 0;
  const uiPreview = await EagleReadonlyKnowledgeService.getUiPreview(
    { itemId: 'eagle-item-1', maxSize: 9999, purpose: 'knowledge_library_ui' },
    async (localImagePath, maxSize) => {
      previewLoaderPath = localImagePath;
      previewLoaderMaxSize = maxSize;
      return {
        success: true,
        imageData: Buffer.from('bounded-eagle-preview').toString('base64'),
        dimensions: { width: 1600, height: 1200 }
      };
    },
    {
      settings: { enabled: true, endpoint: 'http://127.0.0.1:41596' },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ result: sampleItems() }) })
    }
  );
  assert(uiPreview.success === true && uiPreview.status === 'ok', 'explicit single-item Eagle UI preview should succeed', uiPreview);
  assert(previewLoaderPath.includes('.thumb'), 'UI preview loader should receive only the private preferred thumbnail path', previewLoaderPath);
  assert(previewLoaderMaxSize === 512, 'UI preview requests must clamp maxSize to 512', previewLoaderMaxSize);
  assert(uiPreview.preview.width === 512 && uiPreview.preview.height === 384, 'UI preview dimensions should fit within the bounded size', uiPreview.preview);
  assert(uiPreview.preview.dataUrl.startsWith('data:image/jpeg;base64,'), 'UI preview should return a renderer-ready JPEG data URL');
  assert(uiPreview.boundaries.uiOnly === true, 'preview response must declare UI-only use', uiPreview.boundaries);
  assert(uiPreview.boundaries.requiredPurpose === 'knowledge_library_ui', 'preview response must bind the explicit knowledge-library UI purpose', uiPreview.boundaries);
  assert(uiPreview.boundaries.doesNotEnterAgentContext === true, 'preview response must stay out of Agent context', uiPreview.boundaries);
  assert(uiPreview.boundaries.doesNotPersist === true, 'preview response must not be persisted', uiPreview.boundaries);
  assert(uiPreview.boundaries.doesNotWriteEagle === true, 'preview response must not write Eagle', uiPreview.boundaries);
  assert(!JSON.stringify(uiPreview).includes('D:/Eagle/'), 'UI preview response must not expose Eagle local paths', uiPreview);

  let unsafePsdLoaderCalled = false;
  const unsafePsdPreview = await EagleReadonlyKnowledgeService.getUiPreview(
    { itemId: 'large-psd', maxSize: 512, purpose: 'knowledge_library_ui' },
    async () => {
      unsafePsdLoaderCalled = true;
      return { success: false };
    },
    {
      settings: { enabled: true, endpoint: 'http://127.0.0.1:41596' },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          result: [{
            id: 'large-psd',
            name: 'huge-design.psd',
            ext: 'psd',
            filePath: 'D:/Eagle/library/huge-design.psd'
          }]
        })
      })
    }
  );
  assert(unsafePsdPreview.success === false && unsafePsdPreview.status === 'unavailable', 'PSD/PSB without an Eagle thumbnail should fail closed', unsafePsdPreview);
  assert(unsafePsdLoaderCalled === false, 'UI preview must not decode a raw PSD/PSB when Eagle has no thumbnail');
  assert(!JSON.stringify(unsafePsdPreview).includes('D:/Eagle/'), 'blocked PSD preview must not expose the private file path', unsafePsdPreview);

  let nonUiLoaderCalled = false;
  const nonUiPreview = await EagleReadonlyKnowledgeService.getUiPreview(
    { itemId: 'eagle-item-1', maxSize: 512 },
    async () => {
      nonUiLoaderCalled = true;
      return { success: true, imageData: Buffer.from('forbidden').toString('base64') };
    }
  );
  assert(nonUiPreview.success === false, 'preview without the explicit knowledge-library UI purpose must fail closed', nonUiPreview);
  assert(nonUiLoaderCalled === false, 'non-UI preview requests must be rejected before resolving or decoding an Eagle item');

  const unavailable = await EagleReadonlyKnowledgeService.search(
    {
      query: 'socks sku card',
      limit: 2
    },
    {
      settings: {
        enabled: true,
        endpoint: 'http://127.0.0.1:41596'
      },
      fetchImpl: async () => {
        throw new Error('connection refused');
      }
    }
  );
  assert(unavailable.status === 'unavailable', 'Eagle connection failure should be explicit unavailable status', unavailable);
  assert(unavailable.results.length === 0, 'unavailable Eagle connector must not fabricate knowledge', unavailable);
  assert(unavailable.warnings.some((line) => line.includes('Eagle')), 'unavailable result should name Eagle connector', unavailable.warnings);

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-knowledge:eagle-readonly'], 'package script should expose Eagle readonly smoke');

  const preload = read('src/main/preload.ts');
  assertIncludes(preload, 'searchEagleReadonlyKnowledge', 'preload Eagle readonly bridge');
  assertIncludes(preload, 'designKnowledge:searchEagleReadonly', 'preload Eagle readonly IPC channel');
  assertIncludes(preload, 'getEagleReferencePreview', 'preload Eagle UI preview bridge');
  assertIncludes(preload, 'designKnowledge:getEagleReferencePreview', 'preload Eagle UI preview IPC channel');

  const types = read('src/renderer/types.d.ts');
  assertIncludes(types, 'searchEagleReadonlyKnowledge', 'renderer type declaration');
  assertIncludes(types, 'getEagleReferencePreview', 'renderer Eagle UI preview type declaration');
  assertIncludes(types, 'eagle_library', 'renderer type should expose Eagle source type');

  const handlerIndex = read('src/main/ipc-handlers/index.ts');
  assertIncludes(handlerIndex, 'registerEagleKnowledgeHandlers', 'IPC setup');

  const handler = read('src/main/ipc-handlers/eagle-knowledge-handlers.ts');
  assertIncludes(handler, 'designKnowledge:searchEagleReadonly', 'Eagle knowledge IPC handler');
  assertIncludes(handler, 'designKnowledge:getEagleReferencePreview', 'Eagle UI preview IPC handler');
  assertIncludes(handler, 'designKnowledge:analyzeEagleReference', 'Eagle visual analysis IPC handler');
  assertIncludes(handler, 'localPathRedacted: true', 'Eagle visual analysis path redaction boundary');
  assertNoWriteTool(handler, 'Eagle knowledge IPC handler');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assertIncludes(boundaries, 'smoke:design-knowledge:eagle-readonly', 'change boundary validation');
  assertIncludes(boundaries, 'eagle-readonly-knowledge', 'change boundary matcher');

  return {
    success: true,
    checks: [
      'Eagle items normalize into canonical design knowledge results',
      'Eagle source is read-only local_case evidence and never a direct Photoshop action',
      'raw image/base64 payloads are redacted from knowledge results',
      'Eagle metadata cannot smuggle local paths through titles, ids, tags or annotations',
      'local Eagle paths stay out of search results and are used only inside main-process analysis',
      'explicit single-item Eagle UI previews are clamped to 512px and redact local paths',
      'preview requests without the explicit knowledge-library UI purpose fail closed',
      'UI preview refuses raw PSD/PSB decoding when Eagle has no thumbnail',
      'Eagle write tools are rejected by the connector allowlist',
      'explicit filters take priority over AI search and reach Eagle MCP',
      'AI Search is optional and falls back to item_query without failing the task',
      'one Eagle search has an overall timeout even when the fetch implementation ignores AbortSignal',
      'large Eagle result batches are bounded before normalization',
      'Eagle unavailable status does not fabricate knowledge',
      'IPC, preload, renderer types, package script and change boundary are wired'
    ]
  };
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
