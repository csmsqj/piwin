import { describe, expect, it } from 'vitest';
import type { HostPush, HostPushBatchFrame, HostPushFrame } from '@piwin/contracts';
import { HostEgressHub } from '@piwin/host-server';
import { attachSidecarLocalEgress } from './sidecar-local-egress.js';

const STATUS_PUSH: HostPush = { type: 'host/status', mode: 'sdk', ready: true, mock: false };

function jobLogPush(text: string, cursor: number): HostPush {
  return {
    type: 'job/log',
    chunk: { jobId: 'job-1', stream: 'stdout', text, at: '2026-09-28T05:05:20.000Z', cursor },
  };
}

function createHarness() {
  const hub = new HostEgressHub({ hostInstanceId: 'host-1', maxFrameBytes: 4 * 1024 });
  const frames: HostPushBatchFrame[] = [];
  const logs: string[] = [];
  const reattachCallbacks: Array<() => void> = [];
  const egress = attachSidecarLocalEgress({
    egressHub: hub,
    clientId: 'local-jsonl',
    canSend: () => true,
    send: (message: HostPushFrame | HostPushBatchFrame) => {
      if (message.type === 'push/batch') frames.push(message);
    },
    maxQueueBytes: 256 * 1024 * 1024,
    maxQueueItems: 200_000,
    log: (line) => logs.push(line),
    onReattached: () => hub.ingest(STATUS_PUSH),
    scheduleReattach: (callback) => reattachCallbacks.push(callback),
  });
  return { hub, frames, logs, egress, reattachCallbacks };
}

describe('attachSidecarLocalEgress', () => {
  it('re-attaches after an oversized append so Desktop sees a gap instead of silence', () => {
    const { hub, frames, logs, egress, reattachCallbacks } = createHarness();

    hub.ingest(STATUS_PUSH);
    hub.flush();
    const appliedCursor = frames.at(-1)?.throughSeq ?? 0;
    expect(appliedCursor).toBeGreaterThan(0);

    // Incident shape: one job/log append larger than the frame budget.
    hub.ingest(jobLogPush('x'.repeat(8 * 1024), 1));
    hub.flush();
    expect(logs.some((line) => line.includes('local egress closed: oversized-item'))).toBe(true);
    expect(
      logs.some((line) => line.includes('push=job/log') && line.includes('key=job/job-1/log')),
    ).toBe(true);
    const framesBeforeReattach = frames.length;

    // Before the fix every later push was dropped for the Host lifetime.
    expect(reattachCallbacks).toHaveLength(1);
    reattachCallbacks.shift()?.();
    hub.flush();
    expect(egress.getReattachCount()).toBe(1);

    hub.ingest(jobLogPush('small', 2));
    hub.flush();
    egress.flushNow();

    const delivered = frames.slice(framesBeforeReattach);
    expect(delivered.length).toBeGreaterThan(0);
    const firstAfter = delivered[0];
    // afterSeq beyond Desktop's applied cursor is the gap Desktop reconciles.
    expect(firstAfter?.afterSeq).toBeGreaterThan(appliedCursor);
    const deliveredTypes = delivered.flatMap((frame) => frame.items.map((item) => item.push.type));
    expect(deliveredTypes).toContain('host/status');
    expect(deliveredTypes).toContain('job/log');
  });

  it('does not re-attach after dispose', () => {
    const { hub, egress, reattachCallbacks } = createHarness();
    hub.ingest(jobLogPush('x'.repeat(8 * 1024), 1));
    hub.flush();
    egress.dispose();
    reattachCallbacks.shift()?.();
    expect(egress.getReattachCount()).toBe(0);
  });
});
