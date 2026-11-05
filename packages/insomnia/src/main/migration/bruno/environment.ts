import { createHash } from 'node:crypto';

import type { EnvironmentKvPairData } from 'insomnia-data';
import { EnvironmentKvPairDataType, models } from 'insomnia-data';

import type { ReportEntry } from '../types';
import type { BrunoEnvironment, BrunoVariable } from './read';
import { convertTemplate, type TemplateIssue } from './template';

/**
 * Turns Bruno variables into the two shapes of a restless environment: `data`, and the `kvPairData` rows
 * the key-value editor shows.
 *
 * NeDB rejects a key that contains a dot or starts with `$`, and a document it rejects is not imported at all.
 * So `api.url` is stored as `{ api: { url } }`, which `{{ _.api.url }}` reads. When that is not possible, because
 * `api` already holds a plain value, the name is changed, the references to it follow, and the report says so.
 */

export interface BuiltEnvironment {
  data: Record<string, unknown>;
  kvPairData: EnvironmentKvPairData[];
}

export interface EnvironmentContext {
  environmentId: string;
  environmentName: string;
  // Bruno name -> stored name. Shared with the template converter, so references follow a renamed variable.
  renames: Map<string, string>;
  report: (issue: ReportEntry) => void;
  onTemplateIssue: (issue: TemplateIssue) => void;
}

type Tree = Map<string, unknown>;

const isTree = (value: unknown): value is Tree => value instanceof Map;
const isForbidden = (segment: string) => segment === '' || segment.startsWith('$') || segment === '__proto__';
const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

// What NeDB accepts as a key
function toSafeName(name: string) {
  const safe = name.replaceAll('.', '_').replace(/^\$+/, dollars => '_'.repeat(dollars.length));
  return safe === '__proto__' || safe === '' ? `_${safe}_` : safe;
}

// A typed value (an object or an array) can hold keys NeDB rejects too
function sanitizeKeys(value: unknown, onRenamed: () => void): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeKeys(item, onRenamed));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const safe = toSafeName(key);
        if (safe !== key) {
          onRenamed();
        }
        return [safe, sanitizeKeys(child, onRenamed)];
      }),
    );
  }
  return value;
}

// A Map keeps a variable called `__proto__` away from the prototype of a plain object
function toPlain(value: unknown): unknown {
  return isTree(value) ? Object.fromEntries([...value].map(([key, child]) => [key, toPlain(child)])) : value;
}

// Whether `place` would succeed, without changing the tree
function canPlace(tree: Tree, segments: string[]): boolean {
  let node: Tree = tree;
  for (const segment of segments.slice(0, -1)) {
    const next = node.get(segment);
    if (next === undefined) {
      return true;
    }
    if (!isTree(next)) {
      return false;
    }
    node = next;
  }
  return !isTree(node.get(segments.at(-1)!));
}

// Puts a value at a path, unless a plain value or an object is already in the way
function place(tree: Tree, segments: string[], value: unknown): boolean {
  let node = tree;
  for (const segment of segments.slice(0, -1)) {
    const next = node.get(segment);
    if (next === undefined) {
      const created: Tree = new Map();
      node.set(segment, created);
      node = created;
    } else if (isTree(next)) {
      node = next;
    } else {
      return false;
    }
  }
  const last = segments.at(-1)!;
  if (isTree(node.get(last))) {
    return false;
  }
  node.set(last, value);
  return true;
}

export function buildEnvironment(context: EnvironmentContext, variables: BrunoVariable[]): BuiltEnvironment {
  const { environmentId, environmentName, renames, report } = context;
  const tree: Tree = new Map();
  const rows: EnvironmentKvPairData[] = [];
  const rowsByKey = new Map<string, EnvironmentKvPairData>();
  const nestedNames: string[] = [];

  const named = variables.filter(variable => variable.name.trim() !== '');
  // A plain name keeps its key. A dotted name that starts with it is the one that gives way.
  const reserved = new Set(named.filter(v => v.enabled && !v.name.includes('.')).map(v => v.name.trim()));

  const rename = (name: string, safe: string, why: string) => {
    renames.set(name, safe);
    report({
      reason: 'not-supported',
      type: 'Environment',
      name: environmentName,
      detail: `Variable "${name}" is stored as "${safe}" ${why}`,
    });
  };

  const addRow = (name: string, enabled: boolean) => {
    const row: EnvironmentKvPairData = {
      id: `${models.environment.prefixEnvPair}_${sha1(`${environmentId}\0${rows.length}\0${name}`)}`,
      name,
      value: '',
      type: EnvironmentKvPairDataType.STRING,
      enabled,
    };
    rows.push(row);
    return row;
  };

  for (const variable of named) {
    const name = variable.name.trim();
    let value: unknown =
      typeof variable.value === 'string'
        ? convertTemplate(variable.value, context.onTemplateIssue, renames)
        : (variable.value ?? '');
    if (value !== null && typeof value === 'object') {
      let renamed = false;
      value = sanitizeKeys(value, () => (renamed = true));
      if (renamed) {
        report({
          reason: 'not-supported',
          type: 'Environment',
          name: environmentName,
          detail: `Keys with "." or a leading "$" inside variable "${name}" were renamed`,
        });
      }
    }

    if (!variable.enabled) {
      // A disabled variable only shows as a row, but the editor still checks its name
      const safe = toSafeName(name);
      if (safe !== name) {
        rename(name, safe, 'because a key cannot have that name');
      }
      const row = addRow(safe, false);
      row.type = typeof value === 'string' ? EnvironmentKvPairDataType.STRING : EnvironmentKvPairDataType.JSON;
      row.value = typeof value === 'string' ? value : JSON.stringify(value);
      continue;
    }

    const segments = name.split('.');
    const nameIsValid = !segments.some(isForbidden);
    const hasConflict = !nameIsValid || (segments.length > 1 && reserved.has(segments[0])) || !canPlace(tree, segments);
    // Another environment of the collection may have had to rename it. References are converted once, so all must agree.
    const decided = renames.get(name);
    let storedAt: string[];
    if (!hasConflict && decided === undefined) {
      place(tree, segments, value);
      storedAt = segments;
      if (segments.length > 1) {
        nestedNames.push(name);
      }
    } else {
      let safe = decided ?? toSafeName(name);
      while (tree.has(safe) || (reserved.has(safe) && safe !== name)) {
        safe = `${safe}_`;
      }
      place(tree, [safe], value);
      storedAt = [safe];
      if (!hasConflict) {
        rename(name, safe, 'so that every environment of the collection uses the same name');
      } else {
        rename(
          name,
          safe,
          nameIsValid ? `because "${segments[0]}" already holds a value` : 'because a key cannot have that name',
        );
      }
    }

    const key = storedAt[0];
    const row = rowsByKey.get(key) ?? addRow(key, true);
    rowsByKey.set(key, row);
    if (variable.secret === true && storedAt.length === 1) {
      row.isConfidential = true;
    }
  }

  // Row values come from the finished tree, so duplicates and nested names agree with `data`
  for (const [key, row] of rowsByKey) {
    const final = toPlain(tree.get(key));
    row.type = typeof final === 'string' ? EnvironmentKvPairDataType.STRING : EnvironmentKvPairDataType.JSON;
    row.value = typeof final === 'string' ? final : JSON.stringify(final);
  }

  if (nestedNames.length > 0) {
    report({
      reason: 'not-supported',
      type: 'Environment',
      name: environmentName,
      detail: `Variables with a dot are stored as nested values: ${nestedNames.join(', ')}. Scripts that read them by their full name need changing.`,
    });
  }
  return { data: toPlain(tree) as Record<string, unknown>, kvPairData: rows };
}

/**
 * Bruno environments can extend others. restless has no such thing, so the inherited variables are copied in.
 * A variable an environment defines itself wins, like in Bruno.
 */
export function resolveEnvironmentVariables(
  environment: BrunoEnvironment,
  all: BrunoEnvironment[],
  onProblem: (problem: string) => void,
): BrunoVariable[] {
  const byName = new Map(all.map(candidate => [candidate.name, candidate]));
  const resolve = (current: BrunoEnvironment, path: string[]): BrunoVariable[] => {
    const inherited = new Map<string, BrunoVariable>();
    for (const parentName of current.extends) {
      const parent = byName.get(parentName);
      if (!parent) {
        onProblem(`extends "${parentName}", which does not exist`);
      } else if (path.includes(parentName)) {
        onProblem(`extends "${parentName}", which extends it back`);
      } else {
        for (const variable of resolve(parent, [...path, parentName])) {
          if (variable.enabled) {
            inherited.set(variable.name, variable);
          }
        }
      }
    }
    const own = new Set(current.variables.filter(v => v.enabled).map(v => v.name));
    return [...[...inherited.values()].filter(v => !own.has(v.name)), ...current.variables];
  };
  return resolve(environment, [environment.name]);
}
