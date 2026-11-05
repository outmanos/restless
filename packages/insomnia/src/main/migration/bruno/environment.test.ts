import { describe, expect, it } from 'vitest';

import type { ReportEntry } from '../types';
import { buildEnvironment, resolveEnvironmentVariables } from './environment';
import type { BrunoEnvironment, BrunoVariable } from './read';
import { convertTemplate } from './template';

const variable = (name: string, value: unknown = 'v', extra: Partial<BrunoVariable> = {}): BrunoVariable => ({
  name,
  value,
  enabled: true,
  ...extra,
});

function build(variables: BrunoVariable[]) {
  const reports: ReportEntry[] = [];
  const renames = new Map<string, string>();
  const built = buildEnvironment(
    {
      environmentId: 'env_1',
      environmentName: 'Local',
      renames,
      report: issue => reports.push(issue),
      onTemplateIssue: () => {},
    },
    variables,
  );
  return { ...built, reports, renames };
}

// NeDB refuses a key with a dot, or one that starts with $, at any depth
function nedbKeyProblems(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key.includes('.') || key.startsWith('$') ? [`${path}/${key}`] : []),
    ...nedbKeyProblems(child, `${path}/${key}`),
  ]);
}

// What `{{ _.a.b }}` reads from the data
const lookup = (data: unknown, reference: string) => reference.split('.').reduce<any>((node, key) => node?.[key], data);

describe('buildEnvironment', () => {
  it('stores plain variables as text rows', () => {
    const { data, kvPairData, reports } = build([variable('host', 'http://localhost'), variable('env-var2', 'two')]);
    expect(data).toEqual({ 'host': 'http://localhost', 'env-var2': 'two' });
    expect(kvPairData.map(({ name, value, type, enabled }) => ({ name, value, type, enabled }))).toEqual([
      { name: 'host', value: 'http://localhost', type: 'str', enabled: true },
      { name: 'env-var2', value: 'two', type: 'str', enabled: true },
    ]);
    expect(reports).toEqual([]);
  });

  it('converts {{var}} in values', () => {
    expect(build([variable('url', '{{host}}/v1')]).data).toEqual({ url: '{{ _.host }}/v1' });
  });

  it('keeps typed values typed, as json rows', () => {
    const { data, kvPairData } = build([
      variable('typed_env_num', 300),
      variable('typed_env_bool', true),
      variable('typed_env_obj', { scope: 'env' }),
    ]);
    expect(data).toEqual({ typed_env_num: 300, typed_env_bool: true, typed_env_obj: { scope: 'env' } });
    expect(kvPairData.map(({ type, value }) => [type, value])).toEqual([
      ['json', '300'],
      ['json', 'true'],
      ['json', '{"scope":"env"}'],
    ]);
  });

  it('gives row ids that do not change between runs', () => {
    const first = build([variable('a'), variable('b')]).kvPairData.map(row => row.id);
    expect(build([variable('a'), variable('b')]).kvPairData.map(row => row.id)).toEqual(first);
    expect(new Set(first).size).toBe(2);
    expect(first[0]).toMatch(/^envPair_[0-9a-f]{40}$/);
  });

  it('keeps a secret as a key with no value, marked confidential', () => {
    const { data, kvPairData } = build([variable('apiToken', 'leaked-by-mistake', { secret: true })]);
    expect(data).toEqual({ apiToken: 'leaked-by-mistake' });
    // The reader gives secrets an empty value. This checks the builder keeps whatever it is given and flags the row.
    expect(kvPairData[0]).toMatchObject({ name: 'apiToken', isConfidential: true });
  });

  it('keeps a disabled variable as a disabled row that is not in the data', () => {
    const { data, kvPairData } = build([variable('on', '1'), variable('off', '2', { enabled: false })]);
    expect(data).toEqual({ on: '1' });
    expect(kvPairData.map(row => [row.name, row.enabled])).toEqual([
      ['on', true],
      ['off', false],
    ]);
  });

  describe('names NeDB would reject', () => {
    it('stores a dotted name as nested data that the converted reference reads', () => {
      const { data, kvPairData, reports, renames } = build([
        variable('env.var1', 'envVar1'),
        variable('env.var2', 'envVar2'),
        variable('api.url', 'https://api.test'),
      ]);
      expect(data).toEqual({ env: { var1: 'envVar1', var2: 'envVar2' }, api: { url: 'https://api.test' } });
      expect(nedbKeyProblems(data)).toEqual([]);
      // The template mapping stays correct: {{env.var1}} becomes {{ _.env.var1 }}, which reads the nested value
      expect(convertTemplate('{{env.var1}}', undefined, renames)).toBe('{{ _.env.var1 }}');
      expect(lookup(data, 'env.var1')).toBe('envVar1');
      expect(lookup(data, 'api.url')).toBe('https://api.test');
      // One row for each top-level key, holding everything below it
      expect(kvPairData.map(({ name, type, value }) => ({ name, type, value }))).toEqual([
        { name: 'env', type: 'json', value: '{"var1":"envVar1","var2":"envVar2"}' },
        { name: 'api', type: 'json', value: '{"url":"https://api.test"}' },
      ]);
      expect(nedbKeyProblems(kvPairData)).toEqual([]);
      expect(reports).toEqual([
        {
          reason: 'not-supported',
          type: 'Environment',
          name: 'Local',
          detail:
            'Variables with a dot are stored as nested values: env.var1, env.var2, api.url. Scripts that read them by their full name need changing.',
        },
      ]);
    });

    it.each([
      ['plain name first', ['api', 'api.url']],
      ['dotted name first', ['api.url', 'api']],
    ])('renames the dotted name when a plain value holds the key (%s)', (_label, order) => {
      const { data, reports, renames } = build(order.map(name => variable(name, `value of ${name}`)));
      expect(data).toEqual({ api: 'value of api', api_url: 'value of api.url' });
      expect(nedbKeyProblems(data)).toEqual([]);
      // The reference follows the rename, so the template mapping stays correct
      expect(renames.get('api.url')).toBe('api_url');
      expect(convertTemplate('{{api.url}} {{api}}', undefined, renames)).toBe('{{ _.api_url }} {{ _.api }}');
      expect(reports).toEqual([
        {
          reason: 'not-supported',
          type: 'Environment',
          name: 'Local',
          detail: 'Variable "api.url" is stored as "api_url" because "api" already holds a value',
        },
      ]);
    });

    it('uses the same stored name in every environment, because a reference is converted only once', () => {
      const renames = new Map<string, string>();
      const reports: ReportEntry[] = [];
      const context = (environmentName: string) => ({
        environmentId: `env_${environmentName}`,
        environmentName,
        renames,
        report: (issue: ReportEntry) => reports.push(issue),
        onTemplateIssue: () => {},
      });
      // In "Local" a plain `api` forces the rename. "Prod" has no such clash.
      const local = buildEnvironment(context('Local'), [variable('api', 'plain'), variable('api.url', 'local-url')]);
      const prod = buildEnvironment(context('Prod'), [variable('api.url', 'prod-url')]);
      expect(local.data).toEqual({ api: 'plain', api_url: 'local-url' });
      expect(prod.data).toEqual({ api_url: 'prod-url' });
      expect(reports.map(report => [report.name, report.detail])).toEqual([
        ['Local', 'Variable "api.url" is stored as "api_url" because "api" already holds a value'],
        [
          'Prod',
          'Variable "api.url" is stored as "api_url" so that every environment of the collection uses the same name',
        ],
      ]);
    });

    it('does not take a name that another variable owns', () => {
      const { data } = build([variable('api'), variable('api.url', 'one'), variable('api_url', 'two')]);
      expect(data).toEqual({ api: 'v', api_url: 'two', api_url_: 'one' });
    });

    it('renames a dotted name that runs into another dotted name', () => {
      const { data, renames } = build([variable('a.b', '1'), variable('a.b.c', '2')]);
      expect(data).toEqual({ a: { b: '1' }, a_b_c: '2' });
      expect(renames.get('a.b.c')).toBe('a_b_c');
    });

    it('renames a name that starts with $ and a name with an empty part', () => {
      const { data, reports } = build([variable('$token', 't'), variable('a..b', 'x'), variable('.lead', 'y')]);
      expect(data).toEqual({ _token: 't', a__b: 'x', _lead: 'y' });
      expect(nedbKeyProblems(data)).toEqual([]);
      expect(reports.map(report => report.detail)).toEqual([
        'Variable "$token" is stored as "_token" because a key cannot have that name',
        'Variable "a..b" is stored as "a__b" because a key cannot have that name',
        'Variable ".lead" is stored as "_lead" because a key cannot have that name',
      ]);
    });

    it('does not let __proto__ reach a prototype', () => {
      const { data } = build([variable('__proto__', 'x'), variable('__proto__.polluted', 'yes')]);
      expect(({} as any).polluted).toBeUndefined();
      expect(Object.keys(data).sort()).toEqual(['___proto___', '__proto___polluted']);
      expect(nedbKeyProblems(data)).toEqual([]);
    });

    it('renames a disabled dotted variable, which only shows as a row', () => {
      const { data, kvPairData, reports } = build([variable('old.name', 'x', { enabled: false })]);
      expect(data).toEqual({});
      expect(kvPairData[0]).toMatchObject({ name: 'old_name', enabled: false });
      expect(reports).toHaveLength(1);
    });

    it('renames keys inside a typed object value, which NeDB checks too', () => {
      const { data, reports } = build([variable('obj', { 'a.b': 1, '$c': { 'd.e': 2 } })]);
      expect(data).toEqual({ obj: { a_b: 1, _c: { d_e: 2 } } });
      expect(nedbKeyProblems(data)).toEqual([]);
      expect(reports).toEqual([
        {
          reason: 'not-supported',
          type: 'Environment',
          name: 'Local',
          detail: 'Keys with "." or a leading "$" inside variable "obj" were renamed',
        },
      ]);
    });
  });
});

describe('resolveEnvironmentVariables', () => {
  const environment = (name: string, variables: BrunoVariable[], parents: string[] = []): BrunoEnvironment => ({
    name,
    relativePath: `environments/${name}.bru`,
    variables,
    extends: parents,
    hasExternalSecrets: false,
  });

  it('copies inherited variables in, and lets the environment override them', () => {
    const base = environment('base', [
      variable('host', 'base-host'),
      variable('only_base', 'b'),
      variable('off', 'x', { enabled: false }),
    ]);
    const dev = environment('dev', [variable('host', 'dev-host'), variable('only_dev', 'd')], ['base']);
    const problems: string[] = [];
    const names = resolveEnvironmentVariables(dev, [base, dev], problem => problems.push(problem)).map(v => [
      v.name,
      v.value,
    ]);
    expect(names).toEqual([
      ['only_base', 'b'],
      ['host', 'dev-host'],
      ['only_dev', 'd'],
    ]);
    expect(problems).toEqual([]);
  });

  it('follows a chain of parents', () => {
    const a = environment('a', [variable('x', 'a')]);
    const b = environment('b', [variable('y', 'b')], ['a']);
    const c = environment('c', [variable('z', 'c')], ['b']);
    expect(resolveEnvironmentVariables(c, [a, b, c], () => {}).map(v => v.name)).toEqual(['x', 'y', 'z']);
  });

  it('reports a parent that is missing, and a loop, and keeps going', () => {
    const problems: string[] = [];
    const lonely = environment('lonely', [variable('x')], ['ghost']);
    expect(resolveEnvironmentVariables(lonely, [lonely], problem => problems.push(problem)).map(v => v.name)).toEqual([
      'x',
    ]);
    const a = environment('a', [variable('x')], ['b']);
    const b = environment('b', [variable('y')], ['a']);
    resolveEnvironmentVariables(a, [a, b], problem => problems.push(problem));
    expect(problems).toEqual(['extends "ghost", which does not exist', 'extends "a", which extends it back']);
  });
});
