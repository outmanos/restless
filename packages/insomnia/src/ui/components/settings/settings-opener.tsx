import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useInsomniaTabContext } from '~/ui/context/app/insomnia-tab-context';
import uiEventBus, { OPEN_SETTINGS } from '~/ui/event-bus';
import { buildSettingsTab, SETTINGS_TAB_ID } from '~/ui/hooks/use-insomnia-tab';

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
        const existing = tabsRef.current.tabList.find(item => item.id === SETTINGS_TAB_ID);
        navigate(tab ? buildSettingsTab(organizationId, tab).url : (existing?.url ?? buildSettingsTab(organizationId).url));
      }),
    [navigate, organizationId],
  );

  return null;
};
