# useChatActions 重构计划

> 此目录用于未来 useChatActions.ts 的模块化拆分

## 当前状态

`useChatActions.ts` 有 2600+ 行，包含多个职责：

## 可拆分模块

### 1. intent-detection.ts
- `quickIntentCheck()` - 快速意图检测
- `detectIntentFromText()` - 从文本检测意图
- `isGreetingOrIntro()` - 问候/介绍检测
- 约 150 行

### 2. skill-selection.ts  
- `buildSkillSelectionPrompt()` - 技能选择提示构建
- `parseSkillSelection()` - 解析技能选择结果
- `createSkillExecutor()` - 创建技能执行器
- `matchFastAction()` - 快速动作匹配
- 约 300 行

### 3. tool-definitions.ts
- `AVAILABLE_TOOLS` - 可用工具列表
- `VISION_TOOLS` - 视觉工具
- `AUTO_VERIFY_TOOLS` - 自动验证工具
- `RESOURCE_TOOLS` - 资源工具
- 约 120 行

### 4. response-builder.ts
- `buildChatOnlyPrompt()` - 聊天提示构建
- `getDefaultResponse()` - 默认响应
- `getResponseStrategy()` - 响应策略
- 约 100 行

### 5. tool-parser.ts
- `parseToolCalls()` - 解析工具调用
- 约 90 行

### 6. tool-executor.ts (已存在 tool-executor.service.ts)
- `executeToolCall()` - 执行工具调用
- `executeResourceTool()` - 执行资源工具
- 约 300 行

### 7. result-processor.ts
- `processToolResults()` - 处理工具结果
- `cleanAIResponse()` - 清理 AI 响应
- `buildDetailedErrorMessage()` - 构建错误消息
- 约 150 行

## 重构策略

1. **渐进式拆分** - 每次只拆分一个模块
2. **保持兼容** - 从 useChatActions.ts re-export
3. **测试验证** - 拆分后确保功能正常
4. **最终目标** - useChatActions.ts 只保留主 Hook 逻辑

## 依赖关系

```
useChatActions (主 Hook)
├── intent-detection
├── skill-selection
│   └── tool-definitions
├── response-builder
├── tool-parser
├── tool-executor (已独立)
└── result-processor
```

## 注意事项

- 工具执行逻辑已部分迁移到 `tool-executor.service.ts`
- 技能执行逻辑已部分迁移到 `skill-executors/`
- 拆分时需注意循环依赖
