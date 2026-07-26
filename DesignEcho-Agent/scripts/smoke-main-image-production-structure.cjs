#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageProjectStyleStrategy
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-project-style-strategy.ts'));
const {
  buildMainImagePlatformSizeProfile,
  buildMainImageProductionDocumentStructure
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-production-document-structure.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertEqual(actual, expected, message, details) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`, details);
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
}

function findProfile(profile, ratio) {
  return profile.sizeProfiles.find((item) => item.ratio === ratio);
}

function findParentGroup(document, name) {
  return document.parentGroups.find((group) => group.name === name);
}

function assertSize(size, expected, label, details) {
  assertEqual(size.width, expected.width, `${label} width mismatch`, details);
  assertEqual(size.height, expected.height, `${label} height mismatch`, details);
}

const selectedAsset = {
  id: 'asset-1',
  name: 'white-slouch-socks-01.jpg',
  path: 'C:/project/assets/white-slouch-socks-01.jpg',
  role: 'project-image',
  width: 1600,
  height: 1600
};

const projectAssets = [selectedAsset];

const visualSignal = {
  source: 'vision-model',
  assetRef: { id: 'asset-1', path: 'C:/project/assets/white-slouch-socks-01.jpg', name: 'white-slouch-socks-01.jpg' },
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  confidence: 0.82,
  sourceNotes: ['视觉模型：白色堆堆袜', '视觉模型：褶皱袜筒和清爽穿搭氛围']
};

const subjectBounds = {
  left: 250,
  top: 360,
  right: 1330,
  bottom: 980,
  width: 1080,
  height: 620
};

const sizePlans = [
  {
    sizeKey: 'main-image-800',
    targetSize: { width: 1440, height: 1440 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 420,
    decisionReason: '800 folder 1:1 main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  },
  {
    sizeKey: 'main-image-750',
    targetSize: { width: 1440, height: 1920 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 680,
    decisionReason: '750 folder 3:4 vertical main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  },
  {
    sizeKey: 'main-image-1200',
    targetSize: { width: 1440, height: 2560 },
    subjectSize: { width: 1180, height: 720 },
    scale: 0.72,
    targetX: 130,
    targetY: 920,
    decisionReason: '1200 folder 9:16 long vertical main image source size',
    smartLayoutPlanned: true,
    quickExportPlanned: true
  }
];

function buildVisualContextStyle() {
  return buildMainImageProjectStyleStrategy({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    projectAssets,
    selectedAsset,
    visionSignal: visualSignal,
    desiredClickImageCount: 2,
    desiredConversionImageCount: 2
  });
}

function run() {
  const profile = buildMainImagePlatformSizeProfile({
    platform: 'tmall',
    productCategory: 'socks'
  });

  assert(profile.version === 'main-image-production-document-structure/v0', 'profile version mismatch', profile);
  assert(profile.status === 'ready_platform_size_profile', '800/750/1200 profile should be ready without pending ratio confirmation', profile);
  assertEqual(profile.sizeProfiles.length, 3, 'profile should include exactly three delivery entries', profile);
  assert(profile.canClaimOfficialThirdRatio === false, 'profile must not claim a third official ratio', profile);
  assertEqual(profile.officiallyConfirmedRatioCount, 2, 'only 800 and 750 should be official/developer-doc confirmed', profile);
  assert(profile.warnings.length === 0, '800/750/1200 profile should not carry pending-ratio warnings', profile);

  const squareProfile = findProfile(profile, '1:1');
  const verticalProfile = findProfile(profile, '3:4');
  const longVerticalProfile = findProfile(profile, '9:16');
  assert(squareProfile, '1:1 profile should exist', profile);
  assert(verticalProfile, '3:4 profile should exist', profile);
  assert(longVerticalProfile, '9:16 profile should exist', profile);
  assert(squareProfile.id.includes('800'), '1:1 profile should map to 800 folder', squareProfile);
  assert(verticalProfile.id.includes('750'), '3:4 profile should map to 750 folder', verticalProfile);
  assert(longVerticalProfile.id.includes('1200'), '9:16 profile should map to 1200 folder', longVerticalProfile);
  assertSize(squareProfile.designSize, { width: 1440, height: 1440 }, '800 profile design size', squareProfile);
  assertSize(verticalProfile.designSize, { width: 1440, height: 1920 }, '750 profile design size', verticalProfile);
  assertSize(longVerticalProfile.designSize, { width: 1440, height: 2560 }, '1200 profile design size', longVerticalProfile);
  assertEqual(longVerticalProfile.sourceLevel, 'user_project_rule', '1200 profile should remain a user project rule', longVerticalProfile);
  assert(longVerticalProfile.officialClaimAllowed === false, '1200 profile must not be claimed as official platform ratio', longVerticalProfile);
  assertNoRawPayload(profile, 'platform size profile');

  const style = buildVisualContextStyle();
  const production = buildMainImageProductionDocumentStructure({
    platformSizeProfile: profile,
    projectStyleStrategy: style
  });

  assert(production.status === 'ready_production_document_structure', 'visual-context style plus profile should produce document structure', production);
  assertEqual(production.documents.length, 3, 'production structure should generate one document for 800/750/1200', production);
  assert(production.documents.every((doc) => doc.parentGroups.map((group) => group.name).join('|') === '点击图|转化图'), 'each document must keep 点击图 and 转化图 parent groups', production);

  const squareDocument = production.documents.find((doc) => doc.ratio === '1:1');
  const verticalDocument = production.documents.find((doc) => doc.ratio === '3:4');
  const longVerticalDocument = production.documents.find((doc) => doc.ratio === '9:16');
  assert(squareDocument, '800/1:1 production document should exist', production);
  assert(verticalDocument, '750/3:4 production document should exist', production);
  assert(longVerticalDocument, '1200/9:16 production document should exist', production);
  assertSize(longVerticalDocument.canvasSize, { width: 1440, height: 2560 }, '1200 document canvas size', longVerticalDocument);

  assertEqual(findParentGroup(squareDocument, '点击图').childGroups.length, 2, '800 document should include click child groups', squareDocument);
  assertEqual(findParentGroup(squareDocument, '转化图').childGroups.length, 2, '800 document should include conversion child groups', squareDocument);
  assertEqual(findParentGroup(verticalDocument, '点击图').childGroups.length, 2, '750 document should include click child groups', verticalDocument);
  assertEqual(findParentGroup(verticalDocument, '转化图').childGroups.length, 2, '750 document should include conversion child groups', verticalDocument);

  const longVerticalClickGroup = findParentGroup(longVerticalDocument, '点击图');
  const longVerticalConversionGroup = findParentGroup(longVerticalDocument, '转化图');
  assertEqual(longVerticalClickGroup.childGroups.length, 2, '1200 document should include click child groups', longVerticalDocument);
  assertEqual(longVerticalConversionGroup.childGroups.length, 0, '1200 document conversion group must remain empty', longVerticalDocument);

  assertEqual(production.exportSpecs.length, 10, '800/750 should export click+conversion and 1200 should export click only', production);
  assert(production.exportSpecs.every((spec) => spec.groupPath.length === 2), 'export specs should target parent/child group paths', production);
  const longVerticalExports = production.exportSpecs.filter((spec) => spec.documentId === longVerticalDocument.id);
  assertEqual(longVerticalExports.length, 2, '1200 document should only have click exports', longVerticalExports);
  assert(
    longVerticalExports.every((spec) => spec.imageType === 'click' && spec.groupPath[0] === '点击图'),
    '1200 exports must not include conversion exports or 转化图 group paths',
    longVerticalExports
  );
  assert(
    production.exportSpecs.every((spec) => spec.documentId !== longVerticalDocument.id || spec.imageType !== 'conversion'),
    '1200 document must not contain conversion export specs',
    production.exportSpecs
  );
  assert(production.noPhotoshopWrites === true, 'production structure must be read-only', production);
  assert(production.mustNotExecutePhotoshop === true, 'production structure must not execute Photoshop', production);
  assert(production.canClaimDesignComplete === false, 'production structure cannot claim design completion', production);
  assertNoRawPayload(production, 'production document structure');

  const metadataOnlyStyle = buildMainImageProjectStyleStrategy({
    userText: '做主图 raw-image-payload data:image/png;base64,abc',
    projectAssets,
    selectedAsset
  });
  const blocked = buildMainImageProductionDocumentStructure({
    platformSizeProfile: profile,
    projectStyleStrategy: metadataOnlyStyle
  });

  assert(blocked.status === 'blocked_missing_visual_context', 'metadata-only style must block production child groups', blocked);
  assert(blocked.documents.length === 0, 'blocked production structure must not fabricate documents', blocked);
  assert(blocked.blockers.includes('main_image_visual_context_required'), 'blocked production structure should explain visual context requirement', blocked);
  assertNoRawPayload(blocked, 'blocked production document structure');

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    imageType: 'click',
    selectedAsset,
    projectAssets,
    subjectBounds,
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: ['getDocumentInfo', 'getSubjectBounds', 'transformLayer'],
    visionSignal: visualSignal,
    mainImagePlatformProfile: profile
  });

  assert(strategyInputs.productionDocumentStructure, 'strategy input builder should expose production document structure record', strategyInputs);
  assert(strategyInputs.productionDocumentStructure.status === 'ready_production_document_structure', 'builder should carry ready production structure record', strategyInputs.productionDocumentStructure);
  assertEqual(strategyInputs.strategyInputs.exportAcceptancePolicy.productionDocumentCount, 3, 'export acceptance policy should reference production document count', strategyInputs.strategyInputs.exportAcceptancePolicy);
  assertEqual(strategyInputs.strategyInputs.exportAcceptancePolicy.exportSpecCount, 10, 'export acceptance policy should exclude 1200 conversion exports', strategyInputs.strategyInputs.exportAcceptancePolicy);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'platform size profile exposes 800/750/1200 delivery entries',
      'one production document is planned for each of 800/750/1200',
      '800 and 750 include 点击图 and 转化图 child groups',
      '1200/9:16 keeps 转化图 empty and has no conversion export specs',
      'metadata-only style blocks production structure instead of fabricating design output',
      'strategy input builder export acceptance policy counts 3 documents and 10 export specs'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
