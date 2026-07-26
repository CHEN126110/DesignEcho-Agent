/**
 * WebGL 变形引擎类型定义
 */

/**
 * 2D 点
 */
export interface Point2D {
    x: number;
    y: number;
}

/**
 * 控制点对
 */
export interface ControlPointPair {
    source: Point2D;
    target: Point2D;
    weight?: number;
}

/**
 * 变形算法类型
 */
export type WarpAlgorithm = 'tps' | 'mls' | 'affine';

/**
 * 变形配置
 */
export interface WarpConfig {
    /** 变形算法 */
    algorithm: WarpAlgorithm;
    /** 插值模式 */
    interpolation: 'nearest' | 'bilinear' | 'bicubic';
    /** 输出质量 (0-100) */
    quality: number;
    /** 边缘处理 */
    edgeMode: 'clamp' | 'wrap' | 'transparent';
    /** 超采样倍数 */
    supersampling: 1 | 2 | 4;
}

/**
 * 默认变形配置
 */
export const DEFAULT_WARP_CONFIG: WarpConfig = {
    algorithm: 'tps',
    interpolation: 'bilinear',
    quality: 90,
    edgeMode: 'transparent',
    supersampling: 2
};

/**
 * 变形请求
 */
export interface WarpRequest {
    /** 源图像 Base64 (支持 PNG/JPEG) */
    imageBase64: string;
    /** 图像宽度 */
    width: number;
    /** 图像高度 */
    height: number;
    /** 控制点对列表 */
    controlPoints: ControlPointPair[];
    /** 变形配置 */
    config?: Partial<WarpConfig>;
}

/**
 * 变形结果
 */
export interface WarpResult {
    success: boolean;
    /** 变形后图像 Base64 */
    imageBase64?: string;
    /** 变形质量评分 */
    qualityScore?: number;
    /** 处理耗时 (ms) */
    duration?: number;
    /** 错误信息 */
    error?: string;
}

/**
 * TPS (Thin Plate Spline) 权重矩阵
 */
export interface TPSWeights {
    /** 仿射变换参数 (3x2) */
    affine: number[][];
    /** 权重系数 */
    weights: number[][];
    /** 控制点 */
    controlPoints: Point2D[];
}

/**
 * 网格变形数据
 */
export interface WarpMesh {
    /** 网格行数 */
    rows: number;
    /** 网格列数 */
    cols: number;
    /** 源网格点 */
    sourcePoints: Point2D[];
    /** 目标网格点 */
    targetPoints: Point2D[];
}
