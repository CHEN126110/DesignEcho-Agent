# 设计师 PSD/PSB 作为设计知识库的可行性研究

日期：2026-07-07 ｜ 结论：**值得做，优先级高**——它是当前唯一不依赖视觉模型的高质量设计学习通道，且地基已存在（ag-psd 已是依赖、模板知识服务已有存储检索骨架）。红线：每个阶段必须先定消费点再建提取（防"建好未接线"）。

## 一、结论

1. 设计师 PSD/PSB 是**结构化的设计 ground truth**：分组习惯、字号层级、色板、安全边距、屏高节奏、图层样式参数——全部可离线直读，不需要"眼睛"（视觉模型），不需要占用 Photoshop。
2. 当前设计学习管线只吃 Eagle 图片（像素级，依赖视觉模型描述，被眼睛弱卡住）；PSD 通道与它互补：**Eagle 学"好不好看"，PSD 学"规范是什么"**。
3. 用户对图层管理的预期（详情页/分屏结构化/A营销信息…）本身就是设计师 PSD 的组织习惯——与其口头教模型，不如从真实文件归纳。

## 二、实测证据（2026-07-07 探针，ag-psd 29.1.0 离线解析）

### 模板.psb（88MB PSB，1000×14525 详情长图，145 层）——解析仅 42ms

- **分组结构 ground truth**：`详情页 → 屏号(15/14/13/12/11…) → 图片/图标/文案` 三组一屏——正是用户期望的结构化图层树；另有 `产品款式-色卡` 等业务组
- **字号层级系统**：屏标题 27.4 / 小节标题 15.8 / 正文 10.3（AlibabaPuHuiTi 3 系列：65 Medium 做标题、55 Regular 做正文）——字重+字号的双层级
- **色板**：#000000 / #FFFFFF / #383633 / #999999（中性色系统）
- **安全边距**：文案层 x 起点集中在 78–81px（1000 宽的 ≈8%）——可归纳的版心规则
- **屏高节奏**：14525px / ~15 屏 ≈ 970px/屏

### 面料材质.psd（素材模块，474KB）——解析 10ms

- 夸张对比的电商字号系统：主数字 191 / 大标题 120 / 副标 46–59 / 正文 26（MiSans-Demibold）
- 文字内容即卖点话术样本（"吸汗 透气""33mm+长纤维 更细、更软…"）

### 已验证的提取面

文档尺寸、完整分组树（含中文名）、每层 bounds/类型（text/shape/pixel/smartObject/group）、文字内容+字体+字号+颜色、剪贴标记、图层效果（本次样本未用效果，能力在）。

### 如实记录的边界

- **.tif 分层模板（用户排版模板目录全是 tif）ag-psd 不支持**——tif 模板要么经 Photoshop 打开走 UXP 工具读取（getLayerHierarchy/inspectTemplateLayout，已有），要么由用户另存一份 PSD 入库
- 部分文字层 fillColor 读不到（样式可能在 styleRuns 分段里，探针未读分段；ag-psd 支持 styleRuns，正式实现需补）
- 部分形状层 bounds 为 0（矢量层实体边界需从 vectorMask 推，需补算）
- ag-psd 对新版 PS 个别特性可能读不全——读不到的字段标 unknown，诚实降级

## 三、可学清单 → 消费点映射（价值排序）

| 学什么 | 消费点（已存在的机制） | 直接解决的痛点 |
|--------|------------------------|----------------|
| 分组结构模式（屏组/命名习惯） | stagePlan 结构参照；renderLayout 组名规范；critic 图层管理评分 | 用户"图层管理清晰"预期 |
| 字号层级 + 字体搭配 | renderLayout 文字渲染默认值；setTextStyle 参数建议 | 现在字号是 fitLayoutTextToWidth 估算，无设计依据 |
| 间距/边距/屏高度量 | layout-engine 的 margin/gap/DEFAULT_HEIGHT_RATIO 校准（现在是拍脑袋值） | 排版"大小位置不好" |
| 配色组合（文字×背景×强调） | render-layout-style 色彩决策；getDesignPrinciples 知识 | 配色现在只有 WCAG 兜底 |
| 图层样式参数（投影/描边/渐变实参） | addDropShadow 等工具的参数建议 | 模型不知道参数填多少合理 |
| 卖点话术模式 | 文案生成参照（只学句式结构，不抄原文） | 文案凭空写 |
| SKU 模板结构（占位/色卡组织） | 模板设计闭环参照 | 已部分在用（inspectTemplateLayout） |

## 四、现有基建盘点

- ✅ `ag-psd@29.1.0` 已是主进程依赖——但目前只用来读缩略图和文件头尺寸（价值利用率 <5%）
- ✅ `template-knowledge.service.ts`（2932 行）：模板库存储/检索/预览骨架
- ✅ UXP 打开态解析：detail-page-parser、getLayerHierarchy(includeBounds)、inspectTemplateLayout——覆盖 .tif 场景
- ✅ 学习治理：design-learning review/writeback gate、来源标注、Eagle 防照抄边界（先例可复用）
- ✅ 消费端：searchDesignKnowledge、memory-prompt-section 注入、design-state
- ❌ 缺：PSD→设计模式的提取器；模式库 schema；学习管线的 PSD 输入源

## 五、分阶段方案（每阶段带消费点）

### P0：单文件"设计源解析"工具（建议先做）

主进程新工具 `analyzePsdDesignSource`（ag-psd，skipLayerImageData）：输入 PSD/PSB 路径 → 输出 design-source-profile（JSON）：
分组树+命名、文字样式表（字体/字号/颜色/内容摘要）、度量统计（边距/字号分布/屏高推断）、色板、效果参数。

**消费点（立即可用）**：暴露为循环工具——用户说"照这个 PSD 的规范做"时，模型解析后直接拿到结构与度量做参照；详情页 stagePlan 可引用真实屏序。字号/色板/边距进 renderLayout 调用参数。

### P1：多文件模式归纳

对模板目录/素材库批量解析 → 统计归纳（字号层级分布、边距众数、命名习惯、屏高节奏）→ 写入 `design-pattern` 知识（走 searchDesignKnowledge 检索）+ 校准 layout-engine 默认值（数据来源标注，可回滚）。

### P2：并入学习管线

PSD 目录成为 design-learning 第二输入源（与 Eagle 并列）：候选=新增/变更的 PSD；产出走既有 review gate 成洞察卡（内容形态：结构树摘要+度量表，不是纯文本）。

### P3：红线细化

学"模式与度量"不学"内容"：文案只归纳句式不存原文整句入提示；图片素材零复制；来源文件路径全程标注；乱命名文件入库前过筛（review gate）。

## 六、风险

1. **建好未接线**（本仓库最大惯性病）：P0 必须连同"照这个 PSD 做"的真实场景一起落地验证，再扩 P1/P2
2. .tif 覆盖缺口：用户现有模板以 tif 为主——P0 同时支持"当前打开文档"模式（走 UXP getLayerHierarchy，同一 profile schema），离线/打开态双入口
3. 大 PSB 内存：readFileSync 整文件进内存（88MB 实测无压力），设 500MB 上限+超时保护
4. 文件质量参差：素材库里可能有"图层 4/形状 1 拷贝 2"式乱命名——归纳时按占比统计，不让脏样本污染规范
