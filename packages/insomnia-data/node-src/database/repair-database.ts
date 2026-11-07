import type { CookieJar, Environment, GitRepository, Workspace } from 'insomnia-data';
import { database, models } from 'insomnia-data';
import {
  type HotKeyRegistry,
  keyboardKeys,
  type KeyCombination,
  newDefaultRegistry,
  type PlatformKeyCombinations,
} from 'insomnia-data/common';

import * as apiSpecServices from '../services/api-spec';
import * as projectServices from '../services/project';
import * as settingsServices from '../services/settings';

/**
 * Run various database repair scripts
 */
export async function repairDatabase() {
  console.log('[fix] Running database repairs');

  for (const project of await projectServices.list()) {
    if (project.remoteId === null) {
      await projectServices.clearWorkspaceSyncFlags(project._id);
    }
  }

  for (const workspace of await database.find<Workspace>(models.workspace.type)) {
    await _repairBaseEnvironments(workspace);
    await _fixMultipleCookieJars(workspace);
    await _applyApiSpecName(workspace);
  }

  for (const gitRepository of await database.find<GitRepository>(models.gitRepository.type)) {
    await _fixOldGitURIs(gitRepository);
  }

  await _repairHotKeyRegistry();
}

/**
 * This function ensures that apiSpec exists for each workspace
 * If the filename on the apiSpec is not set or is the default initialized name
 * It will apply the workspace name to it
 */
async function _applyApiSpecName(workspace: Workspace) {
  const apiSpec = await apiSpecServices.getByParentId(workspace._id);
  const existsAndFilenameIsDefaultOrMissing =
    apiSpec && (!apiSpec.fileName || apiSpec.fileName === models.apiSpec.init().fileName);
  // A backfill that would write the existing value changes nothing but would
  // still restamp `modified`, which git sync serializes into YAML and shows up
  // as a modified file. Skip no-op writes.
  if (existsAndFilenameIsDefaultOrMissing && apiSpec.fileName !== workspace.name) {
    await apiSpecServices.update(apiSpec, { fileName: workspace.name });
  }
}

/**
 * This function repairs workspaces that have multiple base environments. Since a workspace
 * can only have one, this function walks over all base environments, merges the data, and
 * moves all children as well.
 */
async function _repairBaseEnvironments(workspace: Workspace) {
  const baseEnvironments = await database.find<Environment>(models.environment.type, {
    parentId: workspace._id,
  });

  // Nothing to do here
  if (baseEnvironments.length <= 1) {
    return;
  }

  const chosenBase = baseEnvironments[0];

  for (const baseEnvironment of baseEnvironments) {
    if (baseEnvironment._id === chosenBase._id) {
      continue;
    }

    chosenBase.data = Object.assign(baseEnvironment.data, chosenBase.data);
    const subEnvironments = await database.find<Environment>(models.environment.type, {
      parentId: baseEnvironment._id,
    });

    for (const subEnvironment of subEnvironments) {
      await database.docUpdate(subEnvironment, {
        parentId: chosenBase._id,
      });
    }

    // Remove unnecessary base env
    await database.remove(baseEnvironment);
  }

  // Update remaining base env
  await database.update(chosenBase);
  console.log(`[fix] Merged ${baseEnvironments.length} base environments under ${workspace.name}`);
}

/**
 * This function repairs workspaces that have multiple cookie jars. Since a workspace
 * can only have one, this function walks over all jars and merges them and their cookies
 * together.
 */
async function _fixMultipleCookieJars(workspace: Workspace) {
  const cookieJars = await database.find<CookieJar>(models.cookieJar.type, {
    parentId: workspace._id,
  });

  // Nothing to do here
  if (cookieJars.length <= 1) {
    return;
  }

  const chosenJar = cookieJars[0];

  for (const cookieJar of cookieJars) {
    if (cookieJar._id === chosenJar._id) {
      continue;
    }

    for (const cookie of cookieJar.cookies) {
      if (chosenJar.cookies.find(c => c.id === cookie.id)) {
        continue;
      }

      chosenJar.cookies.push(cookie);
    }

    // Remove unnecessary jar
    await database.remove(cookieJar);
  }

  // Update remaining jar
  await database.update(chosenJar);
  console.log(`[fix] Merged ${cookieJars.length} cookie jars under ${workspace.name}`);
}

// Append .git to old git URIs to mimic previous isomorphic-git behavior
async function _fixOldGitURIs(doc: GitRepository) {
  if (!doc.uriNeedsMigration) {
    return;
  }

  if (!doc.uri.endsWith('.git')) {
    doc.uri += '.git';
  }

  doc.uriNeedsMigration = false;
  await database.update(doc);
  console.log(`[fix] Fixed git URI for ${doc._id}`);
}

// Keyboard shortcuts added after a person's preferences were first saved are missing from them, and a stored
// shortcut that is still the old default for pinning (which command mode now uses) is moved to the new default.
export const repairHotKeyRegistry = (
  stored: Partial<HotKeyRegistry>,
  defaults: HotKeyRegistry,
): { registry: HotKeyRegistry; changed: boolean } => {
  const registry = { ...stored } as HotKeyRegistry;
  let changed = false;
  for (const name of Object.keys(defaults) as (keyof HotKeyRegistry)[]) {
    if (!stored[name]) {
      registry[name] = defaults[name];
      changed = true;
    }
  }
  const pin = stored.request_togglePin;
  if (pin && isOldPinDefault(pin)) {
    registry.request_togglePin = defaults.request_togglePin;
    changed = true;
  }
  return { registry, changed };
};

async function _repairHotKeyRegistry() {
  const settings = await settingsServices.get();
  const { registry, changed } = repairHotKeyRegistry(settings.hotKeyRegistry ?? {}, newDefaultRegistry());
  if (changed) {
    await settingsServices.patch({ hotKeyRegistry: registry });
  }
}

const isOldPinDefault = (pin: PlatformKeyCombinations) => {
  const only = (keys: KeyCombination[] | undefined, expected: Partial<KeyCombination>) =>
    keys?.length === 1 &&
    keys[0].keyCode === expected.keyCode &&
    !!keys[0].shift === !!expected.shift &&
    !!keys[0].ctrl === !!expected.ctrl &&
    !!keys[0].meta === !!expected.meta &&
    !keys[0].alt;
  const p = keyboardKeys.p.keyCode;
  return (
    only(pin.macKeys, { shift: true, meta: true, keyCode: p }) &&
    only(pin.winLinuxKeys, { shift: true, ctrl: true, keyCode: p })
  );
};
