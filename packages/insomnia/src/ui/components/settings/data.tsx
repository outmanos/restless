import React, { type FC } from 'react';
import { Button } from 'react-aria-components';

import { showModal } from '../modals';
import { AlertModal } from '../modals/alert-modal';
import { BUTTON_CLASS_NAME } from './button-styles';
import { ImportExport } from './import-export';
import { SettingsHeading } from './settings-section';

const OpenFolderButton: FC<{ kind: 'data' | 'logs'; testId: string; children: string }> = ({
  kind,
  testId,
  children,
}) => (
  <Button
    className={BUTTON_CLASS_NAME}
    data-testid={testId}
    onPress={async () => {
      try {
        await window.main.openAppFolder(kind);
      } catch (error) {
        showModal(AlertModal, { title: 'Could not open the folder', message: String(error?.message ?? error) });
      }
    }}
  >
    {children}
  </Button>
);

export const Data: FC<{ onClose: () => void; projectId?: string; workspaceId?: string }> = ({
  onClose,
  projectId,
  workspaceId,
}) => (
  <div>
    <SettingsHeading first>Collections and projects</SettingsHeading>
    <ImportExport hideSettingsModal={onClose} projectId={projectId} workspaceId={workspaceId} />

    <SettingsHeading>Folders</SettingsHeading>
    <div className="flex gap-2">
      <OpenFolderButton kind="data" testId="open-data-folder">
        Open data folder
      </OpenFolderButton>
      <OpenFolderButton kind="logs" testId="open-logs-folder">
        Open logs folder
      </OpenFolderButton>
    </div>
  </div>
);
