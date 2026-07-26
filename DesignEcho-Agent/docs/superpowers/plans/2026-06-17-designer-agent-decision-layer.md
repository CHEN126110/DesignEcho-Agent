# Designer Agent Decision Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, testable design decision layer so creative Photoshop work starts from explicit design judgment instead of a fixed script.

**Architecture:** Reuse the existing `design-intelligence-plan` and `design-observation-intents` modules as the truth source. Add a focused runtime contract that formats public design intent and observation goals, then inject it into the autonomous Agent prompt and visible steps without changing Photoshop tools or SKU executors.

**Tech Stack:** TypeScript shared modules, renderer autonomous Agent executor, Node smoke tests with `ts-node`, existing npm build and smoke scripts.

---

### Task 1: Contract And Smoke

**Files:**
- Create: `src/shared/designer-agent-decision-contract.ts`
- Create: `scripts/smoke-designer-agent-decision-layer.cjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing smoke**

Create a smoke that imports `buildDesignerAgentDecisionContract` and checks these behaviors:

```js
const contract = buildDesignerAgentDecisionContract({
  userTask: '帮我做一个袜子主图',
  scenario: 'main-image',
  hasProjectVisualEvidence: true,
  agentDecision: {
    source: 'model-agent',
    designGoal: '做一张突出透气和弹力的袜子主图',
    productUnderstanding: ['短筒圆点袜', '袜口颜色不同'],
    hierarchy: { primarySubject: '单只袜子实拍图', informationPriority: ['主视觉', '标题', '三条卖点'] },
    color: { paletteIntent: '深色背景搭配清爽蓝色点缀' },
    typography: { tone: '清晰直接' },
    assetSelection: { selectionPrinciples: ['优先选择单只或单双袜子的清晰原片'] },
    toolWorkflow: [
      { phase: 'inspect', goal: '确认素材和卖点' },
      { phase: 'compose', goal: '生成当前阶段草稿' },
      { phase: 'verify', goal: '检查图片和文字是否成立' }
    ],
    acceptanceCriteria: ['画面有真实产品', '文字可读', '不直接导出未复核画面']
  }
});
```

Expected assertions:

```js
assert(contract.status === 'ready');
assert(contract.publicDesignIntent.includes('突出透气和弹力'));
assert(contract.publicObservationGoals.some((item) => item.intent === 'image_fit'));
assert(!contract.boundaries.join('\n').includes('直接调用 Photoshop'));
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `node scripts/smoke-designer-agent-decision-layer.cjs`

Expected: fail because the new shared contract does not exist.

- [ ] **Step 3: Implement shared contract**

Create `buildDesignerAgentDecisionContract` with:

```ts
export function buildDesignerAgentDecisionContract(input: DesignerAgentDecisionContractInput): DesignerAgentDecisionContract
```

It must return public design intent, observation goals, boundaries, and tool-use guidance. It must not expose private chain-of-thought or raw tool names as the main user-facing copy.

- [ ] **Step 4: Add npm smoke script**

Add:

```json
"smoke:designer-agent:decision-layer": "node scripts/smoke-designer-agent-decision-layer.cjs"
```

- [ ] **Step 5: Run smoke to verify it passes**

Run: `npm run smoke:designer-agent:decision-layer`

Expected: pass.

### Task 2: Autonomous Agent Integration

**Files:**
- Modify: `src/renderer/services/skill-executors/autonomous-agent.executor.ts`
- Modify: `scripts/smoke-designer-agent-decision-layer.cjs`

- [ ] **Step 1: Extend smoke with source checks**

Add static assertions that `autonomous-agent.executor.ts` imports the new contract and includes its prompt section in the autonomous system prompt.

- [ ] **Step 2: Run smoke to verify it fails**

Run: `npm run smoke:designer-agent:decision-layer`

Expected: fail because the executor is not wired.

- [ ] **Step 3: Wire contract into autonomous prompt**

Build a design-decision prompt section from the user task, `skillId`, project evidence summary, and any `designIntelligenceDecision` already passed in params. Add it to `systemPromptSections`.

- [ ] **Step 4: Emit public design step at task start**

When the task is creative/design-related, emit an `observation` step titled `设计判断准备` with a public summary. Do not emit private reasoning.

- [ ] **Step 5: Run smoke to verify it passes**

Run: `npm run smoke:designer-agent:decision-layer`

Expected: pass.

### Task 3: Regression Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted smokes**

Run:

```bash
npm run smoke:designer-agent:decision-layer
npm run smoke:agent:thinking-tool-boundary
npm run smoke:chat-ui:execution-chain
npm run smoke:ui:user-facing-language-boundary
```

Expected: all pass.

- [ ] **Step 2: Run typecheck and renderer build**

Run:

```bash
npm run build:typecheck:renderer
npm run build:renderer
```

Expected: both pass. Existing bundle-size warnings are acceptable if unchanged.
