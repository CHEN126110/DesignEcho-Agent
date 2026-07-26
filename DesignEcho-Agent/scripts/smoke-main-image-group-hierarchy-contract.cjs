#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageGroupHierarchyContract
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-group-hierarchy-contract.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
}

function buildProductionFixture(overrides = {}) {
  return {
    version: 'main-image-production-document-structure/v0',
    skillId: 'main-image-design',
    scene: 'ecommerce-socks',
    status: 'ready_production_document_structure',
    platform: 'tmall',
    documents: [
      {
        id: 'tmall-1x1-main-image-doc',
        name: '天猫 1比1 主图 raw-image-payload',
        platform: 'tmall',
        ratio: '1:1',
        canvasSize: { width: 1440, height: 1440 },
        exportSize: { width: 800, height: 800 },
        sizeProfileId: 'tmall-1x1-main-image',
        sourceLevel: 'platform_developer_doc',
        parentGroups: [
          {
            name: '点击图',
            role: 'click-images',
            childGroups: [
              {
                id: 'click-light-01',
                name: '点击图 01',
                variantId: 'click-light',
                objective: '点击率',
                imageType: 'click',
                exportRole: 'click-image',
                requiredInputs: ['actualBounds', 'screenshot', 'exportFile']
              }
            ]
          },
          {
            name: '转化图',
            role: 'conversion-images',
            childGroups: [
              {
                id: 'conversion-soft-01',
                name: '转化图 01',
                variantId: 'conversion-soft',
                objective: '转化',
                imageType: 'conversion',
                exportRole: 'conversion-image',
                requiredInputs: ['actualBounds', 'screenshot', 'exportFile']
              }
            ]
          }
        ]
      }
    ],
    exportSpecs: [
      {
        id: 'export-click-light-01',
        documentId: 'tmall-1x1-main-image-doc',
        documentName: '天猫 1比1 主图',
        groupPath: ['点击图', '点击图 01'],
        exportSize: { width: 800, height: 800 },
        fileName: 'tmall-1x1-click-01.jpg',
        imageType: 'click',
        qualityBoundary: 'requires actual export file readback'
      },
      {
        id: 'export-conversion-soft-01',
        documentId: 'tmall-1x1-main-image-doc',
        documentName: '天猫 1比1 主图',
        groupPath: ['转化图', '转化图 01'],
        exportSize: { width: 800, height: 800 },
        fileName: 'tmall-1x1-conversion-01.jpg',
        imageType: 'conversion',
        qualityBoundary: 'requires actual export file readback'
      }
    ],
    verificationPolicy: {
      requiredBeforePhotoshopExecution: ['ready_production_document_structure'],
      requiredAfterPhotoshopExecution: ['actual_bounds_readback', 'export_file_readback'],
      qualityClaimBoundary: 'requires screenshot QA and manual review'
    },
    canClaimOutputQuality: false,
    canClaimDesignComplete: false,
    noPhotoshopWrites: true,
    mustNotExecutePhotoshop: true,
    blockers: [],
    warnings: [],
    limitations: ['fixture only'],
    sourceNotes: [{
      source: 'fixture',
      summary: 'ready production fixture',
      status: 'needs_review'
    }],
    ...overrides
  };
}

function run() {
  const production = buildProductionFixture();
  const currentUxPTools = [
    'createGroup',
    'moveLayerToGroup',
    'moveLayer',
    'exportGroup'
  ];
  const readyCurrent = buildMainImageGroupHierarchyContract({
    productionDocumentStructure: production,
    availableToolNames: currentUxPTools
  });

  assert(readyCurrent.noPhotoshopWrites === true, 'contract must be no-write', readyCurrent);
  assert(readyCurrent.canWritePhotoshop === false, 'contract must not write Photoshop', readyCurrent);
  assert(readyCurrent.canClaimOutputQuality === false, 'contract must not claim output quality', readyCurrent);
  assert(readyCurrent.canClaimDesignComplete === false, 'contract must not claim design completion', readyCurrent);
  assert(readyCurrent.status === 'ready_for_disposable_group_hierarchy_adapter', 'current UXP tools should satisfy group hierarchy adapter readiness', readyCurrent);
  assert(readyCurrent.documents.length === 1, 'contract should preserve document grouping record', readyCurrent);
  assert(readyCurrent.documents[0].requiredParentGroups.join('|') === '点击图|转化图', 'contract should require 点击图 and 转化图 parent groups', readyCurrent);
  assert(readyCurrent.documents[0].requiredGroupPaths.length === 2, 'contract should expose parent/child group paths', readyCurrent);
  assert(!readyCurrent.blockers.includes('missing_verified_parent_group_child_creation_semantics'), 'moveLayerToGroup should satisfy child group nesting semantics', readyCurrent.blockers);
  assert(!readyCurrent.blockers.includes('missing_verified_move_to_group_semantics'), 'moveLayerToGroup should satisfy move-to-group semantics', readyCurrent.blockers);
  assert(!readyCurrent.blockers.includes('missing_verified_group_scoped_export_to_path'), 'exportGroup should satisfy group export semantics', readyCurrent.blockers);
  assertNoRawPayload(readyCurrent, 'ready current group hierarchy contract');

  const missingGroupExport = buildMainImageGroupHierarchyContract({
    productionDocumentStructure: production,
    availableToolNames: currentUxPTools.filter((tool) => tool !== 'exportGroup')
  });
  assert(missingGroupExport.status === 'blocked_missing_required_tool', 'missing exportGroup should block group hierarchy readiness', missingGroupExport);
  assert(missingGroupExport.missingToolNames.includes('exportGroup'), 'missing exportGroup should be explicit', missingGroupExport.missingToolNames);

  const missingProduction = buildMainImageGroupHierarchyContract({
    availableToolNames: currentUxPTools
  });
  assert(missingProduction.status === 'blocked_missing_production_structure', 'missing production structure should block', missingProduction);
  assert(missingProduction.documents.length === 0, 'missing production structure must not fabricate documents', missingProduction);

  const invalidProduction = buildMainImageGroupHierarchyContract({
    productionDocumentStructure: buildProductionFixture({
      documents: [
        {
          ...production.documents[0],
          parentGroups: [production.documents[0].parentGroups[0]]
        }
      ]
    }),
    availableToolNames: currentUxPTools
  });
  assert(invalidProduction.status === 'blocked_invalid_production_structure', 'missing parent groups should block structure', invalidProduction);
  assert(
    invalidProduction.blockers.some((item) => item.startsWith('document_missing_required_parent_groups=')),
    'invalid structure should expose missing parent group blocker',
    invalidProduction.blockers
  );

  const ready = buildMainImageGroupHierarchyContract({
    productionDocumentStructure: production,
    availableToolNames: currentUxPTools,
    toolSemantics: {
      createGroupSupportsParentPath: true,
      moveToGroupToolName: 'moveLayerToGroup',
      groupScopedExportToolName: 'exportGroup'
    }
  });
  assert(
    ready.status === 'ready_for_disposable_group_hierarchy_adapter',
    'explicit verified parentPath/move-to-group/export semantics should allow disposable adapter readiness',
    ready
  );
  assert(ready.canCreateAdapter === true, 'ready contract may create a disposable adapter only', ready);
  assert(ready.canWritePhotoshop === false, 'ready contract still does not write Photoshop', ready);
  assert(ready.verificationReport.status === 'passed', 'ready contract verification should pass as no-write readiness record', ready.verificationReport);
  assertNoRawPayload(ready, 'ready group hierarchy contract');

  console.log('smoke-main-image-group-hierarchy-contract passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
