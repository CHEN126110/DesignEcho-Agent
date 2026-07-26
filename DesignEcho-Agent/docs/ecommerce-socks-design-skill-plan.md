# 电商袜子设计 Skill 规划

## 目标

`ecommerce-socks-design` 是面向电商袜子项目的上层设计 skill。它不是把主图、详情页、SKU 三条业务线继续拆成互不相关的入口，而是由一个上层 skill 先理解用户目标、项目素材、设计上下文和交付范围，再调度子 skill。

## Skill 层级

1. `ecommerce-socks-design`
   - 负责意图理解、项目上下文读取、素材理解、设计 brief、知识检索、执行规划和验收汇总。
   - 面向用户的入口可以是“做主图”“做详情页”“做 SKU”“帮我完成这套袜子电商设计”等自然语言。
2. `main-image`
   - 子 skill。负责主图方向、主体选择、画布尺寸、构图、标题/卖点、输出检查。
3. `detail-page`
   - 子 skill。负责详情页屏幕规划、素材分配、图文模块、版式节奏、长图验收。
4. `sku`
   - 子 skill。负责颜色/规格组合、模板填充、导出命名、自选备注边界和批量验收。

## 控制原则

1. 上层 skill 决定“要做什么”和“先做哪一部分”。
2. 子 skill 决定“这类交付物怎么做”。
3. Photoshop 工具仍由执行层落地，不允许在 skill 文案里伪造执行。
4. 设计知识搜索、项目图片理解、智能缩放、网格排版和验收工具是共享基础能力，不属于某一个子 skill 私有。
5. 当前不改三个子 skill 的业务执行逻辑，只先收口架构入口和未来演进边界。

## 必要输入

1. 用户需求：目标、交付物、平台规格、是否需要整套设计。
2. 项目上下文：项目路径、素材目录、PSD/PSB、已有输出、规格表。
3. 视觉理解：产品款式、袜口、颜色、材质、纹理、图案、适合的图像用途。
4. 设计知识：平台规范、袜子类目设计规则、品牌/竞品参考、recipe。
5. Photoshop 状态：当前文档、选区、图层结构、可写入目标和风险。

## 输出

1. `DesignBrief`：本次电商袜子设计任务的目标和约束。
2. `AssetUnderstanding`：素材角色和使用建议。
3. `DesignDSL`：可执行的设计结构，不直接混入模型自由发挥。
4. `ExecutionPlan`：主图、详情页、SKU 的执行顺序和子 skill 调度。
5. `VerificationReport`：输出文件、截图验收、图层验收和风险项。

## 当前阶段

`ecommerce-socks-design` 父 skill 的最小入口已经落地：

1. 已有 user-facing skill 声明。
2. 已有 plan-only executor。
3. 已能把“整套 / 全套 / 电商袜子设计 / 主图详情页SKU”类组合需求路由到父 skill。
4. 已输出 `ecommerce-socks-design/v0` 编排证据，明确主图、详情页、SKU 子 skill 映射。
5. 已接入 `smoke:ecommerce-socks-design:entry`、preflight、架构报告和项目驾驶舱。
6. 已新增 `ecommerce-socks-dispatch/v0` 调度检查点 evidence。
7. 调度检查点能表达默认不调度、请求未确认阻塞、确认后仍因当前阶段未实现真实 dispatch 而阻塞。
8. 已接入 `smoke:ecommerce-socks-design:dispatch-checkpoint`、preflight、架构报告和项目驾驶舱。
9. 已新增 `ecommerce-socks-dispatch-lifecycle/v0` 调度生命周期 evidence。
10. 调度生命周期明确 context intake、child dispatch、child acceptance、parent report 四阶段，以及父 skill 只汇总子报告的验收边界。
11. 已接入 `smoke:ecommerce-socks-design:dispatch-lifecycle`、preflight、架构报告和项目驾驶舱。
12. 已新增 `ecommerce-socks-dispatch-orchestration/v0` 调度编排计划 evidence。
13. 编排计划明确失败策略、进度分配、子结果报告键和父级聚合规则。
14. 已接入 `smoke:ecommerce-socks-design:dispatch-orchestration`、preflight、架构报告和项目驾驶舱。
15. 已新增 `ecommerce-socks-dispatch-authorization/v0` 调度授权 evidence。
16. 调度授权明确未请求、等待授权、拒绝授权、已授权但仍阻塞四种状态。
17. 已接入 `smoke:ecommerce-socks-design:dispatch-authorization`、preflight、架构报告和项目驾驶舱。
18. 已新增 `ecommerce-socks-child-dispatch-run/v0` 子调度 dry-run evidence。
19. 显式 `dryRunChildDispatch=true` 时，父 skill 只报告子 skill 顺序、期望报告键和父级聚合条件，不调用子 skill。
20. 已接入 `smoke:ecommerce-socks-design:child-dispatch-runner`、preflight、架构报告和项目驾驶舱。
21. 已新增 `ecommerce-socks-child-report-aggregation/v0` 子报告聚合 evidence。
22. 聚合契约明确缺报告、子失败、质量未验收和全部子报告通过四种父级状态。
23. 已接入 `smoke:ecommerce-socks-design:child-report-aggregation`、preflight、架构报告和项目驾驶舱。

当前仍未完成：

1. 父 skill 还不会自动 dispatch 子 skill。
2. 单项主图、详情页、SKU 请求仍保持原子 skill 路由。
3. 尚未进入三个子 skill 的具体设计规范、知识库、DSL、执行顺序和 Photoshop 写入策略。
4. 尚未证明整套电商袜子设计质量完成。
5. 真实 dispatch 的失败处理、回滚策略、进度呈现和子 skill 结果汇总仍未实现。
6. 当前只有编排计划、授权 evidence、dry-run 调度证据和子报告聚合证据，尚未实现真实 child dispatch orchestrator。

边界：

1. 这个父入口不是新的硬编码大杂烩。
2. plan-only 编排结果不能被当作“已经设计完成”。
3. 进入 dispatch 前，需要先明确子 skill 的执行顺序、失败处理、验收责任和用户可见进度。
4. 当前调度检查点是控制层 evidence，不是子 skill 执行结果。
5. 当前调度生命周期是控制层 evidence，不是模型思考、Photoshop 写入或设计质量验收。
6. 当前调度编排计划是控制层 evidence，不是子 skill 执行结果，也不能作为设计完成声明。
7. 当前调度授权是控制层 evidence，不是用户已经批准真实执行的持久许可，也不能绕过后续子 skill 设计 checkpoint。
8. 当前 child dispatch runner 是 dry-run evidence，不会调用 `main-image-design`、`detail-page-design`、`sku-batch`，也不会汇总真实质量结果。
9. 当前 child report aggregation 只能消费已有子报告；它不会生成子报告、不会验收 Photoshop 输出、不会替代子 skill 的质量判断。
