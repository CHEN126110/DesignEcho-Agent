# Collaboration

## Current working mode

- project: `C:\DesignEcho`
- primary focus: DesignEcho architecture cleanup and design-agent capability building
- excluded for now: SKU architecture expansion

## Current active themes

1. agent / MCP / skill boundary cleanup
2. long-horizon project memory
3. design-core-first architecture
4. preventing internal debug behavior from leaking into user-facing flows
5. agent intent understanding and reducing hardcoded routing bias
6. sock shape-unification feasibility research (internal retouching operation, not a user-facing agent skill)
7. matting / subject-detection performance and resource optimization
8. project-level consolidation and master planning
9. external benchmark against design-native agents such as Lovart

## Latest confirmed decisions

1. Internal debug skills must not be reachable from ordinary user commands.
2. Some existing "skills" are actually thin operation wrappers and should eventually move closer to MCP/tool registry.
3. Project progress must not rely on chat memory alone.
4. We need a durable collaboration layer for long tasks, not just runtime product context.
5. We do not solve architectural defects with masking, fallback layering, or adversarial patches.
6. Sock shape unification is currently an internal retouching operation, not a user-facing agent skill.
7. Model-based actionable intent classification should be the primary path; deterministic routing should only remain as a narrow fallback.
8. Skill declarations need explicit routing metadata; description and whenToUse alone are not enough to become the routing truth source.
9. When the request is actionable but ambiguous, the agent should ask a short clarification question before acting.
10. Performance work must be based on real pipeline hotspots, not vague claims about "the model is slow".

## Latest completed work

1. Added explicit skill boundaries:
   - `kind`
   - `visibility`
2. Isolated `agent-panel-bridge` as internal debug.
3. Filtered internal/system skills out of user-facing summaries.
4. Added a smoke test for skill boundaries.
5. Created the long-horizon file stack in this folder.
6. Created the sock shape-unification research, feasibility, PixelCake study, and retrospective summary docs.
7. Audited the current sock shape-unification call paths and corrected the internal skill parameter contract drift.
8. Confirmed `enhanced-shape-morph` is the panel main path and corrected the audit record to reflect its existing Agent-side handler.
9. Split the panel main path into analyzer / planner / validator / executor services so future prototype work has a clean landing zone.
10. Fixed real parameter drift in sock shape unification:
    - `sockStyle` no longer falls back because of the wrong DOM selector
    - UI aliases are normalized (`boat/no-show`, `double-welt/double`, `fold/folded`, `foot/body`)
    - `quality`, `selectedRegions`, and `contentProtection` now have real consumption paths in the prototype main line
11. Added region analysis (`SockRegionAnalyzer`) into the prototype analyzer/planner/validator path for orientation, cuff analysis, and regional contour slicing.
12. Added skeleton-axis alignment into the prototype main line:
    - `align` now prefers `skeleton-axis` over pure bbox/center alignment when contours are available
    - `morph` now augments `region-aware` control pairs with skeleton anchors
13. Updated pipeline smoke so it now proves:
    - alignment path returns `skeleton-axis`
    - morph path returns `optimized-morphing:<quality>:region-aware+skeleton`
14. Reworked the agent intent chain so model classification is now the primary path for actionable requests:
    - `DesignAgentEngine` no longer pre-bypasses template authoring, font replace, or document management before classifier execution
    - `task-classifier` now builds its deterministic skill menu from the live skill registry instead of a hand-maintained parallel list
    - `autonomous-agent` now preserves classifier `skillId / mode / skillParams` instead of collapsing back to `inferSkillHint(userInput)`
15. Added `smoke:agent:intent-engine` to verify:
    - classifier prompt reads the live skill registry
    - detail-page template authoring no longer bypasses model classification
    - document close still works through deterministic fallback
    - autonomous-agent preserves model-recognized intent context
16. Added routing metadata support to skill declarations:
    - `intentSignals`
    - `negativeSignals`
    - `preconditions`
    - `supportedModes`
    - `parameterExtractionHints`
    - `retryPolicy`
    - `clarificationHints`
17. Wired `clarification_needed` into the agent main loop so the engine can return a short clarification question instead of guessing.
18. Updated classifier smoke so it now proves:
    - prompt includes routing metadata
    - clarification route is handled by the engine
19. Continued the cleanup with safe source-of-truth consolidation:
    - moved `normalizeSkillId` aliases into `src/shared/skill-routing.ts`
    - made `routing.ts` and `task-classifier.ts` consume the shared helper instead of keeping two drift-prone alias maps
    - moved `project-image-analysis` and `agent-panel-bridge` common default params into `src/shared/skill-param-defaults.ts`
20. Audited the `<think>` compatibility chain:
    - `thinking-extractor.ts` is still live in `model-service.ts` and cannot be removed yet
    - `stream-adapter.ts` is a half-dead streaming compatibility path, so only obviously unused imports were cleaned for now
21. Extended smoke coverage so it now proves:
    - shared skill-id normalization returns the expected canonical ids
    - deterministic fallback still preserves `project-image-analysis` defaults after the shared-defaults refactor
22. Completed the first performance audit for matting and subject detection:
    - confirmed the hot path bottlenecks are cumulative (export/copy, format conversion, serial YOLO+BiRefNet, heavy logs, result writeback)
    - added `DesignEcho-Agent/docs/matting-performance-review-and-plan.md`
23. Landed two low-risk performance fixes:
    - `smart-layout-service.ts` now requests binary mask output from `MattingService` and consumes `maskBuffer` directly instead of doing a `RAW_MASK` base64 round-trip inside the main process
    - `matting-service.ts` hot-path diagnostic logs now go through a debug gate and stay off by default unless `DESIGNECHO_MATTING_DEBUG=1`
24. Continued the performance work with two more low-risk changes:
    - export-side matting `quality` now affects export max edge (`fast=896`, `balanced=1024`, `quality=1280`) in the UXP export path and the panel matting handler
    - `subject-detection-service.ts` now also prefers binary mask output instead of forcing an internal `RAW_MASK` string round-trip
25. Completed a code-based implementation and reliability review for matting:
    - added `DesignEcho-Agent/docs/matting-implementation-and-reliability-review.md`
    - confirmed the real active models are `BiRefNet` and optional `YOLO-World` when `targetPrompt` is present
    - confirmed `quality` currently affects export/transfer/preprocess cost, not BiRefNet inference cost
    - confirmed `remove-background-by-selection` still does not truly consume `bbox` and still hardcodes `balanced`
    - confirmed `SubjectDetectionService` appears to be only partially wired (`setMattingService(...)` not found, `detectSubjectBounds(...)` not found in active call sites)
26. Corrected the selection matting path with low-risk changes:
    - `remove-background-by-selection` now accepts live `quality` instead of always forcing `balanced`
    - UXP now sends canonical `bbox` (Agent still accepts legacy `box`)
    - the selection box is converted into layer-local coordinates in the handler
    - `MattingService` now projects that box into final mask space and constrains the final mask to the user selection after inference
    - this is now a real selection-constrained postprocess path, but still not true selection-guided model inference
27. Audited the `DesignEcho-UXP` webpack performance warning:
    - added `C:\DesignEcho\DesignEcho-Agent\docs\uxp-webpack-warning-review.md`
    - confirmed the warning is real (`runtime.js` about 499727 bytes)
    - confirmed the main source is our own single-entry eager tool architecture (`src/index.ts -> ToolRegistry -> full tool registration`)
    - confirmed the practical risk is UXP cold-start / first-open overhead, not web download latency
    - confirmed the safest first optimization target is startup initialization behavior, not aggressive webpack code splitting
28. Continued the matting optimization on the UXP hot path:
    - `RemoveBackgroundTool` no longer forces layer groups straight into Base64 copy-export
    - added binary-first fallback for layer groups and for `getLayerImageDataBinary(...)` failure cases via `copyLayerAndExportBinary(...)`
    - refactored temp-document export so binary and Base64 copy-export share the same underlying export path
    - kept Base64 as compatibility fallback instead of removing it outright
29. Completed a project-level planning consolidation:
    - added `C:\DesignEcho\DesignEcho-Agent\docs\project-master-plan.md`
    - aligned the current priorities around:
      - agent intent/routing consolidation
      - image model management rebuild
      - matting pipeline reliability/performance work
      - design-core-first continuation
    - explicitly marked SKU expansion and sock shape-unification productization as paused from the main execution track
30. Landed the first safe slice of intent/routing truth-source consolidation:
    - added `decisionGuidance` to skill routing metadata so classifier-specific decision hints can live in `skill-declarations`
    - moved model-decision param hydration in `engine.ts` to the shared `skill-param-defaults.ts` path instead of a hardcoded skill-id list
    - made `sku-batch` defaults (`countPerSize`, `generateNotes`, `onlyNotes`) explicit in the skill declaration and reused the shared hydrator in deterministic routing
    - corrected declaration drift:
      - `detail-page-design` now explicitly allows `structureMode="inspect"`
      - core skills now carry route-critical decision guidance in the live registry
31. Updated the classifier prompt to consume the live registry more directly:
    - `task-classifier.ts` now renders `decisionGuidance` from skill metadata
    - removed the large hand-written special-rule blocks for detail/main-image/font/document/SKU/project-image routing
    - kept only generic guardrails for follow-up context and internal-debug isolation
32. Added Lovart benchmark conclusions into the master plan:
    - design flow over tool menu
    - visual-first editing
    - style consistency as a durable capability
    - text/visual structure separation
    - reference insight before generation
33. Verified the current slice with build and smoke:
    - `npm run build`
    - `npm run smoke:agent:intent-engine`
    - `npm run smoke:skill-boundaries`
    - `npm run smoke:document-management:skill`
    - `npm run smoke:text-font-replace:skill`
34. Landed the second safe slice of routing consolidation:
    - `routing.ts` now resolves deterministic skill matching through a single internal matcher instead of separately maintaining `inferSkillHint` and `fastDeterministicRoute`
    - deterministic fallback and autonomous hinting now share the same deterministic skill-recognition source for:
      - `matte-product`
      - `sku-batch`
      - `save-current-template`
      - `agent-panel-bridge`
      - existing detail/document/project-image routes
    - `buildDeterministicIntentMessage` and `buildAutonomousIntentMessage` no longer re-run most route predicates and now key primarily off resolved `skillId`
35. Extended smoke coverage for the second slice:
    - `smoke:agent:intent-engine` now verifies `inferSkillHint(...)` stays aligned with deterministic matching for matte / SKU note-only / save-template / debug-bridge
    - rebuild + smoke still pass after the routing consolidation
36. Landed the third safe slice of routing cleanup:
    - added `routing.thinkingMessages` to skill metadata
    - moved core skill deterministic/autonomous thinking copy out of `routing.ts` switch branches and into `skill-declarations.ts`
    - `routing.ts` now keeps only:
      - SKU note-only special message
      - generic fallback message
37. Extended smoke coverage for the third slice:
    - `smoke:agent:intent-engine` now verifies routing thinking messages still resolve correctly after moving to shared metadata
    - build + intent smoke + skill boundary smoke all still pass
38. Landed the fourth safe slice of routing cleanup:
    - added shared signal-matching helpers to `src/shared/skill-routing.ts`
    - `routing.ts` now starts consuming `intentSignals / negativeSignals` as executable metadata, not only prompt text
    - migrated the safest deterministic intents to metadata-first matching:
      - `matte-product`
      - `save-current-template`
      - `detail-page-template-authoring`
      - `main-image-template-authoring`
      - `agent-panel-bridge`
      - `text-font-replace`
      - `sku-batch`
    - kept `document-management`, `detail-page-design`, and `project-image-analysis` on local special handling for now
39. Extended smoke coverage for the fourth slice:
    - `smoke:agent:intent-engine` now verifies the shared signal matcher directly for template-save / detail-template / main-template / text-font and bridge negative matching
    - build + intent smoke + skill boundary smoke + text-font smoke all still pass
40. Landed the fifth safe slice of routing cleanup:
    - added `modeSignals` to routing metadata
    - `detail-page-design` inspect / execute split now starts resolving from shared metadata instead of local route regex ownership
41. Landed the sixth safe slice of routing cleanup:
    - `document-management` close / switch / list / create routing now starts resolving from shared metadata instead of local action regex ownership
    - route-local logic is kept only for document target extraction and save inference
42. Extended smoke coverage again:
    - `smoke:agent:intent-engine` now verifies shared metadata mode resolution for:
      - `detail-page-design`
      - `document-management`
    - after fixing the missing “列出当前文档” signal coverage, smoke is green again
43. Landed the seventh safe slice of routing cleanup:
    - `project-image-analysis` now routes through shared compound metadata matching instead of keeping local project-image regex ownership in `routing.ts`
    - added grouped routing signals to `src/shared/skill-routing.ts` so a skill can require AND-between-groups / OR-within-group
    - smoke now locks:
      - project-image positive match from project context + analysis request
      - generic style question does not get misrouted
      - uploaded single-image analysis does not get misrouted
44. Landed the eighth safe slice of routing cleanup:
    - moved `document-management` routing param extraction into shared executable helper code instead of leaving it inline in `routing.ts`
    - removed the dangerous route-local default that silently fell back to `create`
    - fixed the dangerous close behavior so unspecified close requests no longer flip to `save=true`
    - shared helper now covers:
      - close save preference inference
      - target document name sanitization
      - basic create width/height/name extraction
    - build + intent smoke + skill boundary smoke all still pass after the change

## Current open loops

1. Continue shrinking hardcoded routing in `routing.ts` and move more intent priors into skill metadata.
2. Continue moving thin operation skills toward MCP/tool-registry ownership.
3. Continue consolidating model-selection logic.
4. Continue separating design-core, skills, and executors.
5. Keep the sock shape-unification effort scoped as a feasibility study with explicit pass/fail gates.
6. Keep refining the now-split panel main path before expanding scope or promising algorithmic quality.
7. Keep validating that newly exposed UI parameters are actually consumed by the prototype and are not fake controls.
8. Keep checking whether skeleton integration is helping quality without over-weighting it or masking contour problems.
9. Continue migrating routing away from regex ownership and toward `skill-declarations` metadata.
10. Clean remaining display-layer remnants that still mention user-facing morphing capability inside Agent-side skill summaries.
11. Decide whether the dormant streaming path (`stream-handlers` / `preload` / `stream-chat.service`) should be formally removed or kept as an explicit compatibility subsystem, then clean it consistently.
12. Make matting `quality` a real cost/quality switch instead of a semantic label only.
13. Audit `RemoveBackgroundTool` fallback paths so binary export remains the primary path and Base64 does not silently dominate.
14. Review whether `MattingService` needs an explicit queue / concurrency guard before more features reuse it.
15. Decide whether export-side quality control is sufficient for now or whether the fixed-input BiRefNet model needs a separate fast-path design.
16. Decide whether `remove-background-by-selection` should become a real selection-constrained path or be simplified so the API no longer claims that behavior.
17. Decide whether `SubjectDetectionService` should be fully wired or explicitly retired from the active architecture.
18. Audit the heavy group-layer `copyLayerAndExport()` fallback before touching ONNX inference tuning again.
19. Decide whether the next selection-matting step should crop/export by bbox earlier to reduce wasted full-layer inference work.
20. Decide whether `ToolRegistry` should move to delayed initialization or lazy registration before any webpack chunk-splitting work.
21. Decide whether low-frequency heavy UXP tools can be removed from the startup hot path without changing tool semantics.
22. Continue auditing whether UXP matting fallbacks can be reduced further without breaking group-layer exports or older Base64-only call paths.
23. Execute the new master plan in order instead of advancing all tracks in parallel.
24. Keep architecture cleanup and user-facing reliability ahead of new workflow expansion.
25. Continue migrating remaining deterministic regex ownership out of `routing.ts` without regressing existing business workflows.
26. Decide how far `decisionGuidance` should replace prompt-local rules before moving to the next consolidation slice.
27. Decide whether the next routing slice should target:
    - deterministic regex ownership itself
    - or the remaining hardcoded user-facing thinking/progress messages
28. The remaining largest routing residue is now the regex/pattern ownership itself.
29. After the shared signal matcher landed, the next high-value residue is the local special handling for:
    - `document-management`
    - `detail-page-design`
    - `project-image-analysis`
30. After the latest slices, the largest remaining local special handling is now:
    - `project-image-analysis`
    - document target extraction details in `document-management`
    - residual fallback regex that still exists for compatibility

## Next concrete action

The next meaningful architecture step should be:

1. use `C:\DesignEcho\DesignEcho-Agent\docs\project-master-plan.md` as the top-level execution order
2. continue consolidating agent intent/routing truth sources before expanding business workflows
3. shrink `routing.ts` further so it becomes a narrow fallback/parser layer instead of owning semantic intent
4. then start the image-model management rebuild around a single main-process truth source
5. only then continue deeper matting and tool-registry work

For the sock shape-unification track:

1. use `C:\DesignEcho\DesignEcho-Agent\docs\sock-shape-unification-retrospective-summary.md` as the canonical entrypoint
2. continue from the `enhanced-shape-morph` panel path
3. use the analyzer / planner / validator / executor split as the only prototype landing zone
4. define the first feasibility prototype on that single path
5. keep `shape-morphing` out of ordinary user-facing agent routing
6. continue tightening the prototype around real vertical single-sock samples only
7. evaluate whether the next quality step should be keypoint/junction anchors rather than reviving old trim/coordinate-transform code

For the matting performance track:

1. use `C:\DesignEcho\DesignEcho-Agent\docs\matting-performance-review-and-plan.md` as the canonical entrypoint
2. keep the current low-risk fixes, then make `quality` materially change inference cost
3. audit UXP `remove-background.ts` fallback/export paths before touching the ONNX core again
4. only after that evaluate queueing and deeper binary-protocol cleanup
5. use `C:\DesignEcho\DesignEcho-Agent\docs\matting-implementation-and-reliability-review.md` as the current truth source before changing the matting stack further
6. treat selection matting as “selection-constrained postprocess” for now; do not describe it as true selection-guided inference until the export/inference path changes
7. use `C:\DesignEcho\DesignEcho-Agent\docs\uxp-webpack-warning-review.md` as the truth source before making any UXP bundle-size or startup-performance changes
8. use `C:\DesignEcho\DesignEcho-Agent\docs\matting-performance-review-and-plan.md` as the truth source before the next round of matting optimizations

## Update rule

Whenever the main working topic changes, update this file before or immediately after the next substantial change.
