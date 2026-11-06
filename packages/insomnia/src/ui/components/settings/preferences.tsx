import React, { type FC } from 'react';
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
import { settingsTabIcons } from './settings-tab-icons';
import { TextSetting } from './text-setting';

export type SettingsTabKey =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'keyboard'
  | 'requests'
  | 'security'
  | 'data'
  | 'plugins'
  | 'credentials'
  | 'scripting'
  | 'ai'
  | 'about';

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = 'general';

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

export const isSettingsTabKey = (value: string | null | undefined): value is SettingsTabKey =>
  TABS.some(tab => tab.id === value);

const NAV_ITEM_CLASS_NAME =
  'flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-(--hl) outline-hidden transition-colors select-none hover:bg-(--hl-xs) hover:text-(--color-font) focus-visible:bg-(--hl-xs) aria-selected:bg-(--hl-xs) aria-selected:text-(--color-font) aria-selected:shadow-[inset_2px_0_0_var(--color-surprise)]';

const PANEL_CLASS_NAME = 'h-full w-full overflow-y-auto p-6 outline-hidden';

// Preferences as a page: sections run down the left, the selected section fills the rest.
export const Preferences: FC<{
  selectedTab: SettingsTabKey;
  onSelectTab: (tab: SettingsTabKey) => void;
  onClose: () => void;
  projectId?: string;
  workspaceId?: string;
}> = ({ selectedTab, onSelectTab, onClose, projectId, workspaceId }) => (
  <div className="flex min-h-0 w-full flex-1 flex-col bg-(--color-bg) text-(--color-font)" data-testid="preferences">
    <Tabs
      orientation="vertical"
      selectedKey={selectedTab}
      onSelectionChange={key => onSelectTab(key.toString() as SettingsTabKey)}
      aria-label="Preferences"
      className="flex min-h-0 w-full flex-1"
    >
      <TabList
        aria-label="Preferences sections"
        className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-solid border-(--hl-md) bg-(--color-bg) py-2"
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
