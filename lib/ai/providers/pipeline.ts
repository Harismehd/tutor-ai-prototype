import { AIVisionFeedback } from '../types';
import { toSafeError } from '../errors';
import {
  RawSegmentedQuestion,
  SolveAttempt,
  VerifiedSolution,
  CompareResult,
  FeedbackResult,
  GradedQuestion,
  SolutionType,
  SolutionValue,
} from './pipeline-types';
import {
  SEGMENT_OCR_SYSTEM_PROMPT,
  buildSegmentOcrUserPrompt,
  SOLVE_SYSTEM_PROMPT,
  buildSolveUserPrompt,
  COMPARE_SYSTEM_PROMPT,
  buildCompareUserPrompt,
  FEEDBACK_SYSTEM_PROMPT,
  buildFeedbackUserPrompt,
} from './pipeline-prompts';

/**
 * Every provider (Gemini, OpenAI, future providers) implements this thin
 * adapter. All grading logic lives here in the pipeline, once, so the two
 * providers can never silently drift apart in prompt wording or behaviour
 * (this drift was a contributor to the "fixing Q4 breaks Q1" instability
 * documented in the postmortem).
 */
export interface ModelAdapter {
  readonly name: string;
  /** A vision call that must return parsed JSON. */
  callVisionJSON(systemPrompt: string, userPrompt: string, imagesBase64: string[], temperature: number): Promise<any>;
  /** A text-only call (no images) that must return parsed JSON. */
  callTextJSON(systemPrompt: string, userPrompt: string, temperature: number): Promise<any>;
}

const SOLVE_ATTEMPTS = 3;
const SOLVE_TEMPERATURE = 0.6;
const QUESTION_CONCURRENCY_LIMIT = 4;

/**
 * Global cap on simultaneous in-flight calls to the provider, across ALL
 * stages and ALL questions combined. Without this, a 6-question worksheet
 * could fire ~12+ simultaneous requests (3 solve attempts x 4 concurrent
 * questions), which blows through provider rate limits. Overridable via env
 * for accounts on higher-tier rate limits.
 */
const GLOBAL_PROVIDER_CONCURRENCY = Number(process.env.AI_PIPELINE_MAX_CONCURRENCY) || 3;
const MAX_RETRIES = 3;
const RETRYABLE_PATTERN = /429|rate[ _-]?limit|quota|resource_exhausted|503|502|500|overloaded|timeout|econnreset|fetch failed|network/i;

export async function runGradingPipeline(rawAdapter: ModelAdapter, imagesBase64: string[]): Promise<AIVisionFeedback> {
  if (!imagesBase64 || imagesBase64.length === 0) {
    throw new Error('At least one worksheet page image is required.');
  }

  // Wrap the adapter once: every downstream call automatically gets
  // global throttling + retry-with-backoff + visible error logging.
  const adapter = withThrottleAndRetry(rawAdapter, GLOBAL_PROVIDER_CONCURRENCY);

  // ---- Stage 1: Segmentation + OCR (vision, one call, all pages) ----
  let rawQuestions: RawSegmentedQuestion[];
  try {
    const segResult = await adapter.callVisionJSON(
      SEGMENT_OCR_SYSTEM_PROMPT,
      buildSegmentOcrUserPrompt(),
      imagesBase64,
      0.1
    );
    rawQuestions = Array.isArray(segResult?.questions) ? segResult.questions : [];
  } catch (err) {
    throw toSafeError(err, `${adapter.name}: segmentation/OCR stage`);
  }

  if (rawQuestions.length === 0) {
    throw toSafeError(
      new Error('Segmentation stage returned zero questions.'),
      `${adapter.name}: segmentation/OCR stage`
    );
  }

  // ---- Stages 2-4 run per-question, independently, with bounded concurrency ----
  const gradedQuestions = await mapWithConcurrency(rawQuestions, QUESTION_CONCURRENCY_LIMIT, async (rq) => {
    return gradeSingleQuestion(adapter, rq);
  });

  // ---- Assemble into the AIVisionFeedback shape ----
  const pageMap = new Map<number, GradedQuestion[]>();
  for (const gq of gradedQuestions) {
    if (!pageMap.has(gq.page_number)) pageMap.set(gq.page_number, []);
    pageMap.get(gq.page_number)!.push(gq);
  }

  const pages = Array.from(pageMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([page_number, questions]) => ({
      page_number,
      questions: questions.map((q) => ({
        question_number: q.question_number,
        is_correct: q.is_correct,
        correct_answer: q.correct_answer,
        mistake_type: q.mistake_type,
        topic_tag: q.topic_tag,
        explanation: q.explanation,
      })),
    }));

  return { pages };
}

async function gradeSingleQuestion(adapter: ModelAdapter, rq: RawSegmentedQuestion): Promise<GradedQuestion> {
  try {
    // ---- Stage 2: Independent solve, self-consistency across N attempts ----
    const attempts = await Promise.all(
      Array.from({ length: SOLVE_ATTEMPTS }).map(() =>
        safeSolveAttempt(adapter, rq.question_text_ocr, rq.diagram_description)
      )
    );
    const validAttempts = attempts.filter((a): a is SolveAttempt => a !== null);

    // All 3 attempts failing after retries means the provider was
    // unreachable/rate-limited for this question, NOT that the model
    // "disagreed with itself". Report that honestly instead of masking
    // an infra failure as low AI confidence.
    if (validAttempts.length === 0) {
      return {
        page_number: rq.page_number,
        question_number: rq.question_number,
        is_correct: false,
        correct_answer: '(系統錯誤)',
        mistake_type: '系統暫時無法連接AI服務，請重新批改此題',
        topic_tag: '待覆核',
        explanation: '系統在計算此題時多次連線失敗（可能是流量過大或暫時性錯誤），並非題目本身有問題。請重新提交這份工作紙，或稍後再試。',
      };
    }

    const verified = voteSolution(validAttempts);

    // ---- Stage 3: Compare (deterministic first, LLM fallback) ----
    const compare = await compareAnswers(adapter, rq, verified);

    // ---- Stage 4: Feedback generation ----
    const feedback = await generateFeedback(adapter, rq, verified, compare.is_correct);

    const finalMistakeType = verified.needs_review
      ? appendReviewNote(compare.mistake_type)
      : compare.mistake_type;

    return {
      page_number: rq.page_number,
      question_number: rq.question_number,
      is_correct: verified.needs_review ? false : compare.is_correct,
      correct_answer: verified.display_answer,
      mistake_type: finalMistakeType,
      topic_tag: feedback.topic_tag,
      explanation: feedback.explanation,
    };
  } catch (err) {
    // A single question failing must not take down the whole worksheet.
    const safe = toSafeError(err, `${adapter.name}: question ${rq.page_number}-${rq.question_number}`);
    return {
      page_number: rq.page_number,
      question_number: rq.question_number,
      is_correct: false,
      correct_answer: '',
      mistake_type: 'AI處理此題時發生錯誤，請人工覆核',
      topic_tag: '待覆核',
      explanation: `此題未能自動評分，請老師人工檢查。(${safe.code})`,
    };
  }
}

async function safeSolveAttempt(
  adapter: ModelAdapter,
  questionText: string,
  diagramDescription: string
): Promise<SolveAttempt | null> {
  try {
    const raw = await adapter.callTextJSON(
      SOLVE_SYSTEM_PROMPT,
      buildSolveUserPrompt(questionText, diagramDescription),
      SOLVE_TEMPERATURE
    );
    if (!raw || !raw.solution_type || raw.solution_value === undefined) return null;
    return {
      solution_type: raw.solution_type as SolutionType,
      solution_value: raw.solution_value as SolutionValue,
      reasoning_steps: Array.isArray(raw.reasoning_steps) ? raw.reasoning_steps.map(String) : [],
    };
  } catch (err) {
    // One failed attempt out of three is tolerated (voting handles it) —
    // but it must be LOGGED, or a rate-limit outage looks identical to
    // genuine model disagreement in the final output.
    console.error(
      `[AI Pipeline] ${adapter.name}: solve attempt failed after retries:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function compareAnswers(
  adapter: ModelAdapter,
  rq: RawSegmentedQuestion,
  verified: VerifiedSolution
): Promise<CompareResult> {
  // Try a deterministic, code-level comparison first — no LLM, no hallucination risk.
  const deterministic = deterministicCompare(verified, rq.student_final_answer_ocr);
  if (deterministic) return deterministic;

  if (!rq.student_final_answer_ocr || rq.student_final_answer_ocr.trim() === '') {
    return { is_correct: false, mistake_type: '未作答' };
  }

  // Fall back to an LLM-based semantic comparison (still separate from solving).
  try {
    const raw = await adapter.callTextJSON(
      COMPARE_SYSTEM_PROMPT,
      buildCompareUserPrompt(rq.question_text_ocr, verified.display_answer, rq.student_final_answer_ocr, rq.correction_notes),
      0
    );
    return {
      is_correct: Boolean(raw?.is_correct),
      mistake_type: typeof raw?.mistake_type === 'string' && raw.mistake_type ? raw.mistake_type : (raw?.is_correct ? '無' : '概念錯誤'),
    };
  } catch {
    return { is_correct: false, mistake_type: '無法自動比對，請人工覆核' };
  }
}

async function generateFeedback(
  adapter: ModelAdapter,
  rq: RawSegmentedQuestion,
  verified: VerifiedSolution,
  isCorrect: boolean
): Promise<FeedbackResult> {
  try {
    const raw = await adapter.callTextJSON(
      FEEDBACK_SYSTEM_PROMPT,
      buildFeedbackUserPrompt(
        rq.question_text_ocr,
        rq.diagram_description,
        verified.display_answer,
        verified.reasoning_steps,
        isCorrect,
        verified.needs_review,
        rq.student_final_answer_ocr
      ),
      0.7
    );
    return {
      topic_tag: typeof raw?.topic_tag === 'string' && raw.topic_tag ? raw.topic_tag : '一般',
      explanation: typeof raw?.explanation === 'string' && raw.explanation ? raw.explanation : verified.reasoning_steps.join('\n'),
    };
  } catch {
    return {
      topic_tag: '一般',
      explanation: verified.reasoning_steps.length ? verified.reasoning_steps.join('\n') : '此題的詳細解析暫時無法生成，請老師參考正確答案人工講解。',
    };
  }
}

// ---------------------------------------------------------------------------
// Self-consistency voting
// ---------------------------------------------------------------------------
function voteSolution(attempts: SolveAttempt[]): VerifiedSolution {
  if (attempts.length === 0) {
    return {
      solution_type: 'string',
      solution_value: '',
      display_answer: '(無法確定)',
      reasoning_steps: ['AI 未能成功計算此題，請人工覆核。'],
      needs_review: true,
      agreement_count: 0,
    };
  }

  const buckets = new Map<string, SolveAttempt[]>();
  for (const a of attempts) {
    const key = canonicalize(a.solution_value);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a);
  }

  let bestKey = '';
  let bestGroup: SolveAttempt[] = [];
  for (const [key, group] of buckets.entries()) {
    if (group.length > bestGroup.length) {
      bestKey = key;
      bestGroup = group;
    }
  }

  const winner = bestGroup[0];
  const needsReview = bestGroup.length < 2; // no majority among 3 attempts

  return {
    solution_type: winner.solution_type,
    solution_value: winner.solution_value,
    display_answer: displaySolution(winner.solution_value, winner.solution_type),
    reasoning_steps: winner.reasoning_steps,
    needs_review: needsReview,
    agreement_count: bestGroup.length,
  };
}

// ---------------------------------------------------------------------------
// Normalization / canonical comparison helpers
// ---------------------------------------------------------------------------
function roundNum(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function toHalfWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

function normalizeText(s: string): string {
  return toHalfWidth(String(s))
    .trim()
    .replace(/\s+/g, '')
    .replace(/[。.,，、!！?？:：;；]+$/g, '')
    .toLowerCase();
}

function parseNumericIfPossible(s: string): number | null {
  const cleaned = toHalfWidth(s).trim().replace(/[^\d.\-/]/g, '');
  if (cleaned === '') return null;
  if (cleaned.includes('/')) {
    const [num, den] = cleaned.split('/').map(Number);
    if (!isNaN(num) && !isNaN(den) && den !== 0) return num / den;
    return null;
  }
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function canonicalize(value: SolutionValue): string {
  if (typeof value === 'number') return `n:${roundNum(value)}`;
  if (typeof value === 'string') {
    const n = parseNumericIfPossible(value);
    if (n !== null) return `n:${roundNum(n)}`;
    return `s:${normalizeText(value)}`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort((a, b) => normalizeText(a).localeCompare(normalizeText(b)));
    return keys
      .map((k) => {
        const v = (value as Record<string, number | string>)[k];
        const n = typeof v === 'number' ? v : parseNumericIfPossible(String(v));
        return `${normalizeText(k)}=${n !== null ? roundNum(n) : normalizeText(String(v))}`;
      })
      .join('|');
  }
  return `s:${normalizeText(String(value))}`;
}

function displaySolution(value: SolutionValue, type: SolutionType): string {
  if (type === 'value_map' && typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([k, v]) => `${k} = ${v}`)
      .join(', ');
  }
  return String(value);
}

/**
 * Deterministic comparison, avoiding an extra LLM call (and its associated
 * hallucination risk) whenever the answer shape allows a confident code-level
 * decision: numbers, choice letters, and value-maps of numbers. Returns null
 * when the comparison genuinely needs semantic judgement (free-text string
 * answers), so the caller can fall back to the LLM compare stage.
 */
function deterministicCompare(verified: VerifiedSolution, studentAnswerRaw: string): CompareResult | null {
  const studentAnswer = (studentAnswerRaw || '').trim();
  if (studentAnswer === '') return { is_correct: false, mistake_type: '未作答' };

  if (verified.solution_type === 'number') {
    const studentNum = parseNumericIfPossible(studentAnswer);
    const correctNum = typeof verified.solution_value === 'number' ? verified.solution_value : parseNumericIfPossible(String(verified.solution_value));
    if (studentNum !== null && correctNum !== null) {
      const correct = Math.abs(studentNum - correctNum) < 0.001;
      return { is_correct: correct, mistake_type: correct ? '無' : '計算錯誤' };
    }
    return null;
  }

  if (verified.solution_type === 'choice') {
    const correct = normalizeText(studentAnswer) === normalizeText(String(verified.solution_value));
    return { is_correct: correct, mistake_type: correct ? '無' : '選項錯誤' };
  }

  if (verified.solution_type === 'value_map' && typeof verified.solution_value === 'object') {
    // Only safe to decide deterministically if every value in the student's
    // answer can be confidently parsed against every symbol — otherwise defer
    // to the LLM comparator, which can read free-form phrasing.
    const entries = Object.entries(verified.solution_value as Record<string, number | string>);
    let allMatched = true;
    for (const [symbol, correctVal] of entries) {
      const pattern = new RegExp(`${escapeRegExp(symbol)}\\s*[=:：]?\\s*(-?\\d+(?:\\.\\d+)?)`);
      const match = studentAnswer.match(pattern);
      if (!match) {
        allMatched = false;
        break;
      }
      const studentVal = Number(match[1]);
      const correctNum = typeof correctVal === 'number' ? correctVal : parseNumericIfPossible(String(correctVal));
      if (correctNum === null || Math.abs(studentVal - correctNum) >= 0.001) {
        return { is_correct: false, mistake_type: '計算錯誤' };
      }
    }
    if (allMatched) return { is_correct: true, mistake_type: '無' };
    return null;
  }

  // Free-text 'string' answers need semantic judgement -> defer to LLM stage.
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendReviewNote(mistakeType: string): string {
  const note = '（AI信心不足，建議教師覆核）';
  if (!mistakeType || mistakeType === '無') return note.replace('（', '').replace('）', '');
  return `${mistakeType} ${note}`;
}

// ---------------------------------------------------------------------------
// Global provider throttling + retry-with-backoff
// ---------------------------------------------------------------------------

/** Simple counting semaphore — caps how many calls are in flight at once. */
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_PATTERN.test(msg);
}

async function retryWithBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableError(err);
      console.error(
        `[AI Pipeline] ${label} call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}, retryable=${retryable}):`,
        err instanceof Error ? err.message : err
      );
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoffMs = Math.round(2 ** attempt * 500 + Math.random() * 300); // jittered exponential backoff
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

/**
 * Wraps a ModelAdapter so every call (vision or text) is:
 *  - globally rate-limited to at most `limit` concurrent requests, across
 *    ALL pipeline stages and ALL questions combined, and
 *  - automatically retried with exponential backoff on transient errors
 *    (429/500/502/503/timeouts), with every failure logged server-side.
 * This is a drop-in wrapper — nothing downstream needs to know about it.
 */
function withThrottleAndRetry(adapter: ModelAdapter, limit: number): ModelAdapter {
  const semaphore = new Semaphore(limit);

  const throttled = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const release = await semaphore.acquire();
    try {
      return await retryWithBackoff(fn, label);
    } finally {
      release();
    }
  };

  return {
    name: adapter.name,
    callVisionJSON: (systemPrompt, userPrompt, imagesBase64, temperature) =>
      throttled(`${adapter.name}:vision`, () => adapter.callVisionJSON(systemPrompt, userPrompt, imagesBase64, temperature)),
    callTextJSON: (systemPrompt, userPrompt, temperature) =>
      throttled(`${adapter.name}:text`, () => adapter.callTextJSON(systemPrompt, userPrompt, temperature)),
  };
}

// ---------------------------------------------------------------------------
// Small concurrency-limited mapper (no external dependency needed)
// ---------------------------------------------------------------------------
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}