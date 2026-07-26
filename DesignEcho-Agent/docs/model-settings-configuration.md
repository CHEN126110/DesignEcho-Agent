# 模型设置与配置说明

日期：2026-06-02

本文档说明 DesignEcho 当前模型配置、设置页选择和 Xiaomi MiMo 2.5 迁移边界。它只描述已经落到代码中的配置入口，不把未来计划写成已实现能力。

## 1. 配置真相源

模型清单的唯一真相源是：

- `src/shared/config/models.config.ts`

设置页、模型选择、provider 能力判断和 smoke 都应围绕这份配置展开。新增或下线模型时，优先改这里，再补对应迁移和 smoke。

当前任务模型桶是：

1. `layoutAnalysis`：逻辑、意图、规划、工具调用和 Photoshop 执行链。
2. `textOptimize`：标题、卖点、文案改写和营销话术。
3. `visualAnalyze`：参考图理解、图片内容理解和视觉结构分析。

这三个桶是按任务选择模型，不代表三个模型已经形成固定流水线协作。

## 2. Xiaomi MiMo 官方模型

官方 OpenAI 兼容地址：

- API Base URL：`https://api.xiaomimimo.com/v1`
- Chat Completions：`/chat/completions`
- 文档：`https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api`
- 模型超参：`https://platform.xiaomimimo.com/docs/zh-CN/quick-start/model-hyperparameters`

当前只保留以下 Xiaomi 官方模型作为可选项：

| 配置 ID | API model | 建议用途 |
| --- | --- | --- |
| `xiaomi-mimo-v2.5-pro` | `mimo-v2.5-pro` | 中文推理、规划、代码、Agent 任务、provider-native Web Search |
| `xiaomi-mimo-v2.5` | `mimo-v2.5` | 全模态输入、参考图理解、视觉分析、长上下文 Agent 任务、provider-native Web Search |

已下线迁移的旧模型不要再出现在可选配置中：

- `xiaomi-mimo-v2-pro` -> `xiaomi-mimo-v2.5-pro`
- `xiaomi-mimo-v2-omni` -> `xiaomi-mimo-v2.5`
- `openrouter-mimo-v2-pro` -> `openrouter-mimo-v2.5-pro`

历史用户设置由 renderer store 的持久化迁移处理，避免旧偏好继续指向不可选模型。

## 3. Xiaomi 请求参数

Xiaomi MiMo V2.5 系列官方推荐 `temperature=1.0`、`top_p=0.95`。当前官方 provider 请求会默认使用这组参数；如果调用方显式传入 `temperature`，保留调用方的 `temperature`，但 `top_p` 仍按官方推荐值发送。

Agent 工具调用和普通非流式调用默认发送：

```json
{
  "temperature": 1.0,
  "top_p": 0.95,
  "thinking": { "type": "disabled" }
}
```

这里默认关闭 Xiaomi 思考模式，是因为官方要求 Agent 多轮工具会话在开启思考模式时完整回传历史 `reasoning_content`。当前共享 OpenAI-compatible adapter 尚未把该字段作为多轮工具上下文持久化，直接开启会增加后续 400 错误和输出缺失风险。

## 4. 设置页行为

设置页包含两个相关区域：

1. `API Key` 区域：只负责填写 provider key。Xiaomi MiMo 帮助入口应指向官方 OpenAI API 文档。
2. `AI Models` 区域：分别选择 `layoutAnalysis / textOptimize / visualAnalyze` 三个任务模型桶。

当任一任务桶选择 `xiaomi-*` 模型时，设置页会提示需要 Xiaomi MiMo API Key。没有配置 key 时，模型可以保留在设置中，但真实调用会失败并进入 provider 错误链路。

## 5. Web Search 能力边界

Xiaomi MiMo provider-native Web Search 只应在以下条件同时满足时启用：

1. provider 是 `xiaomi`。
2. API model 是 `mimo-v2.5-pro` 或 `mimo-v2.5`。
3. 用户在设计知识设置中开启 Xiaomi Web Search。

旧模型 `mimo-v2-pro`、`mimo-v2-omni` 以及未列入官方支持集的模型不能作为 Web Search 运行候选。

官方 Web Search 文档说明流式响应首包会返回搜索来源；当前工具流路径已经能接收 Xiaomi OpenAI-compatible stream、`delta.reasoning_content`、`delta.annotations` 和最终 `usage.web_search_usage`。普通直接聊天是否走 provider token streaming 仍受前端 streaming policy 限制。

## 6. 推荐验证命令

模型配置或设置页变更后，至少运行：

```bash
npm run smoke:model-provider:xiaomi
npm run smoke:provider-native:tools
npm run smoke:model-selection:routing
npm run smoke:design-knowledge:runtime-capability
npm run smoke:design-knowledge:xiaomi-web-search-runtime
npm run build:typecheck:renderer
```
