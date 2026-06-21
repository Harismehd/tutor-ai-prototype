import { AIVisionProvider } from './types';
import { GeminiProvider } from './providers/gemini';
import { OpenAIProvider } from './providers/openai';

export class AIVisionFactory {
  /**
   * Instantiates and returns the AI provider specified by the DEFAULT_AI_PROVIDER environment variable.
   * Defaults to 'openai' if not specified (primary production model).
   */
  static getProvider(): AIVisionProvider {
    const provider = (process.env.DEFAULT_AI_PROVIDER || 'openai').toLowerCase();

    switch (provider) {
      case 'openai':
        return new OpenAIProvider();
      case 'gemini':
        return new GeminiProvider();
      default:
        throw new Error(
          `Unsupported AI Provider: "${provider}". Please set DEFAULT_AI_PROVIDER to either "openai" or "gemini" in your environment.`
        );
    }
  }
}
