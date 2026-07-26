'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildReferenceReplicationRootGroupName,
  buildReferenceReplicationSurfaceGroupName,
  inferReferenceReplicationArtifactKind,
  resolveReferenceReplicationDeliveryScenario,
  resolveReferenceReplicationOutputIntent
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'reference-replication-output-intent.ts'
));
const {
  buildDetailTemplateBlueprint,
  buildReferenceReplicationBlueprint
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'reference-replication-blueprint.ts'
));

function buildRepresentation() {
  return {
    canvas: { width: 1080, height: 1440 },
    layout: { layoutType: 'event-poster' },
    alignmentGroups: [],
    elements: [
      {
        id: 'title',
        sourceType: 'main-title',
        nodeKind: 'text',
        name: '主标题',
        content: '职业能力挑战',
        box: { x: 0.12, y: 0.08, width: 0.62, height: 0.12 },
        zIndex: 3
      },
      {
        id: 'award',
        sourceType: 'body-text',
        nodeKind: 'text',
        name: '奖金信息',
        content: '奖金 100000 元',
        box: { x: 0.12, y: 0.43, width: 0.52, height: 0.12 },
        zIndex: 2
      },
      {
        id: 'hero',
        sourceType: 'product-image',
        nodeKind: 'image',
        name: '机器人主视觉',
        box: { x: 0.56, y: 0.72, width: 0.38, height: 0.22 },
        zIndex: 1
      }
    ]
  };
}

function main() {
  const posterIntent = resolveReferenceReplicationOutputIntent({
    userIntent: '参考这张图做个海报'
  });
  const detailIntent = resolveReferenceReplicationOutputIntent({
    userIntent: '参考这个海报做一个详情页'
  });
  const crossPosterIntent = resolveReferenceReplicationOutputIntent({
    userIntent: '参考这个详情页做一张海报'
  });
  const userPosterOverridesModelDetail = resolveReferenceReplicationOutputIntent({
    artifactKind: 'detail-page',
    userIntent: '参考这个详情页做一张海报'
  });
  const userDetailOverridesModelPoster = resolveReferenceReplicationOutputIntent({
    artifactKind: 'poster',
    userIntent: '参考这张海报做一个详情页'
  });
  const modelArtifactFillsMissingDeliverable = resolveReferenceReplicationOutputIntent({
    artifactKind: 'banner',
    userIntent: '参考这张图生成同款版式'
  });
  const explicitReplicationOverridesModelDetail = resolveReferenceReplicationOutputIntent({
    artifactKind: 'detail-page',
    userIntent: '复刻一下这张海报'
  });
  const modelArtifactOverridesReferenceSource = resolveReferenceReplicationOutputIntent({
    artifactKind: 'banner',
    userIntent: '参考这张海报的视觉风格'
  });

  assert.strictEqual(posterIntent.artifactKind, 'poster');
  assert.strictEqual(posterIntent.topology, 'single_canvas');
  assert.strictEqual(posterIntent.autoFillStrategy, 'none');
  assert.strictEqual(detailIntent.artifactKind, 'detail-page');
  assert.strictEqual(detailIntent.topology, 'multi_screen');
  assert.strictEqual(crossPosterIntent.artifactKind, 'poster');
  assert.strictEqual(userPosterOverridesModelDetail.artifactKind, 'poster');
  assert.strictEqual(userPosterOverridesModelDetail.topology, 'single_canvas');
  assert.strictEqual(resolveReferenceReplicationDeliveryScenario(userPosterOverridesModelDetail), 'general-design');
  assert.strictEqual(userDetailOverridesModelPoster.artifactKind, 'detail-page');
  assert.strictEqual(userDetailOverridesModelPoster.topology, 'multi_screen');
  assert.strictEqual(resolveReferenceReplicationDeliveryScenario(userDetailOverridesModelPoster), 'detail-page');
  assert.strictEqual(modelArtifactFillsMissingDeliverable.artifactKind, 'banner');
  assert.strictEqual(explicitReplicationOverridesModelDetail.artifactKind, 'poster');
  assert.strictEqual(modelArtifactOverridesReferenceSource.artifactKind, 'banner');
  assert.strictEqual(inferReferenceReplicationArtifactKind('参考长图海报做一张活动图'), 'poster');

  const posterBlueprint = buildReferenceReplicationBlueprint(
    buildRepresentation(),
    posterIntent
  );
  const detailBlueprint = buildDetailTemplateBlueprint(buildRepresentation());

  assert.strictEqual(posterBlueprint.screens.length, 1);
  assert.strictEqual(posterBlueprint.screens[0].label, '海报画面');
  assert.strictEqual(posterBlueprint.screens[0].elements.length, 3);
  assert.ok(!JSON.stringify(posterBlueprint).includes('详情页'));
  assert.ok(!JSON.stringify(posterBlueprint).includes('第1屏'));
  assert.ok(detailBlueprint.screens.length > 1);
  assert.ok(detailBlueprint.screens.every((screen) => screen.label.startsWith(`第${screen.index}屏_`)));

  assert.strictEqual(
    buildReferenceReplicationRootGroupName(posterIntent, '2026-07-16'),
    '海报复刻骨架_2026-07-16'
  );
  assert.strictEqual(
    buildReferenceReplicationSurfaceGroupName(posterIntent, posterBlueprint.screens[0]),
    '海报画面'
  );
  assert.strictEqual(
    buildReferenceReplicationSurfaceGroupName(detailIntent, detailBlueprint.screens[0]),
    `一_01_${detailBlueprint.screens[0].type}`
  );

  const applySource = fs.readFileSync(path.resolve(
    __dirname,
    '..',
    'src',
    'renderer',
    'services',
    'skill-executors',
    'layout-replication-apply.ts'
  ), 'utf8');
  assert.ok(applySource.includes('buildReferenceReplicationRootGroupName(outputIntent)'));
  assert.ok(applySource.includes('buildReferenceReplicationSurfaceGroupName(outputIntent, screen)'));
  assert.ok(!applySource.includes('rootGroupName = `详情页模板骨架_'));

  console.log(JSON.stringify({
    success: true,
    posterIntent,
    detailIntent,
    crossPosterIntent,
    userPosterOverridesModelDetail,
    userDetailOverridesModelPoster,
    modelArtifactFillsMissingDeliverable,
    explicitReplicationOverridesModelDetail,
    modelArtifactOverridesReferenceSource,
    posterSurfaceCount: posterBlueprint.screens.length,
    detailSurfaceCount: detailBlueprint.screens.length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
