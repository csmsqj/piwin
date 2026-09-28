import type { HostPushBatchFrame, HostPushFrame } from '@piwin/contracts';
import {
  formatHostEgressCloseDetail,
  type HostEgressChannel,
  type HostEgressCloseDetail,
  type HostEgressHub,
} from '@piwin/host-server';

/**
 * Local Desktop egress for `host serve` (ADR 0038 §7, stdio addendum).
 *
 * A WebSocket client whose channel is closed reconnects with its cursor and
 * replays. The stdio sidecar has no reconnect: its one pipe stays open for the
 * Host lifetime. Closing the local channel without re-attaching therefore made
 * Desktop permanently deaf to every push while commands kept working (the
 * 2026-09-28 oversized `job/log` incident).
 *
 * On close we re-attach a fresh channel at the Hub's current sequence. The
 * next batch then carries `afterSeq` beyond Desktop's applied cursor, which is
 * exactly the gap Desktop already reconciles from Host authority (transcript
 * tail, foreground Run, pending permissions). `onReattached` lets the caller
 * ingest a harmless control push so that gap surfaces immediately even when
 * no Run is streaming.
 */
export type SidecarLocalEgressOptions = {
  egressHub: HostEgressHub;
  clientId: string;
  canSend: () => boolean;
  send: (message: HostPushFrame | HostPushBatchFrame) => void;
  maxQueueBytes: number;
  maxQueueItems: number;
  log: (line: string) => void;
  onReattached?: () => void;
  /** Defer re-attach until the Hub has retired the closed channel. */
  scheduleReattach?: (callback: () => void) => void;
};

export type SidecarLocalEgress = {
  flushNow: () => void;
  getReattachCount: () => number;
  dispose: () => void;
};

export function attachSidecarLocalEgress(options: SidecarLocalEgressOptions): SidecarLocalEgress {
  const scheduleReattach = options.scheduleReattach ?? ((callback) => queueMicrotask(callback));
  let disposed = false;
  let reattachCount = 0;
  let channel: HostEgressChannel | undefined;

  const handleClose = (reason: string, detail?: HostEgressCloseDetail): void => {
    const suffix = detail === undefined ? '' : ` ${formatHostEgressCloseDetail(detail)}`;
    options.log(`[piwin host serve] local egress closed: ${reason}${suffix}`);
    channel = undefined;
    if (disposed) return;
    // The Hub removes the closed client only after this callback returns.
    scheduleReattach(() => {
      if (disposed || channel !== undefined) return;
      try {
        channel = open(options.egressHub.getCurrentSeq());
      } catch (error) {
        options.log(
          `[piwin host serve] local egress re-attach failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        return;
      }
      reattachCount += 1;
      options.log(
        `[piwin host serve] local egress re-attached at seq=${options.egressHub.getCurrentSeq()} (count=${reattachCount}); Desktop reconciles the gap`,
      );
      options.onReattached?.();
    });
  };

  const open = (initialSeq: number): HostEgressChannel =>
    options.egressHub.addClient({
      id: options.clientId,
      initialSeq,
      supportsBatch: true,
      canSend: options.canSend,
      maxQueueBytes: options.maxQueueBytes,
      maxQueueItems: options.maxQueueItems,
      send: options.send,
      onSlowConsumer: handleClose,
    });

  channel = open(0);

  return {
    flushNow: () => channel?.flushNow(),
    getReattachCount: () => reattachCount,
    dispose: () => {
      disposed = true;
      channel = undefined;
    },
  };
}
