#!/usr/bin/env node
'use strict';

/**
 * 通用 autonomous executor 架构护栏。
 *
 * 目标不是统计几个旧变量名，而是阻止会真正改变控制流的品类牢笼重新进入 Harness：
 * - unknown 设计默认改写为详情页；
 * - 通用预算固定使用 detail-page；
 * - 进入设计任务后按品类缩窄 Tool / Skill；
 * - 在通用交互、场景判断或系统提示里维护详情页 / 主图 / SKU 专属分支。
 *
 * 任务类型身份可以来自 shared/design-task-types.ts，专业能力可以来自 Skill manifest；
 * 本文件只审计通用 executor 的可执行决策节点。报告写入 tmp/，任一违规 exit 1。
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const targetFile = path.join(
    root,
    'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'
);
const disciplineFile = path.join(root, 'src', 'shared', 'design-discipline-runtime.ts');
const legacySkillBridgeFile = path.join(
    root,
    'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts'
);
const businessVisualContextWrapperFile = path.join(
    root,
    'src', 'renderer', 'services', 'skill-executors', 'business-skill-visual-context.ts'
);
const skillDeclarationFile = path.join(root, 'src', 'shared', 'skills', 'skill-declarations.ts');
const disciplineDebtBaseline = Object.freeze({
    detailStageValidatorReferences: 0,
    detailStageModuleReferences: 0
});

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

function findFunction(sourceFile, name) {
    let found;
    function visit(node) {
        if (found) return;
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
            found = node;
            return;
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return found;
}

function collectNodes(node, predicate) {
    const matches = [];
    function visit(current) {
        if (predicate(current)) matches.push(current);
        ts.forEachChild(current, visit);
    }
    if (node) visit(node);
    return matches;
}

function compactSnippet(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function literalTexts(node, sourceFile) {
    return collectNodes(node, (current) => (
        ts.isStringLiteralLike(current)
        || current.kind === ts.SyntaxKind.RegularExpressionLiteral
    )).map((current) => current.getText(sourceFile));
}

function identifierCount(node, name) {
    return collectNodes(node, (current) => ts.isIdentifier(current) && current.text === name).length;
}

function findVariableDeclaration(sourceFile, name) {
    return collectNodes(sourceFile, (node) => (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.name.text === name
    ))[0];
}

function run() {
    if (!fs.existsSync(targetFile)) {
        console.error(JSON.stringify({
            success: false,
            error: `未找到目标文件：${path.relative(root, targetFile)}`
        }, null, 2));
        process.exit(1);
    }
    if (!fs.existsSync(legacySkillBridgeFile)) {
        console.error(JSON.stringify({
            success: false,
            error: `未找到 legacy Skill bridge：${path.relative(root, legacySkillBridgeFile)}`
        }, null, 2));
        process.exit(1);
    }
    if (!fs.existsSync(skillDeclarationFile)) {
        console.error(JSON.stringify({
            success: false,
            error: `未找到 Skill 声明源：${path.relative(root, skillDeclarationFile)}`
        }, null, 2));
        process.exit(1);
    }
    if (!fs.existsSync(businessVisualContextWrapperFile)) {
        console.error(JSON.stringify({
            success: false,
            error: `未找到业务视觉上下文 wrapper：${path.relative(root, businessVisualContextWrapperFile)}`
        }, null, 2));
        process.exit(1);
    }

    const sourceText = fs.readFileSync(targetFile, 'utf8');
    const sourceFile = ts.createSourceFile(
        targetFile,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const createWrapper = findFunction(sourceFile, 'createExecuteToolWrapper');
    const performancePolicyResolver = findFunction(sourceFile, 'resolveAutonomousPerformancePolicy');
    const toolSelection = findFunction(sourceFile, 'selectToolsForContext');
    const interactionRequest = findFunction(sourceFile, 'hasExplicitDesignInteractionRequest');
    const scenarioResolver = findFunction(sourceFile, 'resolveDesignerAgentScenario');
    const categoryPattern = /详情页|商品详情|主图|白底图|SKU|sku|detail[-_ ]?page|main[-_ ]?image/;

    const legacySkillBridgeText = fs.readFileSync(legacySkillBridgeFile, 'utf8');
    const legacySkillBridgeSourceFile = ts.createSourceFile(
        legacySkillBridgeFile,
        legacySkillBridgeText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const skillDeclarationText = fs.readFileSync(skillDeclarationFile, 'utf8');
    const skillDeclarationSourceFile = ts.createSourceFile(
        skillDeclarationFile,
        skillDeclarationText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const declaredSkillIds = new Set(collectNodes(
        skillDeclarationSourceFile,
        (node) => ts.isPropertyAssignment(node)
            && node.name?.getText(skillDeclarationSourceFile) === 'id'
            && ts.isStringLiteralLike(node.initializer)
    ).map((node) => node.initializer.text));
    // autonomous-agent 是循环自身，matte-product 的暂停属于已有跨切 Policy；
    // 除此之外，任何现有或新增 Skill 都不得在 legacy bridge 中形成业务分支。
    const policyOwnedSkillExceptions = new Set(['autonomous-agent', 'matte-product']);
    const protectedBusinessSkillIds = new Set(
        [...declaredSkillIds].filter((skillId) => !policyOwnedSkillExceptions.has(skillId))
    );
    const protectedBusinessSkillLiterals = literalTexts(legacySkillBridgeSourceFile, legacySkillBridgeSourceFile)
        .map((value) => value.replace(/^['"]|['"]$/g, ''))
        .filter((value) => protectedBusinessSkillIds.has(value));
    const prohibitedBusinessImports = collectNodes(
        legacySkillBridgeSourceFile,
        (node) => ts.isImportDeclaration(node)
    )
        .map((node) => node.moduleSpecifier)
        .filter((node) => ts.isStringLiteralLike(node))
        .map((node) => node.text)
        .filter((value) => /sku-(?:workflow-stages|template-design-loop|intent-params)/.test(value));

    const businessVisualContextWrapperText = fs.readFileSync(businessVisualContextWrapperFile, 'utf8');
    const businessVisualContextWrapperSourceFile = ts.createSourceFile(
        businessVisualContextWrapperFile,
        businessVisualContextWrapperText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const visualScenarioResolver = findFunction(
        businessVisualContextWrapperSourceFile,
        'getBusinessVisualObservationScenarioForSkill'
    );
    const parallelVisualScenarioMap = findVariableDeclaration(
        businessVisualContextWrapperSourceFile,
        'BUSINESS_VISUAL_SKILL_SCENARIOS'
    );
    const visualScenarioOwnershipViolations = [
        ...(parallelVisualScenarioMap ? ['parallel-map:BUSINESS_VISUAL_SKILL_SCENARIOS'] : []),
        ...(identifierCount(visualScenarioResolver, 'getSkillById') > 0 ? [] : ['missing:getSkillById']),
        ...(identifierCount(visualScenarioResolver, 'visualSamplingScenario') > 0 ? [] : ['missing:visualSamplingScenario'])
    ];

    const disciplineText = fs.readFileSync(disciplineFile, 'utf8');
    const disciplineSourceFile = ts.createSourceFile(
        disciplineFile,
        disciplineText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const transitionalCapabilityDebt = {
        detailStageValidatorReferences: identifierCount(disciplineSourceFile, 'validateDetailPageCreativeStagePlan'),
        detailStageModuleReferences: (disciplineText.match(/detail-page-creative-stage-plan/g) || []).length
    };
    const capabilityDebtGrowth = Object.entries(transitionalCapabilityDebt)
        .filter(([name, count]) => count > disciplineDebtBaseline[name])
        .map(([name, count]) => `${name}:${count}>${disciplineDebtBaseline[name]}`);
    const frameworkMethodOwnershipViolations = [
        ...(findVariableDeclaration(disciplineSourceFile, 'FRAMEWORK_TOOL_BY_SKILL')
            ? ['parallel-map:FRAMEWORK_TOOL_BY_SKILL']
            : []),
        ...(identifierCount(disciplineSourceFile, 'getManifestByTaskType') > 0
            ? []
            : ['missing:getManifestByTaskType'])
    ];
    const retiredDisciplineToolPolicyNames = [
        'TASK_TYPE_EXTRA_TOOL_NAMES',
        'TASK_TYPE_EXPOSED_EXTRA_TOOL_NAMES',
        'DESIGN_DISCIPLINE_CORE_TOOL_NAMES',
        'DESIGN_DISCIPLINE_EXPOSED_CORE_TOOL_NAMES',
        'DESIGN_DISCIPLINE_REFERENCE_TOOL_NAMES',
        'buildDesignDisciplineToolPolicy'
    ];
    const legacyDisciplineToolPolicyViolations = retiredDisciplineToolPolicyNames
        .filter((name) => identifierCount(disciplineSourceFile, name) > 0);

    const checks = [
        {
            id: 'unknown-document-role-default',
            description: '未知设计角色不得回退为 detailPage',
            violations: createWrapper && /targetRole\s*===\s*['"]unknown['"][\s\S]{0,160}\?\s*['"]detailPage['"]/.test(createWrapper.getText(sourceFile))
                ? [compactSnippet(createWrapper.getText(sourceFile).match(/targetRole\s*===[\s\S]{0,180}/)?.[0])]
                : []
        },
        {
            id: 'fixed-detail-page-budget',
            description: '通用设计预算不得固定 scenario=detail-page',
            violations: literalTexts(performancePolicyResolver, sourceFile)
                .filter((value) => /^['"]detail-page['"]$/.test(value))
                .map(compactSnippet)
        },
        {
            id: 'declarative-task-runtime-hints',
            description: '文档角色和预算场景必须来自声明式任务身份，不能在 Harness 自行猜默认',
            violations: [
                ['documentRole', identifierCount(createWrapper, 'runtimeHints') > 0 && identifierCount(createWrapper, 'documentRole') > 0],
                ['scenario', identifierCount(performancePolicyResolver, 'runtimeHints') > 0
                    && identifierCount(performancePolicyResolver, 'scenario') > 0]
            ].filter(([, present]) => !present).map(([name]) => `missing:${name}`)
        },
        {
            id: 'category-tool-cage',
            description: 'selectToolsForContext 不得按设计品类 policy/exposed 集缩窄 Tool Registry',
            violations: [
                ['buildDesignDisciplineToolPolicy', identifierCount(toolSelection, 'buildDesignDisciplineToolPolicy')],
                ['exposedToolNames', identifierCount(toolSelection, 'exposedToolNames')],
                ['DESIGN_DISCIPLINE_REFERENCE_TOOL_NAMES', identifierCount(toolSelection, 'DESIGN_DISCIPLINE_REFERENCE_TOOL_NAMES')]
            ].filter(([, count]) => count > 0).map(([name, count]) => `${name}×${count}`)
        },
        {
            id: 'creative-capability-denylist',
            description: '创意设计不得维护品类 Skill/Tool denylist',
            violations: sourceText.includes('CREATIVE_DESIGN_SKELETON_WORKFLOW_SKILLS_AND_TOOLS')
                ? ['CREATIVE_DESIGN_SKELETON_WORKFLOW_SKILLS_AND_TOOLS']
                : []
        },
        {
            id: 'category-interaction-gate',
            description: '交互确认能力不得只对某个设计品类开放',
            violations: literalTexts(interactionRequest, sourceFile)
                .filter((value) => categoryPattern.test(value))
                .map(compactSnippet)
        },
        {
            id: 'category-scenario-branch',
            description: '场景解析不得在 executor 内为详情页/主图/SKU 维护 if/regex 分支',
            violations: collectNodes(scenarioResolver, (node) => ts.isIfStatement(node) || ts.isConditionalExpression(node))
                .map((node) => node.getText(sourceFile))
                .filter((value) => categoryPattern.test(value))
                .map(compactSnippet)
        },
        {
            id: 'category-prompt-injection',
            description: '通用系统提示不得直接调用品类专属 prompt builder',
            violations: identifierCount(sourceFile, 'buildDetailPageCreativeStagePlanPromptSection') > 0
                ? ['buildDetailPageCreativeStagePlanPromptSection']
                : []
        },
        {
            id: 'capability-policy-debt-ratchet',
            description: 'Skill 知识/工具/阶段 policy 仍在迁出 design-discipline-runtime，只许减少不得扩张',
            violations: capabilityDebtGrowth
        },
        {
            id: 'framework-method-owned-by-skill-manifest',
            description: '品类方法论工具必须由现有 Skill Manifest 明确声明并绑定 knowledge_refs，不得在设计纪律运行时平行映射',
            violations: frameworkMethodOwnershipViolations
        },
        {
            id: 'legacy-discipline-tool-policy-retired',
            description: '设计纪律只消费执行结果，不得恢复已无生产消费者的品类 Tool 放行/暴露策略',
            violations: legacyDisciplineToolPolicyViolations
        },
        {
            id: 'legacy-skill-bridge-business-neutrality',
            description: 'legacy Skill bridge 只能做通用适配，不得导入业务流程模块或按受保护业务 Skill 分支',
            violations: [
                ...prohibitedBusinessImports.map((value) => `business-import:${value}`),
                ...protectedBusinessSkillLiterals.map((value) => `business-skill-literal:${value}`)
            ]
        },
        {
            id: 'visual-scenario-owned-by-skill-declaration',
            description: '视觉采样场景必须来自现有 Skill 声明，不得在通用 wrapper 维护平行映射表',
            violations: visualScenarioOwnershipViolations
        }
    ];

    const violationCount = checks.reduce((sum, check) => sum + check.violations.length, 0);
    const payload = {
        success: violationCount === 0,
        targetFile: path.relative(root, targetFile),
        transitionalCapabilityDebt: {
            targetFile: path.relative(root, disciplineFile),
            baseline: disciplineDebtBaseline,
            current: transitionalCapabilityDebt,
            status: capabilityDebtGrowth.length > 0 ? 'grew' : 'not_grown'
        },
        legacySkillBridge: {
            targetFile: path.relative(root, legacySkillBridgeFile),
            declaredSkillCount: declaredSkillIds.size,
            policyOwnedSkillExceptions: [...policyOwnedSkillExceptions],
            prohibitedBusinessImports,
            protectedBusinessSkillLiterals
        },
        businessVisualContextWrapper: {
            targetFile: path.relative(root, businessVisualContextWrapperFile),
            scenarioOwner: 'skill-declaration.visualSamplingScenario',
            hasParallelScenarioMap: Boolean(parallelVisualScenarioMap)
        },
        violationCount,
        checks,
        message: violationCount === 0
            ? '通用 executor 未发现已知品类控制流牢笼。'
            : `发现 ${violationCount} 处品类控制流牢笼；请把任务身份移到 design-task-types，把专业能力移到 Skill manifest，不要在 Harness 增加例外。`
    };

    const outputDirectory = path.join(root, 'tmp');
    ensureDirectory(outputDirectory);
    fs.writeFileSync(
        path.join(outputDirectory, 'autonomous-executor-generic-audit.json'),
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8'
    );
    console.log(JSON.stringify(payload, null, 2));
    process.exit(payload.success ? 0 : 1);
}

run();
