# DesignEcho MCP Tooling Plan

## Goal

Give the coding agent stable, inspectable access to the real state of:

- Photoshop documents
- selected layers
- layout structure
- text targets
- image generation / inpainting inputs and outputs
- task execution traces

The objective is not to expose "more APIs". The objective is to expose the
minimum MCP surface that makes the design agent debuggable, explainable, and
correctable.

## Why MCP Is Needed

Right now the project already has many useful local tools in UXP and Electron,
but they are not organized into a stable model-facing interface. The result is:

- the model cannot directly inspect real runtime state
- bug fixing relies too much on screenshots and logs
- design failures are hard to separate into:
  - intent failure
  - planning failure
  - tool-call failure
  - Photoshop runtime failure

MCP should solve exactly that.

## MCP Design Principles

### 1. Expose facts, not guesses

MCP tools should return:

- real layer ids
- real bounds
- real document state
- real generated file paths
- real tool traces

Not vague summaries.

### 2. Prefer structure over screenshots

For production reasoning, avoid viewport-dependent screenshots.

Use:

- region rendering
- layer rendering
- screen rendering from document coordinates
- JSON structure

Screenshots are still useful, but mainly as debug artifacts for humans.

### 3. Split MCP into tools, resources, prompts

Use MCP as intended:

- `tools`: execute actions or produce derived diagnostics
- `resources`: read stable context/data/artifacts
- `prompts`: reusable workflows for common debug or design tasks

### 4. Strict task support first

The most valuable first MCP tools are not broad "agent" tools.
They are strict, narrow tools for:

- text replacement debugging
- detail-page placement debugging
- SKU trace inspection
- image generation / inpainting input-output inspection

## Recommended MCP Server Scope

Create one local MCP server for DesignEcho runtime, for example:

- `designecho-runtime`

This server should sit above Electron/UXP internals and expose a stable API to
the model.

## Tools

### Priority 0: State and Trace

These should be implemented first.

#### `runtime.get_active_context`

Return the current app/runtime state:

- active Photoshop document
- selected layers
- current panel/page
- current project root
- current task if any
- plugin connection status

Example shape:

```json
{
  "document": {
    "id": 12143,
    "name": "详情页.psb",
    "width": 800,
    "height": 800,
    "bitsPerChannel": 8,
    "mode": "RGBColor"
  },
  "selection": {
    "layerIds": [27],
    "layerNames": ["主标题"],
    "isSingleTextLayer": true
  },
  "panel": {
    "page": "optimize-text"
  },
  "projectRoot": "D:\\DesignEchoDemo\\C-1058",
  "plugin": {
    "connected": true
  }
}
```

#### `runtime.get_recent_task_trace`

Return the latest execution trace for a task:

- user input
- classifier output
- final skill id
- skill params
- tool calls
- duration
- warnings
- final status

This is the single most valuable debugging tool for the agent layer.

#### `runtime.export_debug_bundle`

Export a debug bundle directory containing:

- trace json
- before/after images
- overlays
- tool results
- error payloads

This should return a folder path.

### Priority 1: Text Optimization

#### `text.get_optimize_context`

Given a selected text layer, return:

- target layer id/name
- current text content
- layer bounds
- whether the layer is point text or paragraph text
- nearby layers
- inferred module/context summary

This is better than giving the model only the raw text.

#### `text.render_context_images`

Return file paths for:

- module render
- local region render
- optional full-screen render

The important point: these renders must be document-coordinate based, not
viewport dependent.

#### `text.audit_replacement`

Given a layer id and new content, return:

- before bounds
- after bounds
- font size before/after
- whether wrapping changed
- whether paragraph box changed

This is critical for the current "replace A -> B -> C causes size drift" bug.

### Priority 2: Detail Page

#### `detail.get_template_graph`

Return parsed detail-page structure:

- screens
- placeholders
- clipping bases
- target bounds
- reference layers

#### `detail.audit_placement`

This can wrap the existing placement audit logic and return:

- per-screen placement risks
- offset metrics
- overlap/stacking risks
- missing clipping base

#### `detail.render_overlay_snapshots`

Return per-screen debug images with:

- target boxes
- actual image boxes
- screen labels

### Priority 3: SKU

#### `sku.get_execution_plan`

Return the parsed plan for a SKU request:

- mode
- target sizes
- note strategy
- combos
- duplicates removed
- fallbacks used

#### `sku.audit_batch_result`

Return:

- actual exported files
- template hits/misses
- per-size results
- duplicate detection
- note generation results

### Priority 4: Image Generation / Inpainting

#### `image2image.inspect_request`

Return the real payload summary:

- selected source layer
- source image size
- reference image count
- model
- size preset
- provider endpoint

#### `image2image.inspect_result`

Return:

- provider response meta
- saved temp file path
- placement bounds
- final layer id

#### `inpaint.inspect_request`

Return:

- selection bounds
- mask size
- ROI size
- input clarity preset
- prompt
- provider config

#### `inpaint.inspect_result`

Return:

- generated patch size
- alpha coverage
- paste bounds
- output file path
- human-readable warnings

## Resources

Resources should expose stable data and artifacts. They should not mutate state.

### Recommended resources

#### `designecho://runtime/active-context`

Latest runtime snapshot.

#### `designecho://tasks/latest-trace`

Latest task trace.

#### `designecho://documents/active/layers`

Layer tree of the active document.

#### `designecho://text/current-context`

Current text optimization context.

#### `designecho://detail/latest-audit`

Latest detail-page placement audit result.

#### `designecho://sku/latest-plan`

Latest SKU plan json.

#### `designecho://artifacts/<task-id>/...`

Generated artifacts:

- before.png
- after.png
- overlay.png
- trace.json

Resources are especially useful for multi-step debugging where the model needs
to refer back to the same state repeatedly.

## Prompts

Prompts should encode reusable workflows, not data.

### Recommended prompts

#### `debug_text_replacement`

Use when:

- text replace changes size
- wrapping drifts
- formatting is lost

Expected steps:

1. read active text context
2. inspect replacement audit
3. compare before/after geometry
4. identify whether the issue is binding drift or Photoshop reflow

#### `debug_detail_page_fill`

Use when:

- images stack together
- clipping base is wrong
- actual placement differs from placeholder

#### `debug_sku_run`

Use when:

- wrong sizes are generated
- notes are missing
- duplicate combos appear
- template routing is wrong

#### `debug_image_generation`

Use when:

- provider request fails
- model output is malformed
- result placement is wrong

## What Not To Expose First

Do not start with a huge general-purpose MCP surface.

Avoid first-wave tools like:

- arbitrary Photoshop scripting
- generic file explorer tools already available elsewhere
- broad "do agent task" meta-tools

Those make debugging less clear, not more clear.

## Rollout Order

### Phase 1

Implement first:

- `runtime.get_active_context`
- `runtime.get_recent_task_trace`
- `text.audit_replacement`
- `detail.audit_placement`
- `image2image.inspect_request`
- `inpaint.inspect_request`

### Phase 2

Add:

- overlay renders
- debug bundle export
- SKU audit tools
- stable resources

### Phase 3

Add:

- reusable prompts
- richer artifact bundles
- optional replay tools

## Engineering Notes

### Transport

Use a local MCP server process that talks to Electron/UXP through the existing
runtime APIs. Do not let the model talk directly to arbitrary low-level
Photoshop action descriptors.

### Output format

Prefer JSON with explicit field names.

Always include:

- ids
- names
- bounds
- file paths
- timestamps
- warnings

### Safety

Default debug tools should be read-only unless the tool is explicitly an action
tool.

### Performance

Cache expensive renders for the current task id where possible.

## Bottom Line

The right MCP strategy for DesignEcho is:

- expose real runtime facts
- expose narrow debugging tools first
- expose artifacts as resources
- expose repeatable workflows as prompts

That will improve development quality far more than adding more ad hoc logs or
more broad agent freedom.
