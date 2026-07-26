/**
 * SKU 组合知识库 - 类型定义
 * 
 * 功能：
 * 1. 用户自定义颜色组合（按规格分类：2双装、3双装、4双装等）
 * 2. 模板与颜色组合绑定
 * 3. 标签/描述（袜子类型：小腿袜、中筒袜等）
 * 4. 支持 CSV 导入
 */

/**
 * 袜子类型/标签
 */
export type SockType = 
    | '小腿袜' 
    | '中筒袜' 
    | '长筒袜' 
    | '船袜' 
    | '隐形袜'
    | '儿童袜'
    | '运动袜'
    | '其他';

/**
 * 规格类型（几双装）
 * 支持 1-10 及更多自定义数值
 */
export type ComboSize = number;

/**
 * 单个颜色组合
 * 例如：["白色", "浅粉", "浅蓝", "浅灰"]
 */
export interface ColorCombo {
    /** 唯一 ID */
    id: string;
    /** 颜色列表（按顺序） */
    colors: string[];
    /** 备注（可选，用于自选备注等） */
    remark?: string;
}

/**
 * 模板配置
 * 一个模板对应一种规格的多个颜色组合
 */
export interface TemplateConfig {
    /** 唯一 ID */
    id: string;
    /** 模板名称（如 "4双装"） */
    name: string;
    /** 模板文件名（相对于项目的模板文件目录） */
    templateFile: string;
    /** 规格（几双装） */
    comboSize: ComboSize;
    /** 袜子类型标签 */
    sockType: SockType;
    /** 描述（帮助模型理解） */
    description?: string;
    /** 颜色组合列表 */
    combos: ColorCombo[];
    /** 创建时间 */
    createdAt: string;
    /** 更新时间 */
    updatedAt: string;
}

/**
 * SKU 组合知识库
 * 一个项目/产品可以有多个模板配置
 */
export interface SKUComboCollection {
    /** 唯一 ID */
    id: string;
    /** 名称（如 "C-1016 小腿袜"） */
    name: string;
    /** 关联的项目路径（可选） */
    projectPath?: string;
    /** 可用颜色列表（从 SKU 素材中提取或手动添加） */
    availableColors: string[];
    /** 模板配置列表 */
    templates: TemplateConfig[];
    /** 创建时间 */
    createdAt: string;
    /** 更新时间 */
    updatedAt: string;
}

/**
 * CSV 导入格式
 * 
 * 示例 CSV 内容：
 * 模板,规格,颜色1,颜色2,颜色3,颜色4,备注
 * 4双装.tif,4,白色,浅粉,浅蓝,浅灰,
 * 4双装.tif,4,黑色,深灰,中灰,白色,
 * 4双自选备注.tif,4,白色,浅粉,浅蓝,浅灰,自选颜色
 */
export interface CSVImportRow {
    /** 模板文件名 */
    template: string;
    /** 规格（几双装） */
    comboSize: number;
    /** 颜色列表 */
    colors: string[];
    /** 备注（可选） */
    remark?: string;
}

/**
 * 导入结果
 */
export interface ImportResult {
    success: boolean;
    /** 成功导入的组合数量 */
    imported: number;
    /** 跳过的行数（重复或无效） */
    skipped: number;
    /** 错误信息 */
    errors: string[];
}
