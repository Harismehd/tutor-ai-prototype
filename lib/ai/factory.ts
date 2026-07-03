import { AIVisionProvider } from './types';
import { GeminiProvider } from './providers/gemini';
import { OpenAIProvider } from './providers/openai';
import { OpenRouterProvider } from './providers/openrouter';

export class AIVisionFactory {
  /**
   * Instantiates and returns the AI provider specified by the DEFAULT_AI_PROVIDER environment variable.
   * Defaults to 'openai' if not specified (primary production model).
   */
  static getProvider(): AIVisionProvider {
    const provider = (process.env.DEFAULT_AI_PROVIDER || 'gemini').toLowerCase();

    switch (provider) {
      case 'openai':
        return new OpenAIProvider();
      case 'gemini':
        return new GeminiProvider();
      case 'openrouter':
        return new OpenRouterProvider();
      default:
        throw new Error(
          `Unsupported AI Provider: "${provider}". Please set DEFAULT_AI_PROVIDER to "openai", "gemini" or "openrouter" in your environment.`
        );
    }
  }
}
