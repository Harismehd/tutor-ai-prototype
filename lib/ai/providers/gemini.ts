import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAIProvider } from './base';
import { AIVisionFeedback } from '../types';
import { toSafeError } from '../errors';
import { runGradingPipeline, ModelAdapter } from './pipeline';

/**
 * GeminiProvider is now a thin adapter: it only knows how to make a Gemini
 * vision call and a Gemini text call that return JSON. ALL grading logic
 * (segmentation, independent solving with self-consistency voting,
 * comparison, feedback generation) lives in pipeline.ts and is shared with
 * OpenAIProvider, so the two providers cannot silently drift apart.
 *
 * There is intentionally NO hardcoded answer key / question-specific rubric
 * anywhere in this file — that was the root cause of the inconsistent
 * grading identified in the postmortem.
 */
export class GeminiProvider extends BaseAIProvider implements ModelAdapter {
  public readonly name = 'gemini';
  private genAI: GoogleGenerativeAI;
  private modelName: string;

  constructor() {
    super();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not defined. Please check your setup.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  async analyzeWorksheet(imagesBase64: string[]): Promise<AIVisionFeedback> {
    try {
      return await runGradingPipeline(this, imagesBase64);
    } catch (error) {
      throw toSafeError(error, 'GeminiProvider.analyzeWorksheet');
    }
  }

  // ---- ModelAdapter implementation ----

  async callVision(
    systemPrompt: string,
    userPrompt: string,
    imagesBase64: string[],
    temperature: number
  ): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature,
      },
    });

    const imageParts = imagesBase64.map((img) => {
      const { mimeType, base64Data } = this.parseDataUrl(img);
      return { inlineData: { data: base64Data, mimeType } };
    });

    const result = await model.generateContent([userPrompt, ...imageParts]);
    return result.response.text();
  }

  async callText(systemPrompt: string, userPrompt: string, temperature: number): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature,
      },
    });

    const result = await model.generateContent(userPrompt);
    return result.response.text();
  }
}
