import OpenAI from 'openai';
import { BaseAIProvider } from './base';
import { AIVisionFeedback } from '../types';
import { toSafeError } from '../errors';
import { runGradingPipeline, ModelAdapter } from './pipeline';

/**
 * OpenAIProvider is now a thin adapter: it only knows how to make an OpenAI
 * vision call and an OpenAI text call that return JSON. ALL grading logic
 * lives in pipeline.ts and is shared with GeminiProvider — see the comment
 * at the top of gemini.ts for why that matters.
 */
export class OpenAIProvider extends BaseAIProvider implements ModelAdapter {
  public readonly name = 'openai';
  private openai: OpenAI;
  private modelName: string;

  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not defined. Please check your setup.');
    }
    this.openai = new OpenAI({ apiKey });
    this.modelName = process.env.OPENAI_MODEL || 'gpt-4o';
  }

  async analyzeWorksheet(imagesBase64: string[]): Promise<AIVisionFeedback> {
    try {
      return await runGradingPipeline(this, imagesBase64);
    } catch (error) {
      throw toSafeError(error, 'OpenAIProvider.analyzeWorksheet');
    }
  }

  // ---- ModelAdapter implementation ----

  async callVision(
    systemPrompt: string,
    userPrompt: string,
    imagesBase64: string[],
    temperature: number
  ): Promise<string> {
    const contentParts: any[] = [{ type: 'text', text: userPrompt }];
    imagesBase64.forEach((img) => {
      const dataUrl = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
      contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
    });

    const response = await this.openai.chat.completions.create({
      model: this.modelName,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contentParts },
      ],
    });

    return response.choices[0]?.message?.content || '';
  }

  async callText(systemPrompt: string, userPrompt: string, temperature: number): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.modelName,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    return response.choices[0]?.message?.content || '';
  }
}
