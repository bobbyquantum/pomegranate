/**
 * Tests for SQL generation.
 */

import {
  createTableSQL,
  selectSQL,
  countSQL,
  insertSQL,
  updateSQL,
  deleteSQL,
  searchSQL,
} from '../adapters/sqlite/sql';
import type { TableSchema } from '../schema/types';

describe('SQL Generation', () => {
  describe('createTableSQL', () => {
    it('generates CREATE TABLE with columns', () => {
      const table: TableSchema = {
        name: 'posts',
        columns: [
          { name: 'title', type: 'text', isOptional: false, isIndexed: false },
          { name: 'views', type: 'number', isOptional: false, isIndexed: false },
          { name: 'is_pinned', type: 'boolean', isOptional: false, isIndexed: false },
          { name: 'created_at', type: 'date', isOptional: true, isIndexed: true },
        ],
      };

      const sql = createTableSQL(table);

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "posts"');
      expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
      expect(sql).toContain('"_status" TEXT NOT NULL');
      expect(sql).toContain('"title" TEXT NOT NULL');
      expect(sql).toContain('"views" REAL NOT NULL');
      expect(sql).toContain('"is_pinned" INTEGER NOT NULL');
      expect(sql).toContain('"created_at" REAL DEFAULT NULL');
      // Should create index for created_at and _status
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "posts_created_at"');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "posts__status"');
    });
  });

  describe('selectSQL', () => {
    it('generates basic SELECT', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts"');
      expect(bindings).toEqual([]);
    });

    it('generates SELECT with WHERE', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [{ type: 'where', column: 'status', operator: 'eq', value: 'published' }],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts" WHERE "status" = ?');
      expect(bindings).toEqual(['published']);
    });

    it('generates SELECT with ORDER BY, LIMIT, OFFSET', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [],
        orderBy: [{ column: 'created_at', order: 'desc' }],
        limit: 10,
        offset: 20,
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts" ORDER BY "created_at" DESC LIMIT ? OFFSET ?');
      expect(bindings).toEqual([10, 20]);
    });

    it('generates SELECT with multiple conditions', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [
          { type: 'where', column: 'status', operator: 'eq', value: 'published' },
          { type: 'where', column: 'views', operator: 'gt', value: 100 },
        ],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts" WHERE "status" = ? AND "views" > ?');
      expect(bindings).toEqual(['published', 100]);
    });

    it('handles IN operator', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [
          { type: 'where', column: 'status', operator: 'in', value: ['draft', 'published'] },
        ],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts" WHERE "status" IN (?, ?)');
      expect(bindings).toEqual(['draft', 'published']);
    });

    it('handles BETWEEN operator', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [{ type: 'where', column: 'views', operator: 'between', value: [10, 100] }],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts" WHERE "views" BETWEEN ? AND ?');
      expect(bindings).toEqual([10, 100]);
    });

    it('handles IS NULL', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [{ type: 'where', column: 'deleted_at', operator: 'isNull', value: null }],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts" WHERE "deleted_at" IS NULL');
      expect(bindings).toEqual([]);
    });

    it('handles OR conditions', () => {
      const { sql, bindings } = selectSQL({
        table: 'posts',
        conditions: [
          {
            type: 'or',
            conditions: [
              { type: 'where', column: 'status', operator: 'eq', value: 'draft' },
              { type: 'where', column: 'status', operator: 'eq', value: 'published' },
            ],
          },
        ],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT * FROM "posts" WHERE ("status" = ? OR "status" = ?)');
      expect(bindings).toEqual(['draft', 'published']);
    });
  });

  describe('countSQL', () => {
    it('generates COUNT query', () => {
      const { sql, bindings } = countSQL({
        table: 'posts',
        conditions: [{ type: 'where', column: '_status', operator: 'neq', value: 'deleted' }],
        orderBy: [],
        joins: [],
      });

      expect(sql).toBe('SELECT COUNT(*) as count FROM "posts" WHERE "_status" != ?');
      expect(bindings).toEqual(['deleted']);
    });
  });

  describe('insertSQL', () => {
    it('generates INSERT', () => {
      const { sql, bindings } = insertSQL('posts', {
        id: 'abc123',
        title: 'Hello',
        _status: 'created',
        _changed: '',
      });

      expect(sql).toContain('INSERT INTO "posts"');
      expect(sql).toContain('VALUES');
      expect(bindings).toContain('abc123');
      expect(bindings).toContain('Hello');
    });
  });

  describe('updateSQL', () => {
    it('generates UPDATE', () => {
      const { sql, bindings } = updateSQL('posts', {
        id: 'abc123',
        title: 'Updated',
        _status: 'updated',
        _changed: 'title',
      });

      expect(sql).toContain('UPDATE "posts" SET');
      expect(sql).toContain('WHERE "id" = ?');
      // id should be the last binding
      expect(bindings.at(-1)).toBe('abc123');
    });
  });

  describe('deleteSQL', () => {
    it('generates DELETE', () => {
      const { sql, bindings } = deleteSQL('posts', 'abc123');

      expect(sql).toBe('DELETE FROM "posts" WHERE "id" = ?');
      expect(bindings).toEqual(['abc123']);
    });
  });

  describe('searchSQL', () => {
    it('generates search query with LIKE', () => {
      const { sql, countSql, bindings, countBindings } = searchSQL({
        table: 'posts',
        term: 'hello',
        fields: ['title', 'body'],
        conditions: [],
        orderBy: [],
        limit: 10,
        offset: 0,
      });

      expect(sql).toContain('LIKE ?');
      expect(sql).toContain('LIMIT ? OFFSET ?');
      expect(countSql).toContain('COUNT(*)');
      expect(bindings).toContain('%hello%');
    });
  });
});
