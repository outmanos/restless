import { UpdateChannel, UpdateCheckInterval } from 'insomnia-data/common';
import React, { type FC } from 'react';

import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import appConfig from '../../../../config/config.json';
import { getAppVersion, type UpdateUnsupportedReason } from '../../../common/constants';
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
  'portable': 'The portable Windows build does not update itself. Download a new release to update.',
  'development': 'Updates are off in development builds.',
  'disabled': 'Updates were turned off with the INSOMNIA_DISABLE_AUTOMATIC_UPDATES environment variable.',
};

// A link that shows where it goes while it is hovered or focused, so nobody clicks blind
const AboutLink: FC<{ href: string; children: string }> = ({ href, children }) => (
  <span className="group flex items-baseline gap-3">
    <Link className="text-(--color-surprise) hover:underline" href={href} title={href}>
      {children}
    </Link>
    <span className="invisible truncate text-xs text-(--hl) group-focus-within:visible group-hover:visible">
      {href}
    </span>
  </span>
);

const Updates: FC = () => {
  const { settings } = useRootLoaderData()!;
  const support = window.main.getUpdateSupport();

  if (!support.supported) {
    return (
      <div>
        <p className="faint">{unsupportedText[support.reason]}</p>
        <p className="pad-top-sm">
          <AboutLink href={`${repo}/releases/latest`}>Latest release</AboutLink>
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
        <span className="flex items-center gap-3">
          restless
          <span
            data-testid="about-version"
            className="rounded-md bg-[rgba(var(--color-surprise-rgb),0.5)] px-2 py-0.5 text-sm font-normal text-(--color-font-surprise)"
          >
            v{getAppVersion()}
          </span>
        </span>
      </SettingsHeading>
      <p>Thank you for using restless!</p>
      <p className="faint">restless is an offline-first API client. No account, no telemetry. Based on Insomnia.</p>

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
            <AboutLink href={href}>{label}</AboutLink>
          </li>
        ))}
      </ul>
    </div>
  );
};
