/**
 * 主题适配器
 * 
 * 根据设计师 UI 偏好动态切换主题和视觉样式
 */

export interface UIPreferences {
    theme?: 'dark' | 'light' | 'auto';
    layoutMode?: 'grid' | 'list' | 'compact';
    infoDensity?: 'dense' | 'normal' | 'spacious';
    fontSize?: 'small' | 'medium' | 'large';
    showTips?: boolean;
    primaryColor?: string;
}

// ==================== 类型定义 ====================

/**
 * 主题变量
 */
export interface ThemeVariables {
    // 背景色
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    bgHover: string;
    bgActive: string;
    
    // 文字色
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textInverse: string;
    
    // 边框色
    borderPrimary: string;
    borderSecondary: string;
    
    // 强调色
    accentPrimary: string;
    accentSecondary: string;
    accentHover: string;
    
    // 状态色
    success: string;
    warning: string;
    error: string;
    info: string;
    
    // 阴影
    shadowSm: string;
    shadowMd: string;
    shadowLg: string;
    
    // 圆角
    radiusSm: string;
    radiusMd: string;
    radiusLg: string;
    
    // 间距
    spacingBase: string;
    
    // 字体
    fontSizeBase: string;
    fontSizeSm: string;
    fontSizeLg: string;
    lineHeight: string;
}

/**
 * 预设主题
 */
export type ThemePreset = 'dark' | 'light' | 'auto';

/**
 * 信息密度
 */
export type InfoDensity = 'dense' | 'normal' | 'spacious';

/**
 * 字体大小
 */
export type FontSize = 'small' | 'medium' | 'large';

// ==================== 主题定义 ====================

/**
 * 深色主题
 */
const darkTheme: ThemeVariables = {
    bgPrimary: '#1a1a2e',
    bgSecondary: '#16213e',
    bgTertiary: '#0f3460',
    bgHover: '#1f2937',
    bgActive: '#374151',
    
    textPrimary: '#f3f4f6',
    textSecondary: '#d1d5db',
    textMuted: '#9ca3af',
    textInverse: '#111827',
    
    borderPrimary: '#374151',
    borderSecondary: '#4b5563',
    
    accentPrimary: '#3b82f6',
    accentSecondary: '#60a5fa',
    accentHover: '#2563eb',
    
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#06b6d4',
    
    shadowSm: '0 1px 2px 0 rgb(0 0 0 / 0.3)',
    shadowMd: '0 4px 6px -1px rgb(0 0 0 / 0.3)',
    shadowLg: '0 10px 15px -3px rgb(0 0 0 / 0.3)',
    
    radiusSm: '0.25rem',
    radiusMd: '0.5rem',
    radiusLg: '0.75rem',
    
    spacingBase: '1rem',
    
    fontSizeBase: '0.875rem',
    fontSizeSm: '0.75rem',
    fontSizeLg: '1rem',
    lineHeight: '1.5'
};

/**
 * 浅色主题
 */
const lightTheme: ThemeVariables = {
    bgPrimary: '#ffffff',
    bgSecondary: '#f9fafb',
    bgTertiary: '#f3f4f6',
    bgHover: '#e5e7eb',
    bgActive: '#d1d5db',
    
    textPrimary: '#111827',
    textSecondary: '#374151',
    textMuted: '#6b7280',
    textInverse: '#f9fafb',
    
    borderPrimary: '#e5e7eb',
    borderSecondary: '#d1d5db',
    
    accentPrimary: '#2563eb',
    accentSecondary: '#3b82f6',
    accentHover: '#1d4ed8',
    
    success: '#059669',
    warning: '#d97706',
    error: '#dc2626',
    info: '#0891b2',
    
    shadowSm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    shadowMd: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    shadowLg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    
    radiusSm: '0.25rem',
    radiusMd: '0.5rem',
    radiusLg: '0.75rem',
    
    spacingBase: '1rem',
    
    fontSizeBase: '0.875rem',
    fontSizeSm: '0.75rem',
    fontSizeLg: '1rem',
    lineHeight: '1.5'
};

// ==================== 密度配置 ====================

const densityConfigs: Record<InfoDensity, { spacingBase: string; lineHeight: string }> = {
    dense: { spacingBase: '0.5rem', lineHeight: '1.25' },
    normal: { spacingBase: '1rem', lineHeight: '1.5' },
    spacious: { spacingBase: '1.5rem', lineHeight: '1.75' }
};

// ==================== 字体大小配置 ====================

const fontSizeConfigs: Record<FontSize, { base: string; sm: string; lg: string }> = {
    small: { base: '0.75rem', sm: '0.625rem', lg: '0.875rem' },
    medium: { base: '0.875rem', sm: '0.75rem', lg: '1rem' },
    large: { base: '1rem', sm: '0.875rem', lg: '1.125rem' }
};

// ==================== 主题适配器类 ====================

/**
 * 主题适配器
 */
export class ThemeAdapter {
    private currentTheme: ThemePreset = 'dark';
    private currentVariables: ThemeVariables = darkTheme;
    private mediaQuery: MediaQueryList | null = null;
    private listeners: Set<(theme: ThemeVariables) => void> = new Set();
    
    constructor() {
        // 监听系统主题变化
        if (typeof window !== 'undefined' && window.matchMedia) {
            this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            this.mediaQuery.addEventListener('change', this.handleSystemThemeChange);
        }
    }
    
    /**
     * 应用 UI 偏好
     */
    applyPreferences(prefs: Partial<UIPreferences>): void {
        let variables = { ...this.currentVariables };
        
        // 主题
        if (prefs.theme) {
            this.currentTheme = prefs.theme;
            const baseTheme = this.getBaseTheme(prefs.theme);
            variables = { ...baseTheme };
        }
        
        // 信息密度
        if (prefs.infoDensity) {
            const densityConfig = densityConfigs[prefs.infoDensity];
            variables.spacingBase = densityConfig.spacingBase;
            variables.lineHeight = densityConfig.lineHeight;
        }
        
        // 字体大小
        if (prefs.fontSize) {
            const fontConfig = fontSizeConfigs[prefs.fontSize];
            variables.fontSizeBase = fontConfig.base;
            variables.fontSizeSm = fontConfig.sm;
            variables.fontSizeLg = fontConfig.lg;
        }
        
        // 主色 (如果有自定义)
        if (prefs.primaryColor) {
            variables.accentPrimary = prefs.primaryColor;
            variables.accentHover = this.darkenColor(prefs.primaryColor, 15);
            variables.accentSecondary = this.lightenColor(prefs.primaryColor, 15);
        }
        
        this.currentVariables = variables;
        this.applyToDOM();
        this.notifyListeners();
    }
    
    /**
     * 获取基础主题
     */
    private getBaseTheme(preset: ThemePreset): ThemeVariables {
        if (preset === 'auto') {
            const prefersDark = this.mediaQuery?.matches ?? true;
            return prefersDark ? darkTheme : lightTheme;
        }
        return preset === 'dark' ? darkTheme : lightTheme;
    }
    
    /**
     * 处理系统主题变化
     */
    private handleSystemThemeChange = (e: MediaQueryListEvent): void => {
        if (this.currentTheme === 'auto') {
            const baseTheme = e.matches ? darkTheme : lightTheme;
            this.currentVariables = { ...this.currentVariables, ...baseTheme };
            this.applyToDOM();
            this.notifyListeners();
        }
    };
    
    /**
     * 应用到 DOM
     */
    private applyToDOM(): void {
        if (typeof document === 'undefined') return;
        
        const root = document.documentElement;
        
        // 设置 CSS 变量
        root.style.setProperty('--bg-primary', this.currentVariables.bgPrimary);
        root.style.setProperty('--bg-secondary', this.currentVariables.bgSecondary);
        root.style.setProperty('--bg-tertiary', this.currentVariables.bgTertiary);
        root.style.setProperty('--bg-hover', this.currentVariables.bgHover);
        root.style.setProperty('--bg-active', this.currentVariables.bgActive);
        
        root.style.setProperty('--text-primary', this.currentVariables.textPrimary);
        root.style.setProperty('--text-secondary', this.currentVariables.textSecondary);
        root.style.setProperty('--text-muted', this.currentVariables.textMuted);
        root.style.setProperty('--text-inverse', this.currentVariables.textInverse);
        
        root.style.setProperty('--border-primary', this.currentVariables.borderPrimary);
        root.style.setProperty('--border-secondary', this.currentVariables.borderSecondary);
        
        root.style.setProperty('--accent-primary', this.currentVariables.accentPrimary);
        root.style.setProperty('--accent-secondary', this.currentVariables.accentSecondary);
        root.style.setProperty('--accent-hover', this.currentVariables.accentHover);
        
        root.style.setProperty('--color-success', this.currentVariables.success);
        root.style.setProperty('--color-warning', this.currentVariables.warning);
        root.style.setProperty('--color-error', this.currentVariables.error);
        root.style.setProperty('--color-info', this.currentVariables.info);
        
        root.style.setProperty('--shadow-sm', this.currentVariables.shadowSm);
        root.style.setProperty('--shadow-md', this.currentVariables.shadowMd);
        root.style.setProperty('--shadow-lg', this.currentVariables.shadowLg);
        
        root.style.setProperty('--radius-sm', this.currentVariables.radiusSm);
        root.style.setProperty('--radius-md', this.currentVariables.radiusMd);
        root.style.setProperty('--radius-lg', this.currentVariables.radiusLg);
        
        root.style.setProperty('--spacing-base', this.currentVariables.spacingBase);
        
        root.style.setProperty('--font-size-base', this.currentVariables.fontSizeBase);
        root.style.setProperty('--font-size-sm', this.currentVariables.fontSizeSm);
        root.style.setProperty('--font-size-lg', this.currentVariables.fontSizeLg);
        root.style.setProperty('--line-height', this.currentVariables.lineHeight);
        
        // 设置主题类
        root.classList.remove('theme-dark', 'theme-light');
        root.classList.add(
            this.currentTheme === 'auto' 
                ? (this.mediaQuery?.matches ? 'theme-dark' : 'theme-light')
                : `theme-${this.currentTheme}`
        );
    }
    
    /**
     * 获取当前主题变量
     */
    getVariables(): ThemeVariables {
        return { ...this.currentVariables };
    }
    
    /**
     * 获取当前主题
     */
    getTheme(): ThemePreset {
        return this.currentTheme;
    }
    
    /**
     * 判断当前是否深色
     */
    isDark(): boolean {
        if (this.currentTheme === 'auto') {
            return this.mediaQuery?.matches ?? true;
        }
        return this.currentTheme === 'dark';
    }
    
    /**
     * 添加监听器
     */
    addListener(callback: (theme: ThemeVariables) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    
    /**
     * 通知监听器
     */
    private notifyListeners(): void {
        this.listeners.forEach(listener => {
            try {
                listener(this.currentVariables);
            } catch (e) {
                console.error('[ThemeAdapter] 监听器错误:', e);
            }
        });
    }
    
    /**
     * 加深颜色
     */
    private darkenColor(hex: string, percent: number): string {
        return this.adjustColor(hex, -percent);
    }
    
    /**
     * 减淡颜色
     */
    private lightenColor(hex: string, percent: number): string {
        return this.adjustColor(hex, percent);
    }
    
    /**
     * 调整颜色亮度
     */
    private adjustColor(hex: string, percent: number): string {
        hex = hex.replace('#', '');
        
        const num = parseInt(hex, 16);
        const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(255 * percent / 100)));
        const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(255 * percent / 100)));
        const b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(255 * percent / 100)));
        
        return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
    
    /**
     * 清理资源
     */
    dispose(): void {
        if (this.mediaQuery) {
            this.mediaQuery.removeEventListener('change', this.handleSystemThemeChange);
        }
        this.listeners.clear();
    }
}

// 单例实例
let themeAdapterInstance: ThemeAdapter | null = null;

/**
 * 获取主题适配器单例
 */
export function getThemeAdapter(): ThemeAdapter {
    if (!themeAdapterInstance) {
        themeAdapterInstance = new ThemeAdapter();
    }
    return themeAdapterInstance;
}

/**
 * React Hook: 使用主题
 */
export function useTheme(): {
    variables: ThemeVariables;
    isDark: boolean;
    applyPreferences: (prefs: Partial<UIPreferences>) => void;
} {
    const [variables, setVariables] = React.useState<ThemeVariables>(() => 
        getThemeAdapter().getVariables()
    );
    
    React.useEffect(() => {
        const adapter = getThemeAdapter();
        const unsubscribe = adapter.addListener(setVariables);
        return unsubscribe;
    }, []);
    
    return {
        variables,
        isDark: getThemeAdapter().isDark(),
        applyPreferences: (prefs) => getThemeAdapter().applyPreferences(prefs)
    };
}

// 需要导入 React
import React from 'react';

export default ThemeAdapter;
