import { AIVisionFeedback, AIVisionProvider } from '../types';

export abstract class BaseAIProvider implements AIVisionProvider {
  abstract analyzeWorksheet(imagesBase64: string[]): Promise<AIVisionFeedback>;

  /**
   * Helper to parse data URLs into MIME type and raw base64 data.
   */
  protected parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } {
    if (dataUrl.startsWith('data:')) {
      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        return {
          mimeType: matches[1],
          base64Data: matches[2],
        };
      }
    }
    // Default fallback (assume png if not specified, and treat input as raw base64)
    return {
      mimeType: 'image/png',
      base64Data: dataUrl,
    };
  }
}
