# 项目驾驶舱与会话恢复入口

## 目的

`maintenance:project-cockpit` 是一个只读恢复入口，用于在新会话、网络中断、任务切换或长时间开发后快速确认项目事实。

它不替代详细计划，也不代表功能完成。它只把当前最重要的事实集中展示出来：

1. 当前主线、里程碑和状态
2. 已核实证据数量
3. 未核实事项、主要风险和下一步动作
4. 当前工作区改动规模和边界分组
5. 推荐的维护验证命令
6. Agent 架构基础设施成熟度体检入口

## 使用方式

日常恢复上下文：

```bash
npm run maintenance:project-cockpit
```

输出 JSON，供脚本或后续工具消费：

```bash
node scripts/report-project-cockpit.cjs --json
```

限制风险和下一步条目数量：

```bash
node scripts/report-project-cockpit.cjs --limit 5
```

单独查看 Agent 架构基础设施体检：

```bash
npm run maintenance:agent-architecture
```

## 数据来源

脚本只读取已有真相源：

1. `project-memory/project-state.json`
2. `package.json`
3. `scripts/report-repo-hygiene.cjs`
4. `scripts/report-change-boundaries.cjs`
5. `scripts/report-agent-architecture.cjs`

因此它不会直接判断设计效果，也不会声称某个 Photoshop 能力已经完成。

如果项目状态写错，驾驶舱也会跟着展示错误信息，所以重要开发结束后仍必须写回项目记忆。

## 和其他维护命令的关系

推荐顺序：

1. `npm run maintenance:project-cockpit`
   - 用于恢复上下文和确认当前最应该关注什么。
2. `npm run maintenance:change-boundaries`
   - 用于查看当前改动应该怎么拆分和验收。
3. `npm run maintenance:validate`
   - 用于快速检查维护脚本、项目状态、边界、空白错误和乱码。
4. `npm run maintenance:agent-architecture`
   - 用于判断 Agent 架构基础设施是缺失、MVP 成型还是完整成熟。
5. `npm run maintenance:preflight`
   - 用于提交或交付前的本地预检。

## 设计边界

1. 只读，不修改文件。
2. 不做 Git 清理，不 staging，不提交。
3. 不把规划写成已实现。
4. 不替代真实 Photoshop 手测。
5. 不替代截图级视觉 QA。
6. `maintenance:agent-architecture` 只判断架构 gate，不证明设计质量。

## 后续可扩展项

1. 输出 Markdown 版项目日报。
2. 接入真实 Photoshop 验收报告索引。
3. 标记过期的项目记忆条目。
4. 给每个 `nextAction` 绑定可执行验证命令。
5. 在未来多 Agent 系统中作为 Planner 的上下文入口。
