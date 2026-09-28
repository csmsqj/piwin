/**
 * Throttled, frame-bounded `job/log` push emission for one Job.
 *
 * Invariant: no single `job/log` push may exceed {@link MAX_JOB_LOG_PUSH_BYTES}
 * of JSON-encoded text. Host egress treats `job/log` as an append item and
 * rejects any item above its frame budget; an unbounded throttle window (for
 * example `grep -r` over a large tree) used to produce a multi-MB push that
 * closed the local Desktop egress channel.
 *
 * Every push carries the log-store cursor of the last stored chunk it covers,
 * so cursor-deduplicating readers (mobile workspace jobs) never see two pushes
 * with the same cursor. The log store stays the lossless authority; a single
 * stored chunk that alone exceeds the budget is shortened in the live push only
 * and readers recover the full text through `job/logs`.
 */
import type { JobLogChunk } from '@piwin/contracts';

/** JSON-encoded text budget for one `job/log` push (egress target batch size). */
export const MAX_JOB_LOG_PUSH_BYTES = 128 * 1024;

export type JobLogStream = JobLogChunk['stream'];

export type JobLogEmitterOptions = {
  jobId: string;
  throttleMs: number;
  now: () => Date;
  emit: (chunk: JobLogChunk) => void;
  /** Override for tests; defaults to {@link MAX_JOB_LOG_PUSH_BYTES}. */
  maxPushBytes?: number;
};

type PendingSegment = {
  stream: JobLogStream;
  text: string;
  cursor: number;
  encodedBytes: number;
};

const OMISSION_MARKER = (omittedChars: number): string =>
  `\n[… ${omittedChars} chars omitted from live view; read job logs for full output …]\n`;

/** Measure the wire cost of a text field (JSON string escaping + UTF-8). */
export function measureEncodedTextBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text), 'utf8');
}

/**
 * Shorten one oversized text to fit `maxBytes` once JSON-encoded, keeping the
 * head and the tail (the tail usually holds the status/exit information).
 */
export function fitTextToEncodedBytes(text: string, maxBytes: number): string {
  if (measureEncodedTextBytes(text) <= maxBytes) return text;
  // Start from the char count the byte ratio allows, then halve until it fits.
  const ratio = maxBytes / measureEncodedTextBytes(text);
  let keepChars = Math.floor(text.length * ratio * 0.9);
  while (keepChars > 0) {
    const headChars = Math.ceil(keepChars / 2);
    const tailChars = keepChars - headChars;
    const candidate =
      text.slice(0, headChars) +
      OMISSION_MARKER(text.length - keepChars) +
      (tailChars > 0 ? text.slice(text.length - tailChars) : '');
    if (measureEncodedTextBytes(candidate) <= maxBytes) return candidate;
    keepChars = Math.floor(keepChars / 2);
  }
  // The marker alone (~90 ASCII chars) fits every realistic budget.
  return OMISSION_MARKER(text.length);
}

/** Per-Job throttled log emitter whose pushes never exceed the frame budget. */
export class JobLogEmitter {
  private readonly jobId: string;
  private readonly throttleMs: number;
  private readonly now: () => Date;
  private readonly emitChunk: (chunk: JobLogChunk) => void;
  private readonly maxPushBytes: number;
  private pending: PendingSegment[] = [];
  private pendingBytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(options: JobLogEmitterOptions) {
    this.jobId = options.jobId;
    this.throttleMs = options.throttleMs;
    this.now = options.now;
    this.emitChunk = options.emit;
    this.maxPushBytes = options.maxPushBytes ?? MAX_JOB_LOG_PUSH_BYTES;
    if (this.maxPushBytes <= 0) {
      throw new Error('Job log push budget must be greater than zero');
    }
  }

  /** Queue one stored (already redacted) chunk for throttled emission. */
  public append(stream: JobLogStream, redactedText: string, cursor: number): void {
    if (!redactedText) return;
    const encodedBytes = measureEncodedTextBytes(redactedText);
    this.pending.push({ stream, text: redactedText, cursor, encodedBytes });
    this.pendingBytes += encodedBytes;
    // A fast producer can fill several pushes inside one throttle window;
    // drain eagerly instead of letting the window grow without bound.
    if (this.pendingBytes >= this.maxPushBytes) {
      this.flush();
      return;
    }
    this.schedule();
  }

  /** Emit everything pending now, split into budget-sized pushes. */
  public flush(): void {
    this.clearTimer();
    const segments = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    let group: PendingSegment[] = [];
    let groupBytes = 0;
    for (const segment of segments) {
      const first = group[0];
      if (
        first !== undefined &&
        (first.stream !== segment.stream || groupBytes + segment.encodedBytes > this.maxPushBytes)
      ) {
        this.emitGroup(group);
        group = [];
        groupBytes = 0;
      }
      group.push(segment);
      groupBytes += segment.encodedBytes;
    }
    this.emitGroup(group);
  }

  /** Drop pending output without emitting (Job registry disposal). */
  public dispose(): void {
    this.clearTimer();
    this.pending = [];
    this.pendingBytes = 0;
  }

  private emitGroup(group: PendingSegment[]): void {
    const last = group.at(-1);
    if (last === undefined) return;
    const joined = group.map((segment) => segment.text).join('');
    this.emitChunk({
      jobId: this.jobId,
      stream: last.stream,
      text: fitTextToEncodedBytes(joined, this.maxPushBytes),
      at: this.now().toISOString(),
      cursor: last.cursor,
    });
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.throttleMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
