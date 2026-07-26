# SKU Card Asset Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the non-hardcoded project asset understanding and SKU card candidate layer required before card-style SKU production.

**Architecture:** Keep user requirements out of shared code constants. Shared code should expose generic project asset classification, SKU card candidate scoring, evidence, and executor preflight data. The `E:\DesignEchoDemo\C-1194` project is only used by an exam script or runtime parameter, never as a product-code default.

**Tech Stack:** TypeScript shared helpers, existing `ts-node` smoke scripts, `ProjectAssetIndex`, `ProjectVisualSamplingPlan`, `sku-batch.executor.ts`, Node.js script checks, optional `sharp` metadata probing for exam scripts.

---

## Requirement Boundary

User requirements:

- Current exam project is `E:\DesignEchoDemo\C-1194`.
- Reference finished project is `D:\DesignEchoDemo\C-1137`.
- Current SKU target is card-style color card, not pure-background retouch.
- Required specs are `2双装`, `3双装`, `4双装`, plus matching self-select notes.
- Agent must understand project images before choosing SKU images.
- Agent must run efficiently: metadata first, bounded visual evidence, batch execution, selective review.

Code requirements:

- Do not hardcode `E:\DesignEchoDemo\C-1194` or `D:\DesignEchoDemo\C-1137` in shared runtime code.
- Do not make `平铺` or `模特` a one-project rule; treat them as generic folder hints for product stills and model wearing shots.
- Keep card-style SKU behavior as a configurable business mode, not a branch that claims all SKU tasks are card-style forever.
- Keep pure-background retouch as blocked/deferred, not silently approximated.
- User-visible copy must explain the workflow in design terms, not internal tool terms.

## File Structure

- Modify: `src/shared/project-asset-index.ts`
  - Add generic folder hints for `平铺` and `模特`.
  - Improve SKU readiness so raw product stills can be SKU card candidates.

- Create: `src/shared/sku-card-asset-candidates.ts`
  - Build a SKU card candidate report from `ProjectAssetIndex` plus optional cached visual insight.
  - Score candidates without Photoshop and without full-image reading.

- Create: `scripts/smoke-sku-card-asset-candidates.cjs`
  - Unit-like smoke for candidate scoring, no project-specific paths.

- Modify: `scripts/smoke-project-asset-index.cjs`
  - Add fixture coverage for `平铺` and `模特` folder hints.

- Modify: `src/renderer/services/skill-executors/sku-batch.executor.ts`
  - Attach SKU card candidate evidence to result data and preparation diagnostics.
  - Do not change Photoshop write parameters yet.

- Create: `scripts/smoke-sku-card-preflight-wiring.cjs`
  - Assert `sku-batch` result data can carry SKU card candidate evidence without leaking internal labels to the message.

- Create: `scripts/run-sku-card-exam.cjs`
  - CLI-only exam helper. Accepts `--project` and `--reference`; writes a report under `tmp/`.
  - This is where `E:\DesignEchoDemo\C-1194` can be passed at runtime.

- Modify: `package.json`
  - Add scripts:
    - `smoke:sku:card-asset-candidates`
    - `smoke:sku:card-preflight-wiring`
    - `exam:sku:card`

## Task 1: Project Asset Index Folder Hints

**Files:**
- Modify: `src/shared/project-asset-index.ts`
- Modify: `scripts/smoke-project-asset-index.cjs`

- [ ] **Step 1: Write the failing smoke coverage**

Append these fixture files to `fixtureFiles()` in `scripts/smoke-project-asset-index.cjs`:

```js
{
  path: 'C:/fixture/6036 短筒圆点袜套 2.8元/平铺/sku-card-flat.jpg',
  relativePath: '6036 短筒圆点袜套 2.8元/平铺/sku-card-flat.jpg',
  width: 4284,
  height: 4284,
  sizeBytes: 12_000_000
},
{
  path: 'C:/fixture/6036 短筒圆点袜套 2.8元/模特/model-wear.jpg',
  relativePath: '6036 短筒圆点袜套 2.8元/模特/model-wear.jpg',
  width: 4284,
  height: 5712,
  sizeBytes: 13_000_000
}
```

Add these assertions after the existing role assertions:

```js
const flatAsset = index.assets.find((asset) => asset.relativePath.includes('平铺/sku-card-flat.jpg'));
assert(flatAsset?.folderRole === 'source', '平铺 folder should be treated as source material');
assert(flatAsset?.role === 'raw-product-still', '平铺 image should classify as raw product still');

const modelAsset = index.assets.find((asset) => asset.relativePath.includes('模特/model-wear.jpg'));
assert(modelAsset?.folderRole === 'source', '模特 folder should be treated as source material');
assert(modelAsset?.role === 'raw-model-wear', '模特 image should classify as model wearing shot');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run:

```powershell
npm run smoke:project-asset-index
```

Expected: FAIL because `平铺` and `模特` are currently not generic source hints.

- [ ] **Step 3: Implement generic folder hints**

In `src/shared/project-asset-index.ts`, update `inferFolderRole()` with these generic checks after the existing template/config checks:

```ts
    if (joined.includes('平铺')) return 'source';
    if (joined.includes('模特')) return 'source';
```

Update `inferImageRole()` before the `folderRole === 'source'` fallback:

```ts
    if (lowerPath.includes('/模特/')) {
        return { role: 'raw-model-wear', reasons: ['model folder image'], confidence: 0.78 };
    }
    if (lowerPath.includes('/平铺/')) {
        return { role: 'raw-product-still', reasons: ['flat-lay product folder image'], confidence: 0.78 };
    }
```

Update `skillReadiness()` so SKU candidates include raw product stills:

```ts
    const skuCandidates = roleCounts['color-single'] + roleCounts['raw-product-still'] + roleCounts['sku-output'];
```

- [ ] **Step 4: Run smoke and verify it passes**

Run:

```powershell
npm run smoke:project-asset-index
```

Expected: PASS.

- [ ] **Step 5: Commit this task if committing is allowed**

```powershell
git add src/shared/project-asset-index.ts scripts/smoke-project-asset-index.cjs
git commit -m "feat: classify flat-lay images for SKU card candidates"
```

If the workspace has unrelated dirty changes, do not commit; report the exact touched files instead.

## Task 2: SKU Card Candidate Scoring Helper

**Files:**
- Create: `src/shared/sku-card-asset-candidates.ts`
- Create: `scripts/smoke-sku-card-asset-candidates.cjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing smoke script**

Create `scripts/smoke-sku-card-asset-candidates.cjs`:

```js
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
  buildSkuCardAssetCandidateReport
} = require('../src/shared/sku-card-asset-candidates.ts');

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

function asset(id, relativePath, role, width, height, confidence = 0.78) {
  return {
    id,
    path: `C:/fixture/${relativePath}`,
    relativePath,
    name: relativePath.split('/').pop(),
    extension: '.jpg',
    sizeBytes: 10_000_000,
    width,
    height,
    aspectRatio: width && height ? width / height : undefined,
    folderRole: 'source',
    role,
    comboColors: [],
    isImage: true,
    isDesignDocument: false,
    isOutput: false,
    needsVision: true,
    confidence,
    reasons: ['fixture'],
    evidence: []
  };
}

const report = buildSkuCardAssetCandidateReport({
  assetIndex: {
    indexVersion: 'project-asset-index/v0',
    generatedFrom: 'file-metadata',
    summary: {
      totalFiles: 4,
      totalImages: 4,
      totalDesignDocuments: 0,
      roleCounts: {},
      folderRoleCounts: {},
      extensionCounts: { '.jpg': 4 },
      colorNames: [],
      skuConfigCount: 0
    },
    assets: [
      asset('flat-square', '6036/平铺/flat-square.jpg', 'raw-product-still', 4284, 4284),
      asset('model', '6036/模特/model.jpg', 'raw-model-wear', 4284, 5712),
      asset('detail', '6036/平铺/detail-close.jpg', 'raw-detail-closeup', 4284, 4284),
      asset('output', 'SKU/2双装/old.jpg', 'sku-output', 800, 800)
    ],
    representativeSamples: {},
    visionCandidates: [],
    skillReadiness: [],
    warnings: [],
    limitations: [],
    evidence: []
  },
  maxCandidates: 3
});

assert(report.version === 'sku-card-asset-candidates/v0', 'version mismatch', report);
assert(report.mode === 'card-style', 'mode should be card-style', report);
assert(report.candidates.length === 3, 'report should cap candidates and exclude SKU output', report);
assert(report.candidates[0].assetId === 'flat-square', 'flat square product still should rank first', report);
assert(report.candidates.some((item) => item.assetId === 'model' && item.recommendedUse === 'reference_only'), 'model image should be reference only', report);
assert(report.blockers.length === 0, 'fixture should not be blocked', report);
assert(report.limitations.some((line) => line.includes('不读取图片像素')), 'limitations should state no pixel reads', report);
assert(!JSON.stringify(report).includes('E:\\\\WERKE\\\\C-1194'), 'shared report must not hardcode exam project path');

console.log(JSON.stringify({
  ok: true,
  top: report.candidates[0],
  candidateCount: report.candidates.length
}, null, 2));
```

Add package script:

```json
"smoke:sku:card-asset-candidates": "node scripts/smoke-sku-card-asset-candidates.cjs"
```

- [ ] **Step 2: Run smoke and verify it fails**

Run:

```powershell
npm run smoke:sku:card-asset-candidates
```

Expected: FAIL with module not found for `sku-card-asset-candidates.ts`.

- [ ] **Step 3: Implement candidate helper**

Create `src/shared/sku-card-asset-candidates.ts`:

```ts
import type { EvidenceRef } from './design-agent-os-contracts';
import type { ProjectAssetIndex, ProjectAssetIndexAsset, ProjectAssetRole } from './project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';

export type SkuCardAssetCandidateVersion = 'sku-card-asset-candidates/v0';
export type SkuCardAssetCandidateMode = 'card-style';
export type SkuCardRecommendedUse = 'primary_sku_card' | 'secondary_sku_card' | 'reference_only' | 'reject';

export interface SkuCardAssetCandidate {
    assetId: string;
    path: string;
    relativePath: string;
    role: ProjectAssetRole;
    score: number;
    recommendedUse: SkuCardRecommendedUse;
    needsVisualConfirmation: boolean;
    reasons: string[];
    warnings: string[];
}

export interface SkuCardAssetCandidateReport {
    version: SkuCardAssetCandidateVersion;
    mode: SkuCardAssetCandidateMode;
    status: 'ready_for_selection' | 'needs_visual_confirmation' | 'blocked_no_candidates';
    candidateCount: number;
    candidates: SkuCardAssetCandidate[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface BuildSkuCardAssetCandidateReportInput {
    assetIndex?: ProjectAssetIndex | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
    maxCandidates?: number;
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return normalizeText(value).replace(/\\/g, '/');
}

function hasPathHint(asset: ProjectAssetIndexAsset, hint: string): boolean {
    return normalizePath(asset.relativePath || asset.path).includes(hint);
}

function squareScore(asset: ProjectAssetIndexAsset): number {
    const width = Number(asset.width || 0);
    const height = Number(asset.height || 0);
    if (width <= 0 || height <= 0) return 0;
    const ratio = width / height;
    if (ratio >= 0.92 && ratio <= 1.08) return 14;
    if (ratio >= 0.75 && ratio <= 1.35) return 8;
    return -6;
}

function roleBaseScore(role: ProjectAssetRole): number {
    switch (role) {
        case 'color-single':
            return 72;
        case 'raw-product-still':
            return 68;
        case 'raw-detail-closeup':
            return 38;
        case 'raw-model-wear':
            return 12;
        default:
            return 0;
    }
}

function recommendedUseFromScore(role: ProjectAssetRole, score: number): SkuCardRecommendedUse {
    if (role === 'raw-model-wear') return 'reference_only';
    if (score >= 76) return 'primary_sku_card';
    if (score >= 56) return 'secondary_sku_card';
    if (score >= 24) return 'reference_only';
    return 'reject';
}

function scoreAsset(asset: ProjectAssetIndexAsset): SkuCardAssetCandidate | null {
    if (!asset.isImage || asset.isOutput) return null;
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = roleBaseScore(asset.role);

    if (score <= 0) return null;

    if (hasPathHint(asset, '平铺')) {
        score += 18;
        reasons.push('平铺素材更适合 SKU 卡片选图。');
    }
    if (hasPathHint(asset, '模特')) {
        score -= 16;
        reasons.push('模特图更适合主图或详情页，SKU 卡片中只作为参考。');
    }

    const sq = squareScore(asset);
    score += sq;
    if (sq > 0) reasons.push('图片比例适合卡片裁切。');
    if (sq < 0) warnings.push('图片比例可能需要较大裁切。');

    score += Math.round(Number(asset.confidence || 0) * 6);

    const recommendedUse = recommendedUseFromScore(asset.role, score);
    if (recommendedUse === 'reject') {
        warnings.push('当前证据不足，不建议作为 SKU 卡片主素材。');
    }

    return {
        assetId: asset.id,
        path: asset.path,
        relativePath: asset.relativePath,
        role: asset.role,
        score,
        recommendedUse,
        needsVisualConfirmation: recommendedUse !== 'reject',
        reasons,
        warnings
    };
}

export function buildSkuCardAssetCandidateReport(
    input: BuildSkuCardAssetCandidateReportInput
): SkuCardAssetCandidateReport {
    const maxCandidates = Math.max(1, Math.min(12, Number(input.maxCandidates || 8)));
    const assets = Array.isArray(input.assetIndex?.assets) ? input.assetIndex.assets : [];
    const candidates = assets
        .map(scoreAsset)
        .filter((item): item is SkuCardAssetCandidate => Boolean(item))
        .filter((item) => item.recommendedUse !== 'reject')
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return normalizePath(left.relativePath).localeCompare(normalizePath(right.relativePath), 'zh-Hans-CN');
        })
        .slice(0, maxCandidates);

    const blockers = candidates.length === 0 ? ['项目素材中没有识别到适合 SKU 卡片的候选图。'] : [];
    const needsVisual = candidates.some((candidate) => candidate.needsVisualConfirmation);
    return {
        version: 'sku-card-asset-candidates/v0',
        mode: 'card-style',
        status: blockers.length > 0 ? 'blocked_no_candidates' : needsVisual ? 'needs_visual_confirmation' : 'ready_for_selection',
        candidateCount: candidates.length,
        candidates,
        blockers,
        warnings: needsVisual ? ['SKU 卡片候选仍需视觉模型或人工确认主体完整度、颜色清晰度和裁切风险。'] : [],
        limitations: [
            'SKU card candidate report uses metadata, path hints and existing cached evidence only.',
            '候选报告不读取图片像素，不调用 Photoshop，不声明最终设计质量。',
            '纯色背景 SKU 色卡精修不属于当前卡片式候选选择范围。'
        ],
        evidence: [{
            source: 'sku-card-asset-candidates',
            summary: `Selected ${candidates.length} card-style SKU candidates from ${assets.length} indexed assets.`,
            status: candidates.length > 0 ? 'needs_review' : 'unknown'
        }]
    };
}
```

- [ ] **Step 4: Run smoke and verify it passes**

Run:

```powershell
npm run smoke:sku:card-asset-candidates
```

Expected: PASS.

- [ ] **Step 5: Commit this task if committing is allowed**

```powershell
git add src/shared/sku-card-asset-candidates.ts scripts/smoke-sku-card-asset-candidates.cjs package.json
git commit -m "feat: add SKU card asset candidate scoring"
```

If the workspace has unrelated dirty changes, do not commit; report the exact touched files instead.

## Task 3: SKU Batch Preflight Evidence Wiring

**Files:**
- Modify: `src/renderer/services/skill-executors/sku-batch.executor.ts`
- Create: `scripts/smoke-sku-card-preflight-wiring.cjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing smoke script**

Create `scripts/smoke-sku-card-preflight-wiring.cjs`:

```js
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const executorPath = path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const source = fs.readFileSync(executorPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  source.includes("sku-card-asset-candidates"),
  'sku-batch executor should import the SKU card asset candidate helper'
);
assert(
  source.includes("skuCardAssetCandidateReport"),
  'sku-batch executor should expose skuCardAssetCandidateReport in result data'
);
assert(
  source.includes("buildSkuCardAssetCandidateReport"),
  'sku-batch executor should build SKU card asset candidates from project context'
);
assert(
  !/E:\\\\WERKE\\\\C-1194/.test(source),
  'sku-batch executor must not hardcode the C-1194 exam project path'
);

console.log(JSON.stringify({ ok: true }, null, 2));
```

Add package script:

```json
"smoke:sku:card-preflight-wiring": "node scripts/smoke-sku-card-preflight-wiring.cjs"
```

- [ ] **Step 2: Run smoke and verify it fails**

Run:

```powershell
npm run smoke:sku:card-preflight-wiring
```

Expected: FAIL because the executor does not yet import or expose the candidate report.

- [ ] **Step 3: Wire the helper without changing Photoshop writes**

In `src/renderer/services/skill-executors/sku-batch.executor.ts`, add import:

```ts
import { buildSkuCardAssetCandidateReport } from '../../../shared/sku-card-asset-candidates';
```

After project context is available, build evidence:

```ts
        const skuCardAssetCandidateReport = buildSkuCardAssetCandidateReport({
            assetIndex: projectContext?.assetIndex,
            visualInsightCache: projectContext?.visualInsightCache,
            maxCandidates: 8
        });
```

Attach it to result data in every successful or blocked SKU result that already includes structured diagnostics:

```ts
skuCardAssetCandidateReport,
```

Do not use this report to alter `skuLayout` parameters in this task. This task only exposes preparation evidence.

- [ ] **Step 4: Run smoke and verify it passes**

Run:

```powershell
npm run smoke:sku:card-preflight-wiring
```

Expected: PASS.

- [ ] **Step 5: Run existing SKU safety smokes**

Run:

```powershell
npm run smoke:sku:design-preflight
npm run smoke:sku:configured-execution-plan
npm run smoke:sku:visual-review-intake
npm run smoke:ui:user-facing-language-boundary
```

Expected: all PASS. The final user-visible message must not mention `ProjectAssetIndex`, `VisualSamplingPlan`, `skuLayout`, `configured execution plan`, or raw tool errors.

- [ ] **Step 6: Commit this task if committing is allowed**

```powershell
git add src/renderer/services/skill-executors/sku-batch.executor.ts scripts/smoke-sku-card-preflight-wiring.cjs package.json
git commit -m "feat: expose SKU card candidate evidence"
```

If the workspace has unrelated dirty changes, do not commit; report the exact touched files instead.

## Task 4: Exam Script for C-1194 Without Hardcoding Runtime Code

**Files:**
- Create: `scripts/run-sku-card-exam.cjs`
- Modify: `package.json`

- [ ] **Step 1: Write the exam script**

Create `scripts/run-sku-card-exam.cjs`:

```js
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

const sharp = require('sharp');
const { buildProjectAssetIndex } = require('../src/shared/project-asset-index.ts');
const { buildSkuCardAssetCandidateReport } = require('../src/shared/sku-card-asset-candidates.ts');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function assertProjectPath(value, label) {
  if (!value || !fs.existsSync(value)) {
    throw new Error(`${label} does not exist: ${value || '(empty)'}`);
  }
}

async function collectFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(absolutePath);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      const item = {
        path: absolutePath.replace(/\\/g, '/'),
        relativePath,
        name: entry.name,
        extension: path.extname(entry.name),
        sizeBytes: stat.size
      };
      if (/\.(jpg|jpeg|png|webp|tif|tiff)$/i.test(entry.name)) {
        try {
          const metadata = await sharp(absolutePath).metadata();
          item.width = metadata.width;
          item.height = metadata.height;
        } catch {
          item.probeFailed = true;
        }
      }
      files.push(item);
    }
  }
  return files;
}

async function run() {
  const project = argValue('--project');
  const reference = argValue('--reference');
  const out = argValue('--out') || path.join(__dirname, '..', 'tmp', 'sku-card-exam-report.json');
  assertProjectPath(project, '--project');
  if (reference) assertProjectPath(reference, '--reference');

  const files = await collectFiles(project);
  const assetIndex = buildProjectAssetIndex({
    projectPath: project.replace(/\\/g, '/'),
    projectName: path.basename(project),
    files
  });
  const skuCardAssetCandidateReport = buildSkuCardAssetCandidateReport({
    assetIndex,
    maxCandidates: 8
  });

  const report = {
    ok: skuCardAssetCandidateReport.candidateCount > 0,
    project,
    reference: reference || null,
    totals: {
      files: assetIndex.summary.totalFiles,
      images: assetIndex.summary.totalImages,
      designDocuments: assetIndex.summary.totalDesignDocuments
    },
    roleCounts: assetIndex.summary.roleCounts,
    folderRoleCounts: assetIndex.summary.folderRoleCounts,
    skuCardAssetCandidateReport,
    warnings: [
      ...assetIndex.warnings,
      ...skuCardAssetCandidateReport.warnings
    ],
    limitations: [
      'This exam reads project metadata and image dimensions only.',
      'It does not write Photoshop files or claim final SKU visual quality.'
    ]
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: report.ok,
    out,
    images: report.totals.images,
    candidates: skuCardAssetCandidateReport.candidateCount,
    topCandidates: skuCardAssetCandidateReport.candidates.slice(0, 5).map((item) => ({
      relativePath: item.relativePath,
      score: item.score,
      recommendedUse: item.recommendedUse
    }))
  }, null, 2));
  if (!report.ok) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Add package script:

```json
"exam:sku:card": "node scripts/run-sku-card-exam.cjs"
```

- [ ] **Step 2: Run generic smoke for the script with missing project**

Run:

```powershell
npm run exam:sku:card -- --project "Z:\missing"
```

Expected: FAIL with `--project does not exist`.

- [ ] **Step 3: Run the real C-1194 exam**

Run:

```powershell
npm run exam:sku:card -- --project "E:\DesignEchoDemo\C-1194" --reference "D:\DesignEchoDemo\C-1137" --out "tmp\sku-card-c1194-exam-report.json"
```

Expected: PASS and report at `tmp\sku-card-c1194-exam-report.json`.

Required report checks:

- `totals.images` is at least 50.
- `skuCardAssetCandidateReport.candidateCount` is greater than 0.
- Top candidates should primarily come from `平铺`.
- `模特` images should not rank as primary SKU card candidates.

- [ ] **Step 4: Commit this task if committing is allowed**

```powershell
git add scripts/run-sku-card-exam.cjs package.json
git commit -m "chore: add SKU card exam runner"
```

If the workspace has unrelated dirty changes, do not commit; report the exact touched files instead.

## Task 5: Verification Bundle

**Files:**
- No new files unless a previous task fails and requires a narrowly scoped fix.

- [ ] **Step 1: Run targeted smokes**

Run:

```powershell
npm run smoke:project-asset-index
npm run smoke:project-visual-sampling
npm run smoke:project-asset-understanding:intake
npm run smoke:sku:card-asset-candidates
npm run smoke:sku:card-preflight-wiring
npm run smoke:sku:design-preflight
npm run smoke:sku:configured-execution-plan
npm run smoke:sku:visual-review-intake
npm run smoke:skill-standard
```

Expected: all PASS.

- [ ] **Step 2: Run renderer typecheck**

Run:

```powershell
npm run build:typecheck:renderer
```

Expected: PASS.

- [ ] **Step 3: Run real exam evidence**

Run:

```powershell
npm run exam:sku:card -- --project "E:\DesignEchoDemo\C-1194" --reference "D:\DesignEchoDemo\C-1137" --out "tmp\sku-card-c1194-exam-report.json"
```

Expected: PASS with a candidate report that does not hardcode the project path inside shared code.

- [ ] **Step 4: Diff and encoding check**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors. Review diff manually to confirm Chinese text is readable and no mojibake was introduced.

## Self-Review

Spec coverage:

- Project material understanding: Task 1 and Task 2.
- SKU candidate image retrieval: Task 2 and Task 4.
- Avoid hardcoding C-1194: Requirement Boundary, Task 2 smoke, Task 3 smoke, Task 4 CLI-only exam.
- Efficiency: Task 2 metadata-only helper, Task 4 metadata/dimension scan, no full-image vision loop.
- SKU preflight: Task 3.
- Real exam: Task 4 and Task 5.
- Pure-background retouch deferred: Task 2 limitations and candidate report.

Plan scan:

- No unresolved planning marker language should be present in this plan.

Type consistency:

- `SkuCardAssetCandidateReport`, `buildSkuCardAssetCandidateReport`, and `skuCardAssetCandidateReport` are named consistently across tasks.
