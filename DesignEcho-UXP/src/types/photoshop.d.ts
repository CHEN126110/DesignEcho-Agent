/**
 * Photoshop UXP API 类型声明
 * 
 * 这是简化的类型声明，实际类型由 @types/photoshop 提供
 */

// UXP 环境下的 require 函数声明
declare function require(module: 'photoshop'): typeof import('photoshop');
declare function require(module: 'uxp'): typeof import('uxp');
declare function require(module: string): any;

declare module 'photoshop' {
    export const app: {
        activeDocument: Document | null;
        documents: Document[];
    };

    export const core: {
        executeAsModal: (
            callback: (executionContext: ExecutionContext) => Promise<void>,
            options?: { commandName?: string; timeOut?: number }
        ) => Promise<void>;
    };

    export const action: {
        batchPlay: (
            commands: ActionDescriptor[],
            options?: object
        ) => Promise<ActionDescriptor[]>;
    };

    /**
     * Imaging API - 高性能图像处理
     * 参考: https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/
     */
    export const imaging: {
        /**
         * 获取图层像素数据
         */
        getPixels: (options: {
            documentID: number;
            layerID?: number;
            targetSize?: { width: number; height: number };
            sourceBounds?: { left: number; top: number; right: number; bottom: number };
            colorSpace?: 'RGB' | 'Grayscale' | 'Lab';
            colorProfile?: string;
            componentSize?: -1 | 8 | 16 | 32;
            applyAlpha?: boolean;
            componentCount?: number;  // 分量数
        }) => Promise<{
            imageData: PhotoshopImageData;
            sourceBounds?: { left: number; top: number; right: number; bottom: number };
        }>;

        /**
         * 写入像素数据到图层
         */
        putPixels: (options: {
            documentID: number;
            layerID: number;
            imageData: PhotoshopImageData;
            targetBounds?: { left: number; top: number };
            commandName?: string;
        }) => Promise<void>;

        /**
         * 获取图层蒙版
         */
        getLayerMask: (options: {
            documentID: number;
            layerID: number;
            sourceBounds?: { left: number; top: number; right: number; bottom: number };
            targetSize?: { width: number; height: number };
        }) => Promise<{
            imageData: PhotoshopImageData;
            sourceBounds?: { left: number; top: number; right: number; bottom: number };
        }>;

        /**
         * 设置图层蒙版
         */
        putLayerMask: (options: {
            documentID: number;
            layerID: number;
            imageData: PhotoshopImageData;
            replace?: boolean;
            targetBounds?: { left: number; top: number };
            commandName?: string;
        }) => Promise<void>;

        /**
         * 获取选区
         */
        getSelection: (options: {
            documentID: number;
            sourceBounds?: { left: number; top: number; right: number; bottom: number };
            targetSize?: { width: number; height: number };
        }) => Promise<{
            imageData: PhotoshopImageData;
            sourceBounds?: { left: number; top: number; right: number; bottom: number };
        }>;

        /**
         * 设置选区
         */
        putSelection: (options: {
            documentID: number;
            imageData: PhotoshopImageData;
            replace?: boolean;
            targetBounds?: { left: number; top: number };
            commandName?: string;
        }) => Promise<void>;

        /**
         * 从 Buffer 创建图像数据
         */
        createImageDataFromBuffer: (
            buffer: Uint8Array | Uint16Array | Float32Array,
            options: {
                width: number;
                height: number;
                components: number;
                colorSpace: 'RGB' | 'Grayscale' | 'Lab';
                colorProfile?: string;
                chunky?: boolean;
            }
        ) => Promise<PhotoshopImageData>;

        /**
         * 编码图像数据为 JPEG
         */
        encodeImageData: (options: {
            imageData: PhotoshopImageData;
            base64?: boolean;
        }) => Promise<number[] | Uint8Array | string | { base64?: string }>;
    };

    /**
     * PhotoshopImageData 接口
     */
    interface PhotoshopImageData {
        width: number;
        height: number;
        colorSpace: string;
        colorProfile: string;
        hasAlpha: boolean;
        components: number;
        componentSize: number;
        pixelFormat: string;
        isChunky: boolean;
        type: string;
        getData: (options?: { chunky?: boolean; fullRange?: boolean }) => Promise<Uint8Array | Uint16Array | Float32Array>;
        dispose: () => void;
    }

    export namespace constants {
        export enum LayerKind {
            NORMAL = 1,
            TEXT = 2,
            SOLIDFILL = 3,
            GRADIENTFILL = 4,
            PATTERNFILL = 5,
            LEVELS = 6,
            CURVES = 7,
            COLORBALANCE = 8,
            BRIGHTNESSCONTRAST = 9,
            HUESATURATION = 10,
            SELECTIVECOLOR = 11,
            CHANNELMIXER = 12,
            GRADIENTMAP = 13,
            INVERSION = 14,
            THRESHOLD = 15,
            POSTERIZE = 16,
            SMARTOBJECT = 17,
            PHOTOFILTER = 18,
            EXPOSURE = 19,
            LAYER3D = 20,
            VIDEO = 21,
            BLACKANDWHITE = 22,
            VIBRANCE = 23,
            COLORLOOKUP = 24,
            GROUP = 25
        }
    }

    interface ExecutionContext {
        hostControl: {
            suspendHistory: (options: { historyStateInfo: { name: string } }) => void;
            resumeHistory: (commit: boolean, name?: string) => void;
        };
    }

    interface ActionDescriptor {
        _obj?: string;
        _target?: any[];
        [key: string]: any;
    }

    interface Document {
        id: number;
        name: string;
        width: number;
        height: number;
        resolution: number;
        mode: string;
        layers: Layer[];
        activeLayers: Layer[];
    }

    interface Layer {
        id: number;
        name: string;
        kind: constants.LayerKind;
        visible: boolean;
        opacity: number;
        bounds: Bounds;
        boundsNoEffects: Bounds;
        layers?: Layer[];
        textItem?: TextItem;
        translate: (deltaX: number, deltaY: number) => Promise<void>;
        // P0 图层属性
        blendMode: string;
        allLocked: boolean;
        positionLocked: boolean;
        transparentPixelsLocked: boolean;
        pixelsLocked: boolean;
        // P0 方法
        duplicate: () => Promise<Layer>;
        delete: () => Promise<void>;
    }

    interface Bounds {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    }

    interface TextItem {
        contents: string;
        characterStyle: CharacterStyle;
    }

    interface CharacterStyle {
        size: number;
        font: string;
        fontStyle: string;
        color?: SolidColor;
        tracking: number;
        leading: number;
        horizontalScale: number;
        verticalScale: number;
    }

    interface SolidColor {
        rgb: {
            red: number;
            green: number;
            blue: number;
        };
    }
}

declare module 'uxp' {
    export const entrypoints: {
        setup: (config: {
            panels?: {
                [key: string]: {
                    show?: (node: HTMLElement) => void | Promise<void>;
                    hide?: () => void;
                    destroy?: () => void;
                    menuItems?: Array<{
                        id: string;
                        label: string;
                        enabled?: boolean;
                        checked?: boolean;
                        oninvoke?: () => void;
                    }>;
                };
            };
            commands?: {
                [key: string]: {
                    run?: () => void | Promise<void>;
                };
            };
        }) => void;
    };

    export const storage: {
        localFileSystem: {
            // 获取特殊文件夹
            getTemporaryFolder: () => Promise<Folder>;
            getDataFolder: () => Promise<Folder>;
            getPluginFolder: () => Promise<Folder>;
            
            // 弹出文件/文件夹选择对话框（需要用户交互授权）
            getFileForOpening: (options?: { 
                types?: string[];  // 文件类型过滤，如 ['jpg', 'png']
                initialDomain?: any;
            }) => Promise<File | null>;
            getFileForSaving: (name: string, options?: { 
                types?: string[];
                initialDomain?: any;
            }) => Promise<File | null>;
            getFolder: (options?: { initialDomain?: any }) => Promise<Folder | null>;
            
            // 会话级别 Token（Photoshop 重启后失效）
            createSessionToken: (entry: Entry) => Promise<string>;
            getEntryForSessionToken: (token: string) => Promise<Entry>;
            
            // 持久化 Token（跨会话有效，可保存到 localStorage）
            createPersistentToken: (entry: Entry) => Promise<string>;
            getEntryForPersistentToken: (token: string) => Promise<Entry>;
            
            // 通过 URL 获取 Entry
            getEntryWithUrl: (url: string) => Promise<Entry>;
            
            // 检查 Entry 是否仍然有效
            isFileSystemProvider: boolean;
        };
        formats: {
            utf8: symbol;
            binary: symbol;
        };
        types: {
            file: symbol;
            folder: symbol;
        };
        domains: {
            appLocalCache: symbol;
            appLocalData: symbol;
            appLocalLibrary: symbol;
            appLocalShared: symbol;
            appLocalTemporary: symbol;
            appRoamingData: symbol;
            appRoamingLibrary: symbol;
            userDesktop: symbol;
            userDocuments: symbol;
            userMusic: symbol;
            userPictures: symbol;
            userVideos: symbol;
        };
    };

    interface Folder {
        nativePath: string;
        createFile: (name: string, options?: { overwrite?: boolean }) => Promise<File>;
        createFolder: (name: string) => Promise<Folder>;
        getEntry: (name: string) => Promise<Entry>;
        getEntries: () => Promise<Entry[]>;
    }

    interface Entry {
        isFile: boolean;
        isFolder: boolean;
        name: string;
        nativePath: string;
        delete: () => Promise<void>;
    }

    interface File extends Entry {
        write: (data: string | ArrayBuffer, options?: { format?: symbol }) => Promise<void>;
        read: (options?: { format?: symbol }) => Promise<string | ArrayBuffer>;
    }
}
