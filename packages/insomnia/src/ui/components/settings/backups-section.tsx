import React, { type FC, useCallback, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';

import type { BackupInfo } from '~/main/backup';
import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { showModal } from '../modals';
import { AlertModal } from '../modals/alert-modal';
import { AskModal } from '../modals/ask-modal';
import { showToast } from '../toast-notification';
import { BUTTON_CLASS_NAME } from './button-styles';
import { NumberSetting } from './number-setting';

export const BackupsSection: FC = () => {
  const { settings } = useRootLoaderData()!;
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
  }, [refresh, settings.maxBackups]);

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

  // Opens the backups folder to pick one from, then asks before replacing anything
  const restore = async () => {
    let name: string | null;
    try {
      name = await window.main.chooseBackup();
    } catch (error) {
      showModal(AlertModal, { title: 'Pick a backup', message: String(error?.message ?? error) });
      return;
    }
    if (!name) {
      return;
    }
    showModal(AskModal, {
      title: 'Restore this backup?',
      message: `Your current data is replaced by the backup ${name}, and restless restarts. What you have now is saved as a new backup first, so you can go back.`,
      yesText: 'Restore and restart',
      noText: 'Cancel',
      color: 'danger',
      onDone: async isYes => {
        if (isYes) {
          await window.main.restoreBackup(name);
        }
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-(--hl)">
        A backup is made each time restless updates. You can make one at any time, and restore any of them.
        {backups !== null && (
          <span data-testid="backup-count">
            {' '}
            {backups.length === 0
              ? 'There are none yet.'
              : `${backups.length} saved, keeping the last ${settings.maxBackups}.`}
          </span>
        )}
      </p>
      <NumberSetting
        label="Number of backups to keep"
        setting="maxBackups"
        min={1}
        max={100}
        help="When a new backup is made, the oldest ones beyond this number are deleted. That includes the copy made before a restore."
      />
      <div className="flex flex-wrap gap-2">
        <Button className={BUTTON_CLASS_NAME} onPress={backUpNow} isDisabled={isWorking} data-testid="backup-now">
          Back up now
        </Button>
        <Button className={BUTTON_CLASS_NAME} onPress={restore} data-testid="restore-backup">
          Restore a backup…
        </Button>
        <Button
          className={BUTTON_CLASS_NAME}
          onPress={() => window.main.openAppFolder('backups')}
          data-testid="open-backups-folder"
        >
          Open backups folder
        </Button>
      </div>
    </div>
  );
};
