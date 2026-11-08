import fs from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, dialog } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import type { Settings } from 'insomnia-data';
import { services } from 'insomnia-data';
import { UpdateCheckInterval } from 'insomnia-data/common';

import appConfig from '../../config/config.json';
import packageJSON from '../../package.json';
import { isDevelopment, type UpdateStatus, type UpdateSupport } from '../common/constants';
import { backup, pruneBackups } from './backup';
import { ipcMainOn } from './ipc/electron';

const showUpdateStatusToast = (title: string, description?: string) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('show-toast', {
      content: {
        title,
        description,
        status: 'info',
      },
    });
  }
};

export const getUpdateSupport = (): UpdateSupport => {
  if (process.env['ALLOW_UPDATES_IN_DEV']) {
    return { supported: true };
  }
  if (process.env.INSOMNIA_DISABLE_AUTOMATIC_UPDATES) {
    return { supported: false, reason: 'disabled' };
  }
  if (isDevelopment() || !app.isPackaged) {
    return { supported: false, reason: 'development' };
  }
  // Only AppImage can replace itself on Linux; distro packages are updated by the package manager.
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return { supported: false, reason: 'package-manager' };
  }
  if (process.platform === 'win32' && process.env['PORTABLE_EXECUTABLE_DIR']) {
    return { supported: false, reason: 'portable' };
  }
  return { supported: true };
};

const CHECK_INTERVALS_MS: Record<UpdateCheckInterval, number> = {
  [UpdateCheckInterval.sixHours]: 6 * 60 * 60 * 1000,
  [UpdateCheckInterval.daily]: 24 * 60 * 60 * 1000,
  [UpdateCheckInterval.weekly]: 7 * 24 * 60 * 60 * 1000,
  [UpdateCheckInterval.monthly]: 30 * 24 * 60 * 60 * 1000,
};

export const getCheckIntervalMs = (interval: UpdateCheckInterval) =>
  CHECK_INTERVALS_MS[interval] ?? CHECK_INTERVALS_MS[UpdateCheckInterval.daily];

// The scheduler wakes up often and asks this, so a changed frequency applies without a restart.
export const isCheckDue = (
  settings: Pick<Settings, 'updateAutomatically' | 'updateCheckInterval'>,
  lastCheckAt: number,
  now: number,
) => settings.updateAutomatically && now - lastCheckAt >= getCheckIntervalMs(settings.updateCheckInterval);

export const allowsAutomaticUpdates = (installerInfo: string) => {
  try {
    return JSON.parse(installerInfo).allowAutomaticUpdates === true;
  } catch {
    return false;
  }
};

// The Windows installer asks once per user. After that the choice lives in Preferences.
const applyInstallerUpdateChoice = async (settings: Settings) => {
  if (process.platform !== 'win32' || settings.hasReadInstallerUpdateChoice) {
    return settings;
  }
  const installerInfo = await fs
    .readFile(path.join(path.dirname(process.execPath), 'installer-info.json'), 'utf8')
    .catch(() => '');
  return services.settings.patch({
    hasReadInstallerUpdateChoice: true,
    updateAutomatically: settings.updateAutomatically || allowsAutomaticUpdates(installerInfo),
  });
};

const SCHEDULER_TICK_MS = 10 * 60 * 1000;

let currentUpdateStatus: UpdateStatus = 'idle';

const sendUpdateStatus = (status: UpdateStatus) => {
  currentUpdateStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('update-status-changed', status);
  }
};

// Only a check the user asked for reports "up to date" or a failure. Automatic checks stay quiet,
// since the app may be offline on purpose.
let currentCheckIsManual = false;

const checkForUpdates = async (settings: Settings, { manual }: { manual: boolean }) => {
  currentCheckIsManual = manual;
  try {
    autoUpdater.allowPrerelease = settings.updateChannel === 'beta';
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.warn('[updater] Failed to check for updates:', err.message);
    sendUpdateStatus('idle');
    if (manual) {
      showUpdateStatusToast('Update Error', err.message);
    }
  }
};

const createListeners = () => {
  autoUpdater.on('error', error => {
    console.warn(`[updater] Error: ${error.message}`);
    sendUpdateStatus('idle');
    if (currentCheckIsManual) {
      showUpdateStatusToast('Update Error', error.message);
    }
  });
  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('idle');
    if (currentCheckIsManual) {
      showUpdateStatusToast('Up to Date', packageJSON.version);
    }
  });
  autoUpdater.on('update-available', () => {
    sendUpdateStatus('downloading');
    showUpdateStatusToast('Downloading update...');
  });
  autoUpdater.on('update-downloaded', async ({ version }) => {
    await backup();
    await pruneBackups((await services.settings.get()).maxBackups);
    sendUpdateStatus('readyToRestart');
    showUpdateStatusToast(`Downloaded ${version}`, 'Restart to apply the update.');
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart', 'Later'],
      title: 'Application Update',
      message: `New version: ${version}`,
      detail: `A new version of ${appConfig.productName} has been downloaded. Restart to apply it.`,
    });
    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
};

export const init = async () => {
  autoUpdater.logger = log;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.setFeedURL({ provider: 'github', owner: appConfig.githubOrg, repo: appConfig.githubRepo });
  createListeners();

  const support = getUpdateSupport();
  const settings = await applyInstallerUpdateChoice(await services.settings.get());
  let lastCheckAt = Date.now();
  if (support.supported) {
    if (settings.updateAutomatically && settings.updateCheckOnStartup) {
      checkForUpdates(settings, { manual: false });
    }
    setInterval(async () => {
      const latest = await services.settings.get();
      if (isCheckDue(latest, lastCheckAt, Date.now())) {
        lastCheckAt = Date.now();
        checkForUpdates(latest, { manual: false });
      }
    }, SCHEDULER_TICK_MS);
  } else {
    console.log(`[updater] This build does not update itself (${support.reason})`);
  }

  ipcMainOn('getUpdateSupport', event => {
    event.returnValue = support;
  });
  ipcMainOn('getUpdateStatus', event => {
    event.returnValue = currentUpdateStatus;
  });
  ipcMainOn('applyUpdateAndRestart', () => {
    if (currentUpdateStatus === 'readyToRestart') {
      autoUpdater.quitAndInstall();
    }
  });
  ipcMainOn('manualUpdateCheck', async () => {
    if (!support.supported) {
      showUpdateStatusToast('Updates are not available for this build');
      return;
    }
    sendUpdateStatus('checking');
    showUpdateStatusToast('Checking for updates...');
    lastCheckAt = Date.now();
    checkForUpdates(await services.settings.get(), { manual: true });
  });
};
