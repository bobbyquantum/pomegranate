/**
 * Tests for the Schema Builder (`m` API).
 */

import { m } from '../schema/builder';

describe('Schema Builder', () => {
  describe('m.text()', () => {
    it('creates a text column descriptor', () => {
      const col = m.text();
      expect(col.descriptor.type).toBe('text');
      expect(col.descriptor.isReadonly).toBe(false);
      expect(col.descriptor.isOptional).toBe(false);
      expect(col.descriptor.isIndexed).toBe(false);
      expect(col.descriptor.columnName).toBeNull();
    });

    it('allows custom column name', () => {
      const col = m.text('title_text');
      expect(col.descriptor.columnName).toBe('title_text');
    });

    it('supports chaining modifiers', () => {
      const col = m.text().readonly().optional().indexed();
      expect(col.descriptor.isReadonly).toBe(true);
      expect(col.descriptor.isOptional).toBe(true);
      expect(col.descriptor.isIndexed).toBe(true);
    });

    it('supports default values', () => {
      const col = m.text().default('untitled');
      expect(col.descriptor.defaultValue).toBe('untitled');
    });
  });

  describe('m.number()', () => {
    it('creates a number column descriptor', () => {
      const col = m.number();
      expect(col.descriptor.type).toBe('number');
    });
  });

  describe('m.boolean()', () => {
    it('creates a boolean column descriptor', () => {
      const col = m.boolean();
      expect(col.descriptor.type).toBe('boolean');
    });
  });

  describe('m.date()', () => {
    it('creates a date column descriptor', () => {
      const col = m.date('created_at');
      expect(col.descriptor.type).toBe('date');
      expect(col.descriptor.columnName).toBe('created_at');
    });
  });

  describe('m.belongsTo()', () => {
    it('creates a belongs_to relation descriptor', () => {
      const rel = m.belongsTo('users', { key: 'author_id' });
      expect(rel.kind).toBe('belongs_to');
      expect(rel.relatedTable).toBe('users');
      expect(rel.foreignKey).toBe('author_id');
    });
  });

  describe('m.hasMany()', () => {
    it('creates a has_many relation descriptor', () => {
      const rel = m.hasMany('comments', { foreignKey: 'post_id' });
      expect(rel.kind).toBe('has_many');
      expect(rel.relatedTable).toBe('comments');
      expect(rel.foreignKey).toBe('post_id');
    });
  });

  describe('m.model()', () => {
    it('creates a complete model schema', () => {
      const PostSchema = m.model('posts', {
        title: m.text(),
        body: m.text(),
        status: m.text().indexed(),
        isPinned: m.boolean().default(false),
        createdAt: m.date('created_at').readonly(),
        author: m.belongsTo('users', { key: 'author_id' }),
        comments: m.hasMany('comments', { foreignKey: 'post_id' }),
      });

      expect(PostSchema.table).toBe('posts');

      // Should have columns for: title, body, status, isPinned, createdAt, + author_id (from belongsTo)
      expect(PostSchema.columns.length).toBe(6);

      // Check specific columns
      const titleCol = PostSchema.columns.find((c) => c.fieldName === 'title');
      expect(titleCol).toBeDefined();
      expect(titleCol!.type).toBe('text');
      expect(titleCol!.columnName).toBe('title');

      const createdAtCol = PostSchema.columns.find((c) => c.fieldName === 'createdAt');
      expect(createdAtCol).toBeDefined();
      expect(createdAtCol!.type).toBe('date');
      expect(createdAtCol!.columnName).toBe('created_at');
      expect(createdAtCol!.isReadonly).toBe(true);

      const statusCol = PostSchema.columns.find((c) => c.fieldName === 'status');
      expect(statusCol!.isIndexed).toBe(true);

      // Check relations
      expect(PostSchema.relations.length).toBe(2);
      const authorRel = PostSchema.relations.find((r) => r.fieldName === 'author');
      expect(authorRel!.kind).toBe('belongs_to');
      expect(authorRel!.foreignKey).toBe('author_id');

      const commentsRel = PostSchema.relations.find((r) => r.fieldName === 'comments');
      expect(commentsRel!.kind).toBe('has_many');
    });

    it('schema is frozen (immutable)', () => {
      const schema = m.model('test', { name: m.text() });
      expect(Object.isFrozen(schema)).toBe(true);
    });
  });
});
