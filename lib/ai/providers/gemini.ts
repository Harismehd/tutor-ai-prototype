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
    if (!imagesBase64 || imagesBase64.length === 0) {
      throw new Error('At least one worksheet page image is required.');
    }

    // Configure the model. Gemini 1.5+ and 2.5 support JSON mode.
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `You are an expert educational grading assistant for a tutoring centre.
Analyze the uploaded image(s) of a student's worksheet. The worksheet may consist of one or multiple pages.

Meticulously check the student's answers for EACH question visible on the worksheet pages, group them page-by-page.

CRITICAL ACCURACY & SUBJECT-SPECIFIC RULES:
1. Do NOT invent questions or question numbers. Only grade questions physically visible on the sheet.
2. Scratchpad Solve-First: For EACH question, you must first solve it yourself step-by-step and verify handwriting inside the "scratchpad" field of the JSON. Ensure you never falsely label a student's correct answer as incorrect.
3. Ignore Scribbles: Ignore any student pencil drawings, sketches, or hand-drawn grids outside the printed question boundaries (e.g., student counting drawings). Only grade the answer written in the designated answers space.
4. Math Questions: Accept mathematically equivalent valid methods (e.g., equivalent simplified fractions, decimal equivalents like 0.5 vs 1/2, or alternative calculation steps).
5. Chinese Questions: Compare characters and meaning carefully. Verify stroke correctness and contextual meaning using standard Hong Kong educational terms.
6. Time & Calendar Calculations: Calculate elapsed time periods meticulously. Pay close attention to noon (中午 12 時) vs midnight (午夜 12 時).
7. Fill-in-the-Blank: Compare only the handwritten/typed text inside the blank, ignoring pre-printed surrounding text.
8. Handwriting OCR: If a student's answer is completely illegible or ambiguous, mark is_correct as false and describe the ambiguity in the explanation so the teacher can review it manually.
9. Concise Output: Keep the "explanation" field very brief. If the answer is correct, set explanation to "解答正確。". If incorrect, explain the mistake concisely (e.g., "計算錯誤" or "拼寫錯誤").
10. All text in the "explanation" and "mistake_type" fields MUST be in Traditional Chinese (繁體中文).

You MUST respond with a JSON object conforming to the following schema:
{
  "pages": [
    {
      "page_number": 1, // 1-based index matching the order of uploaded images
      "questions": [
        {
          "question_number": "1", // String label of the question (e.g., "1", "2(a)", "3b")
          "scratchpad": "Solve the problem step-by-step and identify the handwriting here...",
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

Return ONLY the raw JSON object conforming to the schema. Do not include markdown code block backticks (like \`\`\`json) or any conversational text.`;

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
      const result = await model.generateContent([prompt, ...imageParts]);
      const responseText = result.response.text();

      if (!responseText) {
        throw new Error('Empty response received from Gemini.');
      }

      // Clean the response in case it returns markdown blocks
      const cleanedText = responseText.replace(/```json|```/g, '').trim();
      const feedback = JSON.parse(cleanedText) as AIVisionFeedback;

      if (!feedback.pages || !Array.isArray(feedback.pages)) {
        throw new Error('Malformed JSON structure returned by Gemini: missing pages array.');
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
      console.error('Gemini Provider Error:', error);
      throw new Error(`Gemini Vision Analysis failed: ${error?.message || error}`);
    }
  }
}
