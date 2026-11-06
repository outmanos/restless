import React, { type FC } from 'react';

import {
  MAX_EDITOR_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
} from '../../../common/constants';
import { BooleanSetting } from './boolean-setting';
import { NumberSetting } from './number-setting';
import { SettingsHeading } from './settings-section';
import { TextSetting } from './text-setting';
import { ThemePanel } from './theme-panel';

export const Appearance: FC = () => (
  <div>
    <SettingsHeading first>Theme</SettingsHeading>
    <ThemePanel />

    <SettingsHeading>Fonts</SettingsHeading>
    <div className="form-row">
      <TextSetting
        label="Interface font"
        setting="fontInterface"
        help="Enter a comma-separated list of fonts. If left empty, uses system defaults."
        placeholder="-- System Default --"
      />
      <NumberSetting
        label="Interface font size (px)"
        setting="fontSize"
        min={MIN_INTERFACE_FONT_SIZE}
        max={MAX_INTERFACE_FONT_SIZE}
      />
    </div>
    <div className="form-row">
      <TextSetting
        label="Text editor font"
        setting="fontMonospace"
        help="Enter a comma-separated list of monospace fonts. If left empty, uses system defaults."
        placeholder="-- System Default --"
      />
      <NumberSetting
        label="Editor font size (px)"
        setting="editorFontSize"
        min={MIN_EDITOR_FONT_SIZE}
        max={MAX_EDITOR_FONT_SIZE}
      />
    </div>
    <BooleanSetting label="Font ligatures" setting="fontVariantLigatures" />

    <SettingsHeading>Layout</SettingsHeading>
    <BooleanSetting
      label="Use vertical layout"
      setting="forceVerticalLayout"
      help="If checked, stack request and response panels vertically. Otherwise they will be side-by-side above 880px."
    />
    <BooleanSetting
      label="Sidebar focus for collections"
      setting="sidebarFocusForCollections"
      help="If checked, clicking a collection or anything inside it narrows the sidebar to that collection's contents. Otherwise the full project tree stays visible."
    />
  </div>
);
