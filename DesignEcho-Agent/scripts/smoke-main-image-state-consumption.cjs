#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageStateContext,
  buildMainImageStateVersionPatch,
  mergeMainImageStateCopyCandidates,
  mergeMainImageStateReferenceHints
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-state-consumption.ts'));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoMojibake(text, label) {
  const suspiciousTokens = [
    0x93b4,
    0x93c9,
    0x951b,
    0x95c8,
    0xfffd
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

const state = {
  schemaVersion: 'design-project-state/v0',
  targetUser: '北方冬天的年轻女性',
  brandStyle: '干净、温暖、商品感强',
  sellingPoints: ['加厚保暖', '不掉跟', '袜口柔软不勒脚'],
  painPoints: ['冬天脚冷', '袜口勒脚'],
  copywriting: [
    { slot: '点击图主文案', text: '厚暖短袜，冬天也舒服', basis: '加厚保暖' },
    { slot: '转化图1-痛点标题', text: '久穿不勒脚，暖而不闷', basis: '袜口柔软不勒脚' }
  ],
  visualDirection: '白底干净，暖光柔和，主体放大，文字少而准'
};

const context = buildMainImageStateContext({
  state,
  imageType: 'click',
  requestedVersionCount: 3
});

assert(context.projectStateAvailable === true, 'main-image state context should be available', context);
assert(context.copyCandidates.includes('厚暖短袜，冬天也舒服'), 'state copywriting should become copy candidates', context);
assert(context.copyCandidates.includes('加厚保暖'), 'state selling points should supplement copy candidates', context);
assert(context.visualDirection.includes('白底干净'), 'visual direction should pass through', context);
assert(context.targetUser === '北方冬天的年轻女性', 'target user should pass through', context);
assert(context.compositionVersions.length === 3, 'main-image should produce 2-3 composition versions from State', context);
assert(
  context.compositionVersions.some((version) => version.layoutIntent.includes('主体')),
  'composition versions should include layout intent, not only copy text',
  context.compositionVersions
);
assert(
  context.compositionVersions.every((version) => version.sourceContext.length > 0),
  'composition versions should keep source context from State',
  context.compositionVersions
);

const mergedCopy = mergeMainImageStateCopyCandidates(['用户指定短标题'], context, 5);
assert(mergedCopy[0] === '用户指定短标题', 'explicit copy should keep priority over State copy', mergedCopy);
assert(mergedCopy.includes('厚暖短袜，冬天也舒服'), 'state copy should merge after explicit copy', mergedCopy);

const mergedHints = mergeMainImageStateReferenceHints([{ title: '已有参考', note: '保留' }], context, 4);
assert(mergedHints.some((hint) => String(hint.note || '').includes('白底干净')), 'visual direction should become a reference hint', mergedHints);
assert(mergedHints.some((hint) => String(hint.note || '').includes('北方冬天')), 'target user should become a reference hint', mergedHints);

const patch = buildMainImageStateVersionPatch({
  action: 'strategy',
  compositionVersions: context.compositionVersions,
  selectedVersionId: context.compositionVersions[0].id,
  reason: '生成主图多版本构图'
});
assert(patch?.appendVersion?.reason.includes('主图多版本方案'), 'strategy patch should record multi-version plan', patch);
assert(patch?.appendVersion?.reason.includes(context.compositionVersions[0].name), 'strategy patch should mention selected version', patch);
assert(patch?.updatedBy === 'main-image-design', 'version patch should identify main-image skill as author', patch);

const mainImageSkill = read('src/renderer/services/design-skills/main-image-design.skill.ts');
const mainImageExecutor = read('src/renderer/services/skill-executors/main-image.executor.ts');

assert(
  mainImageSkill.includes('buildMainImageStateContext'),
  'main-image design skill should build state context for copy generation'
);
assert(
  mainImageExecutor.includes('getDesignProjectState[main-image]'),
  'main-image executor should read Design Project State'
);
assert(
  mainImageExecutor.includes('mainImageStateContext'),
  'main-image executor should expose state context in result data'
);
assert(
  mainImageExecutor.includes('updateDesignProjectState[main-image:'),
  'main-image executor should append strategy/execution version records'
);
assert(
  mainImageExecutor.includes('hasReviewableMainImageOutput')
    && mainImageExecutor.includes('主图已导出，自动验收还没完整完成')
    && mainImageExecutor.includes("data.status = hasReviewableMainImageOutput ? 'needs_review' : 'failed'"),
  'main-image executor should treat existing exported files as reviewable output instead of contradicting itself as a complete failure',
  mainImageExecutor.slice(
    mainImageExecutor.indexOf('const okResultFileCount'),
    mainImageExecutor.indexOf('function buildMainImageCurrentDocumentCandidate')
  )
);

assertNoMojibake(JSON.stringify(context), 'main image state context');
assertNoMojibake(mainImageSkill, 'main-image-design.skill.ts');
assertNoMojibake(mainImageExecutor, 'main-image.executor.ts');

console.log(JSON.stringify({
  success: true,
  checks: [
    'main-image state context consumes target user, selling points, copywriting and visual direction',
    'state copy merges with explicit copy without overriding user input',
    'state produces 2-3 comparable composition versions',
    'main-image strategy/execution paths append version-history patches',
    'main-image exported result files become reviewable output even when automatic acceptance is incomplete'
  ]
}, null, 2));
