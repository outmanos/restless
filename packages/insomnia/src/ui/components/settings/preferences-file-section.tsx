import { models } from 'insomnia-data';
import React, { type FC, useState } from 'react';
import { Button, Checkbox } from 'react-aria-components';

import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { getAppVersion } from '../../../common/constants';
import { useSettingsPatcher } from '../../hooks/use-request';
import { Icon } from '../icon';
import { showModal } from '../modals';
import { AlertModal } from '../modals/alert-modal';
import { AskModal } from '../modals/ask-modal';
import { showToast } from '../toast-notification';
import { BUTTON_CLASS_NAME } from './button-styles';
import { buildPreferencesFile, parsePreferencesFile } from './preferences-json';

const defaultsOf = () => models.settings.init() as unknown as Record<string, unknown>;

export const PreferencesFileSection: FC = () => {
  const { settings } = useRootLoaderData()!;
  const patchSettings = useSettingsPatcher();
  const [isComplete, setIsComplete] = useState(false);

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
      defaultsOf(),
      getAppVersion(),
      new Date(),
      {
        complete: isComplete,
      },
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
    const result = parsePreferencesFile(text, defaultsOf());
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
            Your current preferences are saved to the backups folder first.
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
        try {
          const current = buildPreferencesFile(
            settings as unknown as Record<string, unknown>,
            defaultsOf(),
            getAppVersion(),
            new Date(),
            { complete: true },
          );
          await window.main.backupPreferences(`${JSON.stringify(current, null, 2)}\n`);
        } catch (error) {
          showModal(AlertModal, {
            title: 'Could not save your current preferences first',
            message: `Nothing was changed. ${String(error?.message ?? error)}`,
          });
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
    <div className="flex flex-col gap-3">
      <p className="text-sm text-(--hl)">
        Save your preferences to a JSON file, or load them from one, for example on another computer.
      </p>
      <Checkbox
        isSelected={isComplete}
        onChange={setIsComplete}
        className="group flex items-start gap-2 text-sm"
        data-testid="export-complete"
      >
        <div className="mt-0.5 flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[4px] border border-solid border-(--hl-lg) transition-colors group-data-selected:border-(--color-surprise) group-data-selected:bg-(--color-surprise)">
          <Icon
            icon="check"
            className="h-[10px] w-[10px] text-(--color-font-surprise) opacity-0 group-data-selected:opacity-100"
          />
        </div>
        <span>
          Include private and per-computer settings
          <span className="block text-xs text-(--hl)">
            Proxy addresses, plugin settings and folders, for a complete copy when you reinstall. The file can contain
            passwords, so keep it safe.
          </span>
        </span>
      </Checkbox>
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
