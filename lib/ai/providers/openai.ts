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

Meticulously check the student's answers for EACH question visible on the worksheet pages, group them page-by-page.

CRITICAL ACCURACY & LANGUAGE INSTRUCTIONS:
1. DO NOT guess. Solve each problem yourself step-by-step before evaluating the student's work.
2. Double-check all math steps. Ensure that you never falsely label a student's correct answer as incorrect.
3. Only mark a question as incorrect (is_correct: false) if there is an actual, demonstrable error in their calculation, final answer, or logic. If the answer is correct, you MUST mark is_correct: true.
4. If a question is correct, you do not need to supply a correct_answer, but you MUST write a brief confirmation reasoning in the "explanation" field.
5. All text in the "explanation" and "mistake_type" fields MUST be written in fluent, grammatically correct Traditional Chinese (繁體中文) suitable for Hong Kong teachers/students/parents.
6. The "explanation" field must be detailed and include: (a) what the question is, (b) your step-by-step correct solution/calculation, (c) what the student wrote, (d) your comparison showing they match or differ. This is your scratchpad to ensure accuracy.

You MUST respond with a JSON object conforming to the following schema:
{
  "pages": [
    {
      "page_number": 1, // 1-based index matching the order of uploaded images
      "questions": [
        {
          "question_number": "4", // The string label of the question (e.g. "4", "1a", "2.1"). If numbers are not visible on the sheet, generate sequential numbering.
          "is_correct": false, // true if correct, false if incorrect
          "correct_answer": "54", // The correct answer or correction (only needed if is_correct is false, otherwise leave empty "")
          "mistake_type": "None", // Description of the mistake in Traditional Chinese (e.g. "計算錯誤", "概念錯誤", or "無" / "None" if correct)
          "topic_tag": "Fraction Addition", // A short 1-3 word tag describing the mathematical topic (in English or Traditional Chinese)
          "explanation": "計算驗證過程：(1)題目是45 + 9。(2)正確檔案是54。(3)學生寫的是54。(4)結果相符，故標記為正確。" // Detailed step-by-step verification scratchpad and explanation in Traditional Chinese
        }
      ]
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

      if (!feedback.pages || !Array.isArray(feedback.pages)) {
        throw new Error('Malformed JSON structure returned by OpenAI: missing pages array.');
      }

      return {
        pages: feedback.pages.map((p) => ({
          page_number: Number(p.page_number) || 1,
          questions: (p.questions || []).map((q) => ({
            question_number: String(q.question_number) || '1',
            is_correct: Boolean(q.is_correct),
            correct_answer: q.correct_answer || '',
            mistake_type: q.mistake_type || 'None',
            topic_tag: q.topic_tag || 'General Math',
            explanation: q.explanation || '',
          })),
        })),
      };
    } catch (error: any) {
      console.error('OpenAI Provider Error:', error);
      throw new Error(`OpenAI Vision Analysis failed: ${error?.message || error}`);
    }
  }
}
