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

const {
  buildSkuCardTemplatePreparationPlan
} = require('../src/shared/sku-card-template-preparation-plan.ts');

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

function enumeratePlaceholderSlots(request) {
  const params = request.params || {};
  if (Array.isArray(params.slots) && params.slots.length > 0) {
    return params.slots.map((slot) => ({
      x: Number(slot.x) || 0,
      y: Number(slot.y) || 0,
      width: Number(slot.width) || 0,
      height: Number(slot.height) || 0
    }));
  }
  const count = Math.max(1, Math.round(Number(params.count) || 1));
  const margin = Number(params.margin) || 0;
  const area = params.area || {};
  const areaWidth = Number(area.width) || 0;
  const areaHeight = Number(area.height) || 0;
  if (params.layout === 'grid') {
    const columns = Math.max(1, Math.min(count, Math.round(Number(params.columns) || Math.ceil(Math.sqrt(count)))));
    const rows = Math.ceil(count / columns);
    const width = Math.floor((areaWidth - margin * (columns - 1)) / columns);
    const height = Math.floor((areaHeight - margin * (rows - 1)) / rows);
    return Array.from({ length: count }, () => ({ width, height }));
  }
  if (params.layout === 'vertical') {
    const height = Math.floor((areaHeight - margin * (count - 1)) / count);
    return Array.from({ length: count }, () => ({ width: areaWidth, height }));
  }
  const width = Math.floor((areaWidth - margin * (count - 1)) / count);
  return Array.from({ length: count }, () => ({ width, height: areaHeight }));
}

const observedCardAspectRatio = 800 / 1216;
const ready = buildSkuCardTemplatePreparationPlan({
  projectPath: 'E:/fixture/project',
  requiredSizes: [2, 3, 4],
  notePlaceholderCount: 8,
  sourceCardAspectRatio: observedCardAspectRatio
});

assert(ready.status === 'ready_for_preparation', 'valid project and sizes should produce a template preparation plan', ready);
assert(ready.canRunPhotoshopWrites === true, 'ready plan should explicitly allow controlled Photoshop writes', ready);
assert(ready.templateOutputs.length === 6, '2/3/4 combo and note templates should be planned', ready);
assert(
  ready.templateOutputs.map((item) => item.relativePath).join('|') === [
    '模板文件/2双装-通用占位卡片模板v4.tif',
    '模板文件/2双自选备注-通用占位卡片模板v4.tif',
    '模板文件/3双装-通用占位卡片模板v4.tif',
    '模板文件/3双自选备注-通用占位卡片模板v4.tif',
    '模板文件/4双装-通用占位卡片模板v4.tif',
    '模板文件/4双自选备注-通用占位卡片模板v4.tif'
  ].join('|'),
  'template outputs should target the project template folder',
  ready
);

const createDocumentRequests = ready.toolRequests.filter((item) => item.toolName === 'createDocument');
const rectangleRequests = ready.toolRequests.filter((item) => item.toolName === 'createRectangle');
const textRequests = ready.toolRequests.filter((item) => item.toolName === 'createTextLayer');
const placeholderRequests = ready.toolRequests.filter((item) => item.toolName === 'createSkuPlaceholders');
const saveRequests = ready.toolRequests.filter((item) => item.toolName === 'saveDocument');
const snapshotRequests = ready.toolRequests.filter((item) => item.toolName === 'getAcceptanceSnapshot');

assert(createDocumentRequests.length === 6, 'each template should create its own Photoshop document', ready);
assert(rectangleRequests.length > 6, 'card templates should create visible background/card rectangles before placeholders', ready);
assert(textRequests.some((item) => item.params?.content === '买家留言自选4双'), 'note templates should include a user-facing self-select title', ready);
assert(textRequests.some((item) => item.params?.content === '4双装'), 'combo templates should include a compact SKU size label', ready);
assert(placeholderRequests.length === 6, 'each template should create SKU placeholders', ready);
assert(saveRequests.length === 6, 'each template should be saved explicitly', ready);
assert(snapshotRequests.length === 6, 'each template should be read back after save', ready);
assert(
  placeholderRequests.find((item) => item.templateKind === 'combo' && item.size === 4)?.params?.count === 4,
  'combo template placeholder count should match combo size',
  ready
);
assert(
  placeholderRequests.find((item) => item.templateKind === 'note' && item.size === 2)?.params?.count === 8,
  'note template placeholder count should use the note color count',
  ready
);
assert(
  placeholderRequests.every((item) => item.params?.area && Number(item.params.area.width) > 0 && Number(item.params.area.height) > 0),
  'card template placeholders should use an explicit content area instead of full-canvas padding',
  ready
);
assert(
  placeholderRequests.every((item) => item.params?.visible === false && item.params?.fillOpacity === 0),
  'card template placeholders should be hidden locator layers so they can guide placement without exporting',
  ready
);
assert(
  placeholderRequests.every((item) => Array.isArray(item.params?.slots) && item.params.slots.length === item.params.count),
  'card template placeholders should pass explicit slots from the Agent design plan instead of asking the tool to invent geometry',
  ready
);
assert(
  placeholderRequests.every((item) => Math.abs(Number(item.params?.sourceCardAspectRatio) - observedCardAspectRatio) < 0.001),
  'card template placeholders should retain the observed SKU card source aspect ratio in the plan',
  ready
);
assert(
  placeholderRequests.find((item) => item.templateKind === 'combo' && item.size === 4)?.params?.layout === 'horizontal' &&
    placeholderRequests.find((item) => item.templateKind === 'combo' && item.size === 4)?.params?.columns === 4,
  '4-pair combo card template should use a horizontal color-card row like the card-style SKU reference',
  ready
);
assert(
  placeholderRequests.find((item) => item.templateKind === 'combo' && item.size === 3)?.params?.layout === 'horizontal' &&
    placeholderRequests.find((item) => item.templateKind === 'combo' && item.size === 3)?.params?.columns === 3,
  '3-pair combo card template should keep the same horizontal card-row language as 2/4-pair templates',
  ready
);
assert(
  placeholderRequests.find((item) => item.templateKind === 'combo' && item.size === 2)?.params?.area?.y >= 220,
  '2-pair combo card template should be vertically centered instead of stuck near the top',
  ready
);
for (const request of placeholderRequests.filter((item) => item.templateKind === 'combo')) {
  const slots = enumeratePlaceholderSlots(request);
  const badSlots = slots.filter((slot) => {
    const ratio = slot.width / Math.max(1, slot.height);
    return Math.abs(ratio - observedCardAspectRatio) > 0.08;
  });
  assert(
    badSlots.length === 0,
    'combo card image placeholders should follow the observed SKU color-card material ratio instead of using arbitrary square boxes',
    { size: request.size, request: request.params, slots, badSlots }
  );
  const outsideSlots = slots.filter((slot) => {
    const area = request.params.area;
    return slot.x < area.x
      || slot.y < area.y
      || slot.x + slot.width > area.x + area.width
      || slot.y + slot.height > area.y + area.height;
  });
  assert(
    outsideSlots.length === 0,
    'explicit SKU placeholder slots should stay inside their design content area',
    { size: request.size, request: request.params, slots, outsideSlots }
  );
}
assert(
  placeholderRequests.find((item) => item.templateKind === 'note' && item.size === 4)?.params?.area?.y >= 300,
  'self-select note placeholders should leave upper space for title and remark guidance',
  ready
);
assert(
  saveRequests.every((item) => item.params?.format === 'tiff' && item.params?.saveAs === true),
  'templates should save as explicit TIFF files without opening save dialogs',
  ready
);
assert(!JSON.stringify(ready).includes('C-1194'), 'plan must not hardcode the exam project path', ready);
assert(!JSON.stringify(ready).includes('C-1137'), 'plan must not hardcode the reference project path', ready);

const blockedProject = buildSkuCardTemplatePreparationPlan({
  projectPath: '',
  requiredSizes: [2, 3, 4]
});
assert(blockedProject.status === 'blocked_missing_project_path', 'missing project path should block template preparation', blockedProject);
assert(blockedProject.canRunPhotoshopWrites === false, 'blocked plan must not allow writes', blockedProject);
assert(blockedProject.toolRequests.length === 0, 'blocked plan must not include tool requests', blockedProject);

const blockedSizes = buildSkuCardTemplatePreparationPlan({
  projectPath: 'E:/fixture/project',
  requiredSizes: []
});
assert(blockedSizes.status === 'blocked_missing_required_sizes', 'missing required sizes should block template preparation', blockedSizes);
assert(blockedSizes.toolRequests.length === 0, 'missing sizes should not produce write requests', blockedSizes);

console.log(JSON.stringify({
  ok: true,
  readyStatus: ready.status,
  outputs: ready.templateOutputs.length,
  blockedProjectStatus: blockedProject.status,
  blockedSizesStatus: blockedSizes.status
}, null, 2));
