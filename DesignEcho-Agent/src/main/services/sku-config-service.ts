/**
 * SKU 配置解析服务
 * 
 * 解析袜子排版脚本的 CSV 配置格式：
 * - 配置文件: 模板名, 颜色组合 (如 "1|2|3" 或 "1+2|3+4")
 * - 颜色文件: 颜色名, 十六进制值
 * 
 * 基于 6.0袜子排版.jsx 的逻辑
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 简单 CSV 解析器
 */
function parseCSV(content: string): string[][] {
    const lines = content.split(/\r?\n/);
    const result: string[][] = [];
    
    for (const line of lines) {
        if (line.trim()) {
            // 简单的 CSV 解析，处理逗号分隔
            const cells = line.split(',').map(cell => cell.trim());
            result.push(cells);
        }
    }
    
    return result;
}

// ===== 类型定义 =====

export interface ColorConfig {
    id: number;           // 索引号
    name: string;         // 颜色名称
    hex: string;          // 十六进制颜色值
}

export interface TemplateConfig {
    templateName: string;         // 模板文件名
    zones: ZoneConfig[];          // 区域配置
    outputName?: string;          // 输出文件名
}

export interface ZoneConfig {
    zoneIndex: number;           // 区域索引
    colorIds: number[];          // 该区域使用的颜色 ID 列表
}

export interface SKUCombination {
    id: string;                  // 组合唯一标识
    templateName: string;        // 模板名
    colors: ColorConfig[];       // 使用的颜色列表
    zones: Array<{
        zoneIndex: number;
        colors: ColorConfig[];   // 该区域的颜色
    }>;
    outputPath: string;          // 输出路径
}

export interface SKUGenerationConfig {
    sourcePsdPath: string;       // 素材 PSD 文件路径
    templateDir: string;         // 模板目录
    outputDir: string;           // 输出目录
    colorConfigs: ColorConfig[]; // 颜色配置列表
    templateConfigs: TemplateConfig[]; // 模板配置列表
    outputPattern: string;       // 输出命名模式
    jpegQuality: number;         // JPEG 质量 (1-12)
    targetSizeMB?: number;       // 目标文件大小 (MB)
    autoAdjustQuality: boolean;  // 是否自动调整质量
}

// ===== 服务类 =====

class SKUConfigService {
    
    /**
     * 解析颜色配置 CSV
     * 格式: 颜色名, 十六进制值
     */
    async parseColorConfig(csvPath: string): Promise<ColorConfig[]> {
        try {
            const content = await fs.readFile(csvPath, 'utf-8');
            const records = parseCSV(content);

            const colors: ColorConfig[] = [];
            for (let i = 0; i < records.length; i++) {
                const row = records[i];
                if (row.length >= 2 && row[0]) {
                    colors.push({
                        id: i,
                        name: row[0].trim(),
                        hex: this.normalizeHex(row[1]?.trim() || 'CCCCCC')
                    });
                }
            }

            console.log(`[SKUConfig] 解析颜色配置: ${colors.length} 种颜色`);
            return colors;
        } catch (error) {
            console.error('[SKUConfig] 解析颜色配置失败:', error);
            throw error;
        }
    }

    /**
     * 解析模板配置 CSV
     * 格式: 模板名, 颜色组合
     * 
     * 颜色组合格式:
     * - "1|2|3" = 3个区域，每个区域1种颜色
     * - "1+2|3" = 2个区域，第一个区域有2种颜色
     */
    async parseTemplateConfig(csvPath: string): Promise<TemplateConfig[]> {
        try {
            const content = await fs.readFile(csvPath, 'utf-8');
            const records = parseCSV(content);

            const templates: TemplateConfig[] = [];
            
            // 跳过标题行 (从索引1开始)
            for (let i = 1; i < records.length; i++) {
                const row = records[i];
                if (row.length >= 2 && row[0] && row[1]) {
                    const templateName = row[0].trim();
                    const colorCombination = row[1].trim();
                    
                    const zones = this.parseColorCombination(colorCombination);
                    
                    templates.push({
                        templateName,
                        zones,
                        outputName: row[2]?.trim()
                    });
                }
            }

            console.log(`[SKUConfig] 解析模板配置: ${templates.length} 个模板组合`);
            return templates;
        } catch (error) {
            console.error('[SKUConfig] 解析模板配置失败:', error);
            throw error;
        }
    }

    /**
     * 解析颜色组合字符串
     * "1|2|3" → [{zoneIndex: 0, colorIds: [1]}, {zoneIndex: 1, colorIds: [2]}, ...]
     * "1+2|3" → [{zoneIndex: 0, colorIds: [1, 2]}, {zoneIndex: 1, colorIds: [3]}]
     */
    private parseColorCombination(combination: string): ZoneConfig[] {
        const zones: ZoneConfig[] = [];
        const zoneParts = combination.split('|');
        
        for (let i = 0; i < zoneParts.length; i++) {
            const colorPart = zoneParts[i].trim();
            const colorIds = colorPart.split('+').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
            
            zones.push({
                zoneIndex: i,
                colorIds
            });
        }
        
        return zones;
    }

    /**
     * 生成 SKU 组合列表
     */
    generateCombinations(
        templateConfigs: TemplateConfig[],
        colorConfigs: ColorConfig[],
        outputDir: string,
        outputPattern: string
    ): SKUCombination[] {
        const combinations: SKUCombination[] = [];
        let fileIndex = 1;
        let lastTemplateName = '';
        let templateIndex = 0;

        for (const template of templateConfigs) {
            // 模板索引
            if (template.templateName !== lastTemplateName) {
                lastTemplateName = template.templateName;
                templateIndex++;
                fileIndex = 1;
            }

            // 收集所有颜色
            const allColors: ColorConfig[] = [];
            const zonesWithColors: Array<{ zoneIndex: number; colors: ColorConfig[] }> = [];

            for (const zone of template.zones) {
                const zoneColors = zone.colorIds
                    .map(id => colorConfigs[id])
                    .filter(c => c !== undefined);
                
                zonesWithColors.push({
                    zoneIndex: zone.zoneIndex,
                    colors: zoneColors
                });
                
                allColors.push(...zoneColors);
            }

            // 生成输出路径
            const colorNames = allColors.map(c => c.name).join('+');
            const outputPath = this.formatOutputPath(outputPattern, {
                template: this.getFileNameWithoutExt(template.templateName),
                colors: colorNames,
                templateId: templateIndex,
                fileIndex: fileIndex
            });

            combinations.push({
                id: `${template.templateName}-${fileIndex}`,
                templateName: template.templateName,
                colors: allColors,
                zones: zonesWithColors,
                outputPath: path.join(outputDir, outputPath + '.jpg')
            });

            fileIndex++;
        }

        console.log(`[SKUConfig] 生成 ${combinations.length} 个 SKU 组合`);
        return combinations;
    }

    /**
     * 格式化输出路径
     * 支持占位符: %模板%, %素材%, %模板ID%, %文件序号%
     */
    private formatOutputPath(pattern: string, values: {
        template: string;
        colors: string;
        templateId: number;
        fileIndex: number;
    }): string {
        return pattern
            .replace(/%模板%/g, values.template)
            .replace(/%素材%/g, values.colors)
            .replace(/%模板ID%/g, values.templateId.toString())
            .replace(/%文件序号%/g, values.fileIndex.toString());
    }

    /**
     * 标准化十六进制颜色值
     */
    private normalizeHex(hex: string): string {
        // 移除 # 前缀
        hex = hex.replace(/^#/, '');
        
        // 如果是3位，扩展为6位
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        
        // 确保是有效的6位十六进制
        if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return 'CCCCCC';
        }
        
        return hex.toUpperCase();
    }

    /**
     * 获取不带扩展名的文件名
     */
    private getFileNameWithoutExt(filePath: string): string {
        const fileName = path.basename(filePath);
        const extIndex = fileName.lastIndexOf('.');
        return extIndex > 0 ? fileName.substring(0, extIndex) : fileName;
    }

    /**
     * 验证配置完整性
     */
    validateConfig(config: SKUGenerationConfig): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!config.sourcePsdPath) {
            errors.push('未指定素材 PSD 文件');
        }

        if (!config.templateDir) {
            errors.push('未指定模板目录');
        }

        if (!config.outputDir) {
            errors.push('未指定输出目录');
        }

        if (config.colorConfigs.length === 0) {
            errors.push('颜色配置为空');
        }

        if (config.templateConfigs.length === 0) {
            errors.push('模板配置为空');
        }

        // 检查颜色引用是否有效
        for (const template of config.templateConfigs) {
            for (const zone of template.zones) {
                for (const colorId of zone.colorIds) {
                    if (colorId < 0 || colorId >= config.colorConfigs.length) {
                        errors.push(`模板 ${template.templateName} 引用了无效的颜色索引 ${colorId}`);
                    }
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 从项目文件夹自动加载配置
     * 遵循 btnImport 的逻辑
     */
    async autoLoadFromProject(projectPath: string): Promise<Partial<SKUGenerationConfig>> {
        const config: Partial<SKUGenerationConfig> = {};

        // 查找 PSD 文件夹中的 SKU 文件
        const psdFolder = path.join(projectPath, 'PSD');
        try {
            const psdFiles = await fs.readdir(psdFolder);
            const skuFile = psdFiles.find(f => 
                f.toUpperCase().includes('SKU') && 
                (f.endsWith('.psd') || f.endsWith('.psb'))
            );
            if (skuFile) {
                config.sourcePsdPath = path.join(psdFolder, skuFile);
            }
        } catch (e) {
            console.log('[SKUConfig] PSD 文件夹不存在');
        }

        // 查找配置文件
        const configFolder = path.join(projectPath, '配置文件');
        try {
            const configFiles = await fs.readdir(configFolder);
            const csvFile = configFiles.find(f => f.endsWith('.csv'));
            if (csvFile) {
                const csvPath = path.join(configFolder, csvFile);
                config.templateConfigs = await this.parseTemplateConfig(csvPath);
            }
        } catch (e) {
            console.log('[SKUConfig] 配置文件夹不存在');
        }

        // 查找模板文件夹
        const templateFolder = path.join(projectPath, '模板文件');
        try {
            await fs.access(templateFolder);
            config.templateDir = templateFolder;
        } catch (e) {
            console.log('[SKUConfig] 模板文件夹不存在');
        }

        // 查找 SKU 输出文件夹
        const skuFolder = path.join(projectPath, 'SKU');
        try {
            await fs.access(skuFolder);
            config.outputDir = skuFolder;
        } catch (e) {
            console.log('[SKUConfig] SKU 文件夹不存在');
        }

        return config;
    }

    /**
     * 生成 UXP 执行指令
     * 转换为 DesignEcho 的工具调用格式
     */
    generateExecutionInstructions(
        combination: SKUCombination,
        sourcePsdPath: string,
        templateDir: string
    ): any[] {
        const instructions: any[] = [];

        // 1. 打开模板 PSD
        instructions.push({
            tool: 'file',
            action: 'open',
            params: {
                filePath: path.join(templateDir, combination.templateName)
            }
        });

        // 2. 对每个区域处理
        for (const zone of combination.zones) {
            for (let colorIndex = 0; colorIndex < zone.colors.length; colorIndex++) {
                const color = zone.colors[colorIndex];

                // 从素材 PSD 复制图层组
                instructions.push({
                    tool: 'layer',
                    action: 'copyFromDocument',
                    params: {
                        sourceDocument: sourcePsdPath,
                        layerName: color.name,
                        targetLayerIndex: zone.zoneIndex
                    }
                });

                // 缩放适应
                instructions.push({
                    tool: 'transform',
                    action: 'fitToPlaceholder',
                    params: {
                        placeholderIndex: zone.zoneIndex,
                        mode: 'contain'
                    }
                });

                // 对齐
                instructions.push({
                    tool: 'align',
                    action: 'toPlaceholder',
                    params: {
                        placeholderIndex: zone.zoneIndex,
                        position: this.getAlignPosition(colorIndex, zone.colors.length)
                    }
                });
            }
        }

        // 3. 水平分布对齐 (如果同一区域有多个颜色)
        instructions.push({
            tool: 'align',
            action: 'distributeHorizontal',
            params: {}
        });

        // 4. 保存
        instructions.push({
            tool: 'file',
            action: 'saveAsJpeg',
            params: {
                outputPath: combination.outputPath,
                quality: 12,
                autoOptimize: true
            }
        });

        // 5. 关闭文档
        instructions.push({
            tool: 'file',
            action: 'close',
            params: {
                save: false
            }
        });

        return instructions;
    }

    /**
     * 根据颜色在区域中的位置确定对齐方式
     */
    private getAlignPosition(index: number, total: number): string {
        if (total === 1) {
            return 'center';
        } else if (index === 0) {
            return 'left';
        } else if (index === total - 1) {
            return 'right';
        } else {
            return 'center';
        }
    }
}

export const skuConfigService = new SKUConfigService();
