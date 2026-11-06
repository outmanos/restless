import { useEffect, useRef } from 'react';
import { matchPath, useNavigate, useParams } from 'react-router';

import { useInsomniaTabContext } from '~/ui/context/app/insomnia-tab-context';
import uiEventBus, { OPEN_SETTINGS } from '~/ui/event-bus';
import { buildSettingsUrl, SETTINGS_TAB_ID } from '~/ui/hooks/use-insomnia-tab';

// Where the user is right now, so the Data section can act on that project and collection.
const getCurrentContext = () => {
  const { pathname, search } = window.location;
  if (matchPath('/organization/:organizationId/project/settings', pathname)) {
    const params = new URLSearchParams(search);
    return { projectId: params.get('project'), workspaceId: params.get('workspace') };
  }
  const workspaceMatch = matchPath(
    { path: '/organization/:organizationId/project/:projectId/workspace/:workspaceId', end: false },
    pathname,
  );
  const projectMatch = matchPath({ path: '/organization/:organizationId/project/:projectId', end: false }, pathname);
  return {
    projectId: workspaceMatch?.params.projectId ?? projectMatch?.params.projectId,
    workspaceId: workspaceMatch?.params.workspaceId,
  };
};

// Listens for openSettings() and navigates to the Preferences tab. Renders nothing.
export const SettingsOpener = () => {
  const { organizationId } = useParams() as { organizationId: string };
  const navigate = useNavigate();
  const { currentOrgTabs } = useInsomniaTabContext();
  const tabsRef = useRef(currentOrgTabs);
  tabsRef.current = currentOrgTabs;

  useEffect(
    () =>
      uiEventBus.on(OPEN_SETTINGS, (tab?: string) => {
        // Without a section, return to the one that was open last
        const existing = tabsRef.current.tabList.find(item => item.id === SETTINGS_TAB_ID);
        const section =
          tab ?? (existing ? new URL(existing.url, window.location.origin).searchParams.get('tab') : null);
        // Remember the page Preferences was opened from, so closing it goes back there
        const onSettings = !!matchPath('/organization/:organizationId/project/settings', window.location.pathname);
        const from = onSettings ? window.history.state?.usr?.from : window.location.pathname + window.location.search;
        navigate(buildSettingsUrl(organizationId, section, getCurrentContext()), { state: { from } });
      }),
    [navigate, organizationId],
  );

  return null;
};
