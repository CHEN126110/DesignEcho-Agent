#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 技能工具显示透明化
 *
 * 守护的不变量（2026-07-02）：
 * 1. 用户可见步骤里，技能工具必须显示「技能·<中文显示名>」，不得落到通用兜底"执行操作"
 *    ——用户要能明确看到 Agent 使用了哪个技能（透明化诉求的直接落点）。
 * 2. 显示名单一来源 = SkillDeclaration.displayName（缺省回退 name），显示层不得另建技能名映射表。
 * 3. 全部 user-facing 技能声明必须带中文 displayName（防新技能漏填回到"执行操作"）。
 * 4. 原子工具与未知工具的显示行为不变（placeImage→置入图片；未知→执行操作兜底）。
 */

const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    compilerOptions: { module: 'commonjs', moduleResolution: 'node' }
});

const ROOT = path.resolve(__dirname, '..');
const { getToolDisplayInfo } = require(path.join(ROOT, 'src/renderer/services/tool-display-info.ts'));
const { SKILL_REGISTRY } = require(path.join(ROOT, 'src/shared/skills/skill-declarations.ts'));

let failures = 0;
function check(name, ok, hint) {
    if (ok) {
        console.log(`  ok  ${name}`);
    } else {
        failures += 1;
        console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`);
    }
}

// 1+2) 技能工具显示「技能·中文名」，来源是声明的 displayName
for (const skill of SKILL_REGISTRY) {
    const info = getToolDisplayInfo(skill.id);
    check(
        `技能 ${skill.id} 显示为「技能·」前缀`,
        typeof info.name === 'string' && info.name.startsWith('技能·'),
        `实际显示: ${info.name}`
    );
    check(
        `技能 ${skill.id} 显示名来自声明（displayName 优先）`,
        info.name === `技能·${skill.displayName || skill.name}`,
        `实际显示: ${info.name}`
    );
}

// 3) user-facing 技能必须有中文 displayName（含至少一个 CJK 字符）
for (const skill of SKILL_REGISTRY) {
    if (skill.visibility !== 'user-facing') continue;
    check(
        `user-facing 技能 ${skill.id} 带中文 displayName`,
        typeof skill.displayName === 'string' && /[一-鿿]/.test(skill.displayName),
        `displayName: ${String(skill.displayName)}`
    );
}

// 4) 原子工具与兜底行为不变
check('placeImage 显示不受影响', getToolDisplayInfo('placeImage').name === '置入图片');
check('未知工具仍走"执行操作"兜底', getToolDisplayInfo('this-tool-does-not-exist').name === '执行操作');

if (failures > 0) {
    console.error(`[smoke-skill-tool-display] FAILED (${failures})`);
    process.exit(1);
}
console.log('[smoke-skill-tool-display] passed');
