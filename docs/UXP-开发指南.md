# Adobe Photoshop UXP 开发指南

> **适用版本**: Photoshop 26.0+ (UXP 7.0+)  
> **更新日期**: 2026-01-25  
> **官方文档**: https://developer.adobe.com/photoshop/uxp/

---

## 目录

1. [UXP 概述](#1-uxp-概述)
2. [开发环境](#2-开发环境)
3. [项目结构](#3-项目结构)
4. [Manifest 配置](#4-manifest-配置)
5. [Photoshop API](#5-photoshop-api)
6. [batchPlay 详解](#6-batchplay-详解)
7. [WebView 集成](#7-webview-集成)
8. [调试与发布](#8-调试与发布)

---

## 1. UXP 概述

### 1.1 什么是 UXP

**UXP (Unified Extensibility Platform)** 是 Adobe 新一代插件平台，用于替代旧的 CEP (Common Extensibility Platform)。

| 特性 | CEP (旧) | UXP (新) |
|------|---------|----------|
| 运行时 | Chromium + Node.js | Adobe 自研 JS 引擎 |
| 性能 | 较慢 | 快 3-5 倍 |
| 安全性 | 较低 | 沙箱隔离 |
| 入口 | HTML + ExtendScript | JavaScript + manifest.json |
| 原生 API | 有限 | 完整 batchPlay |

### 1.2 UXP 架构

```
┌─────────────────────────────────────────────────┐
│                 Photoshop 宿主                   │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────────────────┐ │
│  │  UXP 引擎   │◄──►│     Photoshop 核心       │ │
│  │ (JS 运行时) │    │  (batchPlay/ActionDesc) │ │
│  └─────────────┘    └─────────────────────────┘ │
│         │                                       │
│         ▼                                       │
│  ┌─────────────────────────────────────────────┐│
│  │              你的插件代码                    ││
│  │  - manifest.json (入口配置)                 ││
│  │  - index.js (主逻辑)                        ││
│  │  - Panel HTML (可选)                        ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

---

## 2. 开发环境

### 2.1 必备工具

| 工具 | 用途 | 下载 |
|------|------|------|
| **UXP Developer Tool** | 插件加载/调试 | Photoshop 内置 |
| **Node.js 20+** | TypeScript 编译 | nodejs.org |
| **VS Code** | 代码编辑 | code.visualstudio.com |

### 2.2 UXP Developer Tool

打开方式：Photoshop → Plugins → Development → UXP Developer Tool

功能：
- **Add Plugin**: 加载本地插件目录
- **Load**: 启动插件
- **Reload**: 重新加载（代码更新后）
- **Debug**: 打开 Chrome DevTools
- **Watch**: 自动重载模式

### 2.3 TypeScript 配置

```json
// tsconfig.json
{
    "compilerOptions": {
        "target": "ES2020",
        "module": "ESNext",
        "moduleResolution": "node",
        "lib": ["ES2020", "DOM"],
        "outDir": "./dist",
        "strict": true,
        "esModuleInterop": true
    }
}
```

---

## 3. 项目结构

### 3.1 基础结构

```
my-uxp-plugin/
├── manifest.json       # 必需：插件配置
├── index.js            # 必需：入口文件
├── icons/              # 可选：插件图标
│   ├── icon@1x.png
│   └── icon@2x.png
└── panel.html          # 可选：面板 UI
```

### 3.2 TypeScript 项目结构

```
my-uxp-plugin/
├── src/
│   ├── index.ts        # 源码入口
│   ├── core/           # 核心模块
│   └── tools/          # 工具实现
├── dist/
│   └── index.js        # 编译输出
├── manifest.json
├── package.json
├── tsconfig.json
└── webpack.config.js
```

---

## 4. Manifest 配置

### 4.1 完整示例

```json
{
    "manifestVersion": 6,
    "id": "com.yourcompany.myplugin",
    "name": "My Plugin",
    "version": "1.0.0",
    "main": "dist/index.js",
    
    "host": {
        "app": "PS",
        "minVersion": "26.0.0"
    },
    
    "entrypoints": [
        {
            "type": "panel",
            "id": "mainPanel",
            "label": { "default": "My Panel" },
            "minimumSize": { "width": 280, "height": 400 },
            "maximumSize": { "width": 400, "height": 800 },
            "preferredDockedSize": { "width": 280, "height": 500 },
            "icons": [
                { "width": 23, "height": 23, "path": "icons/icon@1x.png", "scale": [1] },
                { "width": 46, "height": 46, "path": "icons/icon@2x.png", "scale": [2] }
            ]
        }
    ],
    
    "requiredPermissions": {
        "network": { "domains": "all" },
        "webview": {
            "allow": "yes",
            "domains": ["http://localhost:*"],
            "enableMessageBridge": "localAndRemote"
        },
        "clipboard": "readAndWrite",
        "localFileSystem": "request"
    }
}
```

### 4.2 关键配置项

| 字段 | 说明 |
|------|------|
| `manifestVersion` | 固定为 6 |
| `id` | 唯一标识符（反向域名格式） |
| `main` | 入口 JS 文件路径 |
| `host.app` | PS = Photoshop |
| `host.minVersion` | 最低支持版本 |
| `entrypoints` | 面板/命令入口 |
| `requiredPermissions` | 权限声明 |

---

## 5. Photoshop API

### 5.1 核心模块

```javascript
// 导入 Photoshop 模块
const { app, core, action } = require('photoshop');
const { entrypoints } = require('uxp');
```

### 5.2 常用 API

```javascript
// 获取当前文档
const doc = app.activeDocument;

// 获取选中图层
const layers = doc.activeLayers;

// 创建新文档
const newDoc = await app.createDocument({
    width: 1920,
    height: 1080,
    resolution: 72,
    mode: 'RGBColorMode',
    fill: 'white'
});

// 获取所有打开的文档
const allDocs = app.documents;
```

### 5.3 executeAsModal

**重要**: 所有修改 Photoshop 状态的操作必须在 `executeAsModal` 中执行。

```javascript
await core.executeAsModal(async () => {
    // 在这里执行 Photoshop 操作
    const layer = doc.activeLayers[0];
    layer.name = 'New Name';
    
    // 或者使用 batchPlay
    await action.batchPlay([...], {});
    
}, { commandName: '操作名称' });
```

---

## 6. batchPlay 详解

### 6.1 什么是 batchPlay

`batchPlay` 是执行 Photoshop 底层操作的核心 API，类似于 ExtendScript 中的 `executeAction`。

### 6.2 基础语法

```javascript
const result = await action.batchPlay([
    {
        _obj: 'actionName',           // 操作名称
        _target: [{ _ref: 'layer' }], // 目标对象
        // ... 其他参数
        _options: { dialogOptions: 'dontDisplay' }
    }
], { synchronousExecution: true });
```

### 6.3 常用操作示例

#### 选择图层

```javascript
await action.batchPlay([{
    _obj: 'select',
    _target: [{ _ref: 'layer', _id: layerId }],
    makeVisible: true,
    _options: { dialogOptions: 'dontDisplay' }
}], { synchronousExecution: true });
```

#### 移动图层

```javascript
await action.batchPlay([{
    _obj: 'move',
    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
    to: {
        _obj: 'offset',
        horizontal: { _unit: 'pixelsUnit', _value: deltaX },
        vertical: { _unit: 'pixelsUnit', _value: deltaY }
    },
    _options: { dialogOptions: 'dontDisplay' }
}], { synchronousExecution: true });
```

#### 添加图层蒙版

```javascript
await action.batchPlay([{
    _obj: 'make',
    new: { _class: 'channel' },
    at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
    using: { _enum: 'userMaskEnabled', _value: 'revealAll' },
    _options: { dialogOptions: 'dontDisplay' }
}], { synchronousExecution: true });
```

#### 获取图层信息

```javascript
const result = await action.batchPlay([{
    _obj: 'get',
    _target: [
        { _property: 'bounds' },
        { _ref: 'layer', _id: layerId }
    ]
}], { synchronousExecution: true });

const bounds = result[0].bounds;
```

### 6.4 调试 batchPlay

使用 Alchemist 插件录制操作：
1. 安装 Alchemist (UXP 版本)
2. 执行 Photoshop 操作
3. 查看生成的 batchPlay 代码

---

## 7. WebView 集成

### 7.1 WebView 概述

UXP 支持在面板中嵌入 WebView，用于显示复杂 UI 或加载远程内容。

### 7.2 Manifest 配置

```json
{
    "requiredPermissions": {
        "webview": {
            "allow": "yes",
            "domains": ["http://127.0.0.1:8766"],
            "allowLocalRendering": "yes",
            "enableMessageBridge": "localAndRemote"
        }
    }
}
```

### 7.3 创建 WebView

```javascript
function renderPanel(container) {
    container.innerHTML = `
        <webview 
            id="my-webview" 
            src="http://127.0.0.1:8766"
            width="280"
            height="600"
            uxpAllowInspector="true"
        ></webview>
    `;
    
    const webview = container.querySelector('#my-webview');
    
    // 监听加载完成
    webview.addEventListener('loadstop', () => {
        console.log('WebView loaded');
    });
    
    // 监听消息
    webview.addEventListener('message', (e) => {
        console.log('Message from WebView:', e.data);
    });
}
```

### 7.4 双向通信

```javascript
// UXP → WebView
webview.postMessage({ type: 'update', data: {...} }, '*');

// WebView → UXP (在 WebView 内的代码)
window.parent.postMessage({ type: 'action', payload: {...} }, '*');
```

---

## 8. 调试与发布

### 8.1 调试技巧

```javascript
// 控制台日志
console.log('[MyPlugin]', data);

// 使用 UXP Developer Tool 的 Debug 按钮打开 DevTools

// 条件断点
debugger; // 会在 DevTools 中暂停
```

### 8.2 错误处理

```javascript
try {
    await core.executeAsModal(async () => {
        // 操作
    }, { commandName: 'My Operation' });
} catch (error) {
    console.error('[MyPlugin] Error:', error.message);
    // 可以显示用户提示
}
```

### 8.3 发布流程

1. **打包**: 确保 `dist/` 包含编译后的代码
2. **测试**: 在不同版本 Photoshop 中测试
3. **签名**: 使用 Adobe 开发者账号签名
4. **发布**: 提交到 Adobe Exchange

### 8.4 CCX 打包

```bash
# 使用 Adobe ZXPSignCmd 签名
ZXPSignCmd -sign <input_folder> <output.zxp> <certificate.p12> <password>
```

---

## 9. 最新实践

### 9.1 性能优化技巧

```javascript
// 1. 批量 batchPlay - 合并多个操作
// ❌ 低效：多次调用
await action.batchPlay([{ _obj: 'select', ... }], {});
await action.batchPlay([{ _obj: 'move', ... }], {});
await action.batchPlay([{ _obj: 'set', ... }], {});

// ✅ 高效：合并为一次调用
await action.batchPlay([
    { _obj: 'select', ... },
    { _obj: 'move', ... },
    { _obj: 'set', ... }
], { synchronousExecution: true });

// 2. 使用 historyState 减少撤销步骤
await core.executeAsModal(async (executionContext) => {
    const hostControl = executionContext.hostControl;
    const suspensionID = await hostControl.suspendHistory({
        documentID: doc.id,
        name: '批量操作'  // 合并为一个撤销步骤
    });
    
    try {
        // 执行多个操作...
        await operation1();
        await operation2();
        await operation3();
    } finally {
        await hostControl.resumeHistory(suspensionID);
    }
}, { commandName: '批量操作' });

// 3. 避免频繁读取文档状态
// ❌ 每次循环都读取
for (const layer of layers) {
    const doc = app.activeDocument;  // 每次都读取
    await processLayer(layer, doc);
}

// ✅ 缓存引用
const doc = app.activeDocument;
for (const layer of layers) {
    await processLayer(layer, doc);
}
```

### 9.2 WebSocket 最佳实践

```javascript
// 1. 心跳检测保活
class RobustWebSocket {
    constructor(url) {
        this.url = url;
        this.heartbeatInterval = 30000;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
    }
    
    connect() {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
            this.reconnectDelay = 1000;  // 重置重连延迟
            this.startHeartbeat();
        };
        
        this.ws.onclose = () => {
            this.stopHeartbeat();
            this.scheduleReconnect();
        };
    }
    
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, this.heartbeatInterval);
    }
    
    scheduleReconnect() {
        setTimeout(() => {
            this.connect();
        }, this.reconnectDelay);
        
        // 指数退避
        this.reconnectDelay = Math.min(
            this.reconnectDelay * 2, 
            this.maxReconnectDelay
        );
    }
}

// 2. 二进制数据高效处理
ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
        // 重要：复制数据，避免被重用的 buffer 覆盖
        const copy = new Uint8Array(event.data.slice(0));
        handleBinaryData(copy);
    } else {
        handleTextMessage(event.data);
    }
};
```

### 9.3 内存管理

```javascript
// 1. 大图像处理时及时释放
async function processLargeImage(layerId) {
    let imageData = null;
    
    try {
        imageData = await getLayerPixelData(layerId);
        const result = await processImage(imageData);
        return result;
    } finally {
        // 及时释放大型 ArrayBuffer
        imageData = null;
    }
}

// 2. 避免闭包导致的内存泄漏
// ❌ 问题：闭包持有大对象引用
function setupHandler(largeData) {
    element.onclick = () => {
        console.log(largeData.length);  // 闭包持有 largeData
    };
}

// ✅ 解决：只保留必要的数据
function setupHandler(largeData) {
    const length = largeData.length;  // 只保留需要的值
    element.onclick = () => {
        console.log(length);
    };
}

// 3. 定期清理事件监听器
class PluginLifecycle {
    listeners = [];
    
    addListener(target, event, handler) {
        target.addEventListener(event, handler);
        this.listeners.push({ target, event, handler });
    }
    
    cleanup() {
        for (const { target, event, handler } of this.listeners) {
            target.removeEventListener(event, handler);
        }
        this.listeners = [];
    }
}
```

### 9.4 错误处理进阶

```javascript
// 1. 分层错误处理
class PluginError extends Error {
    constructor(code, message, details = null) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

async function safeExecute(operation, fallback = null) {
    try {
        return await operation();
    } catch (error) {
        // 分类处理
        if (error.message.includes('No active document')) {
            throw new PluginError('NO_DOCUMENT', '请先打开一个文档');
        }
        if (error.message.includes('User cancelled')) {
            return fallback;  // 用户取消不算错误
        }
        
        // 记录未知错误
        console.error('[Plugin] Unexpected error:', error);
        throw new PluginError('UNKNOWN', '操作失败，请重试');
    }
}

// 2. 用户友好的错误提示
async function showError(error) {
    const { app } = require('photoshop');
    
    const messages = {
        'NO_DOCUMENT': '请先打开一个 Photoshop 文档',
        'NO_LAYER': '请选择至少一个图层',
        'CONNECTION_LOST': '与服务器的连接已断开，正在重连...',
        'TIMEOUT': '操作超时，请稍后重试'
    };
    
    const message = messages[error.code] || error.message;
    await app.showAlert(message);
}
```

### 9.5 调试技巧进阶

```javascript
// 1. 条件日志
const DEBUG = process.env.NODE_ENV === 'development';

function debug(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', new Date().toISOString(), ...args);
    }
}

// 2. 性能计时
async function measureTime(name, operation) {
    const start = performance.now();
    try {
        return await operation();
    } finally {
        const duration = performance.now() - start;
        console.log(`[Perf] ${name}: ${duration.toFixed(2)}ms`);
    }
}

// 使用
await measureTime('batchPlay', async () => {
    await action.batchPlay([...], {});
});

// 3. 状态快照
function snapshot(label) {
    const doc = app.activeDocument;
    console.log(`[Snapshot: ${label}]`, {
        document: doc?.name,
        layers: doc?.layers?.length,
        activeLayers: doc?.activeLayers?.map(l => l.name),
        selection: doc?.selection?.bounds
    });
}
```

### 9.6 TypeScript 最佳实践

```typescript
// 1. 类型定义
interface BatchPlayResult {
    bounds?: {
        left: { _value: number };
        top: { _value: number };
        right: { _value: number };
        bottom: { _value: number };
    };
}

// 2. 类型安全的 batchPlay 封装
async function getLayerBounds(layerId: number): Promise<{
    left: number;
    top: number;
    width: number;
    height: number;
}> {
    const results = await action.batchPlay([{
        _obj: 'get',
        _target: [
            { _property: 'bounds' },
            { _ref: 'layer', _id: layerId }
        ]
    }], { synchronousExecution: true }) as BatchPlayResult[];
    
    const bounds = results[0].bounds!;
    return {
        left: bounds.left._value,
        top: bounds.top._value,
        width: bounds.right._value - bounds.left._value,
        height: bounds.bottom._value - bounds.top._value
    };
}

// 3. 使用 Zod 校验外部数据
import { z } from 'zod';

const MessageSchema = z.object({
    type: z.enum(['action', 'query', 'event']),
    payload: z.unknown()
});

function handleMessage(data: unknown) {
    const result = MessageSchema.safeParse(data);
    if (!result.success) {
        console.error('Invalid message:', result.error);
        return;
    }
    
    // result.data 现在是类型安全的
    processMessage(result.data);
}
```

---

## 附录

### A. 常见问题

| 问题 | 解决方案 |
|------|----------|
| 插件不加载 | 检查 manifest.json 语法 |
| executeAsModal 超时 | 增加超时时间或拆分操作 |
| batchPlay 失败 | 检查 _obj 和参数格式 |
| WebView 空白 | 检查域名白名单和服务器 |
| 内存占用高 | 及时释放大型 ArrayBuffer |
| WebSocket 断连 | 实现心跳和自动重连 |

### B. 性能检查清单

- [ ] 合并多个 batchPlay 调用
- [ ] 使用 suspendHistory 减少撤销步骤
- [ ] 缓存文档/图层引用
- [ ] 大图像处理后释放内存
- [ ] 清理事件监听器

### C. 参考资源

- [官方 UXP 文档](https://developer.adobe.com/photoshop/uxp/)
- [Photoshop API 参考](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/)
- [batchPlay 参考](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/)
- [Alchemist 插件](https://github.com/nickvl/Alchemist)
- [UXP 性能最佳实践](https://developer.adobe.com/photoshop/uxp/guides/uxp_guide/uxp-misc/performance/)

---

> **文档维护**: 请在 UXP API 更新后同步更新此文档
