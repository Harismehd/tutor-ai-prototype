import { BaseAIProvider } from './base';
import { AIVisionFeedback } from '../types';
import { toSafeError } from '../errors';
import { runGradingPipeline, ModelAdapter } from './pipeline';

/**
 * OpenRouterProvider adapter: implements callVisionJSON and callTextJSON using the
 * OpenRouter completions endpoint. Supports model configuration via OPENROUTER_MODEL.
 */
export class OpenRouterProvider extends BaseAIProvider implements ModelAdapter {
  public readonly name = 'openrouter';
  private apiKey: string;
  private modelName: string;

  constructor() {
    super();
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is not defined. Please check your setup.');
    }
    this.apiKey = apiKey;
    this.modelName = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
  }

  async analyzeWorksheet(imagesBase64: string[]): Promise<AIVisionFeedback> {
    try {
      return await runGradingPipeline(this, imagesBase64);
    } catch (error) {
      throw toSafeError(error, 'OpenRouterProvider.analyzeWorksheet');
    }
  }

  // ---- ModelAdapter implementation ----

  async callVisionJSON(
    systemPrompt: string,
    userPrompt: string,
    imagesBase64: string[],
    temperature: number
  ): Promise<any> {
    const contentParts: any[] = [{ type: 'text', text: userPrompt }];
    imagesBase64.forEach((img) => {
      const { mimeType, base64Data } = this.parseDataUrl(img);
      const dataUrl = img.startsWith('data:') ? img : `data:${mimeType};base64,${base64Data}`;
      contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
    });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelName,
        response_format: { type: 'json_object' },
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contentParts },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content;
    return this.parseJsonResponse(replyText);
  }

  async callTextJSON(systemPrompt: string, userPrompt: string, temperature: number): Promise<any> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.modelName,
        response_format: { type: 'json_object' },
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const replyText = data.choices?.[0]?.message?.content;
    return this.parseJsonResponse(replyText);
  }

  private parseJsonResponse(responseText: string | null | undefined): any {
    if (!responseText) {
      throw new Error('Empty response received from OpenRouter.');
    }
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}
