#!/usr/bin/env node

const {
  buildDetailTemplateBlueprint,
  normalizeTemplateBlueprintScreenGroups
} = require('../dist/main/shared/reference-replication-blueprint.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildRepresentation(elements) {
  return {
    layout: { layoutType: 'custom' },
    elements,
    alignmentGroups: []
  };
}

function element(id, sourceType, name, x, y) {
  return {
    id,
    sourceType,
    name,
    box: { x, y, width: 0.2, height: 0.08 }
  };
}

function run() {
  const textOnlyBlueprint = buildDetailTemplateBlueprint(buildRepresentation([
    element('title_1', 'main-title', '主标题', 0.2, 0.1),
    element('copy_1', 'body-text', '说明文字', 0.2, 0.18)
  ]));

  const imageOnlyBlueprint = buildDetailTemplateBlueprint(buildRepresentation([
    element('product_1', 'product-image', '产品图', 0.2, 0.1)
  ]));

  const mixedBlueprint = buildDetailTemplateBlueprint(buildRepresentation([
    element('title_1', 'main-title', '主标题', 0.2, 0.1),
    element('icon_1', 'icon', '卖点图标', 0.55, 0.12),
    element('product_1', 'product-image', '产品图', 0.2, 0.2)
  ]));

  const textGroups = textOnlyBlueprint.screens[0]?.groups || [];
  const imageGroups = imageOnlyBlueprint.screens[0]?.groups || [];
  const mixedGroups = mixedBlueprint.screens[0]?.groups || [];

  assert(textGroups.length === 1 && textGroups.includes('文案'), `Text-only screen should only contain 文案 group, got ${textGroups.join(',')}.`);
  assert(!textGroups.includes('icon') && !textGroups.includes('图片'), 'Text-only screen must not force icon/image groups.');
  assert(imageGroups.length === 1 && imageGroups.includes('图片'), `Image-only screen should only contain 图片 group, got ${imageGroups.join(',')}.`);
  assert(mixedGroups.includes('文案') && mixedGroups.includes('icon') && mixedGroups.includes('图片'), `Mixed screen should contain all actual groups, got ${mixedGroups.join(',')}.`);

  const legacyMissingGroups = normalizeTemplateBlueprintScreenGroups({});
  const invalidGroups = normalizeTemplateBlueprintScreenGroups({ groups: ['文案', 'invalid', '图片'] });

  assert(legacyMissingGroups.length === 0, `Legacy missing groups must not silently default to 图片, got ${legacyMissingGroups.join(',')}.`);
  assert(invalidGroups.length === 2 && invalidGroups.includes('文案') && invalidGroups.includes('图片'), `Invalid groups should be filtered, got ${invalidGroups.join(',')}.`);

  return {
    success: true,
    groups: {
      textOnly: textGroups,
      imageOnly: imageGroups,
      mixed: mixedGroups,
      legacyMissingGroups,
      invalidGroups
    }
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
