# Image Placement Core MVP

## Purpose

Image Placement Core is the shared planning and verification boundary for placing product images into Photoshop design slots.

It exists because main image, detail page, SKU, and reference replication all need the same basic capability:

1. understand the source image size and optional subject bounds;
2. understand the target slot, safe area, design type, asset role, and intent;
3. compute a conservative placement plan through the existing smart scaling policy;
4. require Photoshop readback evidence after execution;
5. separate planned geometry from actual Photoshop results.

This is an Agent OS infrastructure layer, not a business skill.

## Current Implementation

- Shared module: `src/shared/design-image-placement-core.ts`
- Smoke test: `smoke:image-placement:core`
- Version: `image-placement-core/v0`
- Reused dependency: `computeSmartScalingDecision` from `src/shared/design-smart-scaling-policy.ts`

The MVP exports:

- `buildImagePlacementPlan`
- `verifyImagePlacement`
- `formatImagePlacementCorePolicyForPlanner`

## Evidence Boundary

The core distinguishes these evidence tiers:

- `metadata`: source dimensions and target slot only.
- `subject-bounds`: source dimensions plus real subject bounds.
- `bounds`: Photoshop execution readback returned actual bounds.
- `screenshot`: screenshot review evidence exists.

Metadata-only planning can be useful for speed, but it must stay `needs_review`. It cannot claim subject-level aesthetic placement.

## Speed Policy

The default path should be cheap:

1. use metadata and cached subject bounds when available;
2. avoid full-resolution reads in the planning stage;
3. only request screenshot QA for high crop risk, low confidence, or final acceptance;
4. keep multi-screen detail page tasks from running unbounded per-image visual checks.

## Quality Policy

The core can plan geometry, but quality still needs evidence:

1. `destinationBox` is only a plan.
2. `actualBounds` must be read from Photoshop after execution.
3. A close bounds match proves geometry only; it does not prove crop aesthetics, product visibility, or overall design quality.
4. Screenshot evidence can fail the placement even if bounds are close.
5. Full design quality still requires screen/page-level QA and, for important cases, manual review.

## Stability Policy

The core deliberately does not call Photoshop, models, or business skill executors.

This avoids changing existing execution behavior before the user aligns the business skill design rules for:

- `main-image-design`
- `detail-page-design`
- `sku-batch`

Business skills may later consume this core, but that must be a separate user checkpoint because it can change real design output.

## Current Non-Goals

- It does not choose the best image from a project.
- It does not detect product category, material, style, or selling points.
- It does not replace UXP tools such as `placeImage`, `replaceImagePlaceholder`, `fillDetailPage`, or `transformLayer`.
- It does not prove detail page, main image, SKU, or reference replication design quality.
- It does not solve Photoshop viewport focusing or live user-visible execution tracking.

## Next Gates

1. Add an adapter report that compares existing detail-page/main-image placement evidence against this core without changing execution.
2. Align with the user before wiring any of the three business skills to this core.
3. Build live disposable Photoshop cases for:
   - subject bounds available;
   - subject bounds missing;
   - crop risk high;
   - locked or nested target layer;
   - screenshot review failed.
4. Only after those cases pass should business skill execution paths consume this core by default.
