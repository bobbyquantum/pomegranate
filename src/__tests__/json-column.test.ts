/**
 * `m.json()` column type — serialized as TEXT, parsed on read, optional sanitizer.
 * Exercised through both adapters.
 */

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { SQLiteAdapter } from '../adapters/sqlite/SQLiteAdapter';
import { createTableSQL } from '../adapters/sqlite/sql';
import type { InferRecord, RawRecord } from '../schema/types';
import { createBetterSqliteDriver } from './helpers/betterSqliteDriver';

interface Prefs {
  theme: string;
  size?: number;
}

const SettingsSchema = m.model('settings', {
  name: m.text(),
  prefs: m.json<Prefs>().optional(),
  tags: m.json<string[]>('tag_list', (raw) =>
    Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [],
  ),
  extra: m.json().default({ version: 1 }),
  blob: m.json(),
  normalized: m.json((raw) => (raw === null ? 'fallback' : raw)),
});

class Settings extends Model<typeof SettingsSchema> {
  static schema = SettingsSchema;
}

// ─── Compile-time inference checks ────────────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Rec = InferRecord<(typeof SettingsSchema)['fields']>;
const _tagsAreStringArray: Equal<Rec['tags'], string[]> = true;
const _prefsAreNullable: Equal<Rec['prefs'], Prefs | null> = true;
const _blobIsUnknown: Equal<Rec['blob'], unknown> = true;
void [_tagsAreStringArray, _prefsAreNullable, _blobIsUnknown];

// ─── Tests ────────────────────────────────────────────────────────────────

describe('m.json() schema descriptor', () => {
  it('produces a json column with optional sanitizer', () => {
    expect(SettingsSchema.fields.prefs.type).toBe('json');
    expect(SettingsSchema.fields.tags.columnName).toBe('tag_list');
    const tags = SettingsSchema.columns.find((c) => c.fieldName === 'tags')!;
    expect(tags.type).toBe('json');
    expect(typeof tags.sanitizer).toBe('function');
    const blob = SettingsSchema.columns.find((c) => c.fieldName === 'blob')!;
    expect(blob.sanitizer).toBeUndefined();
  });

  it('accepts a sanitizer as the only argument', () => {
    const col = SettingsSchema.columns.find((c) => c.fieldName === 'normalized')!;
    expect(col.columnName).toBe('normalized');
    expect(col.sanitizer!(null)).toBe('fallback');
  });

  it('is stored as TEXT with text nullability/default rules', () => {
    const sql = createTableSQL({
      name: 'settings',
      columns: [
        { name: 'prefs', type: 'json', isOptional: true, isIndexed: false },
        { name: 'tag_list', type: 'json', isOptional: false, isIndexed: false },
      ],
    });
    expect(sql).toContain('"prefs" TEXT DEFAULT NULL');
    expect(sql).toContain('"tag_list" TEXT NOT NULL DEFAULT \'\'');
  });
});

describe.each([
  ['LokiAdapter', () => new LokiAdapter({ databaseName: `json-${Math.random()}` })],
  [
    'SQLiteAdapter',
    () => new SQLiteAdapter({ databaseName: ':memory:', driver: createBetterSqliteDriver() }),
  ],
])('json columns via %s', (_name, makeAdapter) => {
  let db: Database;

  beforeEach(async () => {
    db = new Database({ adapter: makeAdapter(), models: [Settings] });
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  it('serializes objects on create and parses them on read', async () => {
    const record = await db.write(async () =>
      db.get(Settings).create({ name: 'a', prefs: { theme: 'dark', size: 2 }, blob: [1, 'two'] }),
    );

    expect(record._rawRecord.prefs).toBe('{"theme":"dark","size":2}');
    expect(record._rawRecord.blob).toBe('[1,"two"]');
    expect(record.getField('prefs')).toEqual({ theme: 'dark', size: 2 });
    expect(record.getField('blob')).toEqual([1, 'two']);

    // Round-trips through the adapter as well
    db.get(Settings)._clearCache();
    const reloaded = await db.get(Settings).findById(record.id);
    expect(reloaded!.getField('prefs')).toEqual({ theme: 'dark', size: 2 });
  });

  it('passes strings through untouched (assumed already-serialized)', async () => {
    const record = await db.write(async () =>
      db.get(Settings).create({ name: 'a', prefs: '{"theme":"light"}' }),
    );
    expect(record._rawRecord.prefs).toBe('{"theme":"light"}');
    expect(record.getField('prefs')).toEqual({ theme: 'light' });
  });

  it('keeps null as null and serializes default values', async () => {
    const record = await db.write(async () =>
      db.get(Settings).create({ name: 'a', prefs: null }),
    );
    expect(record._rawRecord.prefs).toBeNull();
    expect(record.getField('prefs')).toBeNull();
    expect(record._rawRecord.extra).toBe('{"version":1}');
    expect(record.getField('extra')).toEqual({ version: 1 });
  });

  it('reads an unset non-optional column as null', async () => {
    const record = await db.write(async () => db.get(Settings).create({ name: 'a' }));
    expect(record._rawRecord.blob).toBe('');
    expect(record.getField('blob')).toBeNull();
  });

  it('applies the sanitizer to parsed values and to null', async () => {
    const record = await db.write(async () =>
      db.get(Settings).create({ name: 'a', tags: ['x', 1, 'y', null] }),
    );
    expect(record.getField('tags')).toEqual(['x', 'y']);
    expect(record.getField('normalized')).toBe('fallback');

    await db.write(async () => {
      await record.update({ tags: { not: 'an array' }, normalized: { ok: true } });
    });
    expect(record.getField('tags')).toEqual([]);
    expect(record.getField('normalized')).toEqual({ ok: true });
  });

  it('returns null for invalid JSON in storage', async () => {
    const raw = {
      id: 'broken',
      name: 'a',
      prefs: '{not json',
      tag_list: 'nope',
      extra: '',
      blob: '',
      normalized: '',
      _status: 'synced',
      _changed: '',
    } as RawRecord;
    await db._adapter.insert('settings', raw);

    const record = await db.get(Settings).findById('broken');
    expect(record!.getField('prefs')).toBeNull();
    expect(record!.getField('tags')).toEqual([]); // sanitizer sees null
  });

  it('serializes on update and reports the column as changed', async () => {
    const record = await db.write(async () => db.get(Settings).create({ name: 'a' }));
    await db.write(async () => {
      await record.update({ prefs: { theme: 'solar' }, tags: ['t'] });
    });

    expect(record._rawRecord.prefs).toBe('{"theme":"solar"}');
    expect(record._rawRecord.tag_list).toBe('["t"]');
    expect(record.changedFields.split(',')).toEqual(expect.arrayContaining(['prefs', 'tag_list']));

    await db.write(async () => {
      await record.update({ prefs: null });
    });
    expect(record._rawRecord.prefs).toBeNull();
    expect(record.getField('prefs')).toBeNull();
  });
});

describe('json columns holding objects (Loki)', () => {
  it('passes already-parsed values through and still sanitizes them', async () => {
    const db = new Database({
      adapter: new LokiAdapter({ databaseName: `json-obj-${Math.random()}` }),
      models: [Settings],
    });
    await db.initialize();
    await db._adapter.insert('settings', {
      id: 'obj',
      name: 'a',
      prefs: { theme: 'inline' },
      tag_list: ['a', 2],
      extra: '',
      blob: '',
      normalized: '',
      _status: 'synced',
      _changed: '',
    } as RawRecord);

    const record = await db.get(Settings).findById('obj');
    expect(record!.getField('prefs')).toEqual({ theme: 'inline' });
    expect(record!.getField('tags')).toEqual(['a']);
    await db.close();
  });
});
