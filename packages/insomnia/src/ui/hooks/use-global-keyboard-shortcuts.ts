import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';
import { plugins } from '~/ui/plugins/renderer-bridge';
import { reload } from '~/ui/templating/renderer-safe';

import { useDocBodyKeyboardShortcuts } from '../components/keydown-binder';
import { openSettings } from '../settings-navigation';
import { useSettingsPatcher } from './use-request';

export const useGlobalKeyboardShortcuts = () => {
  const { settings } = useRootLoaderData()!;
  const patchSettings = useSettingsPatcher();

  useDocBodyKeyboardShortcuts({
    // Route through the same path as Settings → Plugins reload: rescan plugins AND invalidate the
    // render worker's cached Liquid engine, so a plugin that failed once actually recovers (#10295).
    plugin_reload: async () => {
      await plugins.reloadPlugins();
      reload();
    },
    // TODO: move this to workspace route
    environment_showVariableSourceAndValue: () =>
      patchSettings({ showVariableSourceAndValue: !settings.showVariableSourceAndValue }),
    // TODO: move this to organization route
    preferences_showGeneral: () => openSettings(),
    preferences_showKeyboardShortcuts: () => openSettings({ tab: 'keyboard' }),
  });
};
