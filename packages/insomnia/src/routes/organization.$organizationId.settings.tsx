import React, { useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';

import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTabKey,
  Preferences,
  type SettingsTabKey,
} from '~/ui/components/settings/preferences';
import { OrganizationTabList } from '~/ui/components/tabs/tab-list';
import { useInsomniaTabContext } from '~/ui/context/app/insomnia-tab-context';
import { GitFileIssuesProvider } from '~/ui/hooks/use-git-file-issues';
import { buildSettingsTab, SETTINGS_TAB_ID } from '~/ui/hooks/use-insomnia-tab';

// A popup that is open owns the Escape key. Anything else, Escape closes Preferences.
const POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

// Preferences belongs to no project, so the tab strip has no git problems to flag here
const NO_GIT_FILE_ISSUES = { issuesByWorkspaceId: {}, conflictsSuppressed: false };

const Component = () => {
  const { organizationId } = useParams() as { organizationId: string };
  const [searchParams, setSearchParams] = useSearchParams();
  const { closeTabById, updateTabById } = useInsomniaTabContext();

  const requestedTab = searchParams.get('tab');
  const selectedTab = isSettingsTabKey(requestedTab) ? requestedTab : DEFAULT_SETTINGS_TAB;

  const close = useCallback(() => closeTabById(SETTINGS_TAB_ID), [closeTabById]);

  const selectTab = useCallback(
    (tab: SettingsTabKey) => {
      setSearchParams({ tab }, { replace: true });
      // Clicking the Preferences tab later should come back to the same section
      updateTabById?.(SETTINGS_TAB_ID, { url: buildSettingsTab(organizationId, tab).url });
    },
    [organizationId, setSearchParams, updateTabById],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector(POPUP_SELECTOR)) {
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
        <Preferences selectedTab={selectedTab} onSelectTab={selectTab} onClose={close} />
      </div>
    </GitFileIssuesProvider>
  );
};

export default Component;
