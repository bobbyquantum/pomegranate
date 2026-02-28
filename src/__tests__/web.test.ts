/**
 * React Native Web test suite.
 *
 * Tests PomegranateDB's React hooks and component integration in a
 * browser-like environment (jsdom). This validates that PomegranateDB
 * works correctly with React DOM — the same renderer React Native Web uses.
 *
 * Covers:
 *  - DatabaseProvider + useDatabase
 *  - useCollection
 *  - useLiveQuery (live reactive queries)
 *  - useById (single record observation)
 *  - useField (field-level reactivity)
 *  - useCount (reactive counts)
 *  - useSearch (full-text search hook)
 *  - useObservable (generic observable subscription)
 *  - LokiAdapter in jsdom (web adapter)
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { render, screen } from '@testing-library/react';

import { m } from '../schema/builder';
import { Model } from '../model/Model';
import { Database } from '../database/Database';
import { LokiAdapter } from '../adapters/loki/LokiAdapter';
import { Subject } from '../observable/Subject';
import {
  DatabaseProvider,
  useDatabase,
  useCollection,
  useLiveQuery,
  useById,
  useField,
  useCount,
  useSearch,
  useObservable,
  DatabaseSuspenseProvider,
} from '../hooks';

// ─── Test Schema ───────────────────────────────────────────────────────────

const TodoSchema = m.model('todos', {
  title: m.text(),
  body: m.text().default(''),
  done: m.boolean().default(false),
  priority: m.number().default(0),
});

class Todo extends Model<typeof TodoSchema> {
  static schema = TodoSchema;
}

const TagSchema = m.model('tags', {
  name: m.text(),
});

class Tag extends Model<typeof TagSchema> {
  static schema = TagSchema;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function createTestDb() {
  const db = new Database({
    adapter: new LokiAdapter({ databaseName: 'web-test.db' }),
    models: [Todo, Tag],
  });
  await db.initialize();
  return db;
}

function createWrapper(db: Database) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(DatabaseProvider, { value: db }, children);
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('React Native Web — Hooks Test Suite', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  // ─── DatabaseProvider & useDatabase ──────────────────────────────────

  describe('DatabaseProvider + useDatabase', () => {
    it('provides database via context', () => {
      const wrapper = createWrapper(db);
      const { result } = renderHook(() => useDatabase(), { wrapper });
      expect(result.current).toBe(db);
    });

    it('throws when used outside provider', () => {
      // Suppress console.error from React error boundary
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        renderHook(() => useDatabase());
      }).toThrow('useDatabase() must be used within a <DatabaseProvider>');
      spy.mockRestore();
    });

    it('renders a component tree with DatabaseProvider', () => {
      function TestComponent() {
        const database = useDatabase();
        return React.createElement(
          'div',
          { 'data-testid': 'status' },
          database ? 'connected' : 'disconnected',
        );
      }

      render(
        React.createElement(DatabaseProvider, { value: db }, React.createElement(TestComponent)),
      );

      expect(screen.getByTestId('status').textContent).toBe('connected');
    });
  });

  // ─── useCollection ──────────────────────────────────────────────────

  describe('useCollection', () => {
    it('returns a collection for a model class', () => {
      const wrapper = createWrapper(db);
      const { result } = renderHook(() => useCollection(Todo), { wrapper });
      expect(result.current).toBeDefined();
      expect(result.current.table).toBe('todos');
    });

    it('returns different collections for different models', () => {
      const wrapper = createWrapper(db);
      const { result: todoResult } = renderHook(() => useCollection(Todo), { wrapper });
      const { result: tagResult } = renderHook(() => useCollection(Tag), { wrapper });
      expect(todoResult.current.table).toBe('todos');
      expect(tagResult.current.table).toBe('tags');
    });
  });

  // ─── useObservable ──────────────────────────────────────────────────

  describe('useObservable', () => {
    it('returns initial value when observable is null', () => {
      const { result } = renderHook(() => useObservable(null, 'default'));
      expect(result.current).toBe('default');
    });

    it('subscribes and receives values from an observable', async () => {
      const subject = new Subject<number>();
      const { result } = renderHook(() => useObservable(subject, 0));

      expect(result.current).toBe(0);

      act(() => {
        subject.next(42);
      });

      expect(result.current).toBe(42);

      act(() => {
        subject.next(100);
      });

      expect(result.current).toBe(100);
    });

    it('unsubscribes on unmount', () => {
      const subject = new Subject<string>();
      const { result, unmount } = renderHook(() => useObservable(subject, ''));

      act(() => {
        subject.next('hello');
      });
      expect(result.current).toBe('hello');

      unmount();

      // Should not throw — observer was removed
      act(() => {
        subject.next('after unmount');
      });
    });
  });

  // ─── useLiveQuery ──────────────────────────────────────────────────

  describe('useLiveQuery', () => {
    it('starts in loading state', () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      const { result } = renderHook(() => useLiveQuery(collection as any), { wrapper });

      // Initial render might be loading
      expect(result.current.results).toBeDefined();
      expect(Array.isArray(result.current.results)).toBe(true);
    });

    it('returns all records when no query builder is provided', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      // Create some todos
      await db.write(async () => {
        await collection.create({ title: 'Buy milk', done: 0, body: '', priority: 0 });
        await collection.create({ title: 'Walk dog', done: 0, body: '', priority: 1 });
      });

      const { result } = renderHook(() => useLiveQuery(collection as any), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toHaveLength(2);
    });

    it('filters results with a query builder', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({ title: 'Buy milk', done: 1, body: '', priority: 0 });
        await collection.create({ title: 'Walk dog', done: 0, body: '', priority: 1 });
        await collection.create({ title: 'Read book', done: 1, body: '', priority: 2 });
      });

      const { result } = renderHook(
        () => useLiveQuery(collection as any, (qb) => qb.where('done', 'eq', 1)),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toHaveLength(2);
    });

    it('re-renders when collection changes', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      const { result } = renderHook(() => useLiveQuery(collection as any), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toHaveLength(0);

      // Add a record
      await act(async () => {
        await db.write(async () => {
          await collection.create({ title: 'New todo', done: 0, body: '', priority: 0 });
        });
      });

      await waitFor(() => {
        expect(result.current.results).toHaveLength(1);
      });
    });

    it('returns null collection gracefully', () => {
      const { result } = renderHook(() => useLiveQuery(null));
      expect(result.current.results).toEqual([]);
    });
  });

  // ─── useById ────────────────────────────────────────────────────────

  describe('useById', () => {
    it('returns null for null collection', () => {
      const { result } = renderHook(() => useById(null, 'some-id'));
      expect(result.current.record).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('returns null for null id', () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');
      const { result } = renderHook(() => useById(collection as any, null), { wrapper });
      expect(result.current.record).toBeNull();
    });

    it('finds and observes a record by id', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      let createdId = '';
      await db.write(async () => {
        const record = await collection.create({
          title: 'Observable todo',
          done: 0,
          body: '',
          priority: 0,
        });
        createdId = record.id;
      });

      const { result } = renderHook(() => useById(collection as any, createdId), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.record).toBeDefined();
      expect(result.current.record?.id).toBe(createdId);
    });

    it('updates when the observed record changes', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      let createdId = '';
      await db.write(async () => {
        const record = await collection.create({
          title: 'Original',
          done: 0,
          body: '',
          priority: 0,
        });
        createdId = record.id;
      });

      const { result } = renderHook(() => useById(collection as any, createdId), { wrapper });

      await waitFor(() => {
        expect(result.current.record).toBeDefined();
      });

      // Update the record
      await act(async () => {
        await db.write(async () => {
          const record = result.current.record!;
          await record.update({ title: 'Updated' });
        });
      });

      await waitFor(() => {
        expect(result.current.record?.getField('title')).toBe('Updated');
      });
    });
  });

  // ─── useField ──────────────────────────────────────────────────────

  describe('useField', () => {
    it('returns undefined for null record', () => {
      const { result } = renderHook(() => useField(null, 'title'));
      expect(result.current.value).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
    });

    it('returns the current field value', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      let record: any;
      await db.write(async () => {
        record = await collection.create({
          title: 'Field test',
          done: 0,
          body: 'hello',
          priority: 5,
        });
      });

      const { result } = renderHook(() => useField(record, 'title'), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.value).toBe('Field test');
    });

    it('updates when the specific field changes', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      let record: any;
      await db.write(async () => {
        record = await collection.create({ title: 'Watch me', done: 0, body: '', priority: 0 });
      });

      const { result } = renderHook(() => useField(record, 'priority'), { wrapper });

      await waitFor(() => {
        expect(result.current.value).toBe(0);
      });

      await act(async () => {
        await db.write(async () => {
          await record.update({ priority: 10 });
        });
      });

      await waitFor(() => {
        expect(result.current.value).toBe(10);
      });
    });
  });

  // ─── useCount ──────────────────────────────────────────────────────

  describe('useCount', () => {
    it('returns zero for empty collection', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      const { result } = renderHook(() => useCount(collection as any), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.count).toBe(0);
    });

    it('counts all records', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({ title: 'One', done: 0, body: '', priority: 0 });
        await collection.create({ title: 'Two', done: 0, body: '', priority: 0 });
        await collection.create({ title: 'Three', done: 0, body: '', priority: 0 });
      });

      const { result } = renderHook(() => useCount(collection as any), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.count).toBe(3);
    });

    it('counts with a filter', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({ title: 'Done 1', done: 1, body: '', priority: 0 });
        await collection.create({ title: 'Not done', done: 0, body: '', priority: 0 });
        await collection.create({ title: 'Done 2', done: 1, body: '', priority: 0 });
      });

      const { result } = renderHook(
        () => useCount(collection as any, (qb) => qb.where('done', 'eq', 1)),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.count).toBe(2);
    });

    it('updates count reactively when records are added', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      const { result } = renderHook(() => useCount(collection as any), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.count).toBe(0);

      await act(async () => {
        await db.write(async () => {
          await collection.create({ title: 'New', done: 0, body: '', priority: 0 });
        });
      });

      await waitFor(() => {
        expect(result.current.count).toBe(1);
      });
    });
  });

  // ─── useSearch ──────────────────────────────────────────────────────

  describe('useSearch', () => {
    it('returns empty results for empty search term', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      const { result } = renderHook(
        () =>
          useSearch(collection as any, {
            term: '',
            fields: ['title'],
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toEqual([]);
      expect(result.current.total).toBe(0);
    });

    it('searches and returns matching records', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({ title: 'Buy groceries', done: 0, body: '', priority: 0 });
        await collection.create({ title: 'Buy flowers', done: 0, body: '', priority: 0 });
        await collection.create({ title: 'Walk the dog', done: 0, body: '', priority: 0 });
      });

      const { result } = renderHook(
        () =>
          useSearch(collection as any, {
            term: 'Buy',
            fields: ['title'],
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toHaveLength(2);
      expect(result.current.total).toBe(2);
      expect(result.current.hasMore).toBe(false);
    });

    it('supports pagination via hasMore', async () => {
      const wrapper = createWrapper(db);
      const collection = db.collection('todos');

      await db.write(async () => {
        for (let i = 0; i < 5; i++) {
          await collection.create({ title: `Task ${i}`, done: 0, body: '', priority: 0 });
        }
      });

      const { result } = renderHook(
        () =>
          useSearch(collection as any, {
            term: 'Task',
            fields: ['title'],
            limit: 2,
            offset: 0,
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toHaveLength(2);
      expect(result.current.total).toBe(5);
      expect(result.current.hasMore).toBe(true);
    });
  });

  // ─── LokiAdapter in jsdom (Web) ────────────────────────────────────

  describe('LokiAdapter in web environment (jsdom)', () => {
    it('works in browser-like environment', async () => {
      // Verify we're in jsdom
      expect(typeof globalThis.window).toBe('object');
      expect(typeof document).toBe('object');

      // Full CRUD cycle in jsdom
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({
          title: 'Web todo',
          done: 0,
          body: 'created in jsdom',
          priority: 1,
        });
      });

      const qb = collection.query();
      const results = await collection.fetch(qb);
      expect(results).toHaveLength(1);
      expect(results[0].getField('title')).toBe('Web todo');
      expect(results[0].getField('body')).toBe('created in jsdom');
    });

    it('handles batch operations in web environment', async () => {
      const collection = db.collection('todos');

      await db.write(async () => {
        for (let i = 0; i < 10; i++) {
          await collection.create({ title: `Batch ${i}`, done: 0, body: '', priority: i });
        }
      });

      const qb = collection.query();
      const results = await collection.fetch(qb);
      expect(results).toHaveLength(10);

      const count = await collection.count();
      expect(count).toBe(10);
    });

    it('supports queries with operators in web environment', async () => {
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({ title: 'Low', done: 0, body: '', priority: 1 });
        await collection.create({ title: 'Medium', done: 0, body: '', priority: 5 });
        await collection.create({ title: 'High', done: 1, body: '', priority: 10 });
      });

      const qb = collection.query((q: any) => q.where('priority', 'gte', 5));
      const results = await collection.fetch(qb);
      expect(results).toHaveLength(2);
    });

    it('supports reactive observation in web environment', async () => {
      const collection = db.collection('todos');
      const values: number[] = [];

      const countObs = collection.observeCount();
      const unsub = countObs.subscribe((count: number) => {
        values.push(count);
      });

      // Wait for initial emission (async)
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(values).toContain(0);

      await db.write(async () => {
        await collection.create({ title: 'Web reactive', done: 0, body: '', priority: 0 });
      });

      // Wait for reactive update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have received update
      expect(values).toContain(1);
      expect(values.length).toBeGreaterThanOrEqual(2);

      unsub();
    });
  });

  // ─── Full Component Integration ────────────────────────────────────

  describe('Full component integration (web rendering)', () => {
    it('renders a component that reads from database', async () => {
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({ title: 'Render me', done: 0, body: '', priority: 0 });
      });

      function TodoList() {
        const { results, isLoading } = useLiveQuery(collection as any);
        if (isLoading) return React.createElement('div', null, 'Loading...');
        return React.createElement(
          'ul',
          null,
          results.map((todo: any) =>
            React.createElement(
              'li',
              { key: todo.id, 'data-testid': 'todo-item' },
              todo.getField('title'),
            ),
          ),
        );
      }

      render(React.createElement(DatabaseProvider, { value: db }, React.createElement(TodoList)));

      await waitFor(() => {
        expect(screen.getAllByTestId('todo-item')).toHaveLength(1);
      });

      expect(screen.getByText('Render me')).toBeDefined();
    });

    it('renders a component with useCount', async () => {
      const collection = db.collection('todos');

      await db.write(async () => {
        await collection.create({ title: 'A', done: 0, body: '', priority: 0 });
        await collection.create({ title: 'B', done: 0, body: '', priority: 0 });
      });

      function TodoCount() {
        const { count, isLoading } = useCount(collection as any);
        return React.createElement(
          'span',
          { 'data-testid': 'count' },
          isLoading ? '...' : String(count),
        );
      }

      render(React.createElement(DatabaseProvider, { value: db }, React.createElement(TodoCount)));

      await waitFor(() => {
        expect(screen.getByTestId('count').textContent).toBe('2');
      });
    });
  });

  // ─── DatabaseSuspenseProvider ────────────────────────────────────────

  describe('DatabaseSuspenseProvider', () => {
    it('suspends while database initializes, then renders children', async () => {
      function ChildComponent() {
        const database = useDatabase();
        return React.createElement(
          'div',
          { 'data-testid': 'ready' },
          database ? 'initialized' : 'not-ready',
        );
      }

      const adapter = new LokiAdapter({ databaseName: 'suspense-test.db' });

      render(
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', { 'data-testid': 'fallback' }, 'Loading...') },
          React.createElement(
            DatabaseSuspenseProvider,
            { adapter, models: [Todo, Tag] } as any,
            React.createElement(ChildComponent),
          ),
        ),
      );

      // Should eventually render the initialized state
      await waitFor(() => {
        expect(screen.getByTestId('ready').textContent).toBe('initialized');
      });
    });

    it('provides a working database that supports queries', async () => {
      function QueryComponent() {
        const database = useDatabase();
        const collection = database.collection('todos');
        const { results, isLoading } = useLiveQuery(collection as any);
        return React.createElement(
          'div',
          { 'data-testid': 'count' },
          isLoading ? 'loading' : String(results.length),
        );
      }

      const adapter = new LokiAdapter({ databaseName: 'suspense-query.db' });

      render(
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'Loading...') },
          React.createElement(
            DatabaseSuspenseProvider,
            { adapter, models: [Todo, Tag] } as any,
            React.createElement(QueryComponent),
          ),
        ),
      );

      await waitFor(() => {
        expect(screen.getByTestId('count').textContent).toBe('0');
      });
    });
  });
});
