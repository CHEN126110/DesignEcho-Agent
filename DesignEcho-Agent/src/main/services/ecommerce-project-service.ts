/**
 * 电商项目服务
 * 
 * 负责识别电商项目文件夹结构、扫描素材、分类图片
 */

import path from 'path';
import fs from 'fs';
import { serializedFileOperations } from './serialized-file-operations';

const fsPromises = fs.promises;

// 延迟导入 sharp，避免在不需要时加载
let sharpModule: any = null;
async function getSharp() {
    if (!sharpModule) {
        try {
            sharpModule = (await import('sharp')).default;
        } catch { /* sharp 不可用时忽略 */ }
    }
    return sharpModule;
}

// ===== 类型定义 =====

/** 文件夹类型 */
export type FolderType = 
    | 'source'      // 拍摄图/素材
    | 'psd'         // PSD 源文件
    | 'mainImage'   // 主图输出
    | 'detail'      // 详情页输出
    | 'sku'         // SKU 图输出
    | 'unknown';    // 未识别

/** 图片类型 */
export type ImageType = 
    | 'product'     // 产品图（SKU）
    | 'model'       // 模特图
    | 'detail'      // 细节图
    | 'scene'       // 场景图
    | 'package'     // 包装图
    | 'material'    // 材质图
    | 'psd'         // PSD/PSB 设计文件
    | 'design'      // AI/EPS/SVG 设计文件
    | 'video'       // 视频文件
    | 'unknown';    // 未识别

/** 图片文件信息 */
export interface ImageFile {
    name: string;
    path: string;
    relativePath: string;      // 相对于项目根目录
    size: number;
    ext: string;
    type: ImageType;
    thumbnailPath?: string;    // 缩略图路径（如果已生成）
    parentFolder: string;      // 所属文件夹名称
    folderType: FolderType;    // 所属文件夹类型
    width?: number;            // 图片宽度（像素）
    height?: number;           // 图片高度（像素）
    aspectRatio?: number;      // 宽高比 width/height
}

/** 文件夹信息（支持树形结构） */
export interface FolderInfo {
    name: string;
    path: string;
    relativePath: string;
    type: FolderType;
    depth: number;                  // 层级深度（0 = 根目录下的一级文件夹）
    imageCount: number;             // 当前文件夹的图片数
    totalImageCount: number;        // 包含子文件夹的总图片数
    images: ImageFile[];
    children: FolderInfo[];         // 子文件夹
}

/** 项目结构 */
export interface EcommerceProjectStructure {
    projectPath: string;
    projectName: string;
    folders: FolderInfo[];
    summary: {
        totalImages: number;
        totalFolders: number;
        byFolderType: Record<FolderType, number>;
        byImageType: Record<ImageType, number>;
    };
    config?: ProjectConfig;
}

/** 项目配置（持久化） */
export interface ProjectConfig {
    version: string;
    createdAt: string;
    lastOpenedAt: string;
    projectPath: string;
    projectName: string;
    folderMappings: Record<string, FolderType>;  // 文件夹名 -> 类型（用户可覆盖）
    imageClassifications: Record<string, ImageType>;  // 图片路径 -> 类型（用户可覆盖）
    designPlan?: {
        mainImage?: { status: 'pending' | 'in_progress' | 'done' };
        sku?: { status: 'pending' | 'in_progress' | 'done' };
        detail?: { status: 'pending' | 'in_progress' | 'done' };
    };
}

// ===== 识别规则 =====

/** 文件夹名称识别规则 */
const FOLDER_PATTERNS: { type: FolderType; patterns: RegExp[] }[] = [
    {
        type: 'source',
        patterns: [
            /^(拍摄图|素材|原图|raw|source|材料|photos?|images?|assets?)$/i,
            /拍摄/i,
            /素材/i,
            /原图/i
        ]
    },
    {
        type: 'psd',
        patterns: [
            /^(psd|psb|源文件|设计稿|design)$/i,
            /\.psd$/i
        ]
    },
    {
        type: 'mainImage',
        patterns: [
            /^(主图|main|主|首图|cover|thumbnail)$/i,
            /主图/i,
            /^750$/,
            /^800$/,
            /^1200$/
        ]
    },
    {
        type: 'detail',
        patterns: [
            /^(详情|详情页|detail|描述|description)$/i,
            /详情/i
        ]
    },
    {
        type: 'sku',
        patterns: [
            /^(sku|颜色|款式|规格|color|style|variant)$/i,
            /sku/i
        ]
    }
];

/** 图片扩展名 */
/** 常规图片扩展名 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif'];

/** 设计文件扩展名 */
const DESIGN_EXTENSIONS = ['.psd', '.psb', '.ai', '.eps', '.svg'];

/** 视频文件扩展名 */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm'];

/** 所有支持的文件扩展名 */
const ALL_SUPPORTED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DESIGN_EXTENSIONS, ...VIDEO_EXTENSIONS];

// ===== 服务类 =====

export class EcommerceProjectService {
    private static instance: EcommerceProjectService;
    
    private constructor() {}
    
    static getInstance(): EcommerceProjectService {
        if (!EcommerceProjectService.instance) {
            EcommerceProjectService.instance = new EcommerceProjectService();
        }
        return EcommerceProjectService.instance;
    }
    
    /**
     * 识别文件夹类型
     */
    identifyFolderType(folderName: string): FolderType {
        for (const rule of FOLDER_PATTERNS) {
            for (const pattern of rule.patterns) {
                if (pattern.test(folderName)) {
                    return rule.type;
                }
            }
        }
        return 'unknown';
    }
    
    /**
     * 识别图片类型（基于文件名和路径）
     */
    identifyImageType(imagePath: string, folderType: FolderType): ImageType {
        const name = path.basename(imagePath).toLowerCase();
        const ext = path.extname(imagePath).toLowerCase();
        
        // 1. 基于文件扩展名识别特殊类型
        if (['.psd', '.psb'].includes(ext)) return 'psd';
        if (['.ai', '.eps', '.svg'].includes(ext)) return 'design';
        if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
        
        // 2. 基于文件夹类型推断
        if (folderType === 'sku') return 'product';
        if (folderType === 'detail') return 'detail';
        
        // 3. 基于文件名关键词
        if (/模特|model|穿搭|上身|真人/i.test(name)) return 'model';
        if (/细节|detail|局部|zoom|特写/i.test(name)) return 'detail';
        if (/场景|scene|氛围|lifestyle|生活/i.test(name)) return 'scene';
        if (/包装|package|box|袋|盒/i.test(name)) return 'package';
        if (/材质|material|面料|fabric|纹理/i.test(name)) return 'material';
        if (/产品|product|主体|sku|白底|纯色/i.test(name)) return 'product';
        
        return 'unknown';
    }
    
    /**
     * 扫描项目结构（支持递归树形）
     */
    async scanProject(projectPath: string): Promise<EcommerceProjectStructure> {
        console.log(`[EcommerceProject] 扫描项目: ${projectPath}`);
        
        const projectName = path.basename(projectPath);
        const summary = {
            totalImages: 0,
            totalFolders: 0,
            byFolderType: {} as Record<FolderType, number>,
            byImageType: {} as Record<ImageType, number>
        };
        
        // 初始化统计
        const folderTypes: FolderType[] = ['source', 'psd', 'mainImage', 'detail', 'sku', 'unknown'];
        const imageTypes: ImageType[] = ['product', 'model', 'detail', 'scene', 'package', 'material', 'psd', 'design', 'video', 'unknown'];
        folderTypes.forEach(t => summary.byFolderType[t] = 0);
        imageTypes.forEach(t => summary.byImageType[t] = 0);
        
        // 尝试加载已有配置
        const config = await this.loadProjectConfig(projectPath);
        
        // 递归扫描文件夹树
        const folders = await this.scanFolderTree(projectPath, projectPath, config, 0, summary);
        console.log(`[EcommerceProject] 子文件夹扫描完成: ${folders.length} 个一级文件夹`);
        
        // 检查根目录下的图片
        const rootImages = await this.scanDirectImages(projectPath, projectPath, 'source', config);
        console.log(`[EcommerceProject] 根目录图片: ${rootImages.length} 张`);
        if (rootImages.length > 0) {
            const rootFolder: FolderInfo = {
                name: '(根目录)',
                path: projectPath,
                relativePath: '.',
                type: 'source',
                depth: 0,
                imageCount: rootImages.length,
                totalImageCount: rootImages.length,
                images: rootImages,
                children: []
            };
            folders.unshift(rootFolder);
            summary.totalImages += rootImages.length;
            for (const img of rootImages) {
                summary.byImageType[img.type] = (summary.byImageType[img.type] || 0) + 1;
            }
        }
        
        console.log(`[EcommerceProject] 扫描完成: ${summary.totalFolders} 个文件夹, ${summary.totalImages} 张图片`);
        
        return {
            projectPath,
            projectName,
            folders,
            summary,
            config: config || undefined
        };
    }
    
    /**
     * 递归扫描文件夹树
     */
    private async scanFolderTree(
        folderPath: string,
        projectPath: string,
        config: ProjectConfig | null,
        depth: number,
        summary: EcommerceProjectStructure['summary']
    ): Promise<FolderInfo[]> {
        const folders: FolderInfo[] = [];
        
        try {
            const entries = await fsPromises.readdir(folderPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.')) continue;  // 跳过隐藏目录
                if (entry.name === 'node_modules') continue;  // 跳过 node_modules
                
                const currentPath = path.join(folderPath, entry.name);
                const relativePath = path.relative(projectPath, currentPath);
                
                // 识别文件夹类型
                const folderType = config?.folderMappings[relativePath] 
                    || config?.folderMappings[entry.name]
                    || this.identifyFolderType(entry.name);
                
                // 扫描当前文件夹的直接图片
                const images = await this.scanDirectImages(currentPath, projectPath, folderType, config);
                
                // 递归扫描子文件夹
                const children = await this.scanFolderTree(currentPath, projectPath, config, depth + 1, summary);
                
                // 计算总图片数（包含子文件夹）
                const childTotalImages = children.reduce((sum, child) => sum + child.totalImageCount, 0);
                const totalImageCount = images.length + childTotalImages;
                
                const folderInfo: FolderInfo = {
                    name: entry.name,
                    path: currentPath,
                    relativePath,
                    type: folderType,
                    depth,
                    imageCount: images.length,
                    totalImageCount,
                    images,
                    children
                };
                
                folders.push(folderInfo);
                
                // 统计（只统计当前文件夹，避免重复）
                summary.totalFolders++;
                summary.byFolderType[folderType] = (summary.byFolderType[folderType] || 0) + 1;
                summary.totalImages += images.length;
                
                for (const img of images) {
                    summary.byImageType[img.type] = (summary.byImageType[img.type] || 0) + 1;
                }
            }
        } catch (error: any) {
            console.warn(`[EcommerceProject] 扫描文件夹失败: ${folderPath}`, error.message);
        }
        
        return folders;
    }
    
    /**
     * 扫描文件夹内的直接图片（不递归）
     */
    private async scanDirectImages(
        folderPath: string,
        projectPath: string,
        folderType: FolderType,
        config: ProjectConfig | null
    ): Promise<ImageFile[]> {
        const images: ImageFile[] = [];
        
        try {
            const entries = await fsPromises.readdir(folderPath, { withFileTypes: true });
            console.log(`[EcommerceProject] scanDirectImages: ${folderPath} - 共 ${entries.length} 个条目`);
            
            let fileCount = 0;
            let matchedCount = 0;
            
            for (const entry of entries) {
                if (!entry.isFile()) continue;
                fileCount++;
                
                const ext = path.extname(entry.name).toLowerCase();
                if (!ALL_SUPPORTED_EXTENSIONS.includes(ext)) {
                    // 仅首次记录不匹配的扩展名
                    continue;
                }
                matchedCount++;
                
                const fullPath = path.join(folderPath, entry.name);
                const relativePath = path.relative(projectPath, fullPath);
                
                try {
                    const stats = await fsPromises.stat(fullPath);
                    
                    // 获取图片类型
                    const imageType = config?.imageClassifications[relativePath]
                        || this.identifyImageType(fullPath, folderType);
                    
                    // 读取图片尺寸（仅限常规图片格式）
                    let width: number | undefined;
                    let height: number | undefined;
                    let aspectRatio: number | undefined;
                    if (IMAGE_EXTENSIONS.includes(ext)) {
                        try {
                            const sharp = await getSharp();
                            if (sharp) {
                                const meta = await sharp(fullPath).metadata();
                                width = meta.width;
                                height = meta.height;
                                if (width && height) {
                                    aspectRatio = Math.round((width / height) * 1000) / 1000;
                                }
                            }
                        } catch { /* 读取尺寸失败时忽略 */ }
                    }
                    
                    images.push({
                        name: entry.name,
                        path: fullPath,
                        relativePath,
                        size: stats.size,
                        ext,
                        type: imageType,
                        parentFolder: path.basename(folderPath),
                        folderType,
                        width,
                        height,
                        aspectRatio
                    });
                } catch (statError) {
                    // 忽略无法访问的文件
                }
            }
            
            if (fileCount > 0) {
                console.log(`[EcommerceProject] scanDirectImages: ${fileCount} 个文件, ${matchedCount} 个匹配`);
            }
        } catch (error) {
            console.warn(`[EcommerceProject] scanDirectImages 失败: ${folderPath}`);
        }
        
        return images;
    }

    /**
     * 加载项目配置
     */
    async loadProjectConfig(projectPath: string): Promise<ProjectConfig | null> {
        const configPath = path.join(projectPath, '.designecho', 'project.json');
        return await this.loadProjectConfigFile(configPath);
    }

    private async loadProjectConfigFile(configPath: string): Promise<ProjectConfig | null> {
        try {
            const content = await fsPromises.readFile(configPath, 'utf-8');
            return JSON.parse(content) as ProjectConfig;
        } catch {
            return null;
        }
    }
    
    /**
     * 保存项目配置
     */
    async saveProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
        const configPath = path.join(projectPath, '.designecho', 'project.json');
        await serializedFileOperations.runExclusive(configPath, async (normalizedConfigPath) => {
            await this.writeProjectConfigFile(normalizedConfigPath, config);
        });
    }

    private async writeProjectConfigFile(configPath: string, config: ProjectConfig): Promise<void> {
        const configDir = path.dirname(configPath);

        try {
            await serializedFileOperations.writeUtf8Atomically(configPath, JSON.stringify(config, null, 2));
            
            // 在 Windows 上设置隐藏属性（同步执行确保可靠）
            if (process.platform === 'win32') {
                try {
                    const { execSync } = await import('child_process');
                    // 使用 /d 参数也处理目录，+h 设置隐藏，+s 设置系统（可选）
                    execSync(`attrib +h "${configDir}"`, { 
                        windowsHide: true,  // 隐藏 cmd 窗口
                        timeout: 5000       // 5秒超时
                    });
                    console.log(`[EcommerceProject] 配置目录已隐藏: ${configDir}`);
                } catch (attrError: any) {
                    // 隐藏失败不影响主功能
                    console.warn(`[EcommerceProject] 设置隐藏属性失败: ${attrError.message}`);
                }
            }
            
            console.log(`[EcommerceProject] 配置已保存: ${configPath}`);
        } catch (error: any) {
            console.error(`[EcommerceProject] 保存配置失败:`, error);
            throw new Error(`保存配置失败: ${error.message}`);
        }
    }
    
    /**
     * 创建或更新项目配置
     */
    async initProjectConfig(
        projectPath: string, 
        structure: EcommerceProjectStructure
    ): Promise<ProjectConfig> {
        const configPath = path.join(projectPath, '.designecho', 'project.json');
        return await serializedFileOperations.runExclusive(configPath, async (normalizedConfigPath) => {
            const existing = await this.loadProjectConfigFile(normalizedConfigPath);
            const now = new Date().toISOString();

            const config: ProjectConfig = {
                version: '1.0',
                createdAt: existing?.createdAt || now,
                lastOpenedAt: now,
                projectPath,
                projectName: structure.projectName,
                folderMappings: existing?.folderMappings || {},
                imageClassifications: existing?.imageClassifications || {},
                designPlan: existing?.designPlan || {
                    mainImage: { status: 'pending' },
                    sku: { status: 'pending' },
                    detail: { status: 'pending' }
                }
            };

            for (const folder of structure.folders) {
                if (!config.folderMappings[folder.name] && folder.type !== 'unknown') {
                    config.folderMappings[folder.name] = folder.type;
                }
            }

            await this.writeProjectConfigFile(normalizedConfigPath, config);
            return config;
        });
    }
    
    /**
     * 更新文件夹类型映射
     */
    async updateFolderType(
        projectPath: string, 
        folderName: string, 
        type: FolderType
    ): Promise<void> {
        const configPath = path.join(projectPath, '.designecho', 'project.json');
        await serializedFileOperations.runExclusive(configPath, async (normalizedConfigPath) => {
            const config = await this.loadProjectConfigFile(normalizedConfigPath);
            if (!config) {
                throw new Error('项目配置不存在');
            }

            config.folderMappings[folderName] = type;
            config.lastOpenedAt = new Date().toISOString();
            await this.writeProjectConfigFile(normalizedConfigPath, config);
        });
    }
    
    /**
     * 更新图片类型分类
     */
    async updateImageType(
        projectPath: string, 
        imageRelativePath: string, 
        type: ImageType
    ): Promise<void> {
        const configPath = path.join(projectPath, '.designecho', 'project.json');
        await serializedFileOperations.runExclusive(configPath, async (normalizedConfigPath) => {
            const config = await this.loadProjectConfigFile(normalizedConfigPath);
            if (!config) {
                throw new Error('项目配置不存在');
            }

            config.imageClassifications[imageRelativePath] = type;
            config.lastOpenedAt = new Date().toISOString();
            await this.writeProjectConfigFile(normalizedConfigPath, config);
        });
    }
}

// 导出单例
export const ecommerceProjectService = EcommerceProjectService.getInstance();
