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

  async analyzeWorksheet(imageBase64: string): Promise<AIVisionFeedback> {
    // OpenAI expects a full data URL. If a raw base64 string is provided, convert it to a PNG data URL.
    let dataUrl = imageBase64;
    if (!imageBase64.startsWith('data:')) {
      dataUrl = `data:image/png;base64,${imageBase64}`;
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelName,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a professional tutoring-centre teaching assistant. Analyze the uploaded image of the student's worksheet.
Find a specific mistake made by the student. If there are multiple mistakes, select the most prominent one.
You must return a JSON object containing the following four fields:
{
  "mistake": "A brief description of the student's mistake.",
  "correctAnswer": "The correct answer or correct method for the step.",
  "reasonTraditionalChinese": "An educational explanation of why the student's answer is incorrect and how to think about it correctly. This explanation MUST be written in fluent Traditional Chinese (繁體中文) suitable for a student/parent.",
  "weakAreaTag": "A short category/concept tag representing the skill or area being tested (e.g. 'Fraction Addition', 'Basic Multiplication', 'Decimal Division')."
}
Return ONLY the raw JSON object conforming to the schema.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Here is the worksheet image. Please analyze it.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
      });

      const responseText = response.choices[0]?.message?.content;
      if (!responseText) {
        throw new Error('Empty response received from OpenAI.');
      }

      const feedback = JSON.parse(responseText.trim()) as AIVisionFeedback;
      return {
        mistake: feedback.mistake || 'Unable to identify specific mistake details.',
        correctAnswer: feedback.correctAnswer || 'Unable to determine correct answer.',
        reasonTraditionalChinese: feedback.reasonTraditionalChinese || '無法生成繁體中文解析，請聯繫老師。',
        weakAreaTag: feedback.weakAreaTag || 'General Study',
      };
    } catch (error: any) {
      console.error('OpenAI Provider Error:', error);
      throw new Error(`OpenAI Vision Analysis failed: ${error?.message || error}`);
    }
  }
}
