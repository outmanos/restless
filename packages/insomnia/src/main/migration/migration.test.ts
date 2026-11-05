import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { database as db, models, services } from 'insomnia-data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line no-restricted-imports
import { resetV4Counter } from '../../../../insomnia-data/__mocks__/uuid';
import { planBruno } from './bruno/plan';
import { BRU_COLLECTION, YML_COLLECTION } from './bruno/test-utils';
import { commitPlan } from './commit';
import { writeFixture } from './insomnia/make-fixture';
import { buildInsomniaPlan } from './insomnia/plan';
import { expectUntouched, makeTempDir } from './insomnia/test-support';
import type { DetectedSource, MigrationPlan, MigrationReport } from './types';

const reasons = (report: MigrationReport) => new Set(report.entries.map(entry => entry.reason));
const total = (report: MigrationReport) => Object.values(report.imported).reduce((sum, count) => sum + count, 0);
const importable = (plan: MigrationPlan) => new Set(plan.items.map(item => item.doc._id)).size;

describe('plan and commit together', () => {
  let dataDir: string;
  let previousDataPath: string | undefined;

  beforeEach(async () => {
    await db.init({ inMemoryOnly: true }, true);
    resetV4Counter();
    dataDir = await mkdtemp(path.join(tmpdir(), 'restless-migration-'));
    previousDataPath = process.env['INSOMNIA_DATA_PATH'];
    process.env['INSOMNIA_DATA_PATH'] = dataDir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (previousDataPath === undefined) {
      delete process.env['INSOMNIA_DATA_PATH'];
    } else {
      process.env['INSOMNIA_DATA_PATH'] = previousDataPath;
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it('moves an Insomnia install once, and a second run adds nothing', async () => {
    const source = makeTempDir();
    writeFixture(source);
    const detected: DetectedSource = {
      id: `insomnia:${source}`,
      kind: 'insomnia',
      path: source,
      counts: { projects: 0, collections: 0, requests: 0, environments: 0 },
      running: false,
    };

    const report = await expectUntouched(source, async () =>
      commitPlan(await buildInsomniaPlan(detected, { existingProjects: [] })),
    );

    expect(report.imported.Project).toBeGreaterThan(0);
    expect(report.imported.Request).toBeGreaterThan(0);
    expect(await services.project.list()).not.toHaveLength(0);
    for (const project of await services.project.list()) {
      expect(project.parentId).toBe(models.organization.LOCAL_ORGANIZATION_ID);
      expect(project.mcpStdioAccess).toBe(false);
    }

    const again = await commitPlan(await buildInsomniaPlan(detected, { existingProjects: [] }));
    expect(again.imported).toEqual({});
    expect(reasons(again).has('already-imported')).toBe(true);
  });

  it.each([
    ['.bru', BRU_COLLECTION],
    ['YAML', YML_COLLECTION],
  ])('moves a %s Bruno collection once, and a second run adds nothing', async (_format, collection) => {
    const [plan] = await planBruno(collection);

    const report = await commitPlan(plan);

    expect(report.entries.filter(entry => entry.reason === 'parse-error' && entry.type !== 'Request')).toEqual([]);
    expect(total(report)).toBe(importable(plan));
    expect((await services.project.list()).map(project => project.name)).toContain(plan.items[0].name);

    const [secondPlan] = await planBruno(collection);
    const again = await commitPlan(secondPlan);
    expect(again.imported).toEqual({});
    expect(secondPlan.items[0].name).toBe(plan.items[0].name);
  });
});
