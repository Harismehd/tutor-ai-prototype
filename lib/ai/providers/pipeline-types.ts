/**
 * Internal types for the multi-stage grading pipeline.
 * These never cross the provider boundary — the public contract
 * exposed to the rest of the app is still AIVisionFeedback
 * (see gemini.ts / openai.ts return values).
 */

export type SolutionType = 'number' | 'string' | 'choice' | 'value_map';

/** A solution value can be a plain number/string, a single choice letter,
 * or a map of symbol -> number (e.g. {"梅花": 2, "星": 3}). */
export type SolutionValue = number | string | Record<string, number | string>;

export interface RawSegmentedQuestion {
  page_number: number;
  question_number: string;
  /** Exact transcription of the printed question text/equation. */
  question_text_ocr: string;
  /** Structured plain-text description of any diagram, calendar, table,
   * icon tally, or geometric figure attached to the question. Must be
   * detailed enough that a text-only reasoner (no image access) can
   * solve the question from this description alone. */
  diagram_description: string;
  /** The student's raw handwritten answer, including anything crossed out. */
  student_raw_answer_ocr: string;
  /** The student's FINAL intended answer after resolving crossings-out /
   * corrections / parentheses per the erasure-handling rules. */
  student_final_answer_ocr: string;
  /** Free-text notes on any correction, erasure, or ambiguity encountered. */
  correction_notes: string;
  /** True if handwriting was too ambiguous/illegible to confidently OCR. */
  is_ambiguous: boolean;
  /** Normalized bounding box [x0,y0,x1,y1] in 0-1000 image coordinates,
   * used only to help the OCR pass ground itself — not required downstream. */
  bbox?: [number, number, number, number];
}

export interface SolveAttempt {
  solution_type: SolutionType;
  solution_value: SolutionValue;
  reasoning_steps: string[];
}

export interface VerifiedSolution {
  solution_type: SolutionType;
  solution_value: SolutionValue;
  display_answer: string;
  reasoning_steps: string[];
  /** True if the 3 independent solve attempts did not reach a 2/3+ consensus. */
  needs_review: boolean;
  /** How many of the 3 attempts agreed with the chosen solution. */
  agreement_count: number;
}

export interface CompareResult {
  is_correct: boolean;
  mistake_type: string;
}

export interface FeedbackResult {
  topic_tag: string;
  explanation: string;
}

export interface GradedQuestion {
  page_number: number;
  question_number: string;
  is_correct: boolean;
  correct_answer: string;
  mistake_type: string;
  topic_tag: string;
  explanation: string;
}
