import { AIVisionFeedback } from '../types';
import { toSafeError } from '../errors';
import { GradingResult } from './pipeline-types';
import { SYSTEM_PROMPT, USER_INSTRUCTION } from './pipeline-prompts';

export interface ModelAdapter {
  readonly name: string;
  callVisionJSON(systemPrompt: string, userPrompt: string, imagesBase64: string[], temperature: number): Promise<any>;
  callTextJSON(systemPrompt: string, userPrompt: string, temperature: number): Promise<any>;
}

const GLOBAL_PROVIDER_CONCURRENCY = Number(process.env.AI_PIPELINE_MAX_CONCURRENCY) || 3;
const MAX_RETRIES = 3;
const RETRYABLE_PATTERN = /429|rate[ _-]?limit|quota|resource_exhausted|503|502|500|overloaded|timeout|econnreset|fetch failed|network/i;

export async function runGradingPipeline(rawAdapter: ModelAdapter, imagesBase64: string[]): Promise<AIVisionFeedback> {
  if (!imagesBase64 || imagesBase64.length === 0) {
    throw new Error('At least one worksheet page image is required.');
  }

  const adapter = withThrottleAndRetry(rawAdapter, GLOBAL_PROVIDER_CONCURRENCY);
  const passesRequested = Number(process.env.AI_PIPELINE_PASSES) || (process.env.VERCEL ? 1 : 3);

  const pages = await Promise.all(
    imagesBase64.map(async (img, index) => {
      const pageNumber = index + 1;
      const mergedResults = await gradeSinglePage(adapter, img, pageNumber, passesRequested);
      
      return {
        page_number: pageNumber,
        questions: mergedResults.map((r) => {
          const studentAnswer = (r.student_answer || '').trim();
          const isCorrect = r.is_correct;
          const mistakeType = isCorrect
            ? '無'
            : studentAnswer === '' || studentAnswer === '?' || studentAnswer === '未作答'
            ? '未作答'
            : '計算錯誤';

          return {
            question_number: r.question_number,
            is_correct: isCorrect,
            correct_answer: r.correct_answer || '',
            mistake_type: mistakeType,
            topic_tag: Array.isArray(r.topic_tags) && r.topic_tags.length > 0 ? r.topic_tags[0] : '一般',
            explanation: r.explanation_cantonese || '',
          };
        }),
      };
    })
  );

  return { pages };
}

async function gradeSinglePage(
  adapter: ModelAdapter,
  imageDataUrl: string,
  pageNumber: number,
  passes: number
): Promise<GradingResult[]> {
  const errors: string[] = [];
  const attempts = await Promise.all(
    Array.from({ length: passes }).map(async (_, idx) => {
      try {
        const raw = await adapter.callVisionJSON(
          SYSTEM_PROMPT,
          USER_INSTRUCTION,
          [imageDataUrl],
          0.6
        );
        return parseResults(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[AI Pipeline] ${adapter.name}: page ${pageNumber} pass ${idx + 1}/${passes} failed:`,
          msg
        );
        errors.push(msg);
        return null;
      }
    })
  );

  const validPasses = attempts.filter((p): p is GradingResult[] => p !== null);

  if (validPasses.length === 0) {
    throw new Error(`All grading passes failed for page ${pageNumber}.`);
  }

  return validPasses.length > 1 ? mergeByConsensus(validPasses) : validPasses[0];
}

function parseResults(raw: any): GradingResult[] {
  let parsed = raw;
  if (typeof raw === 'string') {
    parsed = extractJson(raw);
  }
  let arr: any = [];
  if (parsed && typeof parsed === 'object') {
    arr = parsed.results || parsed.data?.results || [];
  } else {
    arr = parsed;
  }
  if (!Array.isArray(arr)) {
    throw new Error('Response is missing a results array');
  }
  return arr.map((item: any) => ({
    question_number: String(item.question_number || ''),
    subject: item.subject,
    student_answer: String(item.student_answer !== undefined ? item.student_answer : ''),
    correct_answer: String(item.correct_answer !== undefined ? item.correct_answer : ''),
    is_correct: Boolean(item.is_correct),
    explanation_cantonese: String(item.explanation_cantonese || ''),
    topic_tags: Array.isArray(item.topic_tags) ? item.topic_tags.map(String) : [],
  }));
}

function extractJson(raw: string): any {
  let text = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const startMatch = text.match(/[\{\[]/);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error('No JSON found in model response');
  }
  const start = startMatch.index;
  const openCh = text[start];
  const closeCh = openCh === '[' ? ']' : '}';
  const end = text.lastIndexOf(closeCh);
  if (end === -1 || end < start) {
    throw new Error('Truncated JSON in model response');
  }
  text = text.substring(start, end + 1);

  try {
    return JSON.parse(text);
  } catch (e) {
    let repaired = text.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
    repaired = repaired.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    let braces = 0;
    let brackets = 0;
    let inStr = false;
    let esc = false;

    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;

      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }

    if (inStr) repaired += '"';
    repaired += ']'.repeat(Math.max(0, brackets)) + '}'.repeat(Math.max(0, braces));

    return JSON.parse(repaired);
  }
}

function mergeByConsensus(passes: GradingResult[][]): GradingResult[] {
  const buckets: Record<string, GradingResult[]> = {};
  for (const p of passes) {
    for (const r of p) {
      const qn = String(r.question_number || '').trim();
      if (!buckets[qn]) buckets[qn] = [];
      buckets[qn].push(r);
    }
  }

  function getMajority<T>(items: T[], keyFn: (x: T) => string): T {
    const counter: Record<string, number> = {};
    for (const x of items) {
      const val = keyFn(x);
      counter[val] = (counter[val] || 0) + 1;
    }
    let winnerKey = '';
    let maxCount = -1;
    for (const [key, count] of Object.entries(counter)) {
      if (count > maxCount) {
        maxCount = count;
        winnerKey = key;
      }
    }
    return items.find((x) => keyFn(x) === winnerKey)!;
  }

  const merged: GradingResult[] = [];
  for (const [qn, group] of Object.entries(buckets)) {
    const stu = getMajority(group, (r) => String(r.student_answer || '').trim());
    const cor = getMajority(group, (r) => String(r.correct_answer || '').trim());
    const crt = getMajority(group, (r) => String(r.is_correct));

    const winners = group.filter((r) => String(r.is_correct) === String(crt.is_correct));
    let bestExpl = winners[0];
    for (const r of winners) {
      if ((r.explanation_cantonese || '').length > (bestExpl.explanation_cantonese || '').length) {
        bestExpl = r;
      }
    }

    const tagsSet = new Set<string>();
    for (const r of winners) {
      if (Array.isArray(r.topic_tags)) {
        r.topic_tags.forEach((t) => tagsSet.add(t));
      }
    }
    const tags = Array.from(tagsSet).sort();

    merged.push({
      question_number: qn,
      subject: group[0].subject || 'Mathematics',
      student_answer: stu.student_answer || '',
      correct_answer: cor.correct_answer || '',
      is_correct: crt.is_correct,
      explanation_cantonese: bestExpl.explanation_cantonese || '',
      topic_tags: tags,
    });
  }

  merged.sort((a, b) => {
    const aNum = parseInt(a.question_number, 10);
    const bNum = parseInt(b.question_number, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }
    return a.question_number.localeCompare(b.question_number);
  });

  return merged;
}

// ---------------------------------------------------------------------------
// Semaphore & Retry
// ---------------------------------------------------------------------------
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
      const backoffMs = Math.round(Math.pow(2, attempt) * 500 + Math.random() * 300);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

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