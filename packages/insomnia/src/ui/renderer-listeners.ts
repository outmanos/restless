import { services } from 'insomnia-data';

import { type RAToastContent, showToast } from '~/ui/components/toast-notification';
import * as themes from '~/ui/plugins/misc';
import { plugins } from '~/ui/plugins/renderer-bridge';
import * as templating from '~/ui/templating/renderer-safe';

import { dispatchEditorUndo } from './components/.client/codemirror/editor-undo';
import { MigrationModal } from './components/migration/migration-modal';
import { showModal } from './components/modals';
import { openSettings } from './settings-navigation';

// Edit-menu Undo/Redo route here so one handler reconciles CodeMirror's history
// with the native undo stack based on what's focused (see editor-undo.ts).
window.main.on('edit:undo', () => dispatchEditorUndo('undo'));
window.main.on('edit:redo', () => dispatchEditorUndo('redo'));

window.main.on('toggle-preferences', () => {
  openSettings();
});

window.main.on('show-about', () => {
  openSettings({ tab: 'about' });
});

window.main.on('open-migration', () => {
  showModal(MigrationModal);
});

window.main.on('reload-plugins', async () => {
  const settings = await services.settings.get();
  await plugins.reloadPlugins();
  await themes.applyColorScheme(settings);
  templating.reload();
  console.log('[plugins] reloaded');
});

window.main.on('toggle-preferences-shortcuts', () => {
  openSettings({ tab: 'keyboard' });
});

window.main.on('show-toast', (_, options: { content: RAToastContent; options?: { timeout?: number } }) => {
  showToast(options.content, options.options);
});

window.main.on('plugins.uiAlert', (_, options: Record<string, any>) => {
  window.showAlert?.(options);
});

window.main.on('plugins.uiDialog', (_, options: Record<string, any>) => {
  window.showWrapper?.(options);
});

window.main.on('ui.prompt', (_, id: string, options: Record<string, any>) => {
  window.showPrompt?.({
    ...options,
    onComplete: (value: string) => {
      window.main.notifyPromptResult(id, value);
    },
    onHide: () => {
      window.main.notifyPromptResult(id, null);
    },
  });
});
