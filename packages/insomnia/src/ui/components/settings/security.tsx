import React, { type FC } from 'react';

import { clearOAuthWindowSessionId } from '~/ui/spawn-oauth-window';

import { showModal } from '../modals';
import { AlertModal } from '../modals/alert-modal';
import { BooleanSetting } from './boolean-setting';
import { SettingsHeading } from './settings-section';
import { TextArraySetting } from './text-array-setting';
import { VaultKeyPanel } from './vault-key-panel';

// Hiding Confidential values again does not undo what was already written to the local
// timeline/response history while they were visible, so both directions get a heads-up.
const onHideConfidentialValuesToggled = (isHiding: boolean) => {
  if (isHiding) {
    showModal(AlertModal, {
      title: 'Hiding Confidential Variables',
      message:
        'You are now hiding Confidential variables in the Restless UI. Consider clearing your Response History to remove any potentially confidential information from your local logs/history. You can do this in a Collection’s Settings, or globally from the Tools menu.',
    });
    return;
  }

  showModal(AlertModal, {
    title: 'Confidential Variables Are Now Visible',
    message:
      'Confidential variables are now visible. FYI, they will persist locally in your local logs/Response History.',
  });
};

export const Security: FC = () => (
  <div>
    <SettingsHeading first>Secrets</SettingsHeading>
    <BooleanSetting label="Reveal passwords" setting="showPasswords" />
    <BooleanSetting
      label="Hide Confidential values in Preview/Console"
      setting="hideSecretValuesInPreviewAndConsole"
      onAfterToggle={onHideConfidentialValuesToggled}
    />
    <VaultKeyPanel />

    <SettingsHeading>Sign-in sessions</SettingsHeading>
    <div className="form-row pad-top-sm">
      <BooleanSetting
        label="Clear OAuth 2 session on start"
        setting="clearOAuth2SessionOnRestart"
        help="If checked, clears the OAuth session every time Restless is relaunched."
      />
      <button
        className="pointer flex h-(--line-height-xs) items-center justify-center rounded-md border border-solid border-(--hl-lg) px-(--padding-sm) hover:bg-(--hl-xs)"
        onClick={clearOAuthWindowSessionId}
      >
        Clear OAuth 2 session
      </button>
    </div>
    <BooleanSetting
      label="Validate certificates during authentication"
      setting="validateAuthSSL"
      help="If checked, validates SSL certificates during authentication flows."
    />

    <SettingsHeading>Access</SettingsHeading>
    <TextArraySetting
      label="What folders can Restless access?"
      setting="dataFolders"
      help="This allows you to control what folders Restless (and scripts within Restless) can read/write to."
      placeholder="e.g., /Users/folder1"
    />

    <SettingsHeading>Response preview</SettingsHeading>
    <BooleanSetting label="Disable JS in HTML preview" setting="disableHtmlPreviewJs" />
    <BooleanSetting label="Disable links in response viewer" setting="disableResponsePreviewLinks" />
  </div>
);
