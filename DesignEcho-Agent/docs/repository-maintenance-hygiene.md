# 仓库维护与清理边界

## 当前结论

当前仓库的“未收口改动”主要不是源码本身，而是以下几类内容混在一起：

1. 源码和项目记忆的真实改动
2. `dist` 构建产物
3. `node_modules` 依赖目录
4. `tmp` smoke 输出和临时报告
5. 历史备份、修复、scratch 文件

其中 `node_modules`、`dist`、`tmp` 曾经有大量文件被 Git 跟踪。
本轮已执行 Git 索引清理，只把这些生成目录从 Git 索引移出，不删除本地文件。

## 本轮已落地的维护护栏

1. 根目录新增 `.gitignore`
   - 忽略依赖目录、构建输出、临时目录、日志、本地环境文件和历史 scratch 文件。

2. 根目录新增 `.gitattributes`
   - 约束源码、文档、JSON 使用 LF。
   - 标记图片、PSD、ONNX、压缩包等二进制文件。

3. 新增巡检命令
   - `npm run maintenance:repo-hygiene`
   - `npm run maintenance:repo-hygiene:summary`
   - `npm run maintenance:repo-hygiene:check`
   - `npm run maintenance:repo-hygiene:scratch-check`
   - `npm run maintenance:repo-hygiene:clean-ignored-temp`
   - `npm run maintenance:change-boundaries`
   - `npm run maintenance:change-boundaries:check`
   - `npm run maintenance:project-cockpit`
   - `npm run maintenance:project-cleanup-candidates`
   - `npm run maintenance:validate`
   - `npm run maintenance:preflight`
   - 只读输出当前工作区分类，不修改文件。
   - 输出 `indexCleanup`，用于单独展示已从 Git 索引移出的生成目录删除记录。
   - `summary` 输出适合日常查看的摘要。
   - `check` 会在仍有生成目录被 Git 跟踪时返回失败，用于提交前检查。
   - `scratch-check` 会在 reviewable 改动中出现 `_tmp`、`_backup`、`_restore`、`.bak`、`.old`、`.corrupted.*` 这类疑似临时残留时失败。
   - `clean-ignored-temp` 只清理固定白名单中的 Git ignored 临时输出：`DesignEcho-Agent/tmp`、`DesignEcho-Agent/.cache`、`DesignEcho-UXP/.cache`。
   - `residualCleanup` 单独展示已确认无引用的历史备份/临时文件删除记录。
   - `change-boundaries` 按提交和验收边界拆分当前改动。
   - `change-boundaries:check` 在出现 `other / other-source / other-docs` 模糊分组时返回失败。
   - `project-cockpit` 汇总当前主线、证据数量、未验证风险、下一步动作和工作区边界，用于会话恢复。
   - `project-cleanup-candidates` 只读输出全项目超长源码、超长文档、高风险目录和依赖/构建索引噪声，用于进入源码级简化前排序。
   - `validate` 一次性执行 JSON、项目状态结构、脚本语法、仓库卫生、边界报告、空白错误和乱码扫描。
   - `preflight` 串行执行维护验收、主进程构建、renderer 类型检查、Agent 路由 smoke、Photoshop 验收 smoke 和调试脱敏 smoke，作为提交前本地预检。

4. 已执行 Git 索引清理
   - `DesignEcho-Agent/node_modules`：本地目录存在，剩余被跟踪文件数为 0。
   - `DesignEcho-Agent/dist`：本地目录存在，剩余被跟踪文件数为 0。
   - `DesignEcho-Agent/tmp`：本地目录存在，剩余被跟踪文件数为 0。
   - `DesignEcho-UXP/node_modules`：本地目录存在，剩余被跟踪文件数为 0。
   - `DesignEcho-UXP/dist`：本地目录存在，剩余被跟踪文件数为 0。

当前 `git status` 会出现大量 `D` 记录，这是有意的 Git 索引删除，不代表磁盘文件被删除。
巡检报告中的 `reviewableChangeCount` 才是后续需要继续人工关注的源码、文档、脚本和配置改动规模。
脚本仍保留 `dirtyCount / actionableDirtyCount` 作为兼容旧记录的 JSON 别名，但日常输出不再使用这些容易误解的名称。

5. 新增当前改动边界报告
   - `DesignEcho-Agent/docs/repository-change-boundary-report.md`
   - 用于拆分维护、项目记忆、参考图复刻、智能缩放、局部重绘、Agent 路由和形态工具相关改动。

6. 新增当前改动边界巡检脚本
   - `DesignEcho-Agent/scripts/report-change-boundaries.cjs`
   - 用于把 `git status` 中的改动按提交边界分组，并列出每组建议验证命令。
   - 可用 `--entries <boundary>` 查看某个边界的带状态文件清单。
   - 可用 `--paths <boundary>` 导出某个边界的纯路径清单。
   - 可用 `--validation <boundary>` 查看某个边界的验证命令。
   - 可用 `--fail-on-uncategorized` 在出现 `other / other-source / other-docs` 模糊分组时失败。

## 不应直接做的事

不要在当前未收口工作区直接执行：

```bash
git reset --hard
git clean -fdx
git checkout -- .
```

这些命令会破坏用户近期改动。

## 推荐清理顺序

### 第 1 步：先建立分类视图

运行：

```bash
npm run maintenance:repo-hygiene
```

如果是恢复长期任务或网络中断后的会话，先运行：

```bash
npm run maintenance:project-cockpit
```

如果目标是全项目大扫除或源码简化，先运行：

```bash
npm run maintenance:project-cleanup-candidates -- --summary
```

优先处理 `trackedNoise`、`sourceSimplification.oversizedCodeFiles` 和 `highRiskDirectories`。
其中 `highRiskDirectories` 只能作为人工审查边界，不能被脚本自动删除。

优先只看：

- `source`
- `project-memory`
- `docs`
- `script`
- `package`
- `repo-config`
- `reviewableScratch.total`

暂时忽略：

- `dependency`
- `build-output`
- `temporary`

### 第 1.5 步：按白名单清理 ignored 临时目录

当 smoke、构建或诊断脚本生成临时输出后，可以运行：

```bash
npm run maintenance:repo-hygiene:clean-ignored-temp
```

这条命令只允许删除以下固定目录，且会先确认它们位于仓库内并被 Git 忽略：

- `DesignEcho-Agent/tmp`
- `DesignEcho-Agent/.cache`
- `DesignEcho-UXP/.cache`

它不会清理源码、文档、脚本、benchmark、project-memory、`node_modules` 或 `dist`。
原因是 `node_modules` 和 `dist` 可能支撑本地正在运行的桌面端或 UXP 插件，应该通过 Git 索引清理和提交边界治理，而不是用临时清理命令删除磁盘内容。

### 第 2 步：提交已执行的索引清理

本轮已经执行：

```bash
git rm -r --cached DesignEcho-Agent/node_modules
git rm -r --cached DesignEcho-Agent/dist
git rm -r --cached DesignEcho-Agent/tmp
git rm -r --cached DesignEcho-UXP/node_modules
git rm -r --cached DesignEcho-UXP/dist
```

注意：

- 这是 Git 索引清理，不删除本地文件。
- 它会让提交中出现大量删除项。
- 提交前必须确认构建、启动和插件加载流程不依赖“仓库内已提交的 dist”。
- 提交时建议和 `.gitignore`、`.gitattributes` 放在同一个维护提交中，不要混入业务功能提交。

建议提交分组：

1. 维护提交
   - `.gitignore`
   - `.gitattributes`
   - `DesignEcho-Agent/scripts/report-repo-hygiene.cjs`
   - `DesignEcho-Agent/docs/repository-maintenance-hygiene.md`
   - `DesignEcho-Agent/package.json` 中的维护脚本
   - `node_modules/dist/tmp` 的 Git 索引删除，包括 Agent 与 UXP 两侧依赖目录

2. 项目记忆提交
   - `DesignEcho-Agent/project-memory/*`
   - 如果团队希望项目记忆和维护提交绑定，也可以并入维护提交，但不要和业务源码改动混在一起。

3. 业务功能提交
   - 参考图复刻、智能缩放、模型接入、UXP 工具等源码改动。

当前不建议把上述三类一次性混成一个大提交。

提交前建议先运行：

```bash
npm run maintenance:validate
npm run maintenance:preflight
npm run maintenance:change-boundaries
npm run maintenance:change-boundaries:check
npm run maintenance:repo-hygiene:check
```

### 第 3 步：临时修复文件单独处理

以下类型应先确认没有引用，再删除或移出版本控制：

- `*_backup*`
- `*_restore*`
- `tmp_*`
- `*.corrupted.*`

本轮已确认 7 个历史残留文件本地不存在且没有源码、脚本、文档引用，并已将其删除状态登记到 Git 索引：

- `_backup_src_index.corrupted.ts`
- `_backup_tool-executor.corrupted.ts`
- `_text_handlers_head_restore.ts`
- `_tmp_head_index.ts`
- `_tmp_map_index.ts`
- `tmp_detail_executor_head.ts`
- `tmp_photoshop_tools.json`

后续如出现新的同类文件，仍应先确认引用关系，再清理。

如果 `reviewableScratch.total` 大于 0，先运行：

```bash
npm run maintenance:repo-hygiene:scratch-check
```

这不是自动删除命令，只是提交前拦截器。它的目的不是让工作区表面干净，而是防止临时备份、修复碎片和 scratch 文件进入源码、文档或脚本边界。

## 长期规则

1. 源码、文档、项目记忆可以提交。
2. 构建产物、依赖目录、临时报告默认不提交。
3. 每次重要任务结束后运行维护巡检。
4. 如果新增生成目录，先更新 `.gitignore`，再写代码。
5. 不把工作区干净程度和功能完成度混在一起判断。
6. 日常用户可见报告避免使用“dirty/脏”描述，改用“待收口改动 / reviewable changes / index cleanup”。
7. smoke 或构建命令可能重新生成 ignored 临时目录；需要保持磁盘简洁时，在验证后再次运行 `maintenance:repo-hygiene:clean-ignored-temp`。
8. 新增临时修复文件时必须放入 ignored temp 目录；不要把 `_tmp`、`_backup`、`_restore`、`.bak`、`.old`、`.corrupted.*` 放进源码目录。
