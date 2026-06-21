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
      },
    });

    const prompt = `You are an expert mathematical assessment assistant for a tutoring centre.
Analyze the uploaded image(s) of a student's worksheet. The worksheet may consist of one or multiple pages.

Meticulously check the student's answers for EACH question visible on the worksheet pages.

CRITICAL ACCURACY INSTRUCTIONS:
1. DO NOT guess. Solve each problem yourself step-by-step before evaluating the student's work.
2. Double-check all math steps. Ensure that you never falsely label a student's correct answer as incorrect.
3. Only mark a question as incorrect (is_correct: false) if there is an actual, demonstrable error in their calculation, final answer, or logic. If the answer is correct, you MUST mark is_correct: true.
4. Set the question_number sequentially as they appear in the worksheet.

You MUST respond with a JSON object conforming to the following schema:
{
  "questions": [
    {
      "question_number": 1,
      "scratchpad": "Mandatory step-by-step verification: (1) Identify the question and its values/expression. (2) Solve it step-by-step. (3) Identify the student's written response. (4) Compare student's answer with your independent solution, allowing for mathematical equivalence, synonyms, decimals/fractions, formatting variants, or alternative notations. (5) Formulate conclusion on whether they match.",
      "is_correct": true, // true if correct, false if incorrect based on the scratchpad verification
      "correct_answer": "123", // The correct answer or correction (only needed if is_correct is false, otherwise leave empty "")
      "mistake_type": "None", // Description of the mistake (only needed if is_correct is false, e.g., "Calculation Error", "Wrong Operation", or "None" if correct)
      "topic_tag": "Fraction Addition" // A short 1-3 word tag describing the mathematical topic
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

      if (!feedback.questions || !Array.isArray(feedback.questions)) {
        throw new Error('Malformed JSON structure returned by Gemini: missing questions array.');
      }

      return {
        questions: feedback.questions.map((q) => ({
          question_number: Number(q.question_number) || 1,
          scratchpad: q.scratchpad || '',
          is_correct: Boolean(q.is_correct),
          correct_answer: q.correct_answer || '',
          mistake_type: q.mistake_type || 'None',
          topic_tag: q.topic_tag || 'General Math',
        })),
      };
    } catch (error: any) {
      console.error('Gemini Provider Error:', error);
      throw new Error(`Gemini Vision Analysis failed: ${error?.message || error}`);
    }
  }
}
