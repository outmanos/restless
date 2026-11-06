import { isMac } from 'insomnia-data/common';
import React, { type FC, Fragment } from 'react';

import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { EditorKeyMap } from '../../../common/constants';
import { docsKeyMaps } from '../../../common/documentation';
import { Link } from '../base/link';
import { BooleanSetting } from './boolean-setting';
import { EnumSetting } from './enum-setting';
import { SettingsHeading } from './settings-section';
import { Shortcuts } from './shortcuts';

export const Keyboard: FC = () => {
  const { settings } = useRootLoaderData()!;

  return (
    <div>
      <SettingsHeading first>Text editor key map</SettingsHeading>
      <div className="form-row">
        <EnumSetting<EditorKeyMap>
          label="Key map"
          setting="editorKeyMap"
          help={
            isMac &&
            settings.editorKeyMap === EditorKeyMap.vim && (
              <Fragment>
                To enable key-repeating with Vim on macOS, see{' '}
                <Link href={docsKeyMaps}>
                  documentation <i className="fa fa-external-link-square" />
                </Link>
              </Fragment>
            )
          }
          values={[
            { value: EditorKeyMap.default, name: 'Default' },
            { value: EditorKeyMap.vim, name: 'Vim' },
            { value: EditorKeyMap.emacs, name: 'Emacs' },
            { value: EditorKeyMap.sublime, name: 'Sublime' },
          ]}
        />
      </div>
      <BooleanSetting
        label="Use the key map in one-line editors (headers, query parameters, URLs and so on)"
        setting="enableKeyMapForInlineTextEditors"
      />

      <SettingsHeading>Shortcuts</SettingsHeading>
      <Shortcuts />
    </div>
  );
};
