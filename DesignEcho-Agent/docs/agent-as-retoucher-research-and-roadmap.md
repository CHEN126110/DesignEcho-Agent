# 让 Agent 像精修师一样修图 — 技术评估与现实路线

> 研究方法：多角度调研（精修工作流分解 / UXP 可自动化性 / 现有能力盘点 / 视觉-决策缺口 / 外部 AI 技术）+ 本仓库读码 + curl GitHub 元数据/README 交叉核对。
> **数据可信度声明**：调研的 5 个维度里，「UXP 可自动化性」「现有能力盘点」两维的子任务返回了空占位（未产出），这两块由本仓库一手读码补齐并标注。**全程未在真实 Photoshop 里跑通精修全链路**，凡涉及 batchPlay 能否落地的结论均标「需真机验证」。
> 编制：2026-07-02。

---

## 0. 一句话总判断

**以现有体系，Agent 能做到「产品/静物向的半自动辅助精修」，做不到「人像级无监督全自动精修」。**
手（工具 / 像素算法）可以堆；真瓶颈卡在**「看」（视觉诊断→结构化瑕疵清单）**和**「判断」（修多少的审美克制）**这两层——而当前仓库这两层几乎是空的。**眼 + 脑是天花板，不是手。**

**对我们项目是好消息**：电商产品/袜子向比人像**可自动化程度高得多**，因为产品有**客观正解**（真实颜色可对色卡、干净白底可 255 判定、标准形态可对轮廓、投影有物理规则）；人像的「好看」高度主观、规则约束不住。所以应优先做客观性强的技法。

---

## 1. 核心架构：把精修表达成 harness 闭环

这正是我们前面聊的 harness 五要素的综合：**看(Observation) → 判断(Knowledge/决策) → 手(Action/Tools) → 验(Permissions/非破坏+校验)**。

```
   ①看：视觉诊断              ②判断：修图方案
   通读图→结构化问题清单   →   定技法顺序+强度+克制
   (瑕疵坐标/色偏/光影/形变)     (改多少算对)
          ▲                          │
          │                          ▼
   ④验：对比校验              ③手：工具执行
   修前/后 diff+伪影检测   ←   调色/修复/D&B/液化/锐化/净化
   (过度磨皮/塑料感/穿帮)       (batchPlay + 像素算法)
```

| 环 | 现在有什么 | 缺什么 | 判定 |
|---|---|---|---|
| **①看** | 真分割底座：SAM2 ONNX、Human Parsing(SCHP)、BiRefNet matting | 视觉理解全为「排版/电商卖点」而建（搜 retouch/瑕疵/反光/噪点 全仓零命中）；分割只到「物体/部位」级不到「瑕疵坐标」级；开放词汇检测是**假实现**（simpleTokenize 字符级 + getTextEmbedding 用 Math.sin 造伪向量，失败回退全图） | **近空白 · needs-vision** |
| **②判断** | 只有 DESIGN_STANDARDS 的字号/间距排版规则 | 零「阴影压多少/磨到什么程度/液化推多少」的强度决策 | **完全缺失 · needs-decision（真正天花板）** |
| **③手** | batchPlay 可下发几乎所有 PS 原生命令(调色/滤镜/变形)=clean-tool；Imaging API getPixels/putPixels 可自写频率分离/D&B/瑕疵检测=pixel-algo；已有 morphing 基建(contour-detector+morph-executor)；本会话新增 addDodgeBurnLayer/warpLayer | 73 个 PS 工具**零像素级外科修补原语**(无 healing/clone/dodge-burn 画笔/liquify)；UXP 对 healing/clone/liquify 脚本 API 支持有限 | **动作可堆 · 外科式修补受限** |
| **④验** | VLM compareDesigns/validateDecision(设计层打分) | 无像素级修前/后 diff、无塑料感/穿帮/光晕/克隆重复纹理伪影检测 | **需接线 · pixel-algo 可自写** |

**关键**：手 + 验的空缺是「工程量」问题（做得动）；看 + 判断的空缺是「能力」问题（现有栈无法可靠达成）。

---

## 2. 精修技法流水线（逐项 feasibility）

顺序：分析诊断 → 瑕疵修复 → 磨皮(频率分离) → 中性灰减淡加深 → 液化塑形 → 调色 → 锐化通透 → 背景/净化/投影 → 输出。

| 技法 | feasibility | 说明 |
|---|---|---|
| 分析诊断/制定计划 | **needs-vision** | 全流程总入口；精修师90%质量差距在这拉开。要 VLM 输出结构化问题清单(区域+类型+严重度)，通用 VLM 说不准坐标 |
| 瑕疵修复/去杂物 | pixel-algo + **needs-vision** | 动作可复制(healingBrush/内容识别填充/仿制)；「瑕疵在哪、哪些该留」要视觉。产品灰尘/线头=白底高频离群点，算法可定位 |
| 磨皮/频率分离 | pixel-algo + **needs-decision** | 拆高低频是纯数学(可脚本化)；「抹哪、抹多重」磨过头=塑料脸。反差最大的技法 |
| 中性灰减淡加深(D&B) | **needs-decision** | 建层可做(已 addDodgeBurnLayer)；「哪里亮暗、多少、美的节奏」纯审美，最难自动化 |
| 液化/塑形 | pixel-algo + **needs-decision** | **我们已有较成熟基建**(contour-detector 提轮廓+morph-executor 变形)，产品形态统一是自动化程度最高的技法之一；「推到哪算美/真」仍需判断 |
| 调色/白平衡/曲线 | **clean-tool** | batchPlay 一行下发调整图层最干净；产品「还原真实色」有客观解(对色卡→取色+色差逼近半自动)；氛围调色是审美 |
| 锐化/清晰度/通透 | **clean-tool** | USM/smartSharpen 可按尺寸规则化+保守预设；过锐区间窄，可预设+复核兜底 |
| 背景/抠图/净化 | pixel-algo | 规则主体(袜子/鞋)selectSubject+白底净化可高度自动化；发丝/半透明难 |
| 投影重建(产品向) | **needs-decision** | 阴影灰度图可从轮廓+光源算(可脚本)；「多虚多浓、方向」假阴影一眼假 |
| 去反光/高光控制(产品向) | pixel-algo + **needs-decision** | 过曝高光区=明度阈值离群检测(客观可定位)；「压多少、保留哪些反光才真」需判断 |
| 输出/交付适配 | **clean-tool** | 尺寸/格式/命名/色彩空间纯规则，已有导出基建；零审美 |

---

## 3. 现有可复用资产（本仓库读码补齐）

- **分割/抠图**：`sam-service.ts`(SAM2/MobileSAM ONNX,真实推理,box/point→mask)、`matting-service.ts`(BiRefNet ONNX)、`local-detection-service.ts`(Human Parsing SCHP + Grounding DINO/YOLO-World)。→ 给精修提供**像素级选区**，已就绪可复用。
- **⚠️ 假实现**：Grounding DINO 的 `simpleTokenize`(字符级)、YOLO-World 的 `getTextEmbedding`(Math.sin 伪向量)——**文本引导定位不可信**，要么修真 tokenizer/CLIP，要么走「VLM 粗框→SAM 精修」两段式。
- **重绘/去杂物**：`inpainting-service.ts`(云端 FLUX/Jimeng/Gemini)——**整区重绘，非外科式修补**。
- **谐调/光影**：`harmonization-tool`(ic-light 类光影融合)。
- **形变**：`morphing/`(apply-displacement 位移场 + enhanced-morph-executor MLS + contour-detector)——**自建变形引擎，形态统一方向已较成熟**。
- **调色**：`adjustment-layers.ts`(6 种调整图层)。
- **视觉理解**：`visual-understanding.ts`/`visual-thinking-service.ts`/aesthetic vlm——**全是排版/电商设计评审，精修域空白**。
- **本会话新增**：`addDodgeBurnLayer`(中性灰)、`warpLayer`(预设变形)。
- **模型接入现状**：默认视觉模型 mimo-v2.5(云)/llava-7b(本地)，**非顶级视觉**，像素级瑕疵定位偏弱(见记忆 model-access-no-google-api)。

---

## 4. 外部 AI 技术（curl 调研，未实机）

大部分能进现有 `onnxruntime-node + sharp` 栈：
- **face-parsing**（jonathandinu SegFormer / yakhyo BiSeNet，ONNX，成熟）→ 皮肤区分割，「只磨皮避开五官」。**clean-tool 可直接接**。
- **MediaPipe FaceMesh**（468 landmark）→ face-aware liquify/分区磨皮的几何基础；但变形要自写 TPS/MLS。
- **IOPaint(LaMa)**（23k star）→ 最省事的去杂物/去反光，本地 sidecar，但需拉 Python 子进程。
- **LaMa ONNX**（社区导出）→ 纯本地擦除，进现有栈，但权重可靠性存疑。
- **CodeFormer/GFPGAN** → 人脸修复，**会重绘整脸、改身份/失真风险，只能当可选增强，默认开会翻车**。
- **anomalib**（工业缺陷检测）→ 无监督需按品类训练/校准，泛化差、落地成本高；**不如「VLM 圈区 + SAM/LaMa 擦除」组合**。
- **结论**：外部技术能补「定位辅助」，**补不上「判断强度」**；**没有可靠可插拔的开源端到端自动磨皮模型**（ABPN 类多闭源学术）。

---

## 5. 诚实的「做不到 / 别承诺」清单

1. **无监督全自动人像磨皮/塑形**——磨皮/D&B 的「度」规则约束不住，人像「好看」高度主观。
2. **「接一个模型就自动精修脸」**——没有可靠开源端到端磨皮模型；只能「landmark/分割定位 + 经典频率分离 + 选区擦除 + 可选人脸修复」组合拳，要自写变形/频率分离。
3. **真正外科式像素修补**——73 工具零精修原语，UXP 对 healing/clone/liquify 脚本支持有限，短期 infeasible，只能「蒙版+调整图层+外部 inpainting」逼近。
4. **通用电商瑕疵检测模型**——无监督需训练/校准，不如「VLM 圈区 + SAM/LaMa 擦除」。
5. **别把「能下发命令」当「效果达专业级」**——自写 pixel-algo 从「能写」到「效果好」有大量调参距离，且未真机实测。

---

## 6. 分阶段现实路线

**P0 · 最快见效、不依赖强视觉（客观正解的环节）**
- 白底净化/硬边抠图、真实色还原(取色+色差逼近)、保守预设锐化/通透、输出适配、形态统一(复用 morphing 基建)。
- 为什么先做：产品/袜子向**客观正解**、几乎零审美门槛、多数已有基建。
- 验证：色差对色卡量化、白底 255 判定；**所有 batchPlay 脚本需真机跑通**（补 UXP 可自动化性缺研究）。

**P1 · 补视觉诊断层（把「看」从空白拉到可用）**
- 写精修「体检」提示词/schema 输出结构化瑕疵清单；接 face-parsing/landmark ONNX 进现有栈；搭「VLM 粗框→SAM 精修」两段式定位；**先修掉假实现**(simpleTokenize/Math.sin)。
- 硬约束：默认视觉模型偏弱，像素级瑕疵定位不准；必要时接更强视觉模型。

**P2 · 决策层 + 验证层（治「判断」与防翻车）**
- 像素级修前/后 diff 伪影检测(pixel-algo 自写：局部方差降幅判过度磨皮、边缘光晕、频谱塑料感)；把「验证」从设计打分扩到精修翻车模式；决策层先做**保守区间预设 + 视觉复核兜底**，不追求全自动强度。

**P3 · 外部 AI 集成（按需）**
- IOPaint/LaMa 去杂物 sidecar；face-parsing 皮肤区；可选 CodeFormer 人脸增强(默认关)。

**加法总原则**：先把「有客观正解、动作可复制」的产品向技法做扎实（P0），再补眼睛（P1），最后碰审美决策（P2）；每一步 UXP batchPlay 都要真机验证，别把「能下发」当「效果好」。

---

## 附：与已有研究/记忆的呼应
本研究印证了 [[design-route-a-eyes-hands-brain]]「眼+脑是瓶颈」、[[model-access-no-google-api]]「默认视觉偏弱」、[[design-capability-governance-audit]]「建好未接线」等既有判断，并把「精修」这一具体域的技法-可行性-路线补全。相关 docs/custom-liquify-feasibility-for-sock-morphing.md（液化路线）、learn-claude-code-harness-and-designecho-gap.md（harness 框架）。
