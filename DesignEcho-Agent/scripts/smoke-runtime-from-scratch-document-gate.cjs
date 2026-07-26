#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * 从零设计死锁修复守护：runtimeDesignTaskRequiresOpenDocument 是"无文档(documentState:'absent')时
 * 是否放行 R2、推进去 E1 建画布"的唯一判据。红线双向锁：
 *   - 从零 workMode（create_new / template_fill / 无 work_mode 的创意清单）→ requiresOpenDocument=false
 *     → 无文档可当作"已确认空画布起点"合法观察，继续建画布。
 *   - 需文档 workMode（edit_existing / redesign / analyze_only / export_only，required existing_document）
 *     → requiresOpenDocument=true → 无文档必须仍记 R2 failed（如实失败，保留"先观察既有文档"纪律），
 *       绝不能被误当从零而静默新建空白画布。
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(ROOT, 'tsconfig.main.json')
});

const {
  buildRuntimeStagePlan,
  runtimeDesignTaskRequiresOpenDocument
} = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts'));
const { DETAIL_PAGE_MANIFEST } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'detail-page.manifest.ts'));
const { MAIN_IMAGE_MANIFEST } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'main-image.manifest.ts'));
const { GENERAL_DESIGN_MANIFEST } = require(path.join(ROOT, 'src', 'shared', 'agent-runtime-v5', 'manifests', 'general-design.manifest.ts'));

const detailPlan = buildRuntimeStagePlan(DETAIL_PAGE_MANIFEST);
const mainImagePlan = buildRuntimeStagePlan(MAIN_IMAGE_MANIFEST);
const generalPlan = buildRuntimeStagePlan(GENERAL_DESIGN_MANIFEST);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

// ——— 从零 workMode：不需要已打开文档 → 无文档时放行推进 ———
check('detail-page create_new = 从零（不需要已打开文档）', () => {
  assert.strictEqual(runtimeDesignTaskRequiresOpenDocument(detailPlan, 'create_new'), false);
});
check('detail-page template_fill = 从零（模板来自文件而非已打开文档）', () => {
  assert.strictEqual(runtimeDesignTaskRequiresOpenDocument(detailPlan, 'template_fill'), false);
});

// ——— 需文档 workMode：必须要求已打开文档 → 无文档时绝不放行（红线） ———
for (const workMode of ['edit_existing', 'redesign', 'analyze_only', 'export_only']) {
  check(`detail-page ${workMode} = 需已打开文档（红线：无文档必须仍失败）`, () => {
    assert.strictEqual(
      runtimeDesignTaskRequiresOpenDocument(detailPlan, workMode),
      true,
      `${workMode} 要求 existing_document(→photoshop_document)，无文档时不得被误当从零`
    );
  });
}

// ——— 无 work_mode 的创意清单：主图/海报天然从零 ———
check('main-image（无 workMode，默认契约）= 从零', () => {
  assert.strictEqual(runtimeDesignTaskRequiresOpenDocument(mainImagePlan, undefined), false);
});
check('general-design（无 workMode）= 从零', () => {
  assert.strictEqual(runtimeDesignTaskRequiresOpenDocument(generalPlan, undefined), false);
});

// ——— 边界：undefined plan、未知 workMode ———
check('undefined plan → false（不误判、不崩）', () => {
  assert.strictEqual(runtimeDesignTaskRequiresOpenDocument(undefined, 'create_new'), false);
});
check('detail-page 未声明 workMode（undefined）走默认契约、不崩', () => {
  assert.strictEqual(typeof runtimeDesignTaskRequiresOpenDocument(detailPlan, undefined), 'boolean');
});

// ——— 结构性：判据只看"必需输入是否来源于 photoshop_document"，与关键词无关 ———
check('判据 category-neutral：换 skill_id 不改变结论（只认 input 来源）', () => {
  const forged = buildRuntimeStagePlan({ ...DETAIL_PAGE_MANIFEST, skill_id: 'x.forged', task_type: 'x.forged.v1' });
  assert.strictEqual(runtimeDesignTaskRequiresOpenDocument(forged, 'create_new'), false);
  assert.strictEqual(runtimeDesignTaskRequiresOpenDocument(forged, 'edit_existing'), true);
});

console.log(`\n✅ runtime-from-scratch-document-gate smoke 全部通过（${passed} 项）`);
