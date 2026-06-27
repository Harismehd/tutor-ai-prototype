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
            content: `You are an expert educational grading assistant for a tutoring centre.
Analyze the uploaded image(s) of a student's worksheet. The worksheet may consist of one or multiple pages.

Meticulously check the student's answers for EACH question visible on the worksheet pages, group them page-by-page.

CRITICAL ACCURACY & SUBJECT-SPECIFIC RULES:
1. Do NOT invent questions or question numbers. Only grade questions physically visible on the sheet.
2. Mental Verification: Solve each question step-by-step in your reasoning before writing the evaluation. Ensure you never falsely label a student's correct answer as incorrect.
3. Math Questions: Accept mathematically equivalent valid methods (e.g., equivalent simplified fractions, decimal equivalents like 0.5 vs 1/2, or alternative calculation steps).
4. Chinese Questions: Compare characters and meaning carefully. Verify stroke correctness and contextual meaning using standard Hong Kong educational terms.
5. Fill-in-the-Blank: Compare only the handwritten/typed text inside the blank, ignoring pre-printed surrounding text.
6. Handwriting OCR: If a student's answer is completely illegible or ambiguous, mark is_correct as false and describe the ambiguity in the explanation so the teacher can review it manually.
7. Concise Output: Keep the "explanation" field very brief. If the answer is correct, set explanation to "解答正確。". If incorrect, explain the mistake concisely (e.g., "計算錯誤" or "拼寫錯誤").
8. All text in the "explanation" and "mistake_type" fields MUST be in Traditional Chinese (繁體中文).

You MUST respond with a JSON object conforming to the following schema:
{
  "pages": [
    {
      "page_number": 1, // 1-based index matching the order of uploaded images
      "questions": [
        {
          "question_number": "1", // String label of the question (e.g., "1", "2(a)", "3b")
          "is_correct": true, // true if correct, false if incorrect
          "correct_answer": "", // The correct answer or correction (only needed if is_correct is false, otherwise leave empty "")
          "mistake_type": "無", // Description of the mistake in Traditional Chinese (e.g., "計算錯誤", "拼寫錯誤", or "無" if correct)
          "topic_tag": "Fraction Addition", // A short 1-3 word tag describing the topic (in English or Traditional Chinese)
          "explanation": "解答正確。" // Very short explanation or correction guidance in Traditional Chinese
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
