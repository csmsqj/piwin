import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobLogChunk } from '@piwin/contracts';
import {
  JobLogEmitter,
  MAX_JOB_LOG_PUSH_BYTES,
  fitTextToEncodedBytes,
  measureEncodedTextBytes,
} from './job-log-emitter.js';

const FIXED_NOW = () => new Date('2026-09-28T00:00:00.000Z');

function createEmitter(maxPushBytes?: number): { emitter: JobLogEmitter; chunks: JobLogChunk[] } {
  const chunks: JobLogChunk[] = [];
  const emitter = new JobLogEmitter({
    jobId: 'job-1',
    throttleMs: 100,
    now: FIXED_NOW,
    emit: (chunk) => chunks.push(chunk),
    ...(maxPushBytes === undefined ? {} : { maxPushBytes }),
  });
  return { emitter, chunks };
}

describe('JobLogEmitter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces small same-stream output inside one throttle window', () => {
    vi.useFakeTimers();
    const { emitter, chunks } = createEmitter();
    emitter.append('stdout', 'a', 1);
    emitter.append('stdout', 'b', 2);
    expect(chunks).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(chunks).toEqual([
      { jobId: 'job-1', stream: 'stdout', text: 'ab', at: FIXED_NOW().toISOString(), cursor: 2 },
    ]);
  });

  it('keeps each stream in its own push with its own stream label', () => {
    const { emitter, chunks } = createEmitter();
    emitter.append('stdout', 'out', 1);
    emitter.append('stderr', 'err', 2);
    emitter.flush();
    expect(chunks.map((chunk) => [chunk.stream, chunk.text, chunk.cursor])).toEqual([
      ['stdout', 'out', 1],
      ['stderr', 'err', 2],
    ]);
  });

  it('never emits a push above the budget when a fast producer floods one window', () => {
    vi.useFakeTimers();
    const budget = 1024;
    const { emitter, chunks } = createEmitter(budget);
    // 40 stored chunks of ~300 bytes: far above one push, all before any timer.
    for (let cursor = 1; cursor <= 40; cursor += 1) {
      emitter.append('stdout', 'x'.repeat(300), cursor);
    }
    vi.advanceTimersByTime(100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(measureEncodedTextBytes(chunk.text)).toBeLessThanOrEqual(budget);
    }
    // Lossless when every stored chunk fits: the concatenation is the full output.
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('x'.repeat(300 * 40));
    // Cursor-deduplicating readers need strictly increasing cursors.
    const cursors = chunks.map((chunk) => chunk.cursor);
    expect(cursors).toEqual([...cursors].sort((left, right) => left - right));
    expect(new Set(cursors).size).toBe(cursors.length);
    expect(cursors.at(-1)).toBe(40);
  });

  it('shortens a single stored chunk that alone exceeds the budget', () => {
    const { emitter, chunks } = createEmitter();
    // Control characters JSON-escape to 6 bytes each: 400k chars ≈ 2.4 MB encoded.
    const binaryLike = `HEAD${'\u0001'.repeat(400_000)}TAIL`;
    emitter.append('stdout', binaryLike, 7);
    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    expect(chunk?.cursor).toBe(7);
    expect(measureEncodedTextBytes(chunk?.text ?? '')).toBeLessThanOrEqual(MAX_JOB_LOG_PUSH_BYTES);
    expect(chunk?.text.startsWith('HEAD')).toBe(true);
    expect(chunk?.text.endsWith('TAIL')).toBe(true);
    expect(chunk?.text).toContain('omitted from live view');
  });

  it('drops pending output on dispose', () => {
    vi.useFakeTimers();
    const { emitter, chunks } = createEmitter();
    emitter.append('stdout', 'late', 1);
    emitter.dispose();
    vi.advanceTimersByTime(1_000);
    expect(chunks).toEqual([]);
  });
});

describe('fitTextToEncodedBytes', () => {
  it('returns text unchanged when it already fits', () => {
    expect(fitTextToEncodedBytes('hello', 100)).toBe('hello');
  });

  it('fits multi-byte text into the budget', () => {
    const text = '模型名'.repeat(100_000);
    const fitted = fitTextToEncodedBytes(text, 64 * 1024);
    expect(measureEncodedTextBytes(fitted)).toBeLessThanOrEqual(64 * 1024);
    expect(fitted.length).toBeGreaterThan(1_000);
  });
});
