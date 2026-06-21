export interface AIQuestionFeedback {
  question_number: number;
  is_correct: boolean;
  correct_answer: string;
  mistake_type: string;
  topic_tag: string;
}

export interface AIVisionFeedback {
  questions: AIQuestionFeedback[];
}

export interface AIVisionProvider {
  /**
   * Analyzes an array of worksheet images (representing pages) and returns structured question-by-question feedback.
   * @param imagesBase64 Array of base64 data URLs (e.g., "data:image/png;base64,...") or raw base64 strings representing worksheet pages.
   * @returns A promise resolving to structured AIVisionFeedback.
   */
  analyzeWorksheet(imagesBase64: string[]): Promise<AIVisionFeedback>;
}
