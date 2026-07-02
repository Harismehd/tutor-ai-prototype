/**
 * Central error handling for the AI grading pipeline.
 *
 * Goal: the frontend / API layer should NEVER see raw provider errors
 * (no "Gemini", "OpenAI", SDK stack traces, API key hints, etc). Every
 * failure inside the pipeline gets converted into a SafeAIError with a
 * generic, user-facing message. The real error is logged server-side only.
 */

export class SafeAIError extends Error {
  /** Message that is safe to show to a teacher/end user. */
  public readonly safeMessage: string;
  /** Machine-readable code, useful for frontend branching (retry banners, etc). */
  public readonly code: string;

  constructor(
    internalMessage: string,
    code: string = 'AI_PROCESSING_FAILED',
    safeMessage: string = '系統暫時無法處理此工作紙，請稍後再試。 / System temporarily unable to process this worksheet. Please try again shortly.'
  ) {
    super(internalMessage);
    this.name = 'SafeAIError';
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

/**
 * Wraps any thrown value into a SafeAIError, logging the real cause
 * server-side (console.error -> your log pipeline) and returning a
 * generic message safe to bubble up to API responses / the UI.
 */
export function toSafeError(error: unknown, context: string): SafeAIError {
  if (error instanceof SafeAIError) {
    // Already sanitized upstream — just add context to the internal log.
    console.error(`[AI Pipeline] ${context} (re-thrown):`, error.message);
    return error;
  }
  const internal = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[AI Pipeline] ${context}:`, internal);
  return new SafeAIError(`${context}: ${internal}`);
}

/**
 * Helper for API route handlers:
 *   catch (err) { return res.status(500).json(toClientErrorPayload(err)); }
 */
export function toClientErrorPayload(error: unknown): { error: string; code: string } {
  const safe = error instanceof SafeAIError ? error : toSafeError(error, 'Unhandled');
  return { error: safe.safeMessage, code: safe.code };
}
