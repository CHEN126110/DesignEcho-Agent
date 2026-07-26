import { Tool, ToolResult, ToolSchema } from '../types';
import { getEntryFromPath } from '../../core/file-url';
import {
    buildSockLayoutExecutionPlan,
    inferSockLayoutProjectPaths,
    parseSockColorCombos,
    parseSockColorCombosValidated,
    parseSockColorCsv,
    parseSockLayoutCsv,
    type BuildSockLayoutExecutionPlanInput
} from './sock-layout-config';

type SockLayoutConfigToolParams = BuildSockLayoutExecutionPlanInput & {
    action?: 'inferProjectPaths' | 'parseLayoutCsv' | 'parseColorCsv' | 'parseCombos' | 'buildPlan';
    layoutCsvPath?: string;
    colorCsvPath?: string;
};

async function readTextFile(filePath: string): Promise<string> {
    const { storage } = require('uxp');
    const localFs = storage.localFileSystem;
    const entry = await getEntryFromPath(localFs, filePath);
    return await entry.read({ format: storage.formats.utf8 });
}

/**
 * 尽力扫描项目模板目录，返回模板文件名列表。
 *
 * 用于组合优先路径按颜色数精确匹配真实模板文件、并对缺失模板给出提醒。
 * 目录不存在 / 无访问权限时静默降级为空数组，此时按约定名（N双装）推断，
 * 不阻断"只填颜色组合"主流程。
 */
async function listTemplateFileNames(templateDir?: string): Promise<string[]> {
    const dir = String(templateDir || '').trim();
    if (!dir) return [];
    try {
        const { storage } = require('uxp');
        const entry = await getEntryFromPath(storage.localFileSystem, dir);
        if (!entry?.isFolder) return [];
        const children = await entry.getEntries();
        return (Array.isArray(children) ? children : [])
            .filter((child: any) => child?.isFile)
            .map((child: any) => String(child?.name || '').trim())
            .filter(Boolean);
    } catch (error: any) {
        console.warn(`[SockLayoutConfig] 模板目录扫描跳过（改用约定名推断）：${error?.message || error}`);
        return [];
    }
}

/**
 * Legacy 6.0 sock layout configuration feature.
 *
 * This tool does not write Photoshop documents. It prepares the unified plan
 * consumed by skuLayout, so the old ScriptUI fields become inspectable,
 * reusable and easier to diagnose inside the UXP plugin.
 */
export class SockLayoutConfigTool implements Tool {
    name = 'sockLayoutConfig';

    schema: ToolSchema = {
        name: 'sockLayoutConfig',
        description: 'SKU 编排配置入口。首选"组合优先"：只需按行填写颜色组合（comboText），颜色数自动匹配 N双装 模板，输出可直接交给 skuLayout 执行的 combos 分组；同时兼容旧版排版 CSV + 颜色 CSV。本工具只读，不写入 Photoshop。',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['inferProjectPaths', 'parseLayoutCsv', 'parseColorCsv', 'parseCombos', 'buildPlan'],
                    description: '操作类型：推断项目路径、解析排版 CSV、解析颜色 CSV、解析颜色组合或生成统一执行计划'
                },
                projectRoot: {
                    type: 'string',
                    description: '项目根目录。默认推断 PSD、模板文件、配置文件、SKU 输出目录'
                },
                comboText: {
                    type: 'string',
                    description: '组合优先输入：每行一组颜色，用 + / | / 、/ 空格 分隔，例如「白色+奶白+蓝色」。颜色数自动匹配 N双装 模板'
                },
                templateName: {
                    type: 'string',
                    description: '可选：全局模板覆盖。留空按颜色数自动匹配 N双装；填「N双自选备注」等按备注模式处理所有组合'
                },
                availableTemplates: {
                    type: 'array',
                    description: '可选：模板目录里真实存在的模板文件名列表；不传时工具会尽力自动扫描项目模板目录'
                },
                layoutCsvText: {
                    type: 'string',
                    description: '旧版排版 CSV 文本，列名应包含「模板」和「配色」（组合优先路径下无需填写）'
                },
                colorCsvText: {
                    type: 'string',
                    description: '旧版颜色 CSV 文本，建议列名为「颜色,exValue,编号」（组合优先路径下无需填写）'
                },
                layoutCsvPath: {
                    type: 'string',
                    description: '可选：排版 CSV 本地路径。传入后由 UXP 读取'
                },
                colorCsvPath: {
                    type: 'string',
                    description: '可选：颜色 CSV 本地路径。传入后由 UXP 读取'
                },
                outputPattern: {
                    type: 'string',
                    description: '输出命名模板，支持 %模板%、%素材%、%素材目录%、%模板目录%、%模板ID%、%文件序号%'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 1-12，默认 12'
                },
                autoAdjustQuality: {
                    type: 'boolean',
                    description: '是否启用目标大小质量调整；执行层仍需按计划使用该配置'
                },
                targetSizeMb: {
                    type: 'number',
                    description: '目标文件大小 MB；autoAdjustQuality 为 true 时必须大于 0'
                }
            },
            required: []
        }
    };

    async execute(params: SockLayoutConfigToolParams = {}): Promise<ToolResult<any>> {
        try {
            const action = params.action || 'buildPlan';

            if (action === 'inferProjectPaths') {
                return {
                    success: true,
                    data: inferSockLayoutProjectPaths(params.projectRoot, params.paths || {})
                };
            }

            if (action === 'parseCombos') {
                const parsed = parseSockColorCombosValidated(params.comboText || '');
                if (parsed.error) {
                    return { success: false, error: parsed.error, data: { combos: [] } };
                }
                return {
                    success: true,
                    data: {
                        combos: parsed.combos
                    }
                };
            }

            const layoutCsvText = params.layoutCsvPath
                ? await readTextFile(params.layoutCsvPath)
                : params.layoutCsvText;
            const colorCsvText = params.colorCsvPath
                ? await readTextFile(params.colorCsvPath)
                : params.colorCsvText;

            if (action === 'parseLayoutCsv') {
                return {
                    success: true,
                    data: {
                        rows: parseSockLayoutCsv(layoutCsvText || '')
                    }
                };
            }

            if (action === 'parseColorCsv') {
                return {
                    success: true,
                    data: {
                        rows: parseSockColorCsv(colorCsvText || '')
                    }
                };
            }

            // 组合优先路径下尽力扫描项目模板目录，用于精确匹配真实模板并提醒缺失。
            const usesCombos = params.comboText !== undefined || Array.isArray(params.combos);
            let availableTemplates = params.availableTemplates;
            if (usesCombos && (!availableTemplates || availableTemplates.length === 0)) {
                const inferredPaths = inferSockLayoutProjectPaths(params.projectRoot, params.paths || {});
                const scanned = await listTemplateFileNames(inferredPaths.templateDir);
                if (scanned.length > 0) {
                    availableTemplates = scanned;
                }
            }

            const plan = buildSockLayoutExecutionPlan({
                ...params,
                layoutCsvText,
                colorCsvText,
                availableTemplates
            });

            return {
                success: plan.status === 'ready',
                error: plan.status === 'blocked' ? plan.blockers.join('\n') : undefined,
                data: plan
            };
        } catch (error: any) {
            return {
                success: false,
                error: `袜子排版配置解析失败：${error?.message || String(error)}`,
                data: null
            };
        }
    }
}
