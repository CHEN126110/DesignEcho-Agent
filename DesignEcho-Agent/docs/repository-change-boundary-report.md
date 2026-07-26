# 当前改动边界报告

## 目的

本文件用于把当前工作区的未提交/未收口改动按维护边界拆开，避免后续把仓库清理、项目记忆、参考图复刻、智能缩放、局部重绘、形态工具等内容混在一个不可维护的提交里。

本文件只记录当前已观察到的工作区事实和建议分组，不代表这些功能都已经完成。

## 当前巡检摘要

命令：

```bash
npm run maintenance:repo-hygiene:summary
npm run maintenance:change-boundaries
npm run maintenance:project-cockpit
npm run maintenance:validate
```

当前结果：

- `pendingChangeCount`: 30904
- `indexCleanup.total`: 30764
- `residualCleanup.total`: 7
- `reviewableChangeCount`: 133
- `trackedNoise`: 4 个生成目录均为 0
- `maintenance:change-boundaries` 已能把当前改动按提交和验收边界分组。
- `maintenance:validate` 已能一键验证维护脚本、项目状态结构、仓库卫生、边界报告、空白错误和乱码扫描。
- 当前边界巡检已消除 `other / other-source / other-docs` 这类模糊分组，剩余改动均归入明确边界。

解释：

- `pendingChangeCount` 很大，主要来自已执行的 Git 索引清理。
- `indexCleanup` 是有意把依赖、构建产物、临时目录移出版本控制，不代表磁盘文件删除。
- `residualCleanup` 是已确认无引用的历史备份/临时文件删除。
- 真正需要继续人工判断的是 `reviewableChangeCount`。
- 脚本 JSON 仍保留 `dirtyCount / actionableDirtyCount` 旧字段作为兼容别名，避免影响已有本地记录；日常摘要统一使用 `pendingChangeCount / reviewableChangeCount`。

## 建议提交边界

当前可用命令：

```bash
npm run maintenance:validate
npm run maintenance:preflight
npm run maintenance:project-cockpit
npm run maintenance:change-boundaries
npm run maintenance:change-boundaries:check
npm run maintenance:change-boundaries -- --entries acceptance-infrastructure
npm run maintenance:change-boundaries -- --paths maintenance-tooling
npm run maintenance:change-boundaries -- --validation agent-routing-models
```

这些命令只读，不修改文件。输出中的 `staged / unstaged / untracked` 可用于判断哪些改动已经进入索引，哪些还需要单独选择。
`--entries` 用于查看某个边界下带 Git 状态的文件清单；`--paths` 用于导出纯路径清单；`--validation` 用于查看该边界提交或验收前应运行的命令。
`maintenance:change-boundaries:check` 会在出现 `other / other-source / other-docs` 这类模糊分组时失败，防止新增改动绕过明确边界。

### 1. 仓库维护提交

范围：

- `.gitignore`
- `.gitattributes`
- `DesignEcho-Agent/scripts/report-repo-hygiene.cjs`
- `DesignEcho-Agent/docs/repository-maintenance-hygiene.md`
- `DesignEcho-Agent/docs/repository-change-boundary-report.md`
- `DesignEcho-Agent/package.json` 中的维护脚本
- `node_modules/dist/tmp` 的 Git 索引删除
- 7 个已确认无引用的历史 scratch / tmp 删除

验收：

- `npm run maintenance:repo-hygiene:check` 通过
- `trackedNoise` 为 0
- 本地 `node_modules/dist/tmp` 仍存在

注意：

- 不要把业务源码一起放进这个提交。
- 如果要精确拆 `package.json`，需要注意该文件里还包含此前依赖调整，不一定全都属于维护提交。

### 2. 项目记忆提交

范围：

- `DesignEcho-Agent/project-memory/*`
- `docs/long-horizon/Collaboration.md`
- `DesignEcho-Agent/AGENTS.md`

验收：

- `project-state.json` 可被 JSON 解析
- `Status.md` 与 `project-state.json` 的状态描述一致
- 仍明确区分“已核实 / 未核实 / 待验证”

注意：

- 项目记忆可以和维护提交放在一起，但不建议和业务源码混在一起。

### 3. 参考图复刻提交

范围：

- `DesignEcho-Agent/src/shared/reference-replication*.ts`
- `DesignEcho-Agent/src/renderer/services/skill-executors/layout-replication-*.ts`
- `DesignEcho-Agent/benchmarks/reference-replication/*`
- `DesignEcho-Agent/scripts/create-reference-replication-case.cjs`
- `DesignEcho-Agent/scripts/validate-reference-replication-benchmarks.cjs`
- `DesignEcho-Agent/scripts/smoke-reference-style-recipes.cjs`
- `DesignEcho-Agent/scripts/smoke-reference-match-validation.cjs`
- 相关参考图复刻文档

验收：

- `npm run build:main`
- `npm run build:typecheck:renderer`
- `npm run smoke:reference:blueprint-groups`
- `npm run smoke:reference:match-validation`
- `npm run smoke:reference:style-recipes`
- `npm run benchmark:reference-replication:validate`

注意：

- 当前仍是参考图复刻基础雏形，不应写成高保真设计系统已完成。

### 4. 智能缩放与 placement 提交

范围：

- `DesignEcho-Agent/src/shared/design-smart-scaling-policy.ts`
- `DesignEcho-Agent/src/renderer/services/skill-executors/detail-page-asset-ranker.ts`
- `DesignEcho-Agent/src/renderer/services/skill-executors/detail-page.types.ts`
- `DesignEcho-UXP/src/tools/layout/detail-page-filler.ts`
- `DesignEcho-UXP/src/tools/layout/template-tool.ts`
- `DesignEcho-Agent/docs/smart-scaling-photoshop-transform-research-plan.md`

验收：

- `npm run build:main`
- `npm run build:typecheck:renderer`
- `DesignEcho-UXP npm run build`
- 后续需要真实 Photoshop placement 手测

注意：

- `placementAudit` 只能验证图层 bounds，不等于主体审美验证。

### 5. 局部重绘 / 即梦 / 火山服务提交

范围：

- `DesignEcho-Agent/src/main/services/inpainting-service.ts`
- `DesignEcho-Agent/src/main/services/volcengine-jimeng-image-service.ts`
- `DesignEcho-Agent/src/main/services/volcengine-tos-upload-service.ts`
- `DesignEcho-Agent/src/main/uxp-handlers/inpainting-handlers.ts`
- `DesignEcho-Agent/src/main/uxp-handlers/image-to-image-handlers.ts`
- `DesignEcho-Agent/public/webview/index.html`
- `DesignEcho-UXP/src/tools/image/inpainting.ts`

验收：

- `npm run build:main`
- `DesignEcho-UXP npm run build`
- 至少覆盖删除、改字、普通局部编辑三类 Photoshop 手测

注意：

- 代码对齐官方协议不等于真实效果稳定。

### 6. Agent 路由 / 模型 / skill 边界提交

范围：

- `DesignEcho-Agent/src/renderer/services/agent-orchestration/*`
- `DesignEcho-Agent/src/renderer/services/design-agent/engine.ts`
- `DesignEcho-Agent/src/shared/design-domain-knowledge.ts`
- `DesignEcho-Agent/src/shared/skill-routing.ts`
- `DesignEcho-Agent/src/shared/skills/skill-declarations.ts`
- `DesignEcho-Agent/src/shared/config/models.config.ts`
- `DesignEcho-Agent/src/main/services/model-service.ts`
- `DesignEcho-Agent/scripts/smoke-agent-intent-engine.cjs`

验收：

- `npm run build:main`
- `npm run build:typecheck:renderer`
- `npm run smoke:agent:intent-engine`

注意：

- 普通聊天、模型问答、文档操作不应误入 Photoshop 执行链或内部 debug bridge。

### 7. 形态工具相关提交

范围：

- `DesignEcho-Agent/src/main/services/shape-morphing-*`
- `DesignEcho-Agent/src/main/services/morphing/*`
- `DesignEcho-Agent/src/main/services/sock-morphing/*`
- `DesignEcho-Agent/src/renderer/services/skill-executors/shape-morphing.executor.ts`
- `DesignEcho-UXP/src/tools/morphing/*`

验收：

- 当前不作为 Agent 主线推进
- 如需保留，应确认它是工具能力，不污染 Agent 设计意图路由

注意：

- 不建议和参考图复刻、Agent 路由提交混在一起。

### 8. 主进程基础设施提交

范围：

- `DesignEcho-Agent/src/main/index.ts`
- `DesignEcho-Agent/src/main/preload.ts`
- `DesignEcho-Agent/src/main/ipc-handlers/*`
- provider adapter / stream adapter 等主进程基础设施

验收：

- `npm run build:main`

### 9. UXP 桥接与 Photoshop 工具核心提交

范围：

- `DesignEcho-Agent/src/main/services/mcp-host-service.ts`
- `DesignEcho-Agent/src/shared/binary-protocol.ts`
- `DesignEcho-UXP/src/core/*`
- `DesignEcho-UXP/src/tools/*` 中非局部重绘、非形态专项的工具改动

验收：

- `npm run build:main`
- `DesignEcho-UXP npm run build`

### 10. Renderer UI 与应用状态提交

范围：

- `DesignEcho-Agent/src/renderer/App.tsx`
- `DesignEcho-Agent/src/renderer/components/*`
- `DesignEcho-Agent/src/renderer/hooks/*`
- `DesignEcho-Agent/src/renderer/stores/*`
- renderer 类型声明

验收：

- `npm run build:typecheck:renderer`

### 11. 设计 skill 与执行核心提交

范围：

- `detail-page-design.skill`
- `main-image.executor`
- `autonomous-agent.executor`
- `tool-executor.service`
- `template-knowledge.service`
- 共享 skill 参数与类型

验收：

- `npm run build:main`
- `npm run build:typecheck:renderer`
- `npm run smoke:agent:intent-engine`

### 12. 工程规划文档提交

范围：

- `REFACTOR-PLAN.md`
- `project-master-plan.md`

验收：

- 人工复核，不把规划写成已实现事实。

## 当前不应做的事

1. 不要运行 `git reset --hard`。
2. 不要运行 `git clean -fdx`。
3. 不要把 `dist/node_modules/tmp` 重新加入 Git。
4. 不要把“构建通过”写成“真实 Photoshop 手测通过”。
5. 不要把参考图复刻基础雏形写成完整设计能力已实现。
