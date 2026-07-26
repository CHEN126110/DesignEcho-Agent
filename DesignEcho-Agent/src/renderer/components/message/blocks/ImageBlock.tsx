/**
 * 图片块渲染组件
 */

import React, { useState } from 'react';
import type { ImageBlock as ImageBlockType } from '../types';

interface ImageBlockProps {
    block: ImageBlockType;
}

export const ImageBlock: React.FC<ImageBlockProps> = ({ block }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [isZoomed, setIsZoomed] = useState(false);
    const [hasError, setHasError] = useState(false);
    
    const handleLoad = () => {
        setIsLoading(false);
    };
    
    const handleError = () => {
        setIsLoading(false);
        setHasError(true);
    };
    
    const handleZoom = () => {
        if (block.zoomable !== false) {
            setIsZoomed(!isZoomed);
        }
    };
    
    // 确定图片源
    const imageSrc = block.src.startsWith('data:') 
        ? block.src 
        : block.src.startsWith('http') 
            ? block.src 
            : `data:image/png;base64,${block.src}`;
    
    if (hasError) {
        return (
            <div className="message-block image-block image-error">
                <div className="image-error-content">
                    <span className="error-icon">🖼️</span>
                    <span className="error-text">图片加载失败</span>
                </div>
            </div>
        );
    }
    
    return (
        <>
            <div 
                className={`message-block image-block ${block.zoomable !== false ? 'zoomable' : ''}`}
                style={{
                    maxWidth: block.width ? `${block.width}px` : undefined,
                    aspectRatio: block.aspectRatio ? `${block.aspectRatio}` : undefined
                }}
            >
                {isLoading && (
                    <div className="image-loading">
                        <div className="loading-spinner"></div>
                    </div>
                )}
                <img
                    src={imageSrc}
                    alt={block.alt || '图片'}
                    onLoad={handleLoad}
                    onError={handleError}
                    onClick={handleZoom}
                    className={isLoading ? 'loading' : 'loaded'}
                    style={{
                        maxWidth: block.width ? `${block.width}px` : '100%',
                        maxHeight: block.height ? `${block.height}px` : '400px'
                    }}
                />
                {block.caption && (
                    <div className="image-caption">{block.caption}</div>
                )}
            </div>
            
            {/* 全屏预览 */}
            {isZoomed && (
                <div className="image-zoom-overlay" onClick={() => setIsZoomed(false)}>
                    <div className="zoom-container">
                        <img src={imageSrc} alt={block.alt || '图片'} />
                        {block.caption && (
                            <div className="zoom-caption">{block.caption}</div>
                        )}
                    </div>
                    <button className="zoom-close" onClick={() => setIsZoomed(false)}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            )}
        </>
    );
};

export default ImageBlock;
