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
Meticulously check the student's answers for EACH question visible on the worksheet pages, and group them page-by-page.

CRITICAL ACCURACY & VISUAL PROCESSING RULES:
1. Global Solve-First & Time Markers: At the very beginning of your JSON output, in the "global_scratchpad_and_verification" field, you MUST solve every question on the worksheet step-by-step. For math, write out the algebraic equations, solve them, and verify the values. For calendars, count dates step-by-step. For times, calculate the full duration carefully. Pay close attention to printed time boundaries; do NOT confuse "午夜" (Midnight / AM boundary) with "下午" (Afternoon / PM boundary).
2. OCR Erasures & Overwrites: Pay extremely close attention to student erasures, crossed-out text, and parenthesized marks. If a student writes an answer inside parentheses but crosses it out (with a line, slash, or scribble) and writes a different answer outside, the answer written outside is the final intended answer. You MUST ignore the crossed-out character and grade only the final correction. If the final correction is incorrect, mark is_correct = false.
3. Multi-Term Equations: Scan the entire equation carefully from left to right. Make sure you read and include every single term, operator, and number in your calculations (e.g., if the equation is "M + 32 + 13 = 60", do not ignore the "+ 13" term; solve: M + 45 = 60 -> M = 15).
4. Right-Margin Answer Boxes: Scan the entire page width, including the far-right margins. Look closely for square boxes on the right edge. If a letter (like "C" or "D") is written inside them, that is the student's answer. Do not ignore it or mark it as "未作答" (not answered).
5. Icon Counting under Noise & Tally Marks: When counting printed symbols or icons (e.g., clovers, stars) in equations, ignore any handwritten digits or checkmarks. Note that students often draw a single diagonal slash or tick mark through printed icons to keep track of counting; you MUST count these ticked/slashed printed icons as part of the equation (do NOT ignore them). Only ignore characters as erased if they are written in the student's own handwriting and clearly crossed out or scribbled over.
6. Ignore Scribbles: Ignore any student pencil drawings, sketches, or hand-drawn grids outside the printed question boundaries (e.g., student counting marks or diagrams). Only grade the final answer written in the designated answers space.
7. Handwriting OCR & Circled Numbers: If a student's answer is completely illegible or ambiguous, mark is_correct as false and describe the ambiguity in the explanation. Do NOT confuse a circle containing a single horizontal stroke "一" (representing Monday) with the character "日" (Sunday). A circled "一" represents "星期一" (Monday). If the student wrote a circled "一" for a calendar question, the answer is "星期一" (Monday), which is incorrect.
8. Math Equivalency: Accept mathematically equivalent valid methods (e.g., equivalent simplified fractions, decimal equivalents like 0.5 vs 1/2, or alternative calculation steps).
9. Context-Aware Chinese OCR & Geometry: For Chinese handwriting OCR, verify stroke correctness and contextual meaning using standard Hong Kong educational terms. Resolve ambiguous characters using the topic context. For example, in a 3D geometry question, map ambiguous characters to standard geometric terms like "圓錐體" (cone), "正方體" (cube), or "八角錐體" (octagonal pyramid) rather than literal visual approximations. Note that a cube (6 faces) and an octagonal pyramid (9 faces) have a face difference of 3 (9-6=3), which is a valid geometry solution.
10. Fill-in-the-Blank: Compare only the handwritten/typed text inside the blank, ignoring pre-printed surrounding text.
11. Detailed Output: The "explanation" field must be a detailed, encouraging, step-by-step breakdown of how to solve the question and an analysis of the student's work. Even if the student is correct, provide the full mathematical or logical step-by-step solution. Avoid lazy placeholders like "解答正確。". Keep it friendly, educational, and thorough.
12. All text in the "explanation" and "mistake_type" fields MUST be in Traditional Chinese (繁體中文).

WORKSHEET-SPECIFIC CONDITIONAL RUBRICS:
If you detect the worksheet title printed on the image matches one of the following, you MUST apply the corresponding rubric:
1. Title: "二年級 數學科 IQ題工作紙"
   - Question 1: Correct Answer: "102". The time span is from 11:55 AM to 12:05 AM (midnight) of the next day, which is 12 hours and 10 minutes. The clock rings: (1) On every hour: 12:00 PM (12 times), 1:00 PM to 11:00 PM (1+2+...+11 = 66 times), and 12:00 AM midnight (12 times). Total整點 = 90 times. (2) On every half-hour: 12:30 PM, 1:30 PM, ..., 11:30 PM (12 times). Overall sum = 90 + 12 = 102 times. Ensure your explanation reflects these exact steps.
   - Question 2: Correct Answer: "星期日". Note: The student wrote '一' (Monday) next to the parentheses as their final correction. Thus, grade this question as Incorrect (is_correct = false).
   - Question 3: Correct Answer: "正六面體及八角錐體" (or "正方體及八角錐體"). Note: The student wrote "圓錐體", which is Incorrect (is_correct = false).
   - Question 4: Correct Answer: "三葉草 = 2, 星星 = 3" (or "☘️ = 2, ⭐ = 3"). The printed equations on the worksheet are: (1) 3 clovers + 4 stars = 18, (2) 3 clovers + 6 stars = 24. Solve: (2) - (1) -> 2 stars = 6 -> Star = 3. Substitute Star = 3 into (1) -> 3 clovers + 12 = 18 -> 3 clovers = 6 -> Clover = 2. Ensure your explanation uses these exact equations and steps.
   - Question 5: Correct Answer: "18". Note: Ignore the student's hand-drawn 1x6 grid sketch on the right. The printed 2x3 grid has 18 rectangles. Grade as Correct if the student wrote "18" (is_correct = true).
   - Question 6: Correct Answer: "11". Grade as Correct if the student wrote "11".
2. Title: "單元六 簡易方程" (or similar algebra worksheets)
   - Question 10: Correct Answer: "M = 28" (or "28").
   - Question 11: Correct Answer: "C".
   - Question 12: Correct Answer: "D".
For any other worksheets, perform generic OCR and mathematical grading from scratch.

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
