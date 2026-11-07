import React, { useCallback, useEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { focusSetting } from '~/ui/components/settings/focus-setting';
import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTabKey,
  Preferences,
  type SettingsTabKey,
} from '~/ui/components/settings/preferences';
import type { SettingsIndexEntry } from '~/ui/components/settings/settings-index';
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
  const settingToShow = searchParams.get('setting');

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

  // Jump to a setting asked for in the address, once its section has drawn. The request is dropped afterwards so the
  // same setting can be asked for again.
  useEffect(() => {
    if (!settingToShow) {
      return;
    }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (focusSetting(settingToShow) || attempts >= 20) {
        clearInterval(timer);
        setSearchParams(
          previous => {
            const next = new URLSearchParams(previous);
            next.delete('setting');
            return next;
          },
          { replace: true },
        );
      }
    }, 100);
    return () => clearInterval(timer);
  }, [selectedTab, setSearchParams, settingToShow]);

  const openSetting = useCallback(
    (entry: SettingsIndexEntry) => {
      const url = buildSettingsUrl(organizationId, entry.tab, { projectId, workspaceId }, entry.key);
      setSearchParams(new URL(url, window.location.origin).searchParams, { replace: true });
      updateTabById?.(SETTINGS_TAB_ID, { url: buildSettingsUrl(organizationId, entry.tab, { projectId, workspaceId }) });
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
          onOpenSetting={openSetting}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      </div>
    </GitFileIssuesProvider>
  );
};

export default Component;
