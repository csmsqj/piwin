import { useMemo, type ReactElement } from 'react';
import { ToolCallCard } from './tool-call-card.js';
import { mapCompactionActivityToToolRow } from './compaction-tool-row.js';
import type { CompactionActivityUi } from './chat-reducer.js';

export type CompactionActivityProps = {
  activity: CompactionActivityUi;
  locale: 'zh-CN' | 'en';
  onAbort?: () => void | Promise<void>;
};

/**
 * Compaction rendered as a normal row of the agent's tool chain.
 *
 * The operation id is the row's tool-call id, so a start → terminal transition
 * updates a single node in place instead of swapping a detached banner. Running
 * rows do not auto-expand: compaction streams no output worth holding open.
 * Compaction is atomic maintenance on the context window and renders cleanly
 * as a normal tool row on the timeline without cancel chrome.
 */
export function CompactionActivity(props: CompactionActivityProps): ReactElement {
  const { activity, locale } = props;
  const tool = useMemo(() => mapCompactionActivityToToolRow(activity, locale), [activity, locale]);

  return (
    <div
      className="turn-tool-sequence chat-compaction-row"
      data-testid="compaction-activity"
      data-operation-id={activity.operationId}
      data-phase={activity.phase}
      data-reason={activity.reason}
    >
      <ToolCallCard tool={tool} density="compact" locale={locale} expandWhileRunning={false} />
    </div>
  );
}