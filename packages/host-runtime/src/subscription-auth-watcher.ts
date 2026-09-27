import { watch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import { AUTH_UPDATED_DEBOUNCE_MS } from '@piwin/contracts';

/** Watch the credential directory, including its creation after the first login. */
export class SubscriptionAuthWatcher {
  private watcher: FSWatcher | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private watchRetry: ReturnType<typeof setTimeout> | undefined;
  private watchingParent = false;

  constructor(
    private readonly authPath: string,
    private readonly onCredentialChange: () => Promise<void>,
  ) {}

  start(): void {
    if (this.watcher && !this.watchingParent) return;
    const onChange = (): void => {
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        void this.onCredentialChange();
        if (this.watchingParent) this.start();
      }, AUTH_UPDATED_DEBOUNCE_MS);
    };
    const authDir = dirname(this.authPath);
    try {
      const next = watch(authDir, onChange);
      this.watcher?.close();
      this.watcher = next;
      this.watchingParent = false;
      return;
    } catch {
      // `{PIWIN_ROOT}/pi-agent` may not exist until the first login.
    }
    if (this.watcher) return;
    try {
      this.watcher = watch(dirname(authDir), onChange);
      this.watchingParent = true;
    } catch {
      this.watchRetry = setTimeout(() => {
        this.watchRetry = undefined;
        this.start();
      }, 2_000);
      this.watchRetry.unref?.();
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.watchingParent = false;
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = undefined;
    if (this.watchRetry) clearTimeout(this.watchRetry);
    this.watchRetry = undefined;
  }
}
