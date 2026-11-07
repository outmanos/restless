import { models } from 'insomnia-data';
import React, { type FC, useCallback, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';

import type { BackupInfo, DataFolderInfo } from '~/main/backup';
import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { getAppVersion } from '../../../common/constants';
import { useSettingsPatcher } from '../../hooks/use-request';
import { showModal } from '../modals';
import { AlertModal } from '../modals/alert-modal';
import { AskModal } from '../modals/ask-modal';
import { showToast } from '../toast-notification';
import { ImportExport } from './import-export';
import { buildPreferencesFile, parsePreferencesFile } from './preferences-json';
import { SettingsHeading } from './settings-section';

const BUTTON_CLASS_NAME =
  'flex items-center justify-center gap-2 rounded-xs border border-solid border-(--hl-md) px-4 py-1 text-sm font-semibold text-(--color-font) transition-colors hover:bg-(--hl-xs) disabled:opacity-50';

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

const PreferencesFileSection: FC = () => {
  const { settings } = useRootLoaderData()!;
  const patchSettings = useSettingsPatcher();

  const exportPreferences = async () => {
    const { filePath, canceled } = await window.dialog.showSaveDialog({
      title: 'Export preferences',
      buttonLabel: 'Export',
      defaultPath: window.path.join(
        window.localStorage.getItem('insomnia.lastExportPath') || '',
        'restless-preferences.json',
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) {
      return;
    }
    const file = buildPreferencesFile(
      settings as unknown as Record<string, unknown>,
      models.settings.init() as unknown as Record<string, unknown>,
      getAppVersion(),
    );
    await window.main.writeFile({ path: filePath, content: `${JSON.stringify(file, null, 2)}\n` });
    showToast({ title: 'Preferences exported', description: filePath, status: 'success' });
  };

  const importPreferences = async () => {
    const { filePaths, canceled } = await window.dialog.showOpenDialog({
      title: 'Import preferences',
      buttonLabel: 'Import',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    const [filePath] = filePaths || [];
    if (canceled || !filePath) {
      return;
    }
    let text: string;
    try {
      text = await window.main.insecureReadFile({ path: filePath });
    } catch (error) {
      showModal(AlertModal, { title: 'Could not read the file', message: String(error?.message ?? error) });
      return;
    }
    const result = parsePreferencesFile(text, models.settings.init() as unknown as Record<string, unknown>);
    if ('error' in result) {
      showModal(AlertModal, { title: 'Could not import preferences', message: result.error });
      return;
    }
    const count = Object.keys(result.settings).length;
    if (!count) {
      showModal(AlertModal, { title: 'Nothing to import', message: 'That file has no preferences restless can use.' });
      return;
    }
    showModal(AskModal, {
      title: 'Import preferences',
      message: (
        <div className="flex flex-col gap-2">
          <p>
            Apply {count} {count === 1 ? 'preference' : 'preferences'} from this file? They replace your current ones.
          </p>
          {result.skipped.length > 0 && (
            <p className="text-sm text-(--hl)">
              Skipped {result.skipped.length}: {result.skipped.map(item => item.key).join(', ')}
            </p>
          )}
        </div>
      ),
      yesText: 'Apply',
      noText: 'Cancel',
      onDone: async isYes => {
        if (!isYes) {
          return;
        }
        const patch = { ...result.settings } as Record<string, unknown>;
        if (patch.hotKeyRegistry) {
          patch.hotKeyRegistry = { ...settings.hotKeyRegistry, ...(patch.hotKeyRegistry as object) };
        }
        patchSettings(patch);
        showToast({ title: 'Preferences imported', status: 'success' });
      },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-(--hl)">
        Save your preferences to a JSON file, or load them from one, for example on another computer. Private and
        per-computer settings such as proxy addresses and folders are left out.
      </p>
      <div className="flex gap-2">
        <Button className={BUTTON_CLASS_NAME} onPress={exportPreferences} data-testid="export-preferences">
          Export preferences
        </Button>
        <Button className={BUTTON_CLASS_NAME} onPress={importPreferences} data-testid="import-preferences">
          Import preferences
        </Button>
      </div>
    </div>
  );
};

const BackupsSection: FC = () => {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBackups(await window.main.listBackups());
    } catch {
      setBackups([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const backUpNow = async () => {
    setIsWorking(true);
    try {
      const made = await window.main.createBackup();
      showToast({ title: 'Backup created', description: made.name, status: 'success' });
      await refresh();
    } catch (error) {
      showModal(AlertModal, { title: 'Backup failed', message: String(error?.message ?? error) });
    } finally {
      setIsWorking(false);
    }
  };

  const restore = (backup: BackupInfo) =>
    showModal(AskModal, {
      title: 'Restore this backup?',
      message: `Your current data is replaced by the backup ${backup.name}, and restless restarts. Back up first if you want to keep what you have now.`,
      yesText: 'Restore and restart',
      noText: 'Cancel',
      color: 'danger',
      onDone: async isYes => {
        if (isYes) {
          await window.main.restoreBackup(backup.name);
        }
      },
    });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-(--hl)">
        A backup is made each time restless updates. You can make one at any time, and restore any of them.
      </p>
      <div>
        <Button className={BUTTON_CLASS_NAME} onPress={backUpNow} isDisabled={isWorking} data-testid="backup-now">
          Back up now
        </Button>
      </div>
      {backups && backups.length === 0 && <p className="text-sm text-(--hl)">No backups yet.</p>}
      {backups && backups.length > 0 && (
        <ul
          className="flex flex-col divide-y divide-solid divide-(--hl-sm) rounded-md border border-solid border-(--hl-md)"
          data-testid="backup-list"
        >
          {backups.map(backup => (
            <li key={backup.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{backup.name}</span>
                <span className="text-xs text-(--hl)">
                  {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.sizeBytes)}
                </span>
              </div>
              <Button className={BUTTON_CLASS_NAME} onPress={() => restore(backup)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const LocationSection: FC = () => {
  const [info, setInfo] = useState<DataFolderInfo | null>(null);
  useEffect(() => {
    window.main
      .getDataFolderInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  if (!info) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-(--hl)">Everything you create is kept in this folder, on this computer.</p>
      <div className="flex items-center justify-between gap-3 rounded-md border border-solid border-(--hl-md) px-3 py-2 text-sm">
        <div className="flex min-w-0 flex-col">
          <span className="truncate" title={info.path} data-testid="data-folder-path">
            {info.path}
          </span>
          <span className="text-xs text-(--hl)">{formatBytes(info.sizeBytes)} of data</span>
        </div>
        <Button className={BUTTON_CLASS_NAME} onPress={() => window.shell.showItemInFolder(info.path)}>
          Show in folder
        </Button>
      </div>
    </div>
  );
};

export const Data: FC<{ onClose: () => void; projectId?: string; workspaceId?: string }> = ({
  onClose,
  projectId,
  workspaceId,
}) => (
  <div>
    <SettingsHeading first>Collections and projects</SettingsHeading>
    <ImportExport hideSettingsModal={onClose} projectId={projectId} workspaceId={workspaceId} />

    <SettingsHeading>Preferences file</SettingsHeading>
    <PreferencesFileSection />

    <SettingsHeading>Backups</SettingsHeading>
    <BackupsSection />

    <SettingsHeading>Where your data lives</SettingsHeading>
    <LocationSection />
  </div>
);
