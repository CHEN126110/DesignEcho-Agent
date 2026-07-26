# Design Observation Loop Risk-Controlled Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a low-risk design observation loop so the Agent works as "think -> act one stage -> observe targeted evidence -> adjust", without returning to one-shot layout scripts.

**Architecture:** Add a shared observation-intent contract in the Agent layer first, then wire it into the autonomous design prompt and execution guards. Reuse existing Photoshop read tools (`getAnnotatedSnapshot`, `getAcceptanceSnapshot`, `getLayerBounds`, `getClippingMaskInfo`, `getAllClippingMasks`) before adding any new UXP capability.

**Tech Stack:** Electron renderer TypeScript, shared TypeScript contracts, existing UXP Photoshop tools, Node smoke tests.

---

## Scope And Risk Rules

This plan deliberately does not start with a new Photoshop write tool. The first deliverable is a testable protocol that tells the Agent what to observe and which existing evidence to request.

Do not expose `createClippingMask` to autonomous Agent execution in the first task group. It is a write action and needs a separate guard after the read-only observation loop proves useful.

Do not build the full image reference knowledge library yet. Reference images belong to a later task group after the observation loop can reliably inspect the current Photoshop result.

Do not hardcode C-1194, socks, Taobao, SKU specs, or one screenshot into the Agent core. Project-specific material should enter through project context, reference knowledge, or skill inputs.

## Planned File Structure

- Create `C:\DesignEcho\DesignEcho-Agent\src\shared\design-observation-intents.ts`
  - Owns observation intent ids, evidence requirements, and stage decision labels.
- Create `C:\DesignEcho\DesignEcho-Agent\scripts\smoke-agent-design-observation-protocol.cjs`
  - Verifies the protocol exists, is read-first, and protects against one-shot render/save behavior.
- Modify `C:\DesignEcho\DesignEcho-Agent\package.json`
  - Adds a smoke script for the observation protocol.
- Modify `C:\DesignEcho\DesignEcho-Agent\src\renderer\services\agent-runtime\tool-schemas.ts`
  - Updates `renderLayout` language from one-shot output to stage draft.
  - Adds read-only clipping inspection tools to default autonomous tools.
- Modify `C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\autonomous-agent.executor.ts`
  - Makes post-mutation observation explicit.
  - Requires an observation intent before screenshot/review steps.
  - Keeps save/export blocked until a targeted observation happened after the latest visual mutation.
- Modify `C:\DesignEcho\DesignEcho-Agent\src\renderer\services\tool-display-info.ts`
  - Adds user-facing labels for clipping read tools if they become visible in the execution chain.

---

### Task 1: Add The Observation Intent Contract

**Files:**
- Create: `C:\DesignEcho\DesignEcho-Agent\src\shared\design-observation-intents.ts`
- Test: `C:\DesignEcho\DesignEcho-Agent\scripts\smoke-agent-design-observation-protocol.cjs`
- Modify: `C:\DesignEcho\DesignEcho-Agent\package.json`

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-agent-design-observation-protocol.cjs` with assertions for these exact requirements:

```js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'src/shared/design-observation-intents.ts');
const schemasPath = path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts');
const executorPath = path.join(root, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const contract = fs.existsSync(contractPath) ? read(contractPath) : '';
const schemas = read(schemasPath);
const executor = read(executorPath);

for (const intent of [
  'layout_balance',
  'image_fit',
  'text_readability',
  'container_overflow',
  'visual_hierarchy',
  'stage_readiness',
  'export_readiness'
]) {
  assert(contract.includes(intent), `missing observation intent ${intent}`);
}

assert(contract.includes('getAnnotatedSnapshot'), 'observation contract must prefer annotated visual evidence');
assert(contract.includes('getAcceptanceSnapshot'), 'observation contract must include structured layer evidence');
assert(contract.includes('getClippingMaskInfo'), 'image_fit intent must be able to inspect clipping relationships');
assert(contract.includes('maxRepairAttempts'), 'observation contract must define a bounded repair loop');
assert(!contract.includes('createClippingMask'), 'phase 1 observation contract must stay read-only');

assert(!schemas.includes('一次出整版、又快又齐'), 'renderLayout schema must not encourage one-shot full-page output');
assert(schemas.includes('当前阶段草稿'), 'renderLayout schema should describe staged drafting');
assert(schemas.includes('getClippingMaskInfo'), 'Agent tool schema should expose read-only clipping inspection');
assert(schemas.includes('getAllClippingMasks'), 'Agent tool schema should expose document-level clipping inspection');

assert(executor.includes('designObservationIntent'), 'executor should track targeted observation intent');
assert(executor.includes('needsTargetedObservationAfterMutation'), 'executor should guard post-mutation save/export');
assert(executor.includes('maxRepairAttempts'), 'executor should cap repeated observation/repair loops');
assert(executor.includes('当前阶段'), 'executor prompt should describe stage-level observation');

console.log(JSON.stringify({
  success: true,
  checks: [
    'observation intents exist',
    'evidence requirements are read-only in phase 1',
    'renderLayout is stage draft oriented',
    'executor has post-mutation targeted observation guards'
  ]
}, null, 2));
```

- [ ] **Step 2: Run the smoke test and verify it fails**

Run:

```powershell
node scripts\smoke-agent-design-observation-protocol.cjs
```

Expected: fails because `src/shared/design-observation-intents.ts` does not exist yet or required strings are missing.

- [ ] **Step 3: Add the shared contract**

Create `src/shared/design-observation-intents.ts` with this shape:

```ts
export type DesignObservationIntent =
    | 'layout_balance'
    | 'image_fit'
    | 'text_readability'
    | 'container_overflow'
    | 'visual_hierarchy'
    | 'stage_readiness'
    | 'export_readiness';

export type DesignStageDecision = 'continue' | 'adjust_current_stage' | 'restart_current_stage' | 'ready_to_export';

export interface DesignObservationRequirement {
    intent: DesignObservationIntent;
    purpose: string;
    evidenceTools: string[];
    reviewSignals: string[];
    repairActions: string[];
    maxRepairAttempts: number;
}

export const DESIGN_OBSERVATION_REQUIREMENTS: Record<DesignObservationIntent, DesignObservationRequirement> = {
    layout_balance: {
        intent: 'layout_balance',
        purpose: '检查当前阶段整体重心、留白、对齐和节奏是否成立。',
        evidenceTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot'],
        reviewSignals: ['主体是否清楚', '留白是否失衡', '元素是否拥挤', '视觉路径是否明确'],
        repairActions: ['重新分配当前阶段模块比例', '减少低价值装饰', '调整标题和主体距离'],
        maxRepairAttempts: 3
    },
    image_fit: {
        intent: 'image_fit',
        purpose: '检查图片是否正确进入目标区域，主体是否过大、过小、偏移或溢出。',
        evidenceTools: ['getAnnotatedSnapshot', 'getLayerBounds', 'getClippingMaskInfo', 'getAllClippingMasks'],
        reviewSignals: ['图片是否超出容器', '主体是否居中', '图片是否遮挡文字', '容器约束是否明确'],
        repairActions: ['调整图片缩放', '调整图片位置', '重新选择目标区域', '进入受控容器修正流程'],
        maxRepairAttempts: 3
    },
    text_readability: {
        intent: 'text_readability',
        purpose: '检查标题、卖点和说明文字是否可读、不过框、不互相挤压。',
        evidenceTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot', 'getAllTextLayers'],
        reviewSignals: ['文字是否清晰', '文字是否超框', '层级是否分明', '对比度是否足够'],
        repairActions: ['缩短文案', '调整字号层级', '提升文字对比', '重新分组卖点'],
        maxRepairAttempts: 3
    },
    container_overflow: {
        intent: 'container_overflow',
        purpose: '检查卡片、模块、图片和文字是否溢出画布或容器。',
        evidenceTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot', 'getLayerBounds'],
        reviewSignals: ['元素是否出画布', '卡片内容是否溢出', '元素间是否重叠'],
        repairActions: ['缩小当前元素', '扩大容器', '减少当前阶段内容', '重新排布当前阶段'],
        maxRepairAttempts: 3
    },
    visual_hierarchy: {
        intent: 'visual_hierarchy',
        purpose: '检查第一眼先看到什么，标题、商品、卖点是否有主次。',
        evidenceTools: ['getCanvasSnapshot', 'getAnnotatedSnapshot', 'getDetailPageDesignFramework'],
        reviewSignals: ['第一视觉焦点是否正确', '卖点是否抢主体', '背景是否压主体'],
        repairActions: ['放大主视觉', '降低次要元素权重', '强化核心标题', '减少同权重卡片'],
        maxRepairAttempts: 3
    },
    stage_readiness: {
        intent: 'stage_readiness',
        purpose: '判断当前阶段是否可以进入下一阶段。',
        evidenceTools: ['getAnnotatedSnapshot', 'getAcceptanceSnapshot'],
        reviewSignals: ['当前阶段目标是否达成', '是否存在明显遮挡', '是否存在未复核图片或文字'],
        repairActions: ['调整当前阶段', '重做当前阶段草稿', '减少当前阶段内容'],
        maxRepairAttempts: 3
    },
    export_readiness: {
        intent: 'export_readiness',
        purpose: '保存或导出前检查画面和结构是否具备验收证据。',
        evidenceTools: ['getCanvasSnapshot', 'getAcceptanceSnapshot'],
        reviewSignals: ['画面是否可读', '导出尺寸是否正确', '关键图层是否存在', '是否还有明显错位'],
        repairActions: ['回到问题阶段修正', '重新截图复核', '停止导出并说明阻塞原因'],
        maxRepairAttempts: 1
    }
};
```

- [ ] **Step 4: Add package script**

Add this script entry to `package.json`:

```json
"smoke:agent:design-observation-protocol": "node scripts/smoke-agent-design-observation-protocol.cjs"
```

- [ ] **Step 5: Run the smoke test again**

Run:

```powershell
npm run smoke:agent:design-observation-protocol
```

Expected: still fails until Tasks 2 and 3 update tool schema and executor references.

---

### Task 2: Make Tool Schema Support Targeted Observation

**Files:**
- Modify: `C:\DesignEcho\DesignEcho-Agent\src\renderer\services\agent-runtime\tool-schemas.ts`
- Modify: `C:\DesignEcho\DesignEcho-Agent\src\renderer\services\tool-display-info.ts`
- Test: `C:\DesignEcho\DesignEcho-Agent\scripts\smoke-agent-design-observation-protocol.cjs`

- [ ] **Step 1: Change `renderLayout` wording**

In `tool-schemas.ts`, replace the current one-shot wording:

```ts
description: 'One-shot 版面渲染：...一次出整版、又快又齐。'
```

with stage-oriented wording:

```ts
description: '阶段版面草稿：你只描述当前阶段每个模块“放什么 + 占多少”，引擎自动算出坐标、对齐和图层顺序。用于主图、详情页、SKU 等当前阶段草稿，不代表最终整张图完成；renderLayout 后必须读取真实画面再决定调整或进入下一阶段。'
```

- [ ] **Step 2: Add read-only clipping inspection schemas**

Add these two tool schemas near `getLayerProperties`:

```ts
{
    name: 'getClippingMaskInfo',
    description: 'Read clipping-mask relationship for a layer: whether it is clipped, whether it is a clipping base, and the related base bounds. Use for image-fit and container review. Read-only.',
    inputSchema: objectSchema({
        layerId: { type: 'number' }
    })
},
{
    name: 'getAllClippingMasks',
    description: 'Read all clipping-mask relationships in the active document. Use before judging whether images are constrained by their containers. Read-only.',
    inputSchema: objectSchema({
        groupId: { type: 'number' }
    })
}
```

- [ ] **Step 3: Add the read-only clipping tools to `DEFAULT_AGENT_TOOL_NAMES`**

Add:

```ts
'getClippingMaskInfo',
'getAllClippingMasks',
```

Do not add `createClippingMask` in this task.

- [ ] **Step 4: Add user-facing display names**

In `tool-display-info.ts`, add labels:

```ts
getClippingMaskInfo: { name: '检查图片约束', icon: '[R]', description: '检查图片是否被约束在目标区域。' },
getAllClippingMasks: { name: '检查图片约束关系', icon: '[R]', description: '检查当前文档里的图片约束关系。' },
```

- [ ] **Step 5: Run the protocol smoke**

Run:

```powershell
npm run smoke:agent:design-observation-protocol
```

Expected: schema-related assertions pass; executor-related assertions may still fail until Task 3.

---

### Task 3: Wire Observation Intent Into Autonomous Design Loop

**Files:**
- Modify: `C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\autonomous-agent.executor.ts`
- Test: `C:\DesignEcho\DesignEcho-Agent\scripts\smoke-agent-design-observation-protocol.cjs`
- Existing regression: `C:\DesignEcho\DesignEcho-Agent\scripts\smoke-agent-creative-document-intent.cjs`

- [ ] **Step 1: Import the contract**

Add:

```ts
import { DESIGN_OBSERVATION_REQUIREMENTS, DesignObservationIntent } from '../../../shared/design-observation-intents';
```

- [ ] **Step 2: Extend fresh detail state**

Add state fields close to existing detail-page mutation state:

```ts
designObservationIntent?: DesignObservationIntent;
needsTargetedObservationAfterMutation: boolean;
lastMutationToolName?: string;
repairAttemptCount: number;
maxRepairAttempts: number;
```

Initialize:

```ts
needsTargetedObservationAfterMutation: false,
repairAttemptCount: 0,
maxRepairAttempts: 3
```

- [ ] **Step 3: Mark mutations as needing targeted observation**

When `renderLayout`, `placeImage`, `transformLayer`, `moveLayer`, `setTextStyle`, or `setTextContent` succeeds, set:

```ts
state.needsTargetedObservationAfterMutation = true;
state.lastMutationToolName = toolName;
```

For `renderLayout`, prefer:

```ts
state.designObservationIntent = 'stage_readiness';
```

For `placeImage` and `transformLayer`, prefer:

```ts
state.designObservationIntent = 'image_fit';
```

- [ ] **Step 4: Treat observation tools as satisfying evidence only when targeted**

When a successful call is one of:

```ts
getAnnotatedSnapshot
getCanvasSnapshot
getAcceptanceSnapshot
getLayerBounds
getClippingMaskInfo
getAllClippingMasks
```

clear the post-mutation flag only if `state.designObservationIntent` is set:

```ts
state.needsTargetedObservationAfterMutation = false;
```

Keep the intent available for the next model step so the Agent can explain the user-facing observation in non-technical words.

- [ ] **Step 5: Strengthen save/export guard**

If `saveDocument`, `quickExport`, or `smartSave` is called while `needsTargetedObservationAfterMutation` is true, return a blocked result with:

```ts
nextRequiredTool: 'getAnnotatedSnapshot'
nextRequiredToolReason: '当前阶段刚调整过画面，需要先做针对性观察，再决定保存或继续调整。'
```

User-facing message should avoid tool names in the final chat text. Internal blocker may keep tool names.

- [ ] **Step 6: Cap repair loops**

When the Agent repeats observe -> adjust for the same stage, increment `repairAttemptCount`. If it exceeds `maxRepairAttempts`, block further micro-adjustment with:

```ts
当前阶段已经连续调整多次，继续微调可能是在修补错误方向。请先重新判断当前阶段目标或重做当前阶段草稿。
```

- [ ] **Step 7: Update prompt text**

Replace broad "截图复核" language with:

```text
每次观察前先明确观察目标：这一步是在看整体版面、图片置入、文字可读性、容器溢出、视觉层级，还是导出准备。不要只说“看一下画面”。观察后必须做出 continue / adjust_current_stage / restart_current_stage / ready_to_export 之一的判断。
```

- [ ] **Step 8: Run tests**

Run:

```powershell
npm run smoke:agent:design-observation-protocol
node scripts\smoke-agent-creative-document-intent.cjs
```

Expected: both pass.

---

### Task 4: Add Low-Cost Evidence Ordering

**Files:**
- Modify: `C:\DesignEcho\DesignEcho-Agent\src\shared\design-observation-intents.ts`
- Modify: `C:\DesignEcho\DesignEcho-Agent\src\renderer\services\skill-executors\autonomous-agent.executor.ts`
- Test: `C:\DesignEcho\DesignEcho-Agent\scripts\smoke-agent-design-observation-protocol.cjs`

- [ ] **Step 1: Add evidence cost labels**

Extend `DesignObservationRequirement`:

```ts
evidenceOrder: Array<'structure' | 'annotated_snapshot' | 'canvas_snapshot' | 'vision_model'>;
```

For `image_fit`, set:

```ts
evidenceOrder: ['structure', 'annotated_snapshot']
```

For `visual_hierarchy`, set:

```ts
evidenceOrder: ['canvas_snapshot', 'annotated_snapshot']
```

For `export_readiness`, set:

```ts
evidenceOrder: ['structure', 'canvas_snapshot']
```

- [ ] **Step 2: Add executor prompt guidance**

Add:

```text
效率原则：先读结构证据，再读标注截图，最后才读整图或视觉模型。不要每一步都做最重的观察。
```

- [ ] **Step 3: Update smoke assertions**

Add assertions that:

```js
assert(contract.includes('evidenceOrder'), 'observation contract should define low-cost evidence ordering');
assert(executor.includes('先读结构证据'), 'executor should prefer cheap evidence before heavy screenshots');
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm run smoke:agent:design-observation-protocol
```

Expected: pass.

---

### Task 5: Verification Batch

**Files:**
- No new files.

- [ ] **Step 1: Run targeted smokes**

Run:

```powershell
npm run smoke:agent:design-observation-protocol
node scripts\smoke-agent-creative-document-intent.cjs
node scripts\smoke-agent-runtime-guard.cjs
node scripts\smoke-agent-tool-execution-preflight.cjs
node scripts\smoke-chat-ui-execution-chain.cjs
```

Expected: all exit 0.

- [ ] **Step 2: Run renderer typecheck**

Run:

```powershell
npm run build:typecheck:renderer
```

Expected: exit 0.

- [ ] **Step 3: Run renderer build**

Run:

```powershell
npm run build:renderer
```

Expected: exit 0. Existing chunk-size warnings are acceptable only if they already existed and do not introduce new errors.

---

## Later Work Not Included In This First Plan

1. Add a true local-region screenshot tool. This is useful for long detail pages, but should wait until the observation-intent loop proves stable.
2. Add guarded `createClippingMask` access. This should require known image layer id, known base/container layer id, and a prior `image_fit` observation.
3. Build the reference-image knowledge library. First version should include only `详情页首屏`, `主图`, and `SKU卡片` cases.
4. Add project-specific visual memory. This should store observations and corrections, not hardcode one product category into the core Agent.

## Self-Review

Spec coverage: The plan covers targeted observation, design knowledge integration boundaries, efficiency, no one-shot render/save, read-only first strategy, and debug-risk control.

Placeholder scan: No task uses TBD, TODO, "implement later", or open-ended "add appropriate handling" language.

Type consistency: `DesignObservationIntent`, `DesignStageDecision`, `DesignObservationRequirement`, `DESIGN_OBSERVATION_REQUIREMENTS`, `designObservationIntent`, `needsTargetedObservationAfterMutation`, `repairAttemptCount`, and `maxRepairAttempts` are named consistently across tasks.
