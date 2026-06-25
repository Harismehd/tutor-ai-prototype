export interface AIQuestionFeedback {
  question_number: string;
  subject: string;
  question_text: string;
  student_answer: string;
  correct_answer: string;
  is_correct: boolean;
  mistake_type: string;
  topic_tags: string[];
  topic_tag?: string;
  explanation: string;
  needs_teacher_review: boolean;
}

export interface AIPageFeedback {
  page_number: number;
  questions: AIQuestionFeedback[];
}

export interface AIVisionFeedback {
  pages: AIPageFeedback[];
}

export interface AIVisionProvider {
  /**
   * Analyzes an array of worksheet images (representing pages) and returns structured question-by-question feedback.
   */
  analyzeWorksheet(imagesBase64: string[]): Promise<AIVisionFeedback>;

  /**
   * Generates a structured completion from visual input (images) using a specified system and user prompt.
   */
  generateVisionStructuredCompletion<T>(
    imagesBase64: string[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<T>;

  /**
   * Generates a structured completion from text-only input.
   */
  generateTextStructuredCompletion<T>(
    systemPrompt: string,
    userPrompt: string
  ): Promise<T>;
}
