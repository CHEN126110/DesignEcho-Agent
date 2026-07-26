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
  EAGLE_VISUAL_CASE_INDEX_VERSION,
  buildEagleVisualCaseIndexFromReadonlyKnowledge,
  isEagleVisualCaseIndexPayloadSafe
} = require('../src/shared/eagle-visual-case-index.ts');

const {
  normalizeEagleReadonlyKnowledgeResults
} = require('../src/shared/eagle-readonly-knowledge.ts');

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

function sampleItems() {
  return [
    {
      id: 'eagle-case-1',
      name: 'socks-main-image-reference.jpg',
      ext: 'jpg',
      tags: ['socks', 'main-image', 'clean-layout', 'soft-shadow'],
      folders: ['Ecommerce References', 'Socks'],
      width: 1440,
      height: 1440,
      annotation: 'Five-color socks reference with balanced spacing and low-noise white background.',
      filePath: 'D:/Eagle/library/socks-main-image-reference.jpg',
      thumbnailPath: 'D:/Eagle/library/.thumb/socks-main-image-reference.jpg',
      url: 'https://example.com/case',
      updatedAt: '2026-05-26T12:00:00.000Z',
      imageBase64: 'data:image/png;base64,should-not-leak'
    },
    {
      id: 'eagle-case-2',
      name: 'detail-page-module-reference.png',
      ext: 'png',
      tags: ['detail-page', 'fabric-closeup'],
      folders: ['Ecommerce References'],
      width: 750,
      height: 1200,
      annotation: 'Detail page fabric module. No subject boxes were measured.',
      filePath: 'D:/Eagle/library/detail-page-module-reference.png',
      rawImage: { bytes: 'should-not-leak' }
    }
  ];
}

function run() {
  const readonlyKnowledge = normalizeEagleReadonlyKnowledgeResults(
    {
      query: 'socks ecommerce visual reference',
      limit: 6
    },
    sampleItems(),
    {
      sourceTool: 'item_query',
      nowIso: '2026-05-27T00:00:00.000Z'
    }
  );

  const index = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
    purpose: 'design_reference',
    requestedBy: 'smoke-test'
  });

  assert(index.version === EAGLE_VISUAL_CASE_INDEX_VERSION, 'case index should expose stable version', index);
  assert(index.source.provider === 'eagle', 'case index should preserve Eagle as provider', index.source);
  assert(index.boundaries.readonly === true, 'case index should be readonly', index.boundaries);
  assert(index.boundaries.doesNotRunPhotoshop === true, 'case index must not run Photoshop', index.boundaries);
  assert(index.boundaries.doesNotInferUnobservedVisualFacts === true, 'case index must not fabricate visual analysis', index.boundaries);
  assert(index.summary.caseCount === 2, 'case index should include normalized Eagle knowledge cases', index.summary);
  assert(index.summary.needsVisualAnalysisCount === 2, 'metadata-only Eagle cases should require visual analysis', index.summary);
  assert(index.cases.length === 2, 'case index should keep two cases', index.cases);

  const first = index.cases.find((item) => item.caseId === 'eagle-case:eagle-case-1');
  assert(first, 'case index should include eagle-case-1');
  assert(first.caseId === 'eagle-case:eagle-case-1', 'case id should be stable and traceable', first);
  assert(first.source.itemId === 'eagle-case-1', 'case should preserve Eagle item id', first.source);
  assert(!first.source.filePath, 'case index must not expose the Eagle local file path through readonly knowledge', first.source);
  assert(!first.source.thumbnailPath, 'case index must not expose the Eagle thumbnail path through readonly knowledge', first.source);
  assert(first.asset.width === 1440 && first.asset.height === 1440, 'case should preserve dimensions as metadata', first.asset);
  assert(first.asset.tags.includes('main-image'), 'case should preserve Eagle tags', first.asset);
  assert(first.asset.annotation.includes('Five-color socks'), 'case should preserve annotation text', first.asset);
  assert(first.visualReadiness === 'needs_visual_analysis', 'case should not claim visual analysis is complete', first);
  assert(first.analysis.ocrStatus === 'unknown', 'OCR status should remain unknown until a visual analyzer runs', first.analysis);
  assert(first.analysis.compositionStatus === 'unknown', 'composition status should remain unknown until measured', first.analysis);
  assert(first.analysis.subjectRegions.length === 0, 'subject regions should not be invented from tags', first.analysis);
  assert(first.analysis.dominantColors.length === 0, 'dominant colors should not be invented from tags', first.analysis);
  assert(first.allowedUses.includes('prompt_context'), 'case should remain usable as prompt context', first.allowedUses);
  assert(first.allowedUses.includes('user_reference'), 'case should remain usable as user reference', first.allowedUses);
  assert(!first.allowedUses.includes('direct_photoshop_action'), 'case must not become a direct Photoshop action', first.allowedUses);
  assert(first.sourceNotes.some((line) => line.includes('Eagle item id: eagle-case-1')), 'case source notes should include source item id', first.sourceNotes);
  assert(first.limitations.some((line) => line.includes('视觉分析')), 'case should explain metadata-only visual limitation', first.limitations);

  assert(isEagleVisualCaseIndexPayloadSafe(index), 'case index should pass raw image safety check', index);
  assertNoRawImagePayload(index, 'Eagle visual case index');

  const packageJson = JSON.parse(read('package.json'));
  assert(packageJson.scripts['smoke:design-knowledge:eagle-case-index'], 'package script should expose Eagle visual case index smoke');

  const boundaries = read('scripts/report-change-boundaries.cjs');
  assertIncludes(boundaries, 'smoke:design-knowledge:eagle-case-index', 'change boundary validation');
  assertIncludes(boundaries, 'eagle-visual-case-index', 'change boundary matcher');

  return {
    success: true,
    checks: [
      'Eagle readonly knowledge converts into traceable visual case index entries',
      'case index keeps metadata, tags, dimensions, local file refs and thumbnail refs',
      'metadata-only cases require visual analysis and do not invent OCR, subject boxes, colors or composition',
      'case index is readonly and cannot become a direct Photoshop action',
      'raw image/base64 payloads are not exposed',
      'package script and change boundary validation are wired'
    ]
  };
}

try {
  const result = run();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
