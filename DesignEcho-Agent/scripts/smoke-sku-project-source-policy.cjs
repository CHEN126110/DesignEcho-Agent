#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const agentSourcePath = path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const uxpSourcePath = path.resolve(__dirname, '..', '..', 'DesignEcho-UXP', 'src', 'tools', 'layout', 'sku-layout-tool.ts');

const agentSource = fs.readFileSync(agentSourcePath, 'utf8');
const uxpSource = fs.readFileSync(uxpSourcePath, 'utf8');

assert(
  agentSource.includes('resolveProjectSkuSourceDocument'),
  'SKU executor should resolve the SKU source through a project-first policy'
);
assert(
  !agentSource.includes('let skuDoc = docsResult?.documents?.find((d: any) => matchesSkuDocument(d, skuKeyword));'),
  'SKU executor must not pick an opened SKU document before checking the current project'
);
assert(
  !agentSource.includes('allowPathlessProjectFallback: true'),
  'SKU executor must not use pathless opened SKU documents when a project is loaded'
);
assert(
  !agentSource.includes('临时使用已打开文档'),
  'SKU executor should not present pathless opened documents as a project-safe fallback'
);
assert(
  agentSource.includes('pickBestProjectSkuSourceFile'),
  'SKU executor should score project PSD/PSB candidates before falling back to opened documents'
);
assert(
  agentSource.includes('skuDocName: skuDocName'),
  'SKU executor should pass the resolved SKU document name into skuLayout'
);
assert(
  agentSource.includes('templateDocName: comboTemplateDocWithPreflight.name'),
  'SKU executor should pass the preflighted per-batch combo template document name into skuLayout'
);
assert(
  agentSource.includes('templateDocName: noteTemplateDocWithPreflight.name'),
  'SKU executor should pass the preflighted per-batch note template document name into skuLayout'
);
assert(
  agentSource.includes('...input.templateDoc,') &&
    agentSource.includes('...preflightWithWarnings,') &&
    agentSource.includes('skuTemplateLayoutPreflight: preflightWithWarnings'),
  'SKU template preflight should preserve the opened template document identity while attaching preflight evidence'
);
assert(
  agentSource.includes('SKU 执行计划已确认'),
  'SKU executor should emit a visible execution plan before running Photoshop mutations'
);
assert(
  uxpSource.includes('skuDocName: params.skuDocName') &&
    uxpSource.includes('templateDocName: params.templateDocName'),
  'UXP skuLayout action should forward explicit document names to execution code'
);
assert(
  uxpSource.includes('config.skuDocName') &&
    uxpSource.includes('config.templateDocName'),
  'UXP SKU note/combo execution should honor explicit SKU and template documents'
);
assert(
  !/function isDocumentFromTemplateDirectory[\s\S]*?if \(!templateDir\) return true;/.test(agentSource),
  'SKU combo template directory check must not treat opened documents as templates when no project template dir is resolved (project-first policy must cover templates, not just source docs)'
);
assert(
  /function isDocumentFromTemplateDirectory[\s\S]*?if \(!doc\?\.path\) return false;/.test(agentSource),
  'SKU combo template must reject pathless opened documents, mirroring the source-document project-first policy'
);

console.log('[smoke-sku-project-source-policy] pass');
