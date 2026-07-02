import OpenAI from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
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

type VerifiedSolution = SolveResult & {
  needs_review: boolean;
  candidates: string[];
};

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

    try {
      const pages = [];

      for (const [pageIndex, image] of imagesBase64.entries()) {
        const pageNumber = pageIndex + 1;
        const segments = await this.segmentQuestions(image, pageNumber);
        const questions: AIQuestionFeedback[] = [];

        for (const segment of segments) {
          const ocr = await this.ocrQuestion(image, pageNumber, segment);
          const verified = await this.solveWithConsensus(ocr);

          if (verified.needs_review) {
            questions.push(this.buildReviewQuestion(segment.question_number, verified));
            continue;
          }

          const comparison = await this.compareAnswer(ocr, verified);
          const explanation = await this.generateFeedback(ocr, verified, comparison);

          questions.push({
            question_number: segment.question_number,
            is_correct: comparison.is_correct,
            correct_answer: verified.correct_answer,
            mistake_type: comparison.mistake_type,
            topic_tag: comparison.topic_tag,
            explanation,
          });
        }

        pages.push({ page_number: pageNumber, questions });
      }

      return { pages };
    } catch (error: unknown) {
      console.error('OpenAI Provider Error:', error);
      throw new Error(SYSTEM_FAILURE_MESSAGE);
    }
  }

  private async segmentQuestions(imageBase64: string, pageNumber: number): Promise<QuestionSegment[]> {
    const response = await this.createVisionJson([
      {
        type: 'text',
        text: `${EDUCATION_RULES}

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
      },
      this.imagePart(imageBase64),
    ]);

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
    const response = await this.createVisionJson([
      {
        type: 'text',
        text: `${EDUCATION_RULES}

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
      },
      this.imagePart(imageBase64),
    ]);

    return {
      question_number: String(response.question_number || segment.question_number),
      printed_question: String(response.printed_question || ''),
      diagram_description: String(response.diagram_description || ''),
      student_answer: String(response.student_answer || ''),
      erasure_notes: String(response.erasure_notes || ''),
    };
  }

  private async solveWithConsensus(ocr: OCRResult): Promise<VerifiedSolution> {
    const solves = await Promise.all([0, 1, 2].map(() => this.solveQuestion(ocr)));
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
      return {
        correct_answer: candidates.join(' / '),
        solution_steps: 'The independent solvers did not agree.',
        confidence: 'low',
        needs_review: true,
        candidates,
      };
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
Show concise verification in solution_steps.

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

${JSON_ONLY}`, 0.35);

    return {
      correct_answer: String(response.correct_answer || ''),
      solution_steps: String(response.solution_steps || ''),
      confidence: this.parseConfidence(response.confidence),
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

  private async createVisionJson(content: ChatCompletionContentPart[]): Promise<JsonObject> {
    const response = await this.openai.chat.completions.create({
      model: this.modelName,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    return this.parseJson(response.choices[0]?.message?.content);
  }

  private async createTextJson(prompt: string, temperature: number): Promise<JsonObject> {
    const response = await this.openai.chat.completions.create({
      model: this.modelName,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    return this.parseJson(response.choices[0]?.message?.content);
  }

  private imagePart(img: string): ChatCompletionContentPart {
    const url = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
    return {
      type: 'image_url',
      image_url: { url },
    };
  }

  private parseJson(text?: string | null): JsonObject {
    if (!text) {
      throw new Error('Empty AI response.');
    }
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
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
}
