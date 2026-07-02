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
        maxOutputTokens: 8192,
      },
    });

    const prompt = `You are an expert educational grading assistant for a tutoring centre.
Analyze the uploaded image(s) of a student's worksheet. The worksheet may consist of one or multiple pages.
Meticulously check the student's answers for EACH question visible on the worksheet pages, and group them page-by-page.

REQUIRED GRADING PIPELINE:
You must dynamically analyze the worksheet using the following chain of thought. Document your process in the "global_scratchpad_and_verification" field:
1. Strict OCR & Transcription (CRITICAL): Before solving, you MUST transcribe the printed question text and the student's exact handwritten answer into your scratchpad. Pay extreme attention to visual details: read calendars cell by cell, count grid lines carefully, and distinguish between crossed-out mistakes and final intended answers.
2. Answer Verification: Solve the question completely and independently before judging the student's response. For math, write out the equations and verify values. For calendars or time, count step-by-step.
3. Student Response Matching: Compare the student's final intended answer with your verified answer. Consider handwriting uncertainty, overwriting, spacing, symbols, and minor visual noise (like tally marks through printed icons). Accept mathematically equivalent valid methods.
4. Confidence Handling & Ambiguity: If the student's handwriting is completely illegible, ambiguous, or you are unsure of the stroke, DO NOT confidently mark it incorrect. Instead, flag the uncertainty, explain the ambiguity in the explanation, and consider it unrecognized. For example, if "一" could be a stray mark or "星期一", carefully assess the context.
5. Visual Element Assessment: For diagrams, grids, or clocks, explicitly state your counting logic in the scratchpad before finalizing the answer. Count rectangles systematically. For date questions, determine the start date and manually count days.

CRITICAL ACCURACY & PEDAGOGICAL RULES:
1. Context-Aware Chinese OCR & Geometry: Resolve ambiguous handwritten Chinese characters using topic context and standard Hong Kong educational terms. For instance, in geometry, map ambiguous characters to standard terms like "圓錐體" (cone), "正方體" (cube), or "八角錐體" (octagonal pyramid) rather than literal visual approximations.
2. Pedagogical Constraints (Primary 2, 7-8 years old): Explain all mathematics using primary-level comparative or visual logic. NEVER use secondary-school jargon (e.g., "方程組" / system of equations, "代入" / substitution). Instead, use intuitive comparisons (e.g., "第二個算式比第一個算式多了2個星...").
3. Hong Kong Curriculum Localization: Comply strictly with Hong Kong EDB terminology (e.g., use "正方體" instead of "正六面體").
4. Match Worksheet Vocabulary: Always use the exact terminology printed on the worksheet (e.g., "梅花" instead of "三葉草").
5. Traditional Chinese: All text in the "explanation" and "mistake_type" fields MUST be in Traditional Chinese (繁體中文).
6. Plain-Text Formatting (Strictly NO Markdown): The UI renders explanations as plain text. You MUST NOT use any markdown characters ("*", "-", "#"). Use standard plain numbers (e.g., "1.", "2.") or letters (e.g., "a.", "b.") for step-by-step structures. Use the standard math cross symbol "×" for multiplication, never the asterisk "*".
7. Detailed & Encouraging Output: Provide a detailed, step-by-step breakdown of how to solve the question. Even if correct, provide the full solution to reinforce learning. Avoid lazy placeholders. Keep the tone friendly and encouraging.

You MUST respond with a JSON object conforming to the following schema:
{
  "global_scratchpad_and_verification": "Solve every question here first step-by-step before writing page results...",
  "pages": [
    {
      "page_number": 1, // 1-based index matching the order of uploaded images
      "questions": [
        {
          "question_number": "1", // String label of the question (e.g., "1", "2(a)", "3b")
          "is_correct": true, // true if correct, false if incorrect
          "correct_answer": "102", // The standard correct answer or correction (MUST be populated for ALL questions, correct or incorrect)
          "mistake_type": "無", // Description of the mistake in Traditional Chinese (e.g., "計算錯誤", "概念錯誤", "未作答", or "無" if correct)
          "topic_tag": "Fraction Addition", // A short 1-3 word tag describing the topic (in English or Traditional Chinese)
          "explanation": "詳細且帶鼓勵性的步驟解析" // Detailed step-by-step mathematical explanation in Traditional Chinese
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
