/**
 * Type declarations for the single-pass grading results.
 */

export interface GradingResult {
  question_number: string;
  subject?: string;
  student_answer: string;
  correct_answer: string;
  is_correct: boolean;
  explanation_cantonese: string;
  topic_tags: string[];
}
