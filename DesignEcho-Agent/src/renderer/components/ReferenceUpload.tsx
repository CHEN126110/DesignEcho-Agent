import React, { useCallback, useState } from 'react';

interface ReferenceUploadProps {
    onUpload: (file: File, base64: string) => void;
    isLoading?: boolean;
}

export const ReferenceUpload: React.FC<ReferenceUploadProps> = ({ onUpload, isLoading }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setIsDragging(true);
        } else if (e.type === 'dragleave') {
            setIsDragging(false);
        }
    }, []);

    const processFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) {
            alert('请上传图片文件');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            setPreview(result);
            // 移除 data:image/xxx;base64, 前缀
            const base64 = result.split(',')[1];
            onUpload(file, base64);
        };
        reader.readAsDataURL(file);
    }, [onUpload]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
        }
    }, [processFile]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
        }
    }, [processFile]);

    return (
        <div className="reference-upload">
            <div 
                className={`upload-zone ${isDragging ? 'dragging' : ''} ${preview ? 'has-preview' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input')?.click()}
            >
                {preview ? (
                    <div className="preview-container">
                        <img src={preview} alt="Reference" className="preview-image" />
                        <div className="preview-overlay">
                            <span>点击更换图片</span>
                        </div>
                    </div>
                ) : (
                    <div className="upload-placeholder">
                        <span className="upload-icon">🖼️</span>
                        <span className="upload-text">拖拽图片到这里，或点击上传</span>
                        <span className="upload-hint">支持 JPG, PNG</span>
                    </div>
                )}
                
                <input 
                    type="file" 
                    id="file-input" 
                    className="hidden-input" 
                    accept="image/*"
                    onChange={handleChange}
                    disabled={isLoading}
                />
            </div>

            <style>{`
                .reference-upload {
                    width: 100%;
                    margin-bottom: 16px;
                }

                .upload-zone {
                    width: 100%;
                    height: 160px;
                    border: 2px dashed var(--de-border);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    background: var(--de-bg-card);
                    overflow: hidden;
                    position: relative;
                }

                .upload-zone:hover, .upload-zone.dragging {
                    border-color: var(--de-primary);
                    background: rgba(0, 102, 255, 0.05);
                }

                .upload-zone.has-preview {
                    border-style: solid;
                    padding: 0;
                }

                .upload-placeholder {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    color: var(--de-text-secondary);
                }

                .upload-icon {
                    font-size: 32px;
                }

                .upload-text {
                    font-size: 14px;
                    font-weight: 500;
                }

                .upload-hint {
                    font-size: 12px;
                    opacity: 0.7;
                }

                .hidden-input {
                    display: none;
                }

                .preview-container {
                    width: 100%;
                    height: 100%;
                    position: relative;
                }

                .preview-image {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .preview-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    font-size: 14px;
                    font-weight: 500;
                }

                .upload-zone:hover .preview-overlay {
                    opacity: 1;
                }
            `}</style>
        </div>
    );
};
