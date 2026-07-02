import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAIProvider } from './base';
import { AIQuestionFeedback, AIVisionFeedback } from '../types';

type QuestionSegment = {
  question_number: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type OCRResult = {
  question_number: string;
  printed_question: string;
  diagram_description: string;
  student_answer: string;
  erasure_notes: string;
};

type SolveResult = {
  correct_answer: string;
  solution_steps: string;
  confidence: 'high' | 'medium' | 'low';
};

type CompareResult = {
  is_correct: boolean;
  mistake_type: string;
  topic_tag: string;
};

type GradeFeedbackResult = CompareResult & {
  explanation: string;
};

type VerifiedSolution = SolveResult & {
  needs_review: boolean;
  candidates: string[];
};

type GeminiPart = string | { inlineData: { data: string; mimeType: string } };
type JsonObject = Record<string, unknown>;

const SYSTEM_FAILURE_MESSAGE = '系統暫時無法處理此工作紙，請稍後再試。';

const EDUCATION_RULES = `You are an expert educational grading assistant for a Hong Kong tutoring centre.
The student is Primary 2, age 7-8.
Use Traditional Chinese for student-facing explanation and mistake_type.
Use Hong Kong EDB Primary Mathematics terminology, such as 正方體 and 長方體.
Explain with primary-level visual or comparison logic. Avoid secondary-school jargon such as 方程組, 消去, 代入, or 代回.
For explanations, output plain text only. Do not use markdown, bullets made with hyphens, or asterisks. Use numbered steps and standard line breaks. Use × for multiplication, never *.
Grade only the final intended answer. If a crossed-out or parenthesized answer is replaced by another answer outside it, ignore the crossed-out answer and grade the replacement.
If handwriting is illegible or the solver cannot reach agreement, flag the item for human review instead of guessing.`;

const JSON_ONLY = 'Return only a raw JSON object. Do not include markdown fences or conversational text.';
const SOLVE_ATTEMPTS = 2;

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

    try {
      const pages = [];

      for (const [pageIndex, image] of imagesBase64.entries()) {
        const pageNumber = pageIndex + 1;
        const segments = await this.segmentQuestionsSafely(image, pageNumber);
        const questions: AIQuestionFeedback[] = [];

        for (const segment of segments) {
          try {
            const ocr = await this.ocrQuestion(image, pageNumber, segment);
            const verified = await this.solveWithConsensus(ocr);

            if (verified.needs_review) {
              questions.push(this.buildReviewQuestion(segment.question_number, verified));
              continue;
            }

            const graded = await this.gradeAndGenerateFeedback(ocr, verified);

            questions.push({
              question_number: segment.question_number,
              is_correct: graded.is_correct,
              correct_answer: verified.correct_answer,
              mistake_type: graded.mistake_type,
              topic_tag: graded.topic_tag,
              explanation: graded.explanation,
            });
          } catch (questionError: unknown) {
            console.error(`Gemini question pipeline failed on page ${pageNumber}, question ${segment.question_number}:`, questionError);
            questions.push(this.buildReviewQuestion(segment.question_number, this.reviewSolution()));
          }
        }

        pages.push({ page_number: pageNumber, questions });
      }

      return { pages };
    } catch (error: unknown) {
      console.error('Gemini Provider Error:', error);
      throw new Error(SYSTEM_FAILURE_MESSAGE);
    }
  }

  private async segmentQuestionsSafely(imageBase64: string, pageNumber: number): Promise<QuestionSegment[]> {
    try {
      const segments = await this.segmentQuestions(imageBase64, pageNumber);
      return segments.length > 0 ? segments : [this.fullPageSegment(pageNumber)];
    } catch (error: unknown) {
      console.error(`Gemini segmentation failed on page ${pageNumber}; falling back to full-page review segment:`, error);
      return [this.fullPageSegment(pageNumber)];
    }
  }

  private async segmentQuestions(imageBase64: string, pageNumber: number): Promise<QuestionSegment[]> {
    const response = await this.createVisionJson(
      `${EDUCATION_RULES}

Task: Segment worksheet page ${pageNumber} into individual printed questions.
Return every visible question once. Do not solve or grade anything.
Use bounding boxes in percentage coordinates from 0 to 100 relative to the full page image.
Include enough area for the printed question, answer area, diagrams, and nearby correction marks.

Schema:
{
  "questions": [
    {
      "question_number": "1",
      "bbox": { "x": 0, "y": 0, "width": 100, "height": 20 }
    }
  ]
}

${JSON_ONLY}`,
      imageBase64
    );

    const questions = Array.isArray(response.questions) ? response.questions : [];
    return questions
      .map((q: unknown, index: number) => {
        const question = this.asJsonObject(q);
        const bbox = this.asJsonObject(question.bbox);
        return {
          question_number: String(question.question_number || index + 1),
          bbox: {
            x: Number(bbox.x) || 0,
            y: Number(bbox.y) || 0,
            width: Number(bbox.width) || 100,
            height: Number(bbox.height) || 100,
          },
        };
      })
      .filter((q: QuestionSegment) => q.question_number.trim().length > 0);
  }

  private async ocrQuestion(imageBase64: string, pageNumber: number, segment: QuestionSegment): Promise<OCRResult> {
    const response = await this.createVisionJson(
      `${EDUCATION_RULES}

Task: OCR only question ${segment.question_number} on page ${pageNumber}.
Use the full page image, but focus on this percentage bbox:
${JSON.stringify(segment.bbox)}

Extract:
1. The printed question text, equation, options, and labels.
2. Any diagram, table, calendar, icon, or geometry details needed to solve it.
3. The student's final intended answer.
4. Erasure, crossed-out text, overwrite, or correction notes.

Do not solve or grade the question.

Schema:
{
  "question_number": "${segment.question_number}",
  "printed_question": "",
  "diagram_description": "",
  "student_answer": "",
  "erasure_notes": ""
}

${JSON_ONLY}`,
      imageBase64
    );

    return {
      question_number: String(response.question_number || segment.question_number),
      printed_question: String(response.printed_question || ''),
      diagram_description: String(response.diagram_description || ''),
      student_answer: String(response.student_answer || ''),
      erasure_notes: String(response.erasure_notes || ''),
    };
  }

  private async solveWithConsensus(ocr: OCRResult): Promise<VerifiedSolution> {
    const solves: SolveResult[] = [];
    for (let i = 0; i < SOLVE_ATTEMPTS; i += 1) {
      try {
        solves.push(await this.solveQuestion(ocr));
      } catch (error: unknown) {
        console.error(`Gemini solve attempt ${i + 1} failed for question ${ocr.question_number}:`, error);
      }
    }
    const counts = new Map<string, { answer: string; count: number; result: SolveResult }>();

    for (const solve of solves) {
      const key = this.normalizeAnswer(solve.correct_answer);
      if (!key) continue;
      const current = counts.get(key);
      counts.set(key, {
        answer: solve.correct_answer,
        count: (current?.count || 0) + 1,
        result: solve,
      });
    }

    const winner = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    const candidates = solves.map((s) => s.correct_answer).filter(Boolean);

    if (!winner || winner.count < 2) {
      return this.adjudicateSolution(ocr, solves);
    }

    return {
      ...winner.result,
      correct_answer: winner.answer,
      needs_review: false,
      candidates,
    };
  }

  private async solveQuestion(ocr: OCRResult): Promise<SolveResult> {
    const response = await this.createTextJson(`${EDUCATION_RULES}

Task: Solve this worksheet question from scratch.
You must not see or use the student's answer. Solve only from the printed question and diagram description.
Show concise verification in solution_steps. Keep solution_steps under 700 Traditional Chinese characters.

Printed question:
${ocr.printed_question}

Diagram or visual details:
${ocr.diagram_description}

Schema:
{
  "correct_answer": "",
  "solution_steps": "",
  "confidence": "high"
}

${JSON_ONLY}`, 0.35, 700);

    return {
      correct_answer: String(response.correct_answer || ''),
      solution_steps: String(response.solution_steps || ''),
      confidence: this.parseConfidence(response.confidence),
    };
  }

  private async adjudicateSolution(ocr: OCRResult, solves: SolveResult[]): Promise<VerifiedSolution> {
    const candidates = solves.map((s) => s.correct_answer).filter(Boolean);
    if (candidates.length === 0) {
      return this.reviewSolution();
    }

    const response = await this.createTextJson(`${EDUCATION_RULES}

Task: Verify candidate answers for this worksheet question.
You are not allowed to choose manual review just because candidate wording differs.
Choose the best answer when the printed question and diagram description are clear enough to solve.
Use needs_review only when OCR is genuinely unreadable, the diagram description is insufficient, or the candidates reveal a real unresolved ambiguity.
If two answers are equivalent, choose the shortest student-friendly form.
Keep solution_steps under 700 Traditional Chinese characters.

Printed question:
${ocr.printed_question}

Diagram or visual details:
${ocr.diagram_description}

Candidate solves:
${JSON.stringify(solves)}

Schema:
{
  "correct_answer": "",
  "solution_steps": "",
  "confidence": "high",
  "needs_review": false
}

${JSON_ONLY}`, 0, 700);

    return {
      correct_answer: String(response.correct_answer || candidates[0]),
      solution_steps: String(response.solution_steps || solves[0]?.solution_steps || ''),
      confidence: this.parseConfidence(response.confidence),
      needs_review: Boolean(response.needs_review),
      candidates,
    };
  }

  private async gradeAndGenerateFeedback(ocr: OCRResult, verified: VerifiedSolution): Promise<GradeFeedbackResult> {
    const response = await this.createTextJson(`${EDUCATION_RULES}

Task: Compare the verified answer with the student's final intended answer, then write concise feedback.
Do not re-solve the question. Use the verified answer as authoritative.
Accept mathematically equivalent answers and equivalent Chinese wording.
The explanation must be 3 to 5 short numbered steps, under 900 Traditional Chinese characters total.
Do not list every intermediate clock time unless it is essential. Summarize repeated counting with arithmetic.
Do not use markdown, asterisks, hyphen bullets, sub-bullets, or lettered bullets.

Printed question:
${ocr.printed_question}

Student final answer:
${ocr.student_answer}

Erasure and correction notes:
${ocr.erasure_notes}

Verified correct answer:
${verified.correct_answer}

Verified solution:
${verified.solution_steps}

Schema:
{
  "is_correct": true,
  "mistake_type": "無",
  "topic_tag": "General Math",
  "explanation": ""
}

${JSON_ONLY}`, 0.1, 900);

    return {
      is_correct: Boolean(response.is_correct),
      mistake_type: String(response.mistake_type || (response.is_correct ? '無' : '答案錯誤')),
      topic_tag: String(response.topic_tag || 'General Math'),
      explanation: this.compactExplanation(String(response.explanation || verified.solution_steps || '')),
    };
  }

  private async compareAnswer(ocr: OCRResult, verified: VerifiedSolution): Promise<CompareResult> {
    const response = await this.createTextJson(`${EDUCATION_RULES}

Task: Compare the verified answer with the student's final intended answer.
Do not re-solve the question. Use the verified answer as authoritative.
Accept mathematically equivalent answers and equivalent Chinese wording.

Printed question:
${ocr.printed_question}

Student final answer:
${ocr.student_answer}

Erasure and correction notes:
${ocr.erasure_notes}

Verified correct answer:
${verified.correct_answer}

Verified solution:
${verified.solution_steps}

Schema:
{
  "is_correct": true,
  "mistake_type": "無",
  "topic_tag": "General Math"
}

${JSON_ONLY}`, 0);

    return {
      is_correct: Boolean(response.is_correct),
      mistake_type: String(response.mistake_type || (response.is_correct ? '無' : '答案錯誤')),
      topic_tag: String(response.topic_tag || 'General Math'),
    };
  }

  private async generateFeedback(ocr: OCRResult, verified: VerifiedSolution, comparison: CompareResult): Promise<string> {
    const response = await this.createTextJson(`${EDUCATION_RULES}

Task: Write detailed, encouraging feedback in Traditional Chinese for this Primary 2 student.
Do not re-solve the question. Explain the verified solution and briefly connect it to the student's answer.
Use plain text only, numbered steps, no markdown.

Printed question:
${ocr.printed_question}

Student final answer:
${ocr.student_answer}

Correct answer:
${verified.correct_answer}

Verified solution:
${verified.solution_steps}

Is correct:
${comparison.is_correct}

Mistake type:
${comparison.mistake_type}

Schema:
{
  "explanation": ""
}

${JSON_ONLY}`, 0.2);

    return String(response.explanation || verified.solution_steps || '');
  }

  private buildReviewQuestion(questionNumber: string, verified: VerifiedSolution): AIQuestionFeedback {
    return {
      question_number: questionNumber,
      is_correct: false,
      correct_answer: verified.correct_answer || '需要人工覆核',
      mistake_type: '需要人工覆核',
      topic_tag: 'Review',
      explanation: '系統未能就此題的正確答案取得一致判斷。為避免給學生錯誤回饋，請老師人工覆核此題。',
    };
  }

  private async createVisionJson(prompt: string, imageBase64: string): Promise<JsonObject> {
    return this.withRetry('Gemini vision JSON', async () => {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      });
      const result = await model.generateContent([prompt, this.imagePart(imageBase64)]);
      return this.parseJson(result.response.text());
    });
  }

  private async createTextJson(prompt: string, temperature: number, maxOutputTokens = 900): Promise<JsonObject> {
    return this.withRetry('Gemini text JSON', async () => {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature,
          maxOutputTokens,
        },
      });
      const result = await model.generateContent(prompt);
      return this.parseJson(result.response.text());
    });
  }

  private imagePart(img: string): GeminiPart {
    const { mimeType, base64Data } = this.parseDataUrl(img);
    return {
      inlineData: {
        data: base64Data,
        mimeType,
      },
    };
  }

  private parseJson(text?: string | null): JsonObject {
    if (!text) {
      throw new Error('Empty AI response.');
    }
    const parsed = JSON.parse(this.extractJson(text));
    return this.asJsonObject(parsed);
  }

  private asJsonObject(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  }

  private normalizeAnswer(answer: string): string {
    return answer
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[，。,.]/g, '')
      .trim();
  }

  private parseConfidence(value: unknown): 'high' | 'medium' | 'low' {
    return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
  }

  private compactExplanation(explanation: string): string {
    return explanation
      .replace(/\*\s*/g, '')
      .replace(/^\s*[-•]\s*/gm, '')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .join('\n')
      .slice(0, 900);
  }

  private fullPageSegment(pageNumber: number): QuestionSegment {
    return {
      question_number: `Page ${pageNumber}`,
      bbox: { x: 0, y: 0, width: 100, height: 100 },
    };
  }

  private reviewSolution(): VerifiedSolution {
    return {
      correct_answer: '需要人工覆核',
      solution_steps: 'A provider stage failed before a reliable answer could be verified.',
      confidence: 'low',
      needs_review: true,
      candidates: [],
    };
  }

  private extractJson(text: string): string {
    const withoutFences = text.replace(/```json|```/g, '').trim();
    const firstBrace = withoutFences.indexOf('{');
    const lastBrace = withoutFences.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error(`AI response did not contain a JSON object: ${withoutFences.slice(0, 200)}`);
    }
    return withoutFences.slice(firstBrace, lastBrace + 1);
  }

  private async withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        console.error(`${label} attempt ${attempt} failed:`, error);
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 750));
        }
      }
    }
    throw lastError;
  }
}
