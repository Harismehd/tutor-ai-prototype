import OpenAI from 'openai';
import { BaseAIProvider } from './base';
import { AIVisionFeedback } from '../types';

export class OpenAIProvider extends BaseAIProvider {
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
    const { runGradingPipeline } = await import('../pipeline');
    return runGradingPipeline(imagesBase64, this);
  }

  async generateVisionStructuredCompletion<T>(
    imagesBase64: string[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<T> {
    if (!imagesBase64 || imagesBase64.length === 0) {
      throw new Error('At least one worksheet page image is required.');
    }

    const contentParts: any[] = [
      {
        type: 'text',
        text: userPrompt,
      },
    ];

    imagesBase64.forEach((img) => {
      let dataUrl = img;
      if (!img.startsWith('data:')) {
        dataUrl = `data:image/png;base64,${img}`;
      }
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: dataUrl,
        },
      });
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelName,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: contentParts,
          },
        ],
      });

      const responseText = response.choices[0]?.message?.content;
      if (!responseText) {
        throw new Error('Empty response received from OpenAI.');
      }

      return JSON.parse(responseText.trim()) as T;
    } catch (error: any) {
      console.error('OpenAI Vision Structured Completion Error:', error);
      throw new Error(`OpenAI Vision Structured Completion failed: ${error?.message || error}`);
    }
  }

  async generateTextStructuredCompletion<T>(
    systemPrompt: string,
    userPrompt: string
  ): Promise<T> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelName,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      const responseText = response.choices[0]?.message?.content;
      if (!responseText) {
        throw new Error('Empty response received from OpenAI.');
      }

      return JSON.parse(responseText.trim()) as T;
    } catch (error: any) {
      console.error('OpenAI Text Structured Completion Error:', error);
      throw new Error(`OpenAI Text Structured Completion failed: ${error?.message || error}`);
    }
  }
}
