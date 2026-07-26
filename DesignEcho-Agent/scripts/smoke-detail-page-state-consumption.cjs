const path = require('path');
const fs = require('fs');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const repoRoot = path.resolve(__dirname, '..');
const {
  buildDetailPageStateContext,
  buildDetailPageVersionPatch,
  selectDetailPageScreensForStateRedo
} = require(path.join(repoRoot, 'src', 'shared', 'detail-page-state-consumption.ts'));

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

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const screens = [
  { id: 1, name: '首屏主视觉', type: 'C_HERO', order: 0, copyPlaceholders: [{}], imagePlaceholders: [{}] },
  { id: 2, name: '面料证明', type: 'G_MATERIAL', order: 1, copyPlaceholders: [{}], imagePlaceholders: [{}] },
  { id: 3, name: '细节收口', type: 'J_DETAIL', order: 2, copyPlaceholders: [{}], imagePlaceholders: [{}] }
];

const state = {
  schemaVersion: 'design-project-state/v0',
  targetUser: '北方冬天的年轻女性',
  sellingPoints: ['加厚保暖', '不掉跟', '袜口柔软不勒脚'],
  copywriting: [
    { slot: '首屏主文案', text: '厚暖短袜，冬天穿也舒服', basis: '加厚保暖' },
    { slot: '面料证明', text: '细密毛圈锁住温度', basis: '面料细节' }
  ],
  visualDirection: '干净白底，暖感柔和，高级但不花哨',
  reviewResult: {
    verdict: 'needs_fix',
    issues: [
      { owner: 'layout', target: '面料证明', problem: '文案和图片关系不够清楚', suggestion: '只重做面料证明这一屏' }
    ]
  }
};

const context = buildDetailPageStateContext({ state, screens });

assert(context.projectStateAvailable === true, 'state context should be marked available', context);
assert(context.agentDecisions.length === screens.length, 'state should provide agent decisions for each detail screen', context);
assert(
  context.agentDecisions[0].mainMessage === '厚暖短袜，冬天穿也舒服',
  'matched project copywriting should drive the first screen main message',
  context.agentDecisions[0]
);
assert(
  context.agentDecisions[1].mainMessage === '细密毛圈锁住温度',
  'screen-name matched copywriting should drive the matching screen main message',
  context.agentDecisions[1]
);
assert(
  context.agentDecisions[2].supportingPoints.includes('袜口柔软不勒脚'),
  'state selling points should be available to later screens as supporting points',
  context.agentDecisions[2]
);
assert(
  context.agentDecisions.every((decision) => (decision.rationale || []).some((line) => line.includes('项目状态'))),
  'agent decisions generated from state should identify project-state rationale',
  context.agentDecisions
);
assert(
  context.stylePrompts.some((line) => line.includes('干净白底')),
  'visualDirection should enter detail-page style prompts',
  context
);

const redoScreens = selectDetailPageScreensForStateRedo({ state, screens });
assert(redoScreens.length === 1, 'review issue should target only one screen for redo', redoScreens);
assert(redoScreens[0].id === 2, 'screen-level redo should preserve the matching screen only', redoScreens);

const fillPatch = buildDetailPageVersionPatch({
  action: 'fill',
  screens: redoScreens,
  reason: '按项目状态重做面料证明屏'
});
assert(fillPatch?.appendVersion?.reason.includes('详情页填充'), 'fill should build a version-history patch', fillPatch);
assert(fillPatch?.appendVersion?.reason.includes('面料证明'), 'version reason should mention affected screen', fillPatch);
assert(fillPatch.updatedBy === 'detail-page-design', 'version patch should identify detail-page skill as author', fillPatch);

const exportPatch = buildDetailPageVersionPatch({
  action: 'export',
  screens,
  exportedFileCount: 3
});
assert(exportPatch?.appendVersion?.reason.includes('详情页导出'), 'export should build a version-history patch', exportPatch);
assert(exportPatch?.appendVersion?.reason.includes('3 个文件'), 'export reason should include exported file count', exportPatch);

const detailSkill = read('src/renderer/services/design-skills/detail-page-design.skill.ts');
const detailExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');

assert(
  detailSkill.includes('agentDecisions: projectStateContext.agentDecisions'),
  'detail template state should feed project-state agent decisions into screen plan inference'
);
assert(
  detailExecutor.includes('getDesignProjectState[detail-page]'),
  'detail executor should read Design Project State once for the skill run'
);
assert(
  detailExecutor.includes('selectDetailPageScreensForStateRedo'),
  'detail executor should support screen-level redo from review targets'
);
assert(
  detailExecutor.includes('updateDesignProjectState[detail-page:'),
  'detail executor should append detail fill/export version records'
);

assertNoMojibake(JSON.stringify(context), 'detail page state context');
assertNoMojibake(detailSkill, 'detail-page-design.skill.ts');
assertNoMojibake(detailExecutor, 'detail-page.executor.ts');

console.log(JSON.stringify({
  success: true,
  checks: [
    'detail-page state context turns copywriting and selling points into agent decisions',
    'visualDirection enters style prompts instead of being ignored',
    'review issues can select a single screen for redo',
    'fill/export operations can append version-history patches'
  ]
}, null, 2));
