import type { DocumentStoragePort } from '../../application/ports.js';

export class HttpDocumentStorage implements DocumentStoragePort {
  constructor(
    private readonly documentServiceUrl: string,
    private readonly internalSecret: string,
  ) {}

  async upload(params: { resourceId: string; category: string; originalName: string; mimeType: string; buffer: Buffer }): Promise<void> {
    const formData = new FormData();
    formData.append('resourceType', 'invoice');
    formData.append('resourceId', params.resourceId);
    formData.append('category', params.category);
    formData.append('originalName', params.originalName);
    formData.append('mimeType', params.mimeType);
    formData.append('uploadedBy', 'billing-service');
    formData.append('file', new Blob([new Uint8Array(params.buffer)], { type: params.mimeType }), params.originalName);

    const response = await fetch(`${this.documentServiceUrl}/files/internal`, {
      method: 'POST',
      headers: {
        'X-Internal-Secret': this.internalSecret,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Error subiendo documento a document-service (${response.status}): ${text}`);
    }
  }
}
