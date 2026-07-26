/**
 * 聊天输入状态管理 Hook
 * 
 * 从 ChatPanel.tsx 抽离的输入相关逻辑
 */

import { useState, useCallback, useRef } from 'react';

export interface PastedImage {
    data: string;
    type: string;
}

export interface UseChatInputReturn {
    /** 输入文本 */
    input: string;
    /** 设置输入 */
    setInput: (value: string) => void;
    /** 粘贴的图片 */
    pastedImage: PastedImage | null;
    /** 设置粘贴图片 */
    setPastedImage: (image: PastedImage | null) => void;
    /** 是否正在拖拽图片 */
    isDraggingImage: boolean;
    /** 显示附件菜单 */
    showAttachMenu: boolean;
    /** 设置附件菜单显示 */
    setShowAttachMenu: (show: boolean) => void;
    /** 显示参考图上传 */
    showUpload: boolean;
    /** 设置参考图上传显示 */
    setShowUpload: (show: boolean) => void;
    /** 参考图 */
    referenceImage: string | null;
    /** 设置参考图 */
    setReferenceImage: (image: string | null) => void;
    /** textarea ref */
    textareaRef: React.RefObject<HTMLTextAreaElement>;
    /** 输入区域 ref */
    inputAreaRef: React.RefObject<HTMLDivElement>;
    /** 处理粘贴事件 */
    handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
    /** 处理拖拽进入 */
    handleDragEnter: (e: React.DragEvent) => void;
    /** 处理拖拽悬停 */
    handleDragOver: (e: React.DragEvent) => void;
    /** 处理拖拽离开 */
    handleDragLeave: (e: React.DragEvent) => void;
    /** 处理放下 */
    handleDrop: (e: React.DragEvent) => Promise<void>;
    /** 清除附加内容 */
    clearAttachments: () => void;
}

/**
 * 聊天输入状态管理
 */
export function useChatInput(): UseChatInputReturn {
    const [input, setInput] = useState('');
    const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
    const [isDraggingImage, setIsDraggingImage] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [showUpload, setShowUpload] = useState(false);
    const [referenceImage, setReferenceImage] = useState<string | null>(null);
    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputAreaRef = useRef<HTMLDivElement>(null);

    const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const base64 = reader.result as string;
                        // 提取纯 base64 数据（移除 data:image/xxx;base64, 前缀）
                        const base64Data = base64.split(',')[1] || base64;
                        setPastedImage({
                            data: base64Data,
                            type: file.type
                        });
                    };
                    reader.readAsDataURL(file);
                }
                break;
            }
        }
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 检查是否有图片文件
        const hasImage = Array.from(e.dataTransfer?.types || []).includes('Files');
        if (hasImage) {
            setIsDraggingImage(true);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 检查是否真的离开了输入区域
        const rect = inputAreaRef.current?.getBoundingClientRect();
        if (rect) {
            const { clientX, clientY } = e;
            if (
                clientX < rect.left ||
                clientX > rect.right ||
                clientY < rect.top ||
                clientY > rect.bottom
            ) {
                setIsDraggingImage(false);
            }
        }
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingImage(false);

        const files = e.dataTransfer?.files;
        if (!files?.length) return;

        const file = files[0];
        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result as string;
            const base64Data = base64.split(',')[1] || base64;
            setPastedImage({
                data: base64Data,
                type: file.type
            });
        };
        reader.readAsDataURL(file);
    }, []);

    const clearAttachments = useCallback(() => {
        setPastedImage(null);
        setReferenceImage(null);
    }, []);

    return {
        input,
        setInput,
        pastedImage,
        setPastedImage,
        isDraggingImage,
        showAttachMenu,
        setShowAttachMenu,
        showUpload,
        setShowUpload,
        referenceImage,
        setReferenceImage,
        textareaRef,
        inputAreaRef,
        handlePaste,
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        clearAttachments
    };
}
