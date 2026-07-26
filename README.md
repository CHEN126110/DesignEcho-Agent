# DesignEcho Agent

[![CI](https://github.com/CHEN126110/DesignEcho-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/CHEN126110/DesignEcho-Agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/CHEN126110/DesignEcho-Agent/actions/workflows/codeql.yml/badge.svg)](https://github.com/CHEN126110/DesignEcho-Agent/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向 Adobe Photoshop 的开源设计 Agent 工作区。DesignEcho 将 Electron Agent、可插拔专业能力、Photoshop UXP 原子工具和质量复核链路组合在一起，用于电商主图、详情页、SKU 批量设计与其他可扩展设计任务。

> 项目仍处于积极开发阶段，当前以 Windows 和 Photoshop 桌面工作流为主。请勿直接在不可恢复的生产文件上测试写操作。

## 核心能力

- 自主 Agent 循环：理解目标、规划、调用工具、观察结果、恢复与复核。
- Capability Layer：Knowledge、Skill、Tool、Memory、Evaluation、Policy 分层治理。
- Photoshop UXP 工具链：文档、图层、文字、图像、布局、导出与安全守卫。
- 设计任务运行时：当前 v3 为默认真实执行路径，v5 manifest/contract 运行时持续演进。
- 共享 Design Project State：保存项目事实、规则、方案、评审与版本摘要。
- 可选视觉能力：支持云端视觉模型与本地 ONNX 推理，模型文件不进入 Git。
- 可选 Eagle 与浏览器连接：为参考检索、素材理解和网页读取提供受限桥接。

## 仓库结构

```text
DesignEcho-Agent/
├── DesignEcho-Agent/              Electron Agent、编排、模型、知识与 React UI
├── DesignEcho-UXP/                Photoshop UXP 插件与 Photoshop 原子工具
├── DesignEcho-Browser-Extension/  可选的本地浏览器桥
└── docs/                          架构、开发和维护文档
```

主要运行链路：

```text
User
  → Electron Agent
  → Planner / Capability / Policy
  → IPC + WebSocket (localhost)
  → Photoshop UXP
  → Photoshop document
  → Readback / Evaluation
```

## 环境要求

- Windows 10/11 x64
- Node.js 20 LTS
- npm 10+
- Adobe Photoshop（支持 UXP）
- Adobe UXP Developer Tool（开发加载插件时需要）
- 至少一个已配置的模型 Provider；也可使用 Ollama 等本地 Provider

Photoshop、模型服务和第三方 API 可能需要各自的账号、许可证或费用，它们不包含在本项目许可证中。

## 快速开始

```powershell
git clone https://github.com/CHEN126110/DesignEcho-Agent.git
cd DesignEcho-Agent

cd DesignEcho-Agent
npm ci
npm run build

cd ..\DesignEcho-UXP
npm ci
npm run build
```

启动桌面 Agent：

```powershell
cd DesignEcho-Agent
npm run dev
```

随后在 Adobe UXP Developer Tool 中加载仓库内的 `DesignEcho-UXP` 插件目录。Agent 默认在本机建立 WebSocket 服务，UXP 插件作为客户端连接；相关端口和实现以源码中的网络配置为准。

## 验证

Agent 核心验证：

```powershell
cd DesignEcho-Agent
npm run build:typecheck:renderer
npm run maintenance:validate:agent-fast
```

UXP 构建：

```powershell
cd DesignEcho-UXP
npm run build
```

涉及真实 Photoshop、真实模型或写入操作的测试不会在公共 CI 中自动执行，需要在隔离项目或可丢弃文档中手动验证。

## 本地模型与私有数据

以下内容不会进入仓库：

- API 密钥、`.env` 和本地 Provider 配置
- ONNX 模型、模型缓存和构建产物
- 客户素材、PSD/PSB、Eagle 个人库导出
- 本机运行日志、项目运行状态和调试截图

提交前请阅读 [开源边界](docs/OPEN_SOURCE_SCOPE.md) 和 [依赖风险登记](docs/DEPENDENCY_RISKS.md)。发现安全问题时不要创建公开 Issue，请按 [SECURITY.md](SECURITY.md) 报告。

## 参与维护

- 功能与缺陷：使用 GitHub Issues。
- 代码修改：从小型、可验证的 Pull Request 开始。
- 架构改动：说明对 Agent、Capability、Tool、Memory、Evaluation 和 Policy 边界的影响。
- 新增 Photoshop 工具：同步 Agent schema、执行分类和 UXP registry，并通过工具漂移审计。

完整流程见 [CONTRIBUTING.md](CONTRIBUTING.md)、[GOVERNANCE.md](GOVERNANCE.md) 和 [SUPPORT.md](SUPPORT.md)。

## 项目状态

DesignEcho 当前不是 Adobe 官方产品，也不与 Adobe 存在隶属或背书关系。“Adobe”和“Photoshop”是 Adobe 在相关司法辖区的商标。

## License

本仓库源码采用 [MIT License](LICENSE)。第三方依赖、模型、字体、参考素材及外部服务受各自许可证和条款约束。

---

**English summary:** DesignEcho Agent is an open-source, Windows-first agent workspace that combines an Electron orchestration runtime with an Adobe Photoshop UXP execution layer. The project is experimental and under active development. See the setup, security, and contribution guides above before using it with production assets.
