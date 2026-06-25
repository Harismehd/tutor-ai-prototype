import { AIVisionFeedback, AIVisionProvider, AIPageFeedback, AIQuestionFeedback } from './types';

// Types for the internal steps
interface ExtractedQuestion {
  question_number: string;
  subject: string;
  question_type: 'objective' | 'subjective';
  question_text: string;
  student_answer: string;
  solved_correct_answer: string;
  topic_tags: string[];
}

interface ExtractedPage {
  page_number: number;
  questions: ExtractedQuestion[];
}

interface ExtractedWorksheet {
  pages: ExtractedPage[];
}

interface VerifiedQuestion {
  question_number: string;
  is_correct: boolean;
  mistake_type: string;
  explanation: string;
  needs_teacher_review: boolean;
}

interface VerificationResult {
  verified_questions: VerifiedQuestion[];
}

// -------------------------------------------------------------
// Prompts definitions
// -------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `You are an expert worksheet parsing assistant.
Analyze the uploaded image(s) of a student's worksheet. The worksheet may consist of one or multiple pages.

Your goal is to extract every question, sub-question, blank field, and the student's handwritten or typed answer from the worksheet.
CRITICAL INSTRUCTIONS:
1. Extract ALL questions sequentially, grouped page-by-page.
2. DO NOT invent question numbers. Use the exact visible labels on the worksheet (e.g. "1", "2(a)", "Q3.b"). If no label is visible, name it based on the order (e.g. "Q1").
3. For each question, solve the correct answer yourself. Store it in "solved_correct_answer".
4. Determine the subject ("Math", "English", or "Chinese") and question_type ("objective" or "subjective").
   - "objective": Fill-in-the-blanks, multiple choice, simple arithmetic, exact vocabulary matches.
   - "subjective": Long answers, sentence writing, reading comprehension explanations, essay questions.
5. Extract the student's handwritten/typed answer into "student_answer". If the student left it blank, use "".
6. Determine the topic_tags (e.g. ["Fraction Addition"], ["English Vocabulary"]).

You MUST respond with a JSON object matching this schema:
{
  "pages": [
    {
      "page_number": 1,
      "questions": [
        {
          "question_number": "1a",
          "subject": "Math",
          "question_type": "objective",
          "question_text": "400 / 80 = [ ]",
          "student_answer": "5",
          "solved_correct_answer": "5",
          "topic_tags": ["Math", "Division"]
        }
      ]
    }
  ]
}

Return ONLY the raw JSON object.`;

const GRADING_SYSTEM_PROMPT = `You are an expert educational grading assistant.
Compare the student's answer against the correct answer for a specific question.
Determine if the student's answer is correct, identify the mistake type (in Traditional Chinese), and write a clear, concise explanation in Traditional Chinese explaining why it is correct or incorrect.

CRITICAL INSTRUCTIONS:
1. For objective questions, be highly precise. Small variations in notation (e.g. spaces, uppercase/lowercase, brackets) should NOT make it incorrect if the value/meaning is equivalent.
2. For subjective questions, use educational rubric logic. Check for correct understanding.
3. Keep the explanation concise and in fluent Traditional Chinese.
4. Output MUST be a JSON object matching this schema:
{
  "is_correct": false,
  "mistake_type": "計算錯誤", // or "無" / "None" if correct. Other examples: "語法錯誤", "拼寫錯誤", "概念理解不足"
  "explanation": "步驟驗證與說明..."
}

Return ONLY the raw JSON object.`;

const VERIFICATION_SYSTEM_PROMPT = `You are an expert senior reviewer at a tutoring centre.
Your job is to prevent false negatives (labeling a correct student answer as incorrect) in an AI grading pipeline.
Review the original worksheet image(s) to verify if the student's answer is actually correct.

CRITICAL REVIEW RULES:
1. Consider alternate correct formats: e.g., equivalent fractions (1/2 vs 2/4), decimals (0.5 vs .5), algebraic equivalents, alternate correct spellings or synonyms in language questions, or valid alternate Chinese characters.
2. If the student's answer is correct, set "is_correct" to true, change "mistake_type" to "無", and update the "explanation" to explain why it is correct.
3. If the answer is indeed incorrect, keep "is_correct" as false.
4. If there is significant ambiguity or you are highly uncertain based on the handwriting or context, set "needs_teacher_review" to true.

You MUST respond with a JSON object matching this schema:
{
  "verified_questions": [
    {
      "question_number": "1a",
      "is_correct": boolean,
      "mistake_type": "無",
      "explanation": "經人工覆核，學生的解答「5」確實與標準答案一致...",
      "needs_teacher_review": boolean
    }
  ]
}

Return ONLY the raw JSON object.`;

// -------------------------------------------------------------
// Programmatic Grading Helpers
// -------------------------------------------------------------

function programmaticCheck(student: string, correct: string): boolean {
  const normStudent = student.replace(/\s+/g, '').toLowerCase().trim();
  const normCorrect = correct.replace(/\s+/g, '').toLowerCase().trim();
  
  if (normStudent === normCorrect) return true;

  // Check numeric equivalence
  const numStudent = parseFloat(normStudent);
  const numCorrect = parseFloat(normCorrect);
  if (!isNaN(numStudent) && !isNaN(numCorrect) && numStudent === numCorrect) {
    return true;
  }

  // Fraction / Expression parser
  const evalVal = (s: string): number | null => {
    // Only allow digits, dots, slash, minus, plus, parenthesis, asterisk
    if (/^[0-9./+\-*()]+$/.test(s)) {
      try {
        const fn = new Function(`"use strict"; return (${s})`);
        const val = fn();
        return typeof val === 'number' && isFinite(val) ? val : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const valStudent = evalVal(normStudent);
  const valCorrect = evalVal(normCorrect);
  if (valStudent !== null && valCorrect !== null && Math.abs(valStudent - valCorrect) < 1e-9) {
    return true;
  }

  return false;
}

// -------------------------------------------------------------
// Main Grading Coordinator Pipeline
// -------------------------------------------------------------

export async function runGradingPipeline(
  imagesBase64: string[],
  provider: AIVisionProvider
): Promise<AIVisionFeedback> {
  console.log(`[AI Pipeline] Starting Multi-Step grading pipeline...`);

  // Step 1 & 2: Worksheet Extraction Layer (Vision Call)
  console.log(`[AI Pipeline] Step 1 & 2: Running Structured Question Extraction...`);
  const extractedWorksheet = await provider.generateVisionStructuredCompletion<ExtractedWorksheet>(
    imagesBase64,
    EXTRACTION_SYSTEM_PROMPT,
    'Extract all questions, student answers, and expected solved answers from the worksheet pages.'
  );

  if (!extractedWorksheet || !extractedWorksheet.pages) {
    throw new Error('Failed to extract questions from the worksheet.');
  }

  // Final structured feedback pages accumulator
  const finalPages: AIPageFeedback[] = [];

  // Step 3: Intelligent Grading
  console.log(`[AI Pipeline] Step 3: Grading Extracted Questions...`);
  for (const page of extractedWorksheet.pages) {
    const pageQuestions: AIQuestionFeedback[] = [];

    for (const q of page.questions) {
      // Check if student answer is blank
      if (!q.student_answer || q.student_answer.trim() === '') {
        pageQuestions.push({
          question_number: q.question_number,
          subject: q.subject || 'General',
          question_text: q.question_text || '',
          student_answer: '',
          correct_answer: q.solved_correct_answer,
          is_correct: false,
          mistake_type: '未作答',
          topic_tags: q.topic_tags || [],
          topic_tag: q.topic_tags?.[0] || 'General',
          explanation: '學生未填寫答案。',
          needs_teacher_review: false,
        });
        continue;
      }

      // Try programmatic check for objective questions
      if (q.question_type === 'objective') {
        const isCorrectProg = programmaticCheck(q.student_answer, q.solved_correct_answer);
        if (isCorrectProg) {
          pageQuestions.push({
            question_number: q.question_number,
            subject: q.subject || 'General',
            question_text: q.question_text || '',
            student_answer: q.student_answer,
            correct_answer: q.solved_correct_answer,
            is_correct: true,
            mistake_type: '無',
            topic_tags: q.topic_tags || [],
            topic_tag: q.topic_tags?.[0] || 'General',
            explanation: `經系統自動比對，學生答案「${q.student_answer}」與標準答案完全相符，判定為正確。`,
            needs_teacher_review: false,
          });
          continue;
        }
      }

      // LLM Grading for subjective questions or programmatic misses
      try {
        const gradingUserPrompt = `Question: ${q.question_text}
Student Answer: ${q.student_answer}
Expected Correct Answer: ${q.solved_correct_answer}`;

        const gradingResult = await provider.generateTextStructuredCompletion<{
          is_correct: boolean;
          mistake_type: string;
          explanation: string;
        }>(GRADING_SYSTEM_PROMPT, gradingUserPrompt);

        pageQuestions.push({
          question_number: q.question_number,
          subject: q.subject || 'General',
          question_text: q.question_text || '',
          student_answer: q.student_answer,
          correct_answer: q.solved_correct_answer,
          is_correct: gradingResult.is_correct,
          mistake_type: gradingResult.mistake_type || 'None',
          topic_tags: q.topic_tags || [],
          topic_tag: q.topic_tags?.[0] || 'General',
          explanation: gradingResult.explanation || '',
          needs_teacher_review: false, // will be evaluated in the verification step
        });
      } catch (err) {
        console.error(`[AI Pipeline] LLM Grading failed for question ${q.question_number}:`, err);
        // Fallback to marked incorrect
        pageQuestions.push({
          question_number: q.question_number,
          subject: q.subject || 'General',
          question_text: q.question_text || '',
          student_answer: q.student_answer,
          correct_answer: q.solved_correct_answer,
          is_correct: false,
          mistake_type: '比對出錯',
          topic_tags: q.topic_tags || [],
          topic_tag: q.topic_tags?.[0] || 'General',
          explanation: '系統進行AI評估時發生異常，預設標記為待查。',
          needs_teacher_review: true,
        });
      }
    }

    finalPages.push({
      page_number: page.page_number,
      questions: pageQuestions,
    });
  }

  // Step 4: Verification Double-Check (Vision call for incorrect questions)
  console.log(`[AI Pipeline] Step 4: Running Verification Double-Check on incorrect items...`);
  const incorrectList: any[] = [];
  finalPages.forEach((p) => {
    p.questions.forEach((q) => {
      if (!q.is_correct && q.student_answer !== '') {
        incorrectList.push({
          page_number: p.page_number,
          question_number: q.question_number,
          question_text: q.question_text,
          student_answer: q.student_answer,
          solved_correct_answer: q.correct_answer,
          current_grading_explanation: q.explanation,
        });
      }
    });
  });

  if (incorrectList.length > 0) {
    try {
      const verificationUserPrompt = `Please verify the following list of flagged-incorrect questions against the worksheet images to ensure no false negatives:
${JSON.stringify({ incorrect_questions: incorrectList }, null, 2)}`;

      const verificationOutput = await provider.generateVisionStructuredCompletion<VerificationResult>(
        imagesBase64,
        VERIFICATION_SYSTEM_PROMPT,
        verificationUserPrompt
      );

      if (verificationOutput && verificationOutput.verified_questions) {
        // Map updates back to finalPages
        verificationOutput.verified_questions.forEach((vq) => {
          finalPages.forEach((p) => {
            const matchQ = p.questions.find((q) => q.question_number === vq.question_number);
            if (matchQ) {
              matchQ.is_correct = vq.is_correct;
              matchQ.mistake_type = vq.mistake_type;
              matchQ.explanation = vq.explanation;
              matchQ.needs_teacher_review = vq.needs_teacher_review;
            }
          });
        });
      }
    } catch (verError) {
      console.error(`[AI Pipeline] Step 4 Verification Double-Check failed:`, verError);
      // Fail silently and keep initial grading results to avoid failing the whole request
    }
  }

  console.log(`[AI Pipeline] Grading pipeline completed successfully.`);
  return { pages: finalPages };
}
