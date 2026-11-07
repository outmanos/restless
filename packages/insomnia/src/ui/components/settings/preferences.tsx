import React, { type FC, useState } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';

import { AISettings } from '~/ui/components/settings/ai-settings';
import { CredentialsSettings } from '~/ui/components/settings/credentials';
import { ScriptingSettings } from '~/ui/components/settings/scripting-settings';

import { About } from './about';
import { Appearance } from './appearance';
import { Editor } from './editor';
import { General } from './general';
import { ImportExport } from './import-export';
import { Keyboard } from './keyboard';
import { Plugins } from './plugins';
import { Requests } from './requests';
import { Security } from './security';
import { searchSettings, type SettingsIndexEntry } from './settings-index';
import { settingsTabIcons } from './settings-tab-icons';
import type { SettingsTabKey } from './settings-tabs';
import { TextSetting } from './text-setting';

export { DEFAULT_SETTINGS_TAB, isSettingsTabKey, type SettingsTabKey } from './settings-tabs';

const TABS: { id: SettingsTabKey; label: string; icon: keyof typeof settingsTabIcons }[] = [
  { id: 'general', label: 'General', icon: 'general' },
  { id: 'appearance', label: 'Appearance', icon: 'appearance' },
  { id: 'editor', label: 'Editor', icon: 'editor' },
  { id: 'keyboard', label: 'Keyboard', icon: 'keyboard' },
  { id: 'requests', label: 'Requests', icon: 'requests' },
  { id: 'security', label: 'Security', icon: 'security' },
  { id: 'data', label: 'Data', icon: 'data' },
  { id: 'plugins', label: 'Plugins', icon: 'plugins' },
  { id: 'credentials', label: 'Credentials', icon: 'credentials' },
  { id: 'scripting', label: 'Scripting', icon: 'scripting' },
  { id: 'ai', label: 'AI', icon: 'ai' },
  { id: 'about', label: 'About', icon: 'about' },
];

const NAV_ITEM_CLASS_NAME =
  'flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-(--hl) outline-hidden transition-colors select-none hover:bg-(--hl-xs) hover:text-(--color-font) focus-visible:bg-(--hl-xs) aria-selected:bg-(--hl-xs) aria-selected:text-(--color-font) aria-selected:shadow-[inset_2px_0_0_var(--color-surprise)]';

const PANEL_CLASS_NAME = 'h-full w-full overflow-y-auto p-6 outline-hidden';

// Preferences as a page: sections run down the left, the selected section fills the rest.
export const Preferences: FC<{
  selectedTab: SettingsTabKey;
  onSelectTab: (tab: SettingsTabKey) => void;
  onClose: () => void;
  // Jump to a setting found by the search box
  onOpenSetting: (entry: SettingsIndexEntry) => void;
  projectId?: string;
  workspaceId?: string;
}> = ({ selectedTab, onSelectTab, onClose, onOpenSetting, projectId, workspaceId }) => {
  const [query, setQuery] = useState('');
  const results = searchSettings(query);
  const isSearching = query.trim().length > 0;
  const open = (entry: SettingsIndexEntry) => {
    setQuery('');
    onOpenSetting(entry);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-(--color-bg) text-(--color-font)" data-testid="preferences">
      <Tabs
        orientation="vertical"
        selectedKey={selectedTab}
        onSelectionChange={key => onSelectTab(key.toString() as SettingsTabKey)}
        aria-label="Preferences"
        className="flex min-h-0 w-full flex-1"
      >
        <div className="flex w-56 shrink-0 flex-col border-r border-solid border-(--hl-md) bg-(--color-bg)">
          <div className="p-2">
            <input
              type="search"
              aria-label="Search settings"
              data-testid="settings-search"
              placeholder="Search settings"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && results[0]) {
                  event.preventDefault();
                  open(results[0]);
                }
                // Escape clears the search first. It must not also close Preferences.
                if (event.key === 'Escape' && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery('');
                }
              }}
              className="w-full rounded-md border border-solid border-(--hl-md) bg-(--hl-xs) px-2 py-1 text-sm"
            />
          </div>
          {isSearching && (
            <ul
              aria-label="Matching settings"
              data-testid="settings-search-results"
              className="flex flex-col overflow-y-auto pb-2"
            >
              {results.length === 0 && <li className="px-4 py-2 text-sm text-(--hl)">No setting matches</li>}
              {results.map(entry => (
                <li key={entry.key}>
                  <button
                    type="button"
                    data-testid={`settings-search-result-${entry.key}`}
                    onClick={() => open(entry)}
                    className="flex w-full cursor-pointer flex-col items-start px-4 py-1.5 text-left text-sm hover:bg-(--hl-xs) focus-visible:bg-(--hl-xs)"
                  >
                    {entry.label}
                    <span className="text-xs text-(--hl)">{TABS.find(tab => tab.id === entry.tab)?.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <TabList
            aria-label="Preferences sections"
            className={`${isSearching ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col overflow-y-auto py-2`}
          >
            {TABS.map(({ id, label, icon }) => {
              const TabIcon = settingsTabIcons[icon];
              return (
                <Tab key={id} id={id} className={`${NAV_ITEM_CLASS_NAME} ${id === 'about' ? 'mt-auto' : ''}`}>
                  <TabIcon className="shrink-0" />
                  {label}
                </Tab>
              );
            })}
          </TabList>
        </div>
        <div className="min-w-0 flex-1">
          <TabPanel className={PANEL_CLASS_NAME} id="general">
            <div className="max-w-4xl">
              <General />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="appearance">
            <div className="max-w-4xl">
              <Appearance />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="editor">
            <div className="max-w-4xl">
              <Editor />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="keyboard">
            <div className="max-w-4xl">
              <Keyboard />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="requests">
            <div className="max-w-4xl">
              <Requests />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="security">
            <div className="max-w-4xl">
              <Security />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="data">
            <div className="max-w-4xl">
              <ImportExport hideSettingsModal={onClose} projectId={projectId} workspaceId={workspaceId} />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="plugins">
            <div className="max-w-4xl">
              <div className="pb-4">
                <TextSetting
                  label="Additional plugin path"
                  setting="pluginPath"
                  help="Add a custom path to direct Restless to a different plugin directory."
                  placeholder="~/.insomnia:/other/path"
                />
              </div>
              <Plugins />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="credentials">
            <div className="max-w-4xl">
              <CredentialsSettings />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="scripting">
            <div className="max-w-4xl">
              <ScriptingSettings />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="ai">
            <div className="max-w-4xl">
              <AISettings />
            </div>
          </TabPanel>
          <TabPanel className={PANEL_CLASS_NAME} id="about">
            <div className="max-w-4xl">
              <About />
            </div>
          </TabPanel>
        </div>
      </Tabs>
    </div>
  );
};
