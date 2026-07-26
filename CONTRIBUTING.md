# 贡献指南

感谢你参与 DesignEcho。项目的目标是建设可扩展的专业设计 Agent，而不是把业务逻辑堆成固定流程。

## 开始之前

1. 先搜索现有 Issue，避免重复工作。
2. 较大改动先创建 Proposal Issue，说明目标、边界、风险和验收方式。
3. 不要提交客户素材、真实项目路径、API 密钥、模型文件或私有设计资产。

## 本地开发

```powershell
cd DesignEcho-Agent
npm ci
npm run build:typecheck:renderer

cd ..\DesignEcho-UXP
npm ci
npm run build
```

## 架构原则

- 模型负责理解和推理，Harness 负责任务、能力、权限、状态和评价。
- 默认执行路径保持模型自主循环；不要在入口增加关键词闸门抢走模型决策。
- 专业方法进入 Skill/Knowledge，原子执行进入 Tool。
- 新业务工作流优先通过 manifest、contract 和 Capability Provider 扩展。
- 写操作必须经过现有预检与 Policy；视觉观察不授予写入权限。
- 工具成功不等于任务完成，完成声明必须有读回或交付证据。

## 代码要求

- TypeScript 顶层函数优先使用 `function` 并写显式返回类型。
- React 组件使用显式 Props 类型。
- 避免嵌套三元表达式和无必要的 `try/catch`。
- 源码使用 UTF-8 无 BOM 和 LF；Windows 脚本使用 CRLF。
- 用户可见文案使用简体中文，并提供可行动的错误信息。
- 不扩大 legacy 正则路由、品类专属 executor 分支和分散工具注册债务。

## 验证要求

根据改动范围至少运行：

```powershell
cd DesignEcho-Agent
npm run audit:tools
npm run audit:executor-generic
npm run build:typecheck:renderer
```

Agent 核心改动建议运行：

```powershell
npm run maintenance:validate:agent-fast
```

UXP 改动至少运行：

```powershell
cd ..\DesignEcho-UXP
npm run build
```

真实 Photoshop 写入测试只能在隔离或可丢弃文档中执行，并在 PR 中明确标注是否已完成。

## Pull Request

- 一个 PR 聚焦一个可审查目标。
- 说明改动原因、用户影响、架构边界和验证结果。
- 不把无关格式化、生成文件或本机状态混入 PR。
- 新增 Tool 时同步 schema、权限/执行分类、显示名、UXP registry 和对应 smoke。

提交代码即表示你有权提供这些内容，并同意其按本仓库 MIT License 发布。
