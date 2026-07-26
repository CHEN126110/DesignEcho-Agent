## UXP webpack warning review

Date: 2026-04-05

### Scope

Target project:
- `C:\DesignEcho\DesignEcho-UXP`

Warning under review:
- `WARNING in webpack performance recommendations`
- current production build output reports `runtime.js` over the webpack performance threshold

### Verified facts

1. The plugin is a single-entry UXP panel bundle.
   - `manifest.json` points to `dist/runtime.js`
   - `webpack.config.js` uses a single entry: `./src/index.ts`
   - output is a single `runtime.js` CommonJS bundle

2. The warning is real.
   - current built asset size is about `499727` bytes for `runtime.js`
   - webpack marks the asset as over the size limit

3. The main size driver is not third-party web code.
   - `stats-utf8.json` shows the dominant chunk as `./src/index.ts + 74 modules`
   - the biggest individual modules are internal tools, especially:
     - `./src/tools/layout/sku-layout-tool.ts`
     - `./src/tools/image/remove-background.ts`
     - `./src/tools/layout/smart-layout-engine.ts`
     - `./src/tools/image/inpainting.ts`
     - `./src/tools/morphing/warp-explorer.ts`
     - `./src/tools/layer/smart-object-tools.ts`
     - `./src/tools/layout/detail-page-parser.ts`

4. The startup path eagerly constructs the full tool system.
   - panel `show` calls `initializeConnection()`
   - `initializeConnection()` immediately runs `toolRegistry = new ToolRegistry()`
   - `ToolRegistry` statically imports and registers the entire tool set in `registerDefaultTools()`

5. The warning is partly amplified by bundling structure limitations.
   - webpack stats show `ModuleConcatenation bailout` because many modules use `require('photoshop')` / `require('uxp')` mixed with ESM
   - `photoshop` and `uxp` are already externals, so the warning is not caused by bundling Adobe runtime code itself

### User impact

This warning does **not** mean a network download bottleneck, because the bundle is local.

The practical risk is:
- heavier cold start for the UXP panel
- more parsing/execution work when the panel is first opened
- unnecessary startup cost because many heavy tools are loaded before they are needed

This warning is therefore a **real startup-performance signal**, not a cosmetic warning, but it is also **not** the same thing as a web app download bottleneck.

### What should not be done first

1. Do not blindly add webpack code splitting just to silence the warning.
2. Do not turn off webpack performance hints to hide the issue.
3. Do not apply aggressive async chunk loading before validating UXP runtime compatibility and failure modes.

### Lowest-risk optimization path

Priority 1:
- reduce eager startup work before touching webpack chunking
- specifically, stop paying full initialization cost for the entire `ToolRegistry` during panel startup if the same behavior can be preserved lazily

Priority 2:
- identify low-frequency heavy tools that do not need to be part of the hot startup path
- examples from the current stats:
  - shape/morph tools
  - detail-page parser/filler tools
  - SKU layout tools
  - inpainting-related tools

Priority 3:
- only after that, evaluate whether limited dynamic import is justified for a small number of low-frequency tools

### Current reliability judgment

The most reliable current conclusion is:

- the warning is real
- the main source is our own single-entry eager tool architecture
- the safest first optimization target is startup initialization behavior, not webpack code splitting

### Recommended next step

1. measure and trim eager startup work on the UXP side
2. audit whether `ToolRegistry` can move from eager full registration to lazy registration or delayed initialization without changing behavior
3. only then revisit bundle splitting as a second-stage optimization
