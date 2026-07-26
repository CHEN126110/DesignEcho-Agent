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
const {
  buildBusinessSkillVisualContext
} = require('../src/shared/business-skill-visual-context.ts');
const {
  attachBusinessVisualContextToResult,
  buildBusinessVisualContextForSkill,
  getBusinessVisualObservationScenarioForSkill,
  isBusinessVisualObservationSkill
} = require('../src/renderer/services/skill-executors/business-skill-visual-context.ts');

const root = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function buildContext({ scenario = 'sku', understood = false } = {}) {
  const candidate = {
    assetId: 'asset-1',
    path: 'D:/demo/source/sock.jpg',
    role: 'raw-product-still',
    priority: 80,
    score: 100,
    reason: 'fixture',
    cacheKey: 'project-visual:asset-1',
    cacheStatus: understood ? 'hit' : 'miss',
    shouldAnalyze: !understood,
    cachedInsight: understood ? { summary: 'white sock' } : undefined
  };
  return {
    projectPath: 'D:/demo',
    assetIndex: {
      summary: { totalImages: 1 },
      visionCandidates: [candidate]
    },
    visualSamplingPlan: {
      scenario,
      selectedCandidates: [candidate],
      skippedCandidateCount: 0,
      cacheSummary: understood
        ? { hit: 1, miss: 0, stale: 0, shouldAnalyze: 0 }
        : { hit: 0, miss: 1, stale: 0, shouldAnalyze: 1 }
    },
    visualInsightCache: {
      exists: understood,
      entries: understood ? [{ insight: { summary: 'white sock' } }] : [],
      summary: {
        totalEntries: understood ? 1 : 0,
        entriesWithInsight: understood ? 1 : 0
      }
    }
  };
}

function run() {
  assert(isBusinessVisualObservationSkill('main-image-design'), 'main image should expose observation context');
  assert(isBusinessVisualObservationSkill('detail-page-design'), 'detail page should expose observation context');
  assert(isBusinessVisualObservationSkill('sku-batch'), 'sku should expose observation context');
  assert(getBusinessVisualObservationScenarioForSkill('sku-batch') === 'sku', 'scenario should come from Skill declaration');
  assert(!isBusinessVisualObservationSkill('document-management'), 'atomic document tool is not a business observation Skill');

  const missing = buildBusinessSkillVisualContext({
    scenario: 'sku',
    requiresVisualObservation: true
  });
  assert(missing.status === 'needs_context_snapshot', 'missing context should be reported', missing);
  assert(missing.version === 'business-skill-visual-context/v0', 'visual context should expose its responsibility-based version', missing);
  assert(!Object.prototype.hasOwnProperty.call(missing, 'gateVersion'), 'visual context must not retain a gate-shaped version field', missing);
  assert(missing.requiredInputs.includes('project_context'), 'missing context should list missing input', missing);
  assert(!Object.prototype.hasOwnProperty.call(missing, 'shouldExecute'), 'observation context must not decide execution', missing);
  assert(!Object.prototype.hasOwnProperty.call(missing, 'enforcement'), 'strict/observation enforcement must be removed', missing);
  assert(!Object.prototype.hasOwnProperty.call(missing, 'blockers'), 'observation context must not produce blockers', missing);
  assert(missing.observations.length === 0, 'context status must not masquerade as a visual observation', missing);

  const ready = buildBusinessVisualContextForSkill('sku-batch', {
    params: {},
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildContext({ understood: true })
    }
  });
  assert(ready.status === 'ready', 'reusable image understanding should be reported as ready', ready);
  assert(ready.requiredInputs.length === 0, 'ready context should not report missing inputs', ready);

  const incomplete = buildBusinessVisualContextForSkill('sku-batch', {
    params: {},
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildContext()
    }
  });
  assert(incomplete.status === 'needs_visual_insight', 'missing image summary should be reported', incomplete);
  assert(incomplete.requiredInputs.includes('visual_understanding'), 'missing image summary should be listed as input', incomplete);
  assert(!Object.prototype.hasOwnProperty.call(incomplete, 'shouldExecute'), 'incomplete context still must not decide execution', incomplete);

  const attached = attachBusinessVisualContextToResult(
    { success: true, message: 'ok', data: { businessResult: true } },
    incomplete
  );
  assert(attached.success === true && attached.data.businessResult === true, 'attaching context must preserve business result', attached);
  assert(attached.data.businessVisualContext === incomplete, 'result should expose visual context under its responsibility-based field', attached);
  assert(!Object.prototype.hasOwnProperty.call(attached.data, 'businessVisualObservationGate'), 'result must not retain the legacy gate field', attached);
  assert(attached.data.businessVisualObservationFeedback.missingInputs.includes('visual_understanding'), 'feedback should expose missing input', attached);

  const wrapper = read('src/renderer/services/skill-executors/business-skill-visual-context.ts');
  assert(!fs.existsSync(path.join(root, 'src/shared/business-skill-visual-observation-gate.ts')), 'legacy shared gate module must not remain as an alias');
  assert(!fs.existsSync(path.join(root, 'src/renderer/services/skill-executors/business-skill-visual-observation-gate.ts')), 'legacy renderer gate module must not remain as an alias');
  assert(!wrapper.includes("enforcement: 'observation-only'"), 'wrapper must not recreate enforcement mode');
  assert(!wrapper.includes('requireBusinessVisualObservationBeforeExecution'), 'wrapper must not read removed strict switch');
  assert(!wrapper.includes('blockWithoutBusinessVisualObservation'), 'wrapper must not read removed blocking switch');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'observation context reports status and missing inputs without execution authority',
      'context status is not duplicated into a synthetic observation record',
      'strict enforcement and blockers are absent',
      'responsibility-based context types and result fields replace the legacy gate without aliases',
      'attaching observation context preserves the business result'
    ]
  }, null, 2));
}

run();
