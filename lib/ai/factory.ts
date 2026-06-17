import { AIVisionProvider } from './types';
import { GeminiProvider } from './providers/gemini';
import { OpenAIProvider } from './providers/openai';

export class AIVisionFactory {
  /**
   * Instantiates and returns the AI provider specified by the DEFAULT_AI_PROVIDER environment variable.
   * Defaults to 'gemini' if not specified (suitable for prototype testing).
   */
  static getProvider(): AIVisionProvider {
    const provider = (process.env.DEFAULT_AI_PROVIDER || 'gemini').toLowerCase();

    switch (provider) {
      case 'gemini':
        return new GeminiProvider();
      case 'openai':
        return new OpenAIProvider();
      default:
        throw new Error(
          `Unsupported AI Provider: "${provider}". Please set DEFAULT_AI_PROVIDER to either "gemini" or "openai" in your environment.`
        );
    }
  }
}
