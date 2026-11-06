import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';

import { AISettings } from '~/ui/components/settings/ai-settings';
import { CredentialsSettings } from '~/ui/components/settings/credentials';
import { ScriptingSettings } from '~/ui/components/settings/scripting-settings';
import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { getAppVersion, getProductName } from '../../../common/constants';
import { Modal, type ModalHandle, type ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalHeader } from '../base/modal-header';
import { About } from '../settings/about';
import { Appearance } from '../settings/appearance';
import { BooleanSetting } from '../settings/boolean-setting';
import { Editor } from '../settings/editor';
import { ImportExport } from '../settings/import-export';
import { Keyboard } from '../settings/keyboard';
import { Plugins } from '../settings/plugins';
import { PrivacySecurity } from '../settings/privacy-security';
import { Requests } from '../settings/requests';
import { settingsTabIcons } from '../settings/settings-tab-icons';
import { TextSetting } from '../settings/text-setting';
import { showModal } from './index';

export interface SettingsModalHandle {
  hide: () => void;
  show: (options?: { tab?: SettingsModalTabKey }) => void;
}

export type SettingsModalTabKey =
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

const DEFAULT_TAB: SettingsModalTabKey = 'appearance';

const TAB_CLASS_NAME =
  'flex h-full shrink-0 cursor-pointer items-center justify-between gap-2 px-3 py-1 text-(--hl) outline-hidden transition-colors duration-300 select-none hover:bg-(--hl-sm) hover:text-(--color-font) focus:bg-(--hl-sm) aria-selected:bg-(--hl-xs) aria-selected:text-(--color-font) aria-selected:hover:bg-(--hl-sm) aria-selected:focus:bg-(--hl-sm)';

const TABS: { id: SettingsModalTabKey; label: string; icon: keyof typeof settingsTabIcons }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'appearance' },
  { id: 'editor', label: 'Editor', icon: 'editor' },
  { id: 'keyboard', label: 'Keyboard', icon: 'keyboard' },
  { id: 'requests', label: 'Requests', icon: 'requests' },
  { id: 'security', label: 'Privacy & Security', icon: 'security' },
  { id: 'data', label: 'Data', icon: 'data' },
  { id: 'plugins', label: 'Plugins', icon: 'plugins' },
  { id: 'credentials', label: 'Credentials', icon: 'credentials' },
  { id: 'scripting', label: 'Scripting', icon: 'scripting' },
  { id: 'ai', label: 'AI', icon: 'ai' },
  { id: 'about', label: 'About', icon: 'about' },
];

export const SettingsModal = forwardRef<SettingsModalHandle, ModalProps>((props, ref) => {
  const [selectedTabKey, setSelectedTabKey] = useState<string>(DEFAULT_TAB);
  const { userSession } = useRootLoaderData()!;
  const modalRef = useRef<ModalHandle>(null);
  const [keyboardClosable, setKeyboardClosable] = useState(true);

  useImperativeHandle(
    ref,
    () => ({
      hide: () => {
        modalRef.current?.hide();
      },
      show: options => {
        setSelectedTabKey(options?.tab || DEFAULT_TAB);
        modalRef.current?.show();
      },
    }),
    [],
  );

  return (
    <Modal
      dataTestId="preference-modal"
      className="z-10!"
      ref={modalRef}
      tall
      keyboardClosable={keyboardClosable}
      {...props}
    >
      <ModalHeader>
        {getProductName()} Preferences
        <span className="faint txt-sm">
          &nbsp;&nbsp;–&nbsp; v{getAppVersion()}
          {userSession.id && userSession.email ? ` – ${userSession.email}` : null}
        </span>
      </ModalHeader>
      <ModalBody noScroll>
        <Tabs
          selectedKey={selectedTabKey}
          onSelectionChange={key => {
            setSelectedTabKey(key.toString());
          }}
          aria-label="Settings"
          className="flex h-full w-full flex-1 flex-col"
        >
          <TabList
            className="flex h-(--line-height-sm) w-full shrink-0 items-center overflow-x-auto border-b border-solid border-b-(--hl-md) bg-(--color-bg)"
            aria-label="Settings tabs"
          >
            {TABS.map(({ id, label, icon }) => {
              const TabIcon = settingsTabIcons[icon];
              return (
                <Tab key={id} id={id} className={`${TAB_CLASS_NAME} ${id === 'about' ? 'ml-auto' : ''}`}>
                  <TabIcon className="shrink-0" />
                  {label}
                </Tab>
              );
            })}
          </TabList>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="appearance">
            <Appearance />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="editor">
            <Editor />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="keyboard">
            <Keyboard />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="requests">
            <Requests />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="security">
            <PrivacySecurity />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="data">
            <ImportExport
              hideSettingsModal={() => modalRef.current?.hide()}
              onModalChange={(isOpen: boolean) => setKeyboardClosable(!isOpen)}
            />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-x-hidden overflow-y-auto p-4" id="plugins">
            <div className="pb-4">
              <TextSetting
                label="Additional plugin path"
                setting="pluginPath"
                help="Add a custom path to direct Restless to a different plugin directory."
                placeholder="~/.insomnia:/other/path"
              />
            </div>
            <Plugins />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="credentials">
            <CredentialsSettings />
          </TabPanel>
          <TabPanel className="relative h-full w-full overflow-y-auto p-4" id="scripting">
            <div className="pb-4">
              <BooleanSetting
                label="Show legacy unit tests"
                setting="enableLegacyUnitTests"
                help="If checked, the Tests tab will always be shown in the collection view. Otherwise, it will only be shown if the collection already has legacy tests."
              />
            </div>
            <ScriptingSettings />
          </TabPanel>
          <TabPanel className="relative h-full w-full overflow-y-auto p-4" id="ai">
            <AISettings />
          </TabPanel>
          <TabPanel className="h-full w-full overflow-y-auto p-4" id="about">
            <About />
          </TabPanel>
        </Tabs>
      </ModalBody>
    </Modal>
  );
});

SettingsModal.displayName = 'SettingsModal';

export const showSettingsModal = (options?: { tab?: SettingsModalTabKey }) => {
  showModal(SettingsModal, options);
};
