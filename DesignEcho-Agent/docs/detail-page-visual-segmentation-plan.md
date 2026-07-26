# Detail Page Visual Segmentation Plan

## Goal

Make messy detail-page templates workable even when the PSD folder structure is unreliable.

The target is not "guess from screenshots". The target is:

1. Read the current PSD as a document model.
2. Infer visual modules from geometry, clipping, text, and raster cues.
3. Rebuild screen boundaries and module ownership.
4. Feed that result into the existing detail-page planning and execution chain.

## Current Ground Truth

The current project already has the foundations needed for this work:

1. Structure parsing exists.
   - `parseDetailPageTemplate`
   - `detail-page-parser.ts`

2. Visual correction already exists, but only as a secondary fix-up.
   - `reassignByVisualBounds(...)`

3. Layout statistics already exist.
   - alignment groups
   - density
   - balance score
   - image/copy area ratios

4. Runtime truth reconstruction already exists.
   - live placement reconstruction
   - placement audit
   - copy layout audit

5. Pixel extraction already exists and does not depend on viewport position.
   - document/screen snapshots
   - `imaging.getPixels(...)`

This means the project is not missing capability. It is missing one stage in the pipeline.

## Three Candidate Approaches

### Option A: Structure First, Visual Correction

Flow:

1. Parse screens from groups.
2. Parse placeholders from structure.
3. Use visual bounds to fix obvious mistakes.
4. Continue with screen planning and fill.

Pros:

1. Lowest implementation cost.
2. Reuses almost all current code.
3. Easy to debug.

Cons:

1. Still assumes top-level screens are mostly correct.
2. Weak when the PSD has poor grouping.
3. Cannot recover well when screen boundaries are wrong from the start.

When it works:

1. Structured templates
2. Semi-structured templates

When it fails:

1. Messy templates with good visual layout but bad folder structure

### Option B: Visual First

Flow:

1. Ignore the current screen grouping.
2. Infer visual modules from layer geometry and raster cues.
3. Build screens from modules.
4. Derive placeholders from modules.
5. Continue with planning and fill.

Pros:

1. Best theoretical fit for messy templates.
2. Matches real visual organization.

Cons:

1. High implementation and validation cost.
2. Harder to explain and debug.
3. Current pipeline still assumes screens already exist, so this would force a larger rewrite.

When it works:

1. Highly chaotic PSDs

When it fails:

1. Over-complexity relative to current product maturity
2. Weak maintainability if introduced too early

### Option C: Dual-Channel Hybrid

Flow:

1. Run structure parsing.
2. Run visual module clustering.
3. Fuse both results with explicit rules.
4. Produce refined screens, placeholders, and confidence.
5. Continue with the existing screen plan, content matching, fill, and audits.

Pros:

1. Best fit for the current codebase.
2. No rewrite of the filler/runtime chain.
3. Keeps explanations and audits possible.
4. Lets us compare structure truth and visual truth side by side.

Cons:

1. More complex than Option A.
2. Needs a clear merge contract.

When it works:

1. Structured templates
2. Semi-structured templates
3. Messy templates, if the visual layout is still coherent

## Recommended Approach

Use **Option C: Dual-Channel Hybrid**.

Reason:

1. The current parser already has visual reassignment logic, so the architecture already accepts mixed reasoning.
2. The current pipeline already has stable downstream stages:
   - layout graph
   - screen plan
   - content match
   - fill
   - live audits
3. Pure visual-first would require replacing too much of the current control flow.
4. Pure structure-first is not enough for the messy templates we now care about.

This is not a fallback strategy. It is a **two-source decision model**:

1. Structure gives one interpretation.
2. Visual clustering gives another interpretation.
3. The system merges them explicitly and records confidence and disagreements.

## What "Visual Module" Means

A visual module is a coherent content block on the page, usually containing some combination of:

1. main image
2. text layers
3. decorative elements
4. background or shape container

A module should answer:

1. Which layers belong together visually?
2. What is the main image in this block?
3. What text belongs to this block?
4. What is the likely purpose of the block?

## Visual Signals to Use

The first implementation should rely on signals the project already exposes:

1. layer bounds
2. parent/path ids
3. clipping relationships
4. z-order
5. text presence and font size
6. whitespace gaps
7. alignment groups
8. image/copy area ratios

Raster signals should be added only where needed:

1. large horizontal whitespace bands
2. strong background changes
3. module background continuity

Do not start with a pure image segmentation model.

## New Stage to Add

Insert a new stage between:

1. `parseDetailPageTemplate`
2. `buildDetailPageLayoutGraphs` / `inferDetailScreenPlans`

New stage:

1. `buildVisualModuleClusters`
2. `refineScreensWithVisualModules`

Outputs:

1. refined screen boundaries
2. module clusters
3. placeholder-to-module mapping
4. structure-vs-visual disagreement report

## Suggested Data Contracts

### VisualModule

```ts
type DetailVisualModule = {
  id: string;
  bounds: Bounds;
  layerIds: number[];
  mainImageLayerId: number | null;
  textLayerIds: number[];
  elementLayerIds: number[];
  backgroundLayerIds: number[];
  confidence: number;
  reasons: string[];
};
```

### RefinedScreen

```ts
type DetailRefinedScreen = {
  id: string;
  bounds: Bounds;
  sourceScreenId: number | null;
  moduleIds: string[];
  confidence: number;
  disagreementFlags: string[];
};
```

## MCP Tools to Add First

The first MCP layer should be diagnostic, not fully generative.

1. `detail.inspect_visual_modules`
2. `detail.inspect_screen_boundaries`
3. `detail.audit_segmentation_merge`
4. `detail.capture_visual_context_bundle`

Purpose:

1. verify what the system thinks a module is
2. verify where screen boundaries are
3. compare structure parsing with visual clustering
4. feed module-level context into later planning

## Validation Strategy

Do not ship this by intuition. Validate on a fixed PSD set.

Suggested baseline:

1. 4 structured templates
2. 4 semi-structured templates
3. 4 messy templates

Measure:

1. screen boundary accuracy
2. module ownership accuracy
3. image-to-module correctness
4. copy-to-module correctness
5. guarded screen rate
6. post-fill risky placement rate

The hybrid route is worth keeping only if it materially improves messy templates without degrading structured ones.

## Success Criteria

For messy templates:

1. module ownership accuracy >= 75%
2. wrong-module rate reduced by at least 30%
3. guarded screen rate reduced by at least 30%

For structured templates:

1. no meaningful regression in placement audit
2. no meaningful regression in copy audit

## Implementation Order

### Phase 1

1. Define `DetailVisualModule`
2. Define `DetailRefinedScreen`
3. Implement geometry-first clustering
4. Expose diagnostic MCP tools

### Phase 2

1. Merge structure and visual results
2. Feed refined screens into `screenPlan`
3. Feed module signals into content matching

### Phase 3

1. Add selective raster cues for ambiguous cases
2. Add module-level visual context bundles for planning

## Non-Goals

1. Do not replace the existing filler.
2. Do not replace live placement reconstruction.
3. Do not turn this into a screenshot-driven black box.
4. Do not hide parser mistakes with silent fallback logic.

## Final Position

The most suitable route for the current project is:

**Structure parsing + visual module clustering + explicit merge.**

That gives the project:

1. better messy-template handling
2. maintainable debugging
3. compatibility with the current detail-page executor
4. measurable validation through MCP
