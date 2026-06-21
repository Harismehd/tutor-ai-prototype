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
    if (!imagesBase64 || imagesBase64.length === 0) {
      throw new Error('At least one worksheet page image is required.');
    }

    // Build user content parts, supporting multiple images
    const contentParts: any[] = [
      {
        type: 'text',
        text: 'Please analyze the pages of this student worksheet and return the structured JSON feedback.',
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
            content: `You are an expert mathematical assessment assistant for a tutoring centre.
Analyze the uploaded image(s) of a student's worksheet. The worksheet may consist of one or multiple pages.

Meticulously check the student's answers for EACH question visible on the worksheet pages.

CRITICAL ACCURACY INSTRUCTIONS:
1. DO NOT guess. Solve each problem yourself step-by-step before evaluating the student's work.
2. Double-check all math steps. Ensure that you never falsely label a student's correct answer as incorrect.
3. Only mark a question as incorrect (is_correct: false) if there is an actual, demonstrable error in their calculation, final answer, or logic. If the answer is correct, you MUST mark is_correct: true.
4. Set the question_number sequentially as they appear in the worksheet.

You MUST respond with a JSON object conforming to the following schema:
{
  "questions": [
    {
      "question_number": 1,
      "is_correct": true, // true if correct, false if incorrect
      "correct_answer": "123", // The correct answer or correction (only needed if is_correct is false, otherwise leave empty "")
      "mistake_type": "None", // Description of the mistake (only needed if is_correct is false, e.g., "Calculation Error", "Wrong Operation", or "None" if correct)
      "topic_tag": "Fraction Addition" // A short 1-3 word tag describing the mathematical topic
    }
  ]
}

Return ONLY the raw JSON object conforming to the schema.`,
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

      const feedback = JSON.parse(responseText.trim()) as AIVisionFeedback;

      if (!feedback.questions || !Array.isArray(feedback.questions)) {
        throw new Error('Malformed JSON structure returned by OpenAI: missing questions array.');
      }

      return {
        questions: feedback.questions.map((q) => ({
          question_number: Number(q.question_number) || 1,
          is_correct: Boolean(q.is_correct),
          correct_answer: q.correct_answer || '',
          mistake_type: q.mistake_type || 'None',
          topic_tag: q.topic_tag || 'General Math',
        })),
      };
    } catch (error: any) {
      console.error('OpenAI Provider Error:', error);
      throw new Error(`OpenAI Vision Analysis failed: ${error?.message || error}`);
    }
  }
}
