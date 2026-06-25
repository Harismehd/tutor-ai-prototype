import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAIProvider } from './base';
import { AIVisionFeedback } from '../types';

export class GeminiProvider extends BaseAIProvider {
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

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
      },
      systemInstruction: systemPrompt,
    });

    const imageParts = imagesBase64.map((img) => {
      const { mimeType, base64Data } = this.parseDataUrl(img);
      return {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      };
    });

    try {
      const result = await model.generateContent([userPrompt, ...imageParts]);
      const responseText = result.response.text();

      if (!responseText) {
        throw new Error('Empty response received from Gemini.');
      }

      const cleanedText = responseText.replace(/```json|```/g, '').trim();
      return JSON.parse(cleanedText) as T;
    } catch (error: any) {
      console.error('Gemini Vision Structured Completion Error:', error);
      throw new Error(`Gemini Vision Structured Completion failed: ${error?.message || error}`);
    }
  }

  async generateTextStructuredCompletion<T>(
    systemPrompt: string,
    userPrompt: string
  ): Promise<T> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
      },
      systemInstruction: systemPrompt,
    });

    try {
      const result = await model.generateContent([userPrompt]);
      const responseText = result.response.text();

      if (!responseText) {
        throw new Error('Empty response received from Gemini.');
      }

      const cleanedText = responseText.replace(/```json|```/g, '').trim();
      return JSON.parse(cleanedText) as T;
    } catch (error: any) {
      console.error('Gemini Text Structured Completion Error:', error);
      throw new Error(`Gemini Text Structured Completion failed: ${error?.message || error}`);
    }
  }
}
