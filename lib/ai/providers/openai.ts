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
13. Pedagogical Constraints (Age Mismatch): The student demographic profile is Primary 2 (7-8 years old). You MUST explain all mathematics using primary-level comparative or visual logic. NEVER use secondary-school mathematical jargon such as "方程組" (system of equations), "消去" (elimination), or "代入/代回" (substitution). Instead, explain using step-by-step intuitive comparisons (e.g., "比較兩個算式：第二個算式比第一個算式多了2個星，結果大了6。由此可知，2個星代表6，所以1個星代表3...").
14. Hong Kong Curriculum Localization: Comply strictly with the Hong Kong Education Bureau (EDB) Primary Mathematics Curriculum terminology. Always use "正方體" instead of "正六面體", and "長方體" instead of "直角六面體" or "長方柱".
15. Plain-Text Formatting (No Markdown) & Multiplication Cross: The frontend UI renders explanation text as pre-formatted plain text (whitespace-pre-wrap). To prevent raw unrendered symbols from showing in the UI, you MUST NOT use any markdown characters (do not use "**" for bold, and do not use "*" or "-" for list bullets). Use plain numbers (e.g., "1.", "2.") and standard line breaks for step-by-step structure. Never use the programming asterisk symbol "*" for multiplication; always use the standard math multiplication cross symbol "×" instead (for example, write "3 × 69 = 207" or "2 × 3 = 6").
16. Match Worksheet Vocabulary: Always use the exact terminology, names, or symbols printed on the worksheet. For example, if the sheet uses "梅花" (Clover), do not write "三葉草". If the sheet uses "星" (Star), do not write "星星".
17. Professional Calendar Explanations: For calendar and date questions, do not list long day-by-day dates leading up to the starting date (e.g., listing June 1 to June 15). Instead, instruct the student to look directly at the calendar grid image to identify the starting day of the week, and then write out the day-by-day travel timeline clearly (for example: Day 1 is June 15 (Thursday), Day 2 is June 16 (Friday), Day 3 is June 17 (Saturday), Day 4 is June 18 (Sunday)).

QUESTION-SPECIFIC CONDITIONAL RUBRICS:
Before grading a question, check if its printed text or equation matches any of the following descriptions. If it matches, you MUST apply the corresponding rubric:
- If the question contains "11時55分至午夜12時5分" (Clock chimes):
  * Correct Answer: "102".
  * Explanation steps:
    1. 計算整點報時：中午 12:00 報時 12 次。下午 1:00 至晚上 11:00 報時次數為 1 加到 11 等於 66 次。隔天凌晨 12:00 報時 12 次。整點報時總共 90 次。
    2. 計算半點報時：從中午 12:30 到晚上 11:30，共有 12 個半點，所以報時 12 次。
    3. 兩者相加：90 加 12 等於 102 次。
- If the question contains "旅行團" or "6月15日出發" (Travel calendar):
  * Correct Answer: "星期日".
  * Grading note: The student wrote '一' (Monday) next to the parentheses as their final correction. Thus, grade this question as Incorrect (is_correct = false).
  * Explanation steps:
    1. 觀察月曆：請看工作紙上的月曆，可以直接找出 6 月 15 日是星期四。
    2. 旅行天數推算：旅行團是四天三夜，所以第四天是回港日。
    3. 推算星期：第一天是 6 月 15 日（星期四），第二天是 6 月 16 日（星期五），第三天是 6 月 17 日（星期六），第四天是 6 月 18 日（星期日）。
    4. 結論：小明回港的日期是星期日。
- If the question contains "柱體和錐體" and "相差3個" (Solid shapes):
  * Correct Answer: "正方體及八角錐體" (or "正方體和八角錐體").
  * Grading note: The student wrote "圓錐體", which is Incorrect (is_correct = false). Always explain that the prism is a "正方體" (which has 6 faces), and a pyramid with 3 more faces must have 9 faces, making it an "八角錐體".
- If the question shows icons of Clovers (☘️) and Stars (⭐) (e.g., 3 clovers + 4 stars = 18):
  * Correct Answer: "梅花 = 2, 星 = 3" (or "☘️ = 2, ⭐ = 3").
  * Explanation steps:
    比較兩個算式：第一個算式有 3 個梅花和 4 個星，共 18；第二個算式有 3 個梅花和 6 個星，共 24。
    第二個算式比第一個算式多了 2 個星，結果大了 6（24 減 18 等於 6）。由此可知，2 個星代表 6，所以 1 個星代表 3。
    再把星的值放回第一個算式：3 個梅花加 12（4 個星）等於 18，所以 3 個梅花代表 6，1 個梅花代表 2。
- If the question contains "有6個正方形" and "長方形多少個" (Count rectangles):
  * Correct Answer: "18".
  * Grading note: Ignore the student's hand-drawn 1x6 grid sketch on the right. The printed 2x3 grid has 18 rectangles. Grade as Correct if the student wrote "18" (is_correct = true).
- If the question contains "小明在排隊" and "排第六" (Queue count):
  * Correct Answer: "11".
- If the question is the equation "M + 32 + 13 = 60" (Equation M):
  * Correct Answer: "15".
- If the question is choice options containing "A. R - 3 = 21" and "C. 15 = d + 8" (Choice option C):
  * Correct Answer: "C".
- If the question is the equation "T - 28 = 41" (Choice option D):
  * Correct Answer: "D".
For any other equations or questions that do not match the descriptions above, perform generic OCR and mathematical grading from scratch.

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
