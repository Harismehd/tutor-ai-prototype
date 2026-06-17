export interface AIVisionFeedback {
  mistake: string;
  correctAnswer: string;
  reasonTraditionalChinese: string;
  weakAreaTag: string;
}

export interface AIVisionProvider {
  /**
   * Analyzes an image of a student's worksheet and returns structured feedback.
   * @param imageBase64 The base64 data URL (e.g., "data:image/png;base64,...") or raw base64 string of the image.
   * @returns A promise resolving to structured AIVisionFeedback.
   */
  analyzeWorksheet(imageBase64: string): Promise<AIVisionFeedback>;
}
