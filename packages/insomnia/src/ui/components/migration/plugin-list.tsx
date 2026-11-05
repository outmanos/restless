import { useState } from 'react';

import { Button, Icon } from '~/basic-components';
import { plugins } from '~/ui/plugins/renderer-bridge';
import { reload as reloadTemplating } from '~/ui/templating/renderer-safe';

import { installMigratedPlugin, type PluginInstallDeps, pluginNameProblem } from './flow';
import { Section, Spinner } from './parts';

type InstallState = { status: 'installing' } | { status: 'installed' } | { status: 'failed'; error: string };

// The same install as the Plugins tab, then a reload so the plugin works without a restart.
const installDeps: PluginInstallDeps = {
  install: (name, allowScopedPackageNames) => window.main.installPlugin(name, allowScopedPackageNames),
  reload: async () => {
    await plugins.reloadPlugins();
    reloadTemplating();
  },
};

const PluginRow = ({
  name,
  state,
  onInstall,
}: {
  name: string;
  state: InstallState | undefined;
  onInstall: (name: string) => void;
}) => {
  const problem = pluginNameProblem(name);
  const isInstalling = state?.status === 'installing';

  return (
    <li
      className="flex items-start justify-between gap-3 rounded-md border border-solid border-(--hl-md) p-3"
      data-testid={`migration-plugin-${name}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium break-all">{name}</span>
        {problem && <span className="text-xs text-(--hl)">Cannot be installed from here. {problem}</span>}
        {state?.status === 'failed' && (
          <span className="text-xs break-words text-(--color-danger)" role="alert">
            {state.error}
          </span>
        )}
      </div>
      {state?.status === 'installed' ? (
        <span className="flex shrink-0 items-center gap-1 text-sm" data-testid={`migration-plugin-done-${name}`}>
          <Icon icon="check" aria-hidden /> Installed
        </span>
      ) : (
        <Button
          size="sm"
          className="shrink-0"
          isDisabled={isInstalling || Boolean(problem)}
          aria-label={`Install ${name} from npm`}
          data-testid={`migration-plugin-install-${name}`}
          onPress={() => onInstall(name)}
        >
          {isInstalling ? (
            <>
              <Spinner /> Installing…
            </>
          ) : state?.status === 'failed' ? (
            'Try again'
          ) : (
            'Install from npm'
          )}
        </Button>
      )}
    </li>
  );
};

// Plugins are never copied. Each one is downloaded from npm, one click at a time.
export const PluginList = ({ names }: { names: string[] }) => {
  const [installs, setInstalls] = useState<ReadonlyMap<string, InstallState>>(new Map());

  const setState = (name: string, state: InstallState) => setInstalls(current => new Map(current).set(name, state));

  const install = async (name: string) => {
    if (installs.get(name)?.status === 'installing') {
      return;
    }
    setState(name, { status: 'installing' });
    const result = await installMigratedPlugin(name, installDeps);
    setState(name, result.ok ? { status: 'installed' } : { status: 'failed', error: result.error });
  };

  return (
    <Section title="Plugins" testId="migration-plugins">
      <p className="text-sm text-(--hl)">
        restless does not copy plugins. Each one is downloaded from npm when you click its button, and not before.
        Plugins are third-party code, so only install the ones you trust.
      </p>
      <ul className="flex flex-col gap-2">
        {names.map(name => (
          <PluginRow key={name} name={name} state={installs.get(name)} onInstall={install} />
        ))}
      </ul>
    </Section>
  );
};
