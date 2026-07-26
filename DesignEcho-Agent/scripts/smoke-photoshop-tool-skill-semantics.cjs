const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  getPhotoshopToolSkillSemantics,
  buildPhotoshopToolSkillPromptSection
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'photoshop-tool-skill.ts'));
const {
  classifyAgentToolExecution
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const {
  getDefaultAgentTools,
  selectTools
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function assertToolSemantics(name, expectedKind, params = {}) {
  const semantics = getPhotoshopToolSkillSemantics(name, params);
  assert(semantics, `${name} should have Photoshop skill semantics`, { name, params });
  assert(
    semantics.capabilityKind === expectedKind,
    `${name} should be classified as ${expectedKind}, got ${semantics.capabilityKind}`,
    semantics
  );
  assert(
    typeof semantics.userIntentBoundary === 'string' && semantics.userIntentBoundary.length >= 12,
    `${name} should expose a user-intent boundary for the model`,
    semantics
  );
  assert(
    Array.isArray(semantics.doNotUseFor) && semantics.doNotUseFor.length > 0,
    `${name} should expose do-not-use guidance`,
    semantics
  );
  return semantics;
}

function assertSchemaHasBoundary(name, params = {}) {
  const schema = selectTools([name])[0];
  assert(schema, `${name} should exist in the Agent tool schema catalog`);
  const semantics = getPhotoshopToolSkillSemantics(name, params);
  assert(semantics, `${name} should have semantic catalog data`);
  assert(
    schema.description.includes('能力边界'),
    `${name} schema description should include semantic boundary text`,
    schema.description
  );
  assert(
    schema.description.includes(semantics.userIntentBoundary.slice(0, 12)),
    `${name} schema description should consume shared semantic boundary text`,
    { description: schema.description, semantics }
  );
}

const cases = [];
function runCase(name, fn) {
  try {
    const details = fn();
    cases.push({ name, status: 'pass', details });
  } catch (error) {
    cases.push({
      name,
      status: 'fail',
      message: error.message,
      details: error.details || error.stack
    });
  }
}

runCase('critical-tools-have-shared-photoshop-skill-semantics', () => {
  return [
    assertToolSemantics('getDocumentInfo', 'read_only_observation'),
    assertToolSemantics('searchProjectResources', 'read_only_observation'),
    assertToolSemantics('createTextLayer', 'photoshop_write'),
    assertToolSemantics('placeImage', 'photoshop_write'),
    assertToolSemantics('saveDocument', 'save_export'),
    assertToolSemantics('generateImage', 'external_generation'),
    assertToolSemantics('updateDesignProjectState', 'stateful_context')
  ].map((item) => ({ toolName: item.toolName, capabilityKind: item.capabilityKind }));
});

runCase('sku-layout-action-semantics-are-not-a-single-blunt-tool', () => {
  const readonly = assertToolSemantics('skuLayout', 'read_only_observation', { action: 'listLayerSets' });
  const capabilities = assertToolSemantics('skuLayout', 'read_only_observation', { action: 'getCapabilities' });
  const execute = assertToolSemantics('skuLayout', 'photoshop_write', { action: 'execute' });
  const noteExport = assertToolSemantics('skuLayout', 'save_export', { action: 'exportNote' });
  assert(
    classifyAgentToolExecution('skuLayout', { action: 'listLayerSets' }) === 'read_only_observation',
    'skuLayout listLayerSets should be read-only in execution preflight'
  );
  assert(
    classifyAgentToolExecution('skuLayout', { action: 'execute' }) === 'photoshop_write',
    'skuLayout execute should be Photoshop write in execution preflight'
  );
  assert(
    classifyAgentToolExecution('skuLayout', { action: 'exportNote' }) === 'save_export',
    'skuLayout exportNote should be save/export in execution preflight'
  );
  return { readonly, capabilities, execute, noteExport };
});

runCase('agent-tool-schemas-consume-shared-semantic-boundaries', () => {
  for (const name of ['getDocumentInfo', 'searchProjectResources', 'createTextLayer', 'placeImage', 'saveDocument', 'generateImage']) {
    assertSchemaHasBoundary(name);
  }
  return selectTools(['createTextLayer', 'placeImage']).map((tool) => ({
    name: tool.name,
    description: tool.description
  }));
});

runCase('default-agent-tools-have-no-unknown-photoshop-semantics', () => {
  const missing = getDefaultAgentTools()
    .map((tool) => tool.name)
    .filter((name) => !getPhotoshopToolSkillSemantics(name));
  assert(missing.length === 0, `default Agent tools should all have shared semantics: ${missing.join(', ')}`, missing);
  return { count: getDefaultAgentTools().length };
});

runCase('prompt-section-frames-photoshop-as-a-skill-not-a-keyword-trigger', () => {
  const section = buildPhotoshopToolSkillPromptSection(['getDocumentInfo', 'createTextLayer', 'skuLayout']);
  for (const expected of ['Adobe Photoshop 技能使用边界', '先理解用户目标', '能力边界', '副作用', '不要因为关键词直接调用']) {
    assert(section.includes(expected), `prompt section should include ${expected}`, section);
  }
  assert(!section.includes('\u515c\u5e95'), 'prompt section should not introduce fallback wording');
  return section;
});

const payload = {
  success: cases.every((item) => item.status === 'pass'),
  cases
};

console.log(JSON.stringify(payload, null, 2));
if (!payload.success) process.exitCode = 1;
