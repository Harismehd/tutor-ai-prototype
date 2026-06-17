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
    this.modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  }

  async analyzeWorksheet(imageBase64: string): Promise<AIVisionFeedback> {
    const { mimeType, base64Data } = this.parseDataUrl(imageBase64);

    // Get model. With Gemini 1.5+, we can configure the response mime type to JSON.
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `You are a professional tutoring-centre teaching assistant. Analyze the uploaded image of the student's worksheet.
Find a specific mistake made by the student. If there are multiple mistakes, select the most prominent one.
You must return a JSON object containing the following four fields:
1. "mistake": A brief description of the student's mistake.
2. "correctAnswer": The correct answer or correct method for the step.
3. "reasonTraditionalChinese": An educational explanation of why the student's answer is incorrect and how to think about it correctly. This explanation MUST be written in fluent Traditional Chinese (繁體中文) suitable for a student/parent.
4. "weakAreaTag": A short category/concept tag representing the skill or area being tested (e.g. "Fraction Addition", "Basic Multiplication", "Decimal Division").

Return ONLY the raw JSON object conforming to the schema. Do not include markdown code block backticks (like \`\`\`json) or any conversational text.`;

    const imageParts = [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
    ];

    try {
      const result = await model.generateContent([prompt, ...imageParts]);
      const responseText = result.response.text();

      if (!responseText) {
        throw new Error('Empty response received from Gemini.');
      }

      // Clean the response in case it returns markdown blocks
      const cleanedText = responseText.replace(/```json|```/g, '').trim();
      const feedback = JSON.parse(cleanedText) as AIVisionFeedback;

      // Ensure properties are strictly provided and default to fallbacks if missing
      return {
        mistake: feedback.mistake || 'Unable to identify specific mistake details.',
        correctAnswer: feedback.correctAnswer || 'Unable to determine correct answer.',
        reasonTraditionalChinese: feedback.reasonTraditionalChinese || '無法生成繁體中文解析，請聯繫老師。',
        weakAreaTag: feedback.weakAreaTag || 'General Study',
      };
    } catch (error: any) {
      console.error('Gemini Provider Error:', error);
      throw new Error(`Gemini Vision Analysis failed: ${error?.message || error}`);
    }
  }
}
