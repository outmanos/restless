import React, { type FC } from 'react';

import { BooleanSetting } from './boolean-setting';
import { NumberSetting } from './number-setting';
import { SettingsHeading } from './settings-section';

export const Editor: FC = () => (
  <div>
    <SettingsHeading first>Text editor</SettingsHeading>
    <div className="row-fill row-fill--top">
      <div>
        <BooleanSetting label="Indent with tabs" setting="editorIndentWithTabs" />
        <BooleanSetting label="Wrap text editor lines" setting="editorLineWrapping" />
      </div>
    </div>
    <div className="form-row pad-top-sm">
      <NumberSetting label="Editor indent size" setting="editorIndentSize" help="" min={1} max={16} />
      <NumberSetting
        label="Autocomplete popup delay (ms)"
        setting="autocompleteDelay"
        help="Delay the autocomplete popup by milliseconds. Enter 0 to disable the autocomplete delay."
        min={0}
        max={3000}
        step={100}
      />
    </div>

    <SettingsHeading>Requests</SettingsHeading>
    <BooleanSetting label="Use bulk header editor" setting="useBulkHeaderEditor" />
    <BooleanSetting label="Raw template syntax" setting="nunjucksPowerUserMode" />
    <BooleanSetting
      label="Template tags show variable source and value"
      help="If checked, reveals the environment variable source and value in the template tag. Otherwise, hover over the template tag to see the source and value."
      setting="showVariableSourceAndValue"
    />
  </div>
);
