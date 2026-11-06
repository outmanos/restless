import { UpdateChannel, UpdateCheckInterval } from 'insomnia-data/common';
import React, { type FC } from 'react';

import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import appConfig from '../../../../config/config.json';
import { getAppVersion, getProductName, type UpdateUnsupportedReason } from '../../../common/constants';
import { Link } from '../base/link';
import { CheckForUpdatesButton } from '../check-for-updates-button';
import { showToast } from '../toast-notification';
import { BooleanSetting } from './boolean-setting';
import { EnumSetting } from './enum-setting';
import { SettingsHeading } from './settings-section';

const repo = `https://github.com/${appConfig.githubOrg}/${appConfig.githubRepo}`;

const links = [
  { label: 'Release notes', href: `${repo}/releases/latest` },
  { label: 'Wiki', href: `${repo}/wiki` },
  { label: 'Source code', href: repo },
  { label: 'Report an issue', href: `${repo}/issues` },
  { label: 'License', href: `${repo}/blob/main/LICENSE` },
  { label: 'Software bill of materials', href: `${repo}/blob/main/package-lock.json` },
];

const unsupportedText: Record<UpdateUnsupportedReason, string> = {
  'package-manager':
    'This build does not update itself. Update it with your package manager, or download a new release. The AppImage updates itself.',
  portable: 'The portable Windows build does not update itself. Download a new release to update.',
  development: 'Updates are off in development builds.',
  disabled: 'Updates were turned off with the INSOMNIA_DISABLE_AUTOMATIC_UPDATES environment variable.',
};

const Updates: FC = () => {
  const { settings } = useRootLoaderData()!;
  const support = window.main.getUpdateSupport();

  if (!support.supported) {
    return (
      <div>
        <p className="faint">{unsupportedText[support.reason]}</p>
        <p className="pad-top-sm">
          <Link className="text-(--color-surprise) hover:underline" href={`${repo}/releases/latest`}>
            Latest release
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex w-full items-center justify-between gap-2">
        <BooleanSetting
          label="Automatic updates"
          setting="updateAutomatically"
          help="Checks GitHub for new versions and downloads them. When off, Restless only checks when you ask it to."
        />
        <CheckForUpdatesButton />
      </div>
      {settings.updateAutomatically && (
        <div className="pad-top-sm">
          <BooleanSetting
            label="Check when Restless starts"
            setting="updateCheckOnStartup"
            help="If checked, looks for a new version each time the app opens."
          />
          <div className="form-row pad-top-sm">
            <EnumSetting<UpdateCheckInterval>
              label="Check every"
              setting="updateCheckInterval"
              values={[
                { value: UpdateCheckInterval.sixHours, name: '6 hours' },
                { value: UpdateCheckInterval.daily, name: 'Day' },
                { value: UpdateCheckInterval.weekly, name: 'Week' },
              ]}
              help="How often to look again while Restless stays open."
            />
          </div>
        </div>
      )}
      <div className="form-row pad-top-sm">
        <EnumSetting<UpdateChannel>
          label="Update channel"
          setting="updateChannel"
          values={[
            { value: UpdateChannel.stable, name: 'Release (recommended)' },
            { value: UpdateChannel.beta, name: 'Early access (beta)' },
          ]}
        />
      </div>
    </div>
  );
};

export const About: FC = () => {
  const details = window.main.getAboutDetails();

  return (
    <div>
      <SettingsHeading first>
        {getProductName()} {getAppVersion()}
      </SettingsHeading>
      <p className="faint">An offline-first API client. No account, no telemetry. Based on Insomnia.</p>

      <SettingsHeading>Updates</SettingsHeading>
      <Updates />

      <SettingsHeading>This build</SettingsHeading>
      <table className="table--fancy" data-testid="about-details">
        <tbody>
          {details.map(({ label, value }) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn btn--outlined btn--super-compact mt-2"
        onClick={() => {
          window.clipboard.writeText(details.map(({ label, value }) => `${label}: ${value}`).join('\n'));
          showToast({ title: 'Copied', status: 'success' });
        }}
      >
        Copy details
      </button>

      <SettingsHeading>Links</SettingsHeading>
      <ul className="flex flex-col gap-1">
        {links.map(({ label, href }) => (
          <li key={href}>
            <Link className="text-(--color-surprise) hover:underline" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};
