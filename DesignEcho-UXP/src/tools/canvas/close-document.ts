import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core } = require('photoshop');

export class CloseDocumentTool implements Tool {
    name = 'closeDocument';

    schema: ToolSchema = {
        name: 'closeDocument',
        description: 'Close a Photoshop document. Supports saving or discarding changes.',
        parameters: {
            type: 'object',
            properties: {
                documentName: {
                    type: 'string',
                    description: 'Document name to close. Supports fuzzy matching.'
                },
                documentId: {
                    type: 'number',
                    description: 'Document id to close.'
                },
                save: {
                    type: 'boolean',
                    description: 'Whether to save changes before closing. Default false.'
                }
            }
        }
    };

    async execute(params: {
        documentName?: string;
        documentId?: number;
        save?: boolean;
    }): Promise<{
        success: boolean;
        closedDocument?: string;
        error?: string;
    }> {
        try {
            const documents = app.documents;
            if (!documents || documents.length === 0) {
                return { success: false, error: 'No open documents' };
            }

            let targetDoc: any = null;

            if (params.documentId) {
                for (const doc of documents) {
                    if (doc.id === params.documentId) {
                        targetDoc = doc;
                        break;
                    }
                }
            } else if (params.documentName) {
                const searchName = params.documentName.toLowerCase();
                for (const doc of documents) {
                    if (doc.name.toLowerCase().includes(searchName) ||
                        doc.name.replace(/\.[^.]+$/, '').toLowerCase() === searchName) {
                        targetDoc = doc;
                        break;
                    }
                }
            } else {
                targetDoc = app.activeDocument;
            }

            if (!targetDoc) {
                return {
                    success: false,
                    error: params.documentName
                        ? `Document not found: ${params.documentName}`
                        : 'No target document specified'
                };
            }

            const docName = targetDoc.name;
            const shouldSave = params.save === true;

            await core.executeAsModal(async () => {
                if (shouldSave) {
                    await targetDoc.save();
                }
                await (targetDoc as any).closeWithoutSaving();
            }, { commandName: 'DesignEcho: Close Document' });

            console.log(`[CloseDocument] Closed ${docName} (${shouldSave ? 'saved' : 'discarded changes'})`);

            return {
                success: true,
                closedDocument: docName
            };
        } catch (error: any) {
            console.error('[CloseDocument] Error:', error);
            return {
                success: false,
                error: error?.message || 'Close document failed'
            };
        }
    }
}
