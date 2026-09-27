/**
 * While Devin is logged out, the web-search Devin switch cannot stay on.
 * Persist that, and turn DuckDuckGo on when it was the only source.
 */
import { useEffect, useRef } from 'react';

import type { DraftWeb } from './web-draft.js';
import { draftAfterDevinLogout } from './web-draft.js';
import type { DevinAccountView } from './use-devin-account.js';

export function useDevinLogoutSearch(input: {
  account: DevinAccountView;
  draft: DraftWeb;
  setDraft: (draft: DraftWeb) => void;
  save: (draft: DraftWeb) => Promise<boolean>;
}): void {
  const { account, draft, setDraft, save } = input;
  const attempted = useRef(false);

  useEffect(() => {
    if (account.state !== 'logged-out') {
      attempted.current = false;
      return;
    }
    if (attempted.current) return;
    const next = draftAfterDevinLogout(draft);
    if (!next) return;
    attempted.current = true;
    setDraft(next);
    void save(next);
  }, [account.state, draft, save, setDraft]);
}
