import React, { useCallback, useEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTabKey,
  Preferences,
  type SettingsTabKey,
} from '~/ui/components/settings/preferences';
import { OrganizationTabList } from '~/ui/components/tabs/tab-list';
import { useInsomniaTabContext } from '~/ui/context/app/insomnia-tab-context';
import { GitFileIssuesProvider } from '~/ui/hooks/use-git-file-issues';
import { buildSettingsUrl, SETTINGS_TAB_ID } from '~/ui/hooks/use-insomnia-tab';

// A popup that is open owns the Escape key. Anything else, Escape closes Preferences.
const POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

// Preferences belongs to no project, so the tab strip has no git problems to flag here
const NO_GIT_FILE_ISSUES = { issuesByWorkspaceId: {}, conflictsSuppressed: false };

const Component = () => {
  const { organizationId } = useParams() as { organizationId: string };
  const [searchParams, setSearchParams] = useSearchParams();
  const { closeTabById, updateTabById } = useInsomniaTabContext();
  const location = useLocation();
  // The page Preferences was opened from. It is where closing the last tab leads back to.
  const from = (location.state as { from?: string } | null)?.from;

  const projectId = searchParams.get('project') || undefined;
  const workspaceId = searchParams.get('workspace') || undefined;
  const requestedTab = searchParams.get('tab');
  const selectedTab = isSettingsTabKey(requestedTab) ? requestedTab : DEFAULT_SETTINGS_TAB;

  const close = useCallback(() => closeTabById(SETTINGS_TAB_ID, { fallbackUrl: from }), [closeTabById, from]);

  const selectTab = useCallback(
    (tab: SettingsTabKey) => {
      const url = buildSettingsUrl(organizationId, tab, { projectId, workspaceId });
      setSearchParams(new URL(url, window.location.origin).searchParams, { replace: true });
      // Clicking the Preferences tab later should come back to the same section
      updateTabById?.(SETTINGS_TAB_ID, { url });
    },
    [organizationId, projectId, setSearchParams, updateTabById, workspaceId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      // Only a popup that is showing owns the key. Lists inside the page itself, and popups kept in the page while closed, do not
      const isPopupOpen = Array.from(document.querySelectorAll<HTMLElement>(POPUP_SELECTOR)).some(
        element => element.getClientRects().length > 0 && !element.closest('[data-testid="preferences"]'),
      );
      if (isPopupOpen) {
        return;
      }
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <GitFileIssuesProvider value={NO_GIT_FILE_ISSUES}>
      <div className="flex h-full flex-col">
        <OrganizationTabList />
        <Preferences
          selectedTab={selectedTab}
          onSelectTab={selectTab}
          onClose={close}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      </div>
    </GitFileIssuesProvider>
  );
};

export default Component;
