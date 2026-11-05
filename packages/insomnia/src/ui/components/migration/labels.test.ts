import { describe, expect, it } from 'vitest';

import type { ReportReason } from '~/main/migration/types';

import {
  isSupportingType,
  QUIET_SKIPS_NOTE,
  REASON_INFO,
  REASON_ORDER,
  reasonInfo,
  sourceLabel,
  typeLabel,
  typePosition,
} from './labels';
import { DASHES } from './test-fixtures';

// Adding a reason to ReportReason makes this fail to compile until the UI has a label for it.
const ALL_REASONS = Object.keys({
  'already-imported': true,
  'secret-not-readable': true,
  'cloud-only': true,
  'git-project': true,
  'file-missing': true,
  'unknown-model': true,
  'not-supported': true,
  'script-partly-translated': true,
  'parse-error': true,
} satisfies Record<ReportReason, true>) as ReportReason[];

describe('REASON_INFO and REASON_ORDER', () => {
  it('has a label for every reason', () => {
    expect(Object.keys(REASON_INFO).sort()).toEqual([...ALL_REASONS].sort());
    for (const reason of ALL_REASONS) {
      expect(REASON_INFO[reason].title.length).toBeGreaterThan(0);
      expect(REASON_INFO[reason].hint.length).toBeGreaterThan(0);
    }
  });

  it('lists every reason exactly once in the display order', () => {
    expect([...REASON_ORDER].sort()).toEqual([...ALL_REASONS].sort());
    expect(new Set(REASON_ORDER).size).toBe(REASON_ORDER.length);
  });

  it('keeps already-imported last and parse-error first', () => {
    expect(REASON_ORDER[0]).toBe('parse-error');
    expect(REASON_ORDER.at(-1)).toBe('already-imported');
  });

  it('writes the product name in lowercase and never uses dashes in sentences', () => {
    const text = [...Object.values(REASON_INFO).flatMap(info => [info.title, info.hint]), QUIET_SKIPS_NOTE].join('\n');
    expect(text).toContain('restless');
    expect(text).not.toContain('Restless');
    for (const dash of DASHES) {
      expect(text).not.toContain(dash);
    }
  });

  it('points Git projects to File > Open Folder…', () => {
    expect(REASON_INFO['git-project'].hint).toContain('File > Open Folder…');
  });
});

describe('reasonInfo()', () => {
  it('returns the label of a known reason', () => {
    expect(reasonInfo('cloud-only')).toEqual(REASON_INFO['cloud-only']);
  });

  it('still gives an unknown reason a readable title', () => {
    expect(reasonInfo('made-up-reason')).toEqual({ title: 'Made up reason', hint: '' });
  });

  it('does not read from the prototype', () => {
    expect(reasonInfo('constructor')).toEqual({ title: 'Constructor', hint: '' });
    expect(reasonInfo('')).toEqual({ title: 'Other', hint: '' });
  });
});

describe('sourceLabel()', () => {
  it('names the apps as plain text', () => {
    expect(sourceLabel('insomnia')).toBe('Insomnia');
    expect(sourceLabel('insomnium')).toBe('Insomnium');
    expect(sourceLabel('bruno')).toBe('Bruno');
  });

  it('passes an unknown kind through', () => {
    expect(sourceLabel('postman')).toBe('postman');
    expect(sourceLabel('toString')).toBe('toString');
  });
});

describe('typeLabel()', () => {
  it('uses the singular for one and the plural otherwise', () => {
    expect(typeLabel('Request', 1)).toBe('request');
    expect(typeLabel('Request', 2)).toBe('requests');
    expect(typeLabel('Request', 0)).toBe('requests');
    expect(typeLabel('RequestGroup', 3)).toBe('folders');
    expect(typeLabel('Workspace', 1)).toBe('collection');
  });

  it('defaults to the singular', () => {
    expect(typeLabel('CaCertificate')).toBe('CA certificate');
  });

  it('names the types that are only ever listed as skipped', () => {
    expect(typeLabel('OAuth2Token')).toBe('OAuth 2 token');
    expect(typeLabel('GitCredentials')).toBe('Git credential');
    expect(typeLabel('CloudCredential', 2)).toBe('cloud credentials');
    expect(typeLabel('GitRepository', 2)).toBe('Git repositories');
  });

  it('makes a label for a type it does not know', () => {
    expect(typeLabel('FooBar', 1)).toBe('foo bar');
    expect(typeLabel('FooBar', 4)).toBe('foo bars');
    expect(typeLabel('SocketIOResponse', 2)).toBe('socket io responses');
    expect(typeLabel('', 2)).toBe('items');
  });

  it('does not read from the prototype', () => {
    expect(typeLabel('constructor', 1)).toBe('constructor');
    expect(typeLabel('__proto__', 2)).toBe('protos');
  });
});

describe('typePosition() and isSupportingType()', () => {
  it('puts containers before requests before environments', () => {
    expect(typePosition('Project')).toBeLessThan(typePosition('Workspace'));
    expect(typePosition('Workspace')).toBeLessThan(typePosition('Request'));
    expect(typePosition('Request')).toBeLessThan(typePosition('Environment'));
  });

  it('puts unknown types after every known one', () => {
    expect(typePosition('SomethingNew')).toBeGreaterThan(typePosition('PluginData'));
  });

  it('treats the meta models as supporting records', () => {
    for (const type of ['WorkspaceMeta', 'RequestMeta', 'RequestGroupMeta', 'GrpcRequestMeta', 'SocketIORequestMeta']) {
      expect(isSupportingType(type)).toBe(true);
    }
    expect(isSupportingType('Request')).toBe(false);
    expect(isSupportingType('WebSocketPayload')).toBe(false);
  });
});
