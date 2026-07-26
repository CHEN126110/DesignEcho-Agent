#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildEagleAssetCandidatesPanel
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-asset-candidates-panel.ts'));

const {
  buildEagleCandidateVisualHandoff
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-candidate-visual-handoff.ts'));

const {
  normalizeEagleReadonlyKnowledgeResults
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-readonly-knowledge.ts'));

const {
  buildEagleVisualCaseIndexFromReadonlyKnowledge
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'eagle-visual-case-index.ts'));

const {
  EagleAssetCandidatesService,
  createEagleAssetCandidatesRuntimeApi
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'eagle-asset-candidates.service.ts'));

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function sampleReadonlyKnowledge() {
  return normalizeEagleReadonlyKnowledgeResults(
    {
      query: 'socks sku card clean shadow',
      limit: 4
    },
    [
      {
        id: 'eagle-asset-1',
        name: 'five-color-socks-card.jpg',
        ext: 'jpg',
        tags: ['socks', 'sku-card', 'clean-shadow', 'white-bg'],
        folders: ['SKU references', '袜子案例'],
        width: 1600,
        height: 1000,
        annotation: 'Five socks arranged with consistent form and soft shadow.',
        filePath: 'D:\\Eagle\\library\\five-color-socks-card.jpg',
        thumbnailPath: 'D:\\Eagle\\library\\.thumb\\five-color-socks-card.jpg',
        url: 'https://example.com/case',
        star: 5,
        imageBase64: 'data:image/png;base64,should-not-leak'
      },
      {
        id: 'eagle-asset-2',
        name: 'detail-page-layout.png',
        ext: 'png',
        tags: ['detail-page', 'layout'],
        folders: ['Detail references'],
        width: 1440,
        height: 2560,
        annotation: 'Long-form detail page layout reference.',
        filePath: 'C:\\tmp\\detail-page-layout.png',
        thumbnailPath: 'C:\\tmp\\.thumb\\detail-page-layout.png',
        star: 4
      }
    ],
    {
      nowIso: '2026-05-28T00:00:00.000Z',
      sourceTool: 'item_query'
    }
  );
}

const readonlyKnowledge = sampleReadonlyKnowledge();
const visualCaseIndex = buildEagleVisualCaseIndexFromReadonlyKnowledge(readonlyKnowledge, {
  requestedBy: 'smoke-ui-eagle-asset-candidates',
  generatedAt: '2026-05-28T00:00:00.000Z'
});
const panel = buildEagleAssetCandidatesPanel({
  query: 'socks sku card clean shadow',
  readonlyKnowledge,
  visualCaseIndex,
  generatedAt: '2026-05-28T00:01:00.000Z'
});

assert(panel.version === 'eagle-asset-candidates-panel/v0', 'panel should expose stable version', panel);
assert(panel.status === 'ready', 'panel should be ready when readonly Eagle cases exist', panel);
assert(panel.candidates.length === 2, 'panel should expose Eagle candidates from visual case index', panel.candidates);
assert(panel.summary.includes('2'), 'panel summary should expose candidate count', panel.summary);
assert(panel.totals.candidateCount === 2, 'panel totals should count candidates', panel.totals);
assert(panel.totals.needsVisualAnalysisCount === 2, 'panel should keep visual analysis requirement visible', panel.totals);
assert(panel.canRunEagle === false, 'panel must not run Eagle automatically', panel);
assert(panel.canSearchEagleAutomatically === false, 'panel must not search Eagle automatically', panel);
assert(panel.canRunAgentRuntime === false, 'panel must not run Agent runtime', panel);
assert(panel.canRunPhotoshop === false, 'panel must not run Photoshop', panel);
assert(panel.canClaimDesignQuality === false, 'panel must not claim design quality', panel);

const first = panel.candidates[0];
assert(first.title === 'five-color-socks-card.jpg', 'candidate should preserve title', first);
assert(first.dimensionsLabel === '1600x1000', 'candidate should expose dimensions label', first);
assert(first.tagPreview.includes('sku-card'), 'candidate should preserve safe tag preview', first);
assert(first.folderPreview.includes('SKU references'), 'candidate should preserve folder preview', first);
assert(first.readinessLabel === '待视觉分析', 'candidate should not pretend visual analysis is done', first);
assert(first.allowedUseLabels.includes('用户参考'), 'candidate should map allowed uses for UI', first);
assert(first.warningCount >= 0, 'candidate should expose warning count', first);
assert(!Object.prototype.hasOwnProperty.call(first, 'filePath'), 'candidate card must not expose local filePath', first);
assert(!Object.prototype.hasOwnProperty.call(first, 'thumbnailPath'), 'candidate card must not expose local thumbnailPath', first);

const missingSelectionHandoff = buildEagleCandidateVisualHandoff({
  panel,
  selectedCandidateId: '',
  requestedBy: 'smoke-ui-eagle-asset-candidates',
  generatedAt: '2026-05-28T00:06:00.000Z'
});
assert(missingSelectionHandoff.version === 'eagle-candidate-visual-handoff/v0', 'handoff should expose stable version', missingSelectionHandoff);
assert(missingSelectionHandoff.status === 'needs_selection', 'handoff should require an explicit user selection', missingSelectionHandoff);
assert(missingSelectionHandoff.selectedCandidate === null, 'handoff must not fabricate a candidate without selection', missingSelectionHandoff);
assert(missingSelectionHandoff.visualAnalysisRequest.shouldRequestVisualAnalysis === false, 'handoff without selection must not request visual analysis', missingSelectionHandoff);
assert(missingSelectionHandoff.canRunEagle === false, 'handoff must not run Eagle', missingSelectionHandoff);
assert(missingSelectionHandoff.canRunAgentRuntime === false, 'handoff must not run Agent runtime', missingSelectionHandoff);
assert(missingSelectionHandoff.canRunPhotoshop === false, 'handoff must not run Photoshop', missingSelectionHandoff);
assert(missingSelectionHandoff.canClaimVisualAnalysisComplete === false, 'handoff must not claim visual analysis complete', missingSelectionHandoff);
assert(missingSelectionHandoff.canClaimDesignQuality === false, 'handoff must not claim design quality', missingSelectionHandoff);

const selectedHandoff = buildEagleCandidateVisualHandoff({
  panel,
  selectedCandidateId: first.candidateId,
  requestedBy: 'smoke-ui-eagle-asset-candidates',
  generatedAt: '2026-05-28T00:07:00.000Z'
});
assert(selectedHandoff.status === 'ready_for_visual_analysis_request', 'selected candidate should produce a visual-analysis request handoff', selectedHandoff);
assert(selectedHandoff.selectedCandidate?.candidateId === first.candidateId, 'handoff should preserve selected candidate id', selectedHandoff);
assert(selectedHandoff.selectedCandidate?.title === first.title, 'handoff should preserve selected candidate title', selectedHandoff);
assert(selectedHandoff.selectedCandidate?.dimensionsLabel === first.dimensionsLabel, 'handoff should preserve selected candidate dimensions', selectedHandoff);
assert(selectedHandoff.selectedCandidate?.tagPreview.includes('sku-card'), 'handoff should preserve safe metadata hints', selectedHandoff);
assert(selectedHandoff.visualAnalysisRequest.shouldRequestVisualAnalysis === true, 'selected handoff should request visual observations', selectedHandoff);
assert(selectedHandoff.visualAnalysisRequest.requestedObservations.includes('subject_regions'), 'handoff should require subject-region observation', selectedHandoff);
assert(selectedHandoff.visualAnalysisRequest.requestedObservations.includes('composition'), 'handoff should require composition observation', selectedHandoff);
assert(selectedHandoff.designDecisionHandoff.canProvideMetadataHints === true, 'handoff should allow metadata hints for downstream design planning', selectedHandoff);
assert(selectedHandoff.designDecisionHandoff.canClaimDesignDecisionReady === false, 'handoff must not mark design decision ready before visual observation', selectedHandoff);
assert(selectedHandoff.requiredReview.includes('visual_analysis_required'), 'handoff should require visual analysis review', selectedHandoff);
assert(selectedHandoff.requiredReview.includes('human_review_required'), 'handoff should require human review', selectedHandoff);
assert(selectedHandoff.canRunEagle === false, 'selected handoff must not run Eagle', selectedHandoff);
assert(selectedHandoff.canRunAgentRuntime === false, 'selected handoff must not run Agent runtime', selectedHandoff);
assert(selectedHandoff.canRunPhotoshop === false, 'selected handoff must not run Photoshop', selectedHandoff);
assert(selectedHandoff.canClaimVisualAnalysisComplete === false, 'selected handoff must not claim visual analysis complete', selectedHandoff);
assert(selectedHandoff.canClaimDesignQuality === false, 'selected handoff must not claim design quality', selectedHandoff);

const missingCandidateHandoff = buildEagleCandidateVisualHandoff({
  panel,
  selectedCandidateId: 'missing-candidate',
  requestedBy: 'smoke-ui-eagle-asset-candidates',
  generatedAt: '2026-05-28T00:08:00.000Z'
});
assert(missingCandidateHandoff.status === 'blocked_candidate_not_found', 'handoff should block missing selected candidate', missingCandidateHandoff);
assert(missingCandidateHandoff.selectedCandidate === null, 'missing candidate handoff must not fabricate selected candidate', missingCandidateHandoff);

const emptyPanel = buildEagleAssetCandidatesPanel({
  query: 'socks',
  readonlyKnowledge: { ...readonlyKnowledge, results: [], status: 'ok' },
  visualCaseIndex: { ...visualCaseIndex, cases: [], summary: { ...visualCaseIndex.summary, caseCount: 0 } },
  generatedAt: '2026-05-28T00:02:00.000Z'
});
assert(emptyPanel.status === 'empty', 'empty Eagle result should stay explicit empty state', emptyPanel);
assert(emptyPanel.candidates.length === 0, 'empty panel must not fabricate candidates', emptyPanel);

const disabledPanel = buildEagleAssetCandidatesPanel({
  query: 'socks',
  readonlyKnowledge: { ...readonlyKnowledge, status: 'disabled', results: [] },
  generatedAt: '2026-05-28T00:03:00.000Z'
});
assert(disabledPanel.status === 'disabled', 'disabled readonly knowledge should surface disabled status', disabledPanel);

const payloadText = JSON.stringify(panel);
for (const forbidden of ['confidence', '置信', 'data:image', 'rawImage', 'base64', 'C:\\tmp', 'D:\\Eagle']) {
  assert(!payloadText.includes(forbidden), `Eagle asset candidate payload must not expose forbidden marker: ${forbidden}`);
}

const handoffPayloadText = JSON.stringify(selectedHandoff);
for (const forbidden of ['confidence', '置信', 'data:image', 'rawImage', 'base64', 'C:\\tmp', 'D:\\Eagle', 'filePath', 'thumbnailPath', 'direct_photoshop_action']) {
  assert(!handoffPayloadText.includes(forbidden), `Eagle candidate handoff payload must not expose forbidden marker: ${forbidden}`);
}

const contractSource = read('src/shared/eagle-asset-candidates-panel.ts');
const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
const css = read('src/renderer/components/DesignAgentWorkbench.css');
const packageJson = read('package.json');
const changeBoundaries = read('scripts/report-change-boundaries.cjs');
const maintenance = read('scripts/validate-maintenance-hygiene.cjs');
const serviceSource = read('src/renderer/services/eagle-asset-candidates.service.ts');
const componentSource = read('src/renderer/components/EagleAssetCandidatesPanel.tsx');

async function assertServiceSearchBehavior() {
  let searchCalls = 0;
  const service = new EagleAssetCandidatesService({
    searchEagleReadonlyKnowledge: async (query) => {
      searchCalls += 1;
      assert(query.query === 'socks sku card', 'service should pass sanitized query to readonly Eagle API', query);
      assert(query.limit === 6, 'service should pass bounded limit to readonly Eagle API', query);
      assert(query.preferAiSearch === true, 'service should keep AI search preference explicit', query);
      return sampleReadonlyKnowledge();
    }
  });
  const result = await service.search({
    query: '  socks sku card  ',
    limit: 99,
    preferAiSearch: true,
    generatedAt: '2026-05-28T00:04:00.000Z'
  });
  assert(searchCalls === 1, 'service should call readonly Eagle API exactly once after explicit search');
  assert(result.status === 'ready', 'service should convert readonly Eagle results into ready candidate panel', result);
  assert(result.candidates.length === 2, 'service should keep visual case candidates in panel result', result);
  const text = JSON.stringify(result);
  for (const forbidden of ['data:image', 'rawImage', 'base64', 'C:\\tmp', 'D:\\Eagle', 'confidence', '置信']) {
    assert(!text.includes(forbidden), `service payload must not expose forbidden marker: ${forbidden}`);
  }

  const missingApiService = new EagleAssetCandidatesService({});
  const missingApiResult = await missingApiService.search({
    query: 'socks sku card',
    generatedAt: '2026-05-28T00:05:00.000Z'
  });
  assert(missingApiResult.status === 'unavailable', 'missing renderer API should return explicit unavailable panel', missingApiResult);
  assert(missingApiResult.candidates.length === 0, 'missing renderer API must not fabricate candidates', missingApiResult);
}

assert(!workbench.includes('EagleAssetCandidatesPanel'), 'Workbench should not compose Eagle candidates in the default right rail');
assert(componentSource.includes('data-testid="workbench-eagle-asset-candidates-panel"'), 'Eagle component should expose Eagle asset candidates panel');
assert(componentSource.includes('data-testid="workbench-eagle-asset-candidates-boundary"'), 'Eagle component should expose Eagle candidates boundary');
assert(componentSource.includes('data-testid="workbench-eagle-asset-candidate-select-button"'), 'Eagle component should expose explicit candidate selection buttons');
assert(componentSource.includes('data-testid="workbench-eagle-candidate-visual-handoff"'), 'Eagle component should expose the selected-candidate handoff');
assert(!workbench.includes('searchEagleReadonlyKnowledge'), 'Workbench must not search Eagle directly');
assert(!workbench.includes('window.designEcho'), 'Workbench must not call desktop APIs directly');
assert(!workbench.includes('executeToolCall'), 'Workbench must not execute tools');
assert(!workbench.includes('processWithUnifiedAgent'), 'Workbench must not call Agent runtime');
assert(serviceSource.includes('createEagleAssetCandidatesRuntimeApi'), 'renderer service should expose runtime API adapter factory');
assert(serviceSource.includes('searchEagleReadonlyKnowledge'), 'renderer service should own readonly Eagle search bridge');
assert(!componentSource.includes('window.designEcho'), 'Eagle candidate component must not call desktop APIs directly');
assert(componentSource.includes('data-testid="workbench-eagle-asset-candidates-search-button"'), 'Eagle candidate component should expose explicit search button');
assert(componentSource.includes('EagleAssetCandidatesPanel'), 'Eagle candidate UI should live in a dedicated component');
assert(!css.includes('.eagle-asset-candidates-panel'), 'Workbench CSS should not keep removed Eagle right-rail styles');
assert(contractSource.includes('canSearchEagleAutomatically: false'), 'contract should keep automatic Eagle search disabled');
assert(contractSource.includes('canRunEagle: false'), 'contract should keep Eagle execution disabled');
assert(contractSource.includes('canRunPhotoshop: false'), 'contract should keep Photoshop execution disabled');
assert(packageJson.includes('"smoke:ui:eagle-asset-candidates"'), 'package script should expose Eagle asset candidates smoke');
assert(packageJson.includes('smoke:ui:eagle-asset-candidates'), 'maintenance preflight should run Eagle asset candidates smoke');
assert(changeBoundaries.includes('eagle-asset-candidates-panel'), 'change boundaries should include Eagle asset candidates panel files');
assert(changeBoundaries.includes('eagle-candidate-visual-handoff'), 'change boundaries should include Eagle candidate visual handoff contract');
assert(changeBoundaries.includes('EagleAssetCandidatesPanel'), 'change boundaries should include Eagle asset candidates component');
assert(changeBoundaries.includes('eagle-asset-candidates)\\.service'), 'change boundaries should include Eagle asset candidates renderer service');
assert(changeBoundaries.includes('smoke:ui:eagle-asset-candidates'), 'change boundaries should include Eagle asset candidates smoke validation');
assert(changeBoundaries.includes('eagle-asset-candidates'), 'change boundaries should include Eagle asset candidates smoke matcher');
assert(maintenance.includes('smoke-ui-eagle-asset-candidates.cjs'), 'maintenance hygiene should run/check Eagle asset candidates smoke');
assert(exists('src/shared/eagle-asset-candidates-panel.ts'), 'Eagle asset candidates panel contract should exist');
assert(exists('src/shared/eagle-candidate-visual-handoff.ts'), 'Eagle candidate visual handoff contract should exist');
assert(exists('src/renderer/services/eagle-asset-candidates.service.ts'), 'Eagle asset candidates renderer service should exist');
assert(exists('src/renderer/components/EagleAssetCandidatesPanel.tsx'), 'Eagle asset candidates component should exist');

assertServiceSearchBehavior()
  .then(() => {
    console.log(JSON.stringify({
      success: true,
      checks: [
        'Eagle readonly knowledge and visual case index normalize into UI-safe candidate cards',
        'candidate cards preserve title, dimensions, tags, folders, allowed uses and readiness without exposing local paths',
        'empty and disabled Eagle states stay explicit and do not fabricate candidates',
        'renderer service requires explicit readonly Eagle search and returns UI-safe candidate panels',
        'explicit selected Eagle candidate creates a visual-analysis handoff without claiming analysis or design quality',
        'candidate panel does not search Eagle, run Agent runtime, run Photoshop or claim design quality',
        'Workbench no longer mounts Eagle candidates in the default user surface',
        'package, maintenance preflight, change boundaries and maintenance hygiene are wired'
      ]
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
