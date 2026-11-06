import { NewRequestCollection } from 'insomnia-data/common';
import React, { type FC } from 'react';

import { BooleanSetting } from './boolean-setting';
import { EnumSetting } from './enum-setting';
import { SettingsHeading } from './settings-section';

export const General: FC = () => (
  <div>
    <SettingsHeading first>New requests</SettingsHeading>
    <EnumSetting<NewRequestCollection>
      label="Default collection for new requests"
      setting="newRequestCollection"
      values={[
        { value: NewRequestCollection.lastUsed, name: 'The last one used' },
        { value: NewRequestCollection.first, name: 'The first one in the list' },
      ]}
      help="Where the + button in the tab bar adds a request when no collection is open. In a collection, it adds to that collection."
    />

    <SettingsHeading>Navigation</SettingsHeading>
    <BooleanSetting
      label="Sidebar focus for collections"
      setting="sidebarFocusForCollections"
      help="If checked, clicking a collection or anything inside it narrows the sidebar to that collection's contents. Otherwise the full project tree stays visible."
    />
    <BooleanSetting
      label="Show legacy unit tests"
      setting="enableLegacyUnitTests"
      help="If checked, the Tests tab will always be shown in the collection view. Otherwise, it will only be shown if the collection already has legacy tests."
    />

    <SettingsHeading>Links</SettingsHeading>
    <BooleanSetting
      label="Open Insomnia web links"
      setting="handleInsomniaLinks"
      help="Opens insomnia:// plugin, theme and import links here. Turn this off if you also use Insomnia. Takes effect after a restart."
    />
  </div>
);
