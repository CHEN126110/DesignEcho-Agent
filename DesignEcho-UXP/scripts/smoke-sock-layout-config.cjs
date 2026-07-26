#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src', 'tools', 'sku', 'sock-layout-config.ts');
const registryPath = path.join(projectRoot, 'src', 'tools', 'registry.ts');
const packagePath = path.join(projectRoot, 'package.json');

function loadTsModule(filePath) {
    assert(fs.existsSync(filePath), `Missing helper module: ${path.relative(projectRoot, filePath)}`);
    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        }
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(transpiled, {
        module,
        exports: module.exports,
        require,
        console,
        TextDecoder
    }, { filename: filePath });
    return module.exports;
}

function main() {
    const config = loadTsModule(helperPath);

    const paths = config.inferSockLayoutProjectPaths('E:/Project/Socks');
    assert.strictEqual(paths.projectRoot, 'E:/Project/Socks', 'project root should be normalized');
    assert.strictEqual(paths.skuSourcePath, 'E:/Project/Socks/PSD/SKU.psb', 'default SKU source path changed');
    assert.strictEqual(paths.templateDir, 'E:/Project/Socks/模板文件', 'template directory inference changed');
    assert.strictEqual(paths.configDir, 'E:/Project/Socks/配置文件', 'config directory inference changed');
    assert.strictEqual(paths.outputDir, 'E:/Project/Socks/SKU', 'output directory inference changed');

    const colorRows = config.parseSockColorCsv([
        '颜色,exValue,编号',
        '白色,,1',
        '浅灰,#eeeeee,2',
        '黑色,#111111,3'
    ].join('\n'));
    assert.strictEqual(JSON.stringify(colorRows.map((row) => row.name)), JSON.stringify(['白色', '浅灰', '黑色']), 'color csv names changed');
    assert.strictEqual(colorRows[1].slot, 2, 'color slot parsing changed');

    const rows = config.parseSockLayoutCsv([
        '模板,配色',
        '2双装.tif,1+2',
        '2双装.tif,123',
        '2双装.tif,"1+3"',
        '2双自选备注.tif,1+2+3',
        '4双自选备注.tif,1+2|2+3'
    ].join('\n'));
    assert.strictEqual(rows.length, 5, 'layout row count changed');
    assert.strictEqual(rows[0].mode, 'combo', 'combo row classification changed');
    assert.strictEqual(JSON.stringify(rows[1].regions), JSON.stringify([[1, 2, 3]]), 'compact digit sequence parsing changed');
    assert.strictEqual(JSON.stringify(rows[3].regions), JSON.stringify([[1, 2, 3]]), 'single-region note parsing changed');
    assert.strictEqual(
        JSON.stringify(rows[4].regions),
        JSON.stringify([[1, 2, 2, 3]]),
        'pipe-separated colors should remain one ordered placeholder sequence in 6.3 mode'
    );

    const plan = config.buildSockLayoutExecutionPlan({
        projectRoot: 'E:/Project/Socks',
        layoutCsvText: [
            '模板,配色',
            '2双装.tif,1+2',
            '2双自选备注.tif,1+2+3'
        ].join('\n'),
        colorCsvText: [
            '颜色,exValue,编号',
            '白色,,1',
            '浅灰,,2',
            '黑色,,3'
        ].join('\n'),
        outputPattern: '%模板%/%文件序号%%素材%',
        targetSizeMb: 2,
        autoAdjustQuality: true
    });

    assert.strictEqual(plan.status, 'ready', `plan should be ready: ${plan.blockers.join('; ')}`);
    assert.strictEqual(plan.inputMode, 'csv', 'legacy CSV input should be tagged as csv mode');
    assert.strictEqual(plan.templateGroups.length, 2, 'CSV plan should group items into two templates');
    assert.strictEqual(plan.paths.templateDir, 'E:/Project/Socks/模板文件', 'plan should carry inferred template dir');
    assert.strictEqual(plan.items.length, 2, 'plan item count changed');
    assert.strictEqual(JSON.stringify(plan.items[0].colorNames), JSON.stringify(['白色', '浅灰']), 'combo color mapping changed');
    assert.strictEqual(JSON.stringify(plan.items[1].regions), JSON.stringify([['白色', '浅灰', '黑色']]), 'note color mapping changed');
    assert.strictEqual(plan.items[0].outputRelativePath, '2双装/1白色+浅灰.jpg', 'combo output pattern changed');
    assert.strictEqual(plan.items[1].outputRelativePath, '2双自选备注/1白色+浅灰+黑色.jpg', 'note output pattern changed');
    assert.strictEqual(plan.quality.autoAdjustQuality, true, 'auto quality flag changed');
    assert.strictEqual(plan.quality.targetSizeMb, 2, 'target size parsing changed');

    const blocked = config.buildSockLayoutExecutionPlan({
        layoutCsvText: '模板,配色\n2双装.tif,1+9',
        colorCsvText: '颜色,exValue,编号\n白色,,1'
    });
    assert.strictEqual(blocked.status, 'blocked', 'missing color slot should block');
    assert(blocked.blockers.some((item) => item.includes('颜色槽位 9')), 'missing slot blocker should be diagnostic');

    // === 组合优先路径（只填颜色组合） ===
    const combos = config.parseSockColorCombos('白色+奶白\n黑色 白色、灰色\n\n   ');
    assert.strictEqual(
        JSON.stringify(combos),
        JSON.stringify([['白色', '奶白'], ['黑色', '白色', '灰色']]),
        'combo lines should split on +/space/、 and drop blank lines'
    );

    const comboPlan = config.buildSockLayoutExecutionPlan({
        projectRoot: 'E:/Project/Socks',
        comboText: ['白色+白色', '黑色+白色', '白色+奶白+蓝色+灰白'].join('\n')
    });
    assert.strictEqual(comboPlan.inputMode, 'combos', 'comboText should route to combos mode');
    assert.strictEqual(comboPlan.status, 'ready', `combo plan should be ready: ${comboPlan.blockers.join('; ')}`);
    assert.strictEqual(comboPlan.items.length, 3, 'combo plan item count changed');
    assert.strictEqual(comboPlan.colorRows.length, 5, 'combo palette should be derived from unique color names');
    assert.strictEqual(comboPlan.items[0].templateName, '2双装', 'two-color combo should auto-map to 2双装');
    assert.strictEqual(comboPlan.items[0].mode, 'combo', 'auto-inferred combo mode changed');
    assert.strictEqual(comboPlan.items[0].outputRelativePath, '2双装/1白色+白色.jpg', 'combo output naming changed');
    assert.strictEqual(comboPlan.items[1].outputRelativePath, '2双装/2黑色+白色.jpg', 'per-template sequence numbering changed');
    assert.strictEqual(comboPlan.items[2].templateName, '4双装', 'four-color combo should auto-map to 4双装');
    assert.strictEqual(comboPlan.items[2].outputRelativePath, '4双装/1白色+奶白+蓝色+灰白.jpg', 'four-color combo output naming changed');
    assert.strictEqual(comboPlan.templateGroups.length, 2, 'combo plan should group into 2双装 and 4双装');
    assert.strictEqual(
        JSON.stringify(comboPlan.templateGroups[0].combos),
        JSON.stringify([['白色', '白色'], ['黑色', '白色']]),
        'template group combos should be execution-ready color name arrays'
    );

    const matchedPlan = config.buildSockLayoutExecutionPlan({
        projectRoot: 'E:/Project/Socks',
        comboText: '白色+白色\n白色+奶白+蓝色',
        availableTemplates: ['2双装.tif', '4双装.tif']
    });
    assert.strictEqual(matchedPlan.items[0].templateFileName, '2双装.tif', 'combo should bind to the real template file when available');
    assert.strictEqual(matchedPlan.items[0].outputRelativePath, '2双装/1白色+白色.jpg', 'real template output should still use the stripped template name');
    assert(matchedPlan.warnings.some((item) => item.includes('3双装')), 'missing 3双装 template should warn, not silently guess');
    const missingGroup = matchedPlan.templateGroups.find((group) => group.templateName === '3双装');
    assert(missingGroup && missingGroup.matchedRealTemplate === false, 'unmatched template group should be flagged');

    const notePlan = config.buildSockLayoutExecutionPlan({
        projectRoot: 'E:/Project/Socks',
        comboText: '白色+奶白+蓝色+灰白+灰色+黑色',
        templateName: '4双自选备注'
    });
    assert.strictEqual(notePlan.items.length, 1, 'note override should keep one item per line');
    assert.strictEqual(notePlan.items[0].mode, 'self_select_note', 'template override with 自选备注 should switch to note mode');
    assert.strictEqual(notePlan.items[0].templateName, '4双自选备注', 'note template override name changed');
    assert.strictEqual(
        notePlan.items[0].outputRelativePath,
        '4双自选备注/1白色+奶白+蓝色+灰白+灰色+黑色.jpg',
        'note override output naming changed'
    );

    const emptyCombo = config.buildSockLayoutExecutionPlan({ comboText: '   \n  ' });
    assert.strictEqual(emptyCombo.inputMode, 'combos', 'empty comboText should still be combos mode');
    assert.strictEqual(emptyCombo.status, 'blocked', 'empty combo input should block');
    assert(emptyCombo.blockers.some((item) => item.includes('未填写颜色组合')), 'empty combo blocker should be diagnostic');

    // buildPlan 与 parseCombos 同一条上限线：整段文本塌成一个超大组合必须 blocked，不许静默产出垃圾计划
    const oversizedCombo = config.buildSockLayoutExecutionPlan({
        comboText: Array.from({ length: 20 }, (_, i) => `颜色${i + 1}`).join('+')
    });
    assert.strictEqual(oversizedCombo.status, 'blocked', 'oversized combo (>8 colors) should block buildPlan');
    assert(oversizedCombo.blockers.some((item) => item.includes('上限')), 'oversized combo blocker should mention the per-combo color limit');

    // override 命中真实模板文件时回填真实文件名：执行层要按文件名从模板目录打开文档
    const overrideBackfill = config.buildSockLayoutExecutionPlan({
        projectRoot: 'E:/Project/Socks',
        comboText: '白色+奶白+蓝色+灰白',
        templateName: '4双自选备注',
        availableTemplates: ['4双自选备注.psd', '2双装.tif']
    });
    assert.strictEqual(overrideBackfill.items[0].templateFileName, '4双自选备注.psd', 'template override should backfill the real template file name');
    assert.strictEqual(overrideBackfill.templateGroups[0].matchedRealTemplate, true, 'backfilled override should be marked matchedRealTemplate');

    // 重复组合 → 警告不阻塞（输出同名，执行层去重只导出一份）
    const duplicated = config.buildSockLayoutExecutionPlan({
        projectRoot: 'E:/Project/Socks',
        comboText: '白色+白色\n白色+白色'
    });
    assert.strictEqual(duplicated.status, 'ready', 'duplicate combos should warn, not block');
    assert(duplicated.warnings.some((item) => item.includes('重复填写')), 'duplicate combos should produce an explicit warning');

    const registrySource = fs.readFileSync(registryPath, 'utf8');
    assert(registrySource.includes('SockLayoutConfigTool'), 'ToolRegistry should register SockLayoutConfigTool');

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert(packageJson.scripts['smoke:sock-layout-config'], 'package script should expose sock layout config smoke');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'legacy 6.0 sock layout project paths normalize into one config object',
            'layout CSV and color CSV parse into deterministic combo/note execution items (csv mode)',
            'combos-first input maps color counts to N双装 templates and derives the palette',
            'available templates bind to real files and missing sizes warn instead of guessing',
            'template override drives self-select-note mode; empty combos block diagnostically',
            'output naming and quality settings are centralized',
            'missing color slots block with a diagnostic message',
            'UXP tool registry exposes the sock layout config feature'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
