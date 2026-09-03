/**
 * pomegranate-db/watermelon — React bindings (DatabaseProvider / useDatabase /
 * withDatabase) with @testing-library/react in jsdom.
 *
 * @jest-environment jsdom
 */

import { createElement } from 'react';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

import {
  m,
  Model,
  Q,
  Database,
  appSchema,
  tableSchema,
  LokiJSAdapter,
  DatabaseProvider,
  useDatabase,
  withDatabase,
} from '../watermelon';
import type { WatermelonSubscription } from '../watermelon';
import { useEffect, useState } from 'react';

const TaskSchema = m.model('tasks', { title: m.text('title') });
class Task extends Model<typeof TaskSchema> {
  static schema = TaskSchema;
  static table = 'tasks';
  get title(): string { return this.getField('title') as string; }
  set title(value: string) { this.setField('title', value); }
}

const schema = appSchema({
  version: 1,
  tables: [tableSchema({ name: 'tasks', columns: [{ name: 'title', type: 'string' }] })],
});

function createDatabase(): Database {
  return new Database({
    adapter: new LokiJSAdapter({ schema, dbName: `react-${Math.random()}`, useIncrementalIndexedDB: true }),
    modelClasses: [Task],
  });
}

describe('DatabaseProvider / useDatabase', () => {
  it('provides the compat Database to hooks', () => {
    const database = createDatabase();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(DatabaseProvider, { database }, children);
    const { result } = renderHook(() => useDatabase(), { wrapper });
    expect(result.current).toBe(database);
    expect(result.current.collections.get('tasks').table).toBe('tasks');
  });

  it('throws outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useDatabase())).toThrow(/useDatabase\(\) must be used within/);
    } finally {
      spy.mockRestore();
    }
  });

  it('drives a live query from a component and re-renders on writes', async () => {
    const database = createDatabase();

    function TaskList(): ReturnType<typeof createElement> {
      const db = useDatabase();
      const [titles, setTitles] = useState<string[] | null>(null);
      useEffect(() => {
        const subscription: WatermelonSubscription = db
          .get<Task>('tasks')
          .query(Q.sortBy('title', Q.asc))
          .observe()
          .subscribe((tasks) => setTitles(tasks.map((t) => t.title)));
        return () => subscription.unsubscribe();
      }, [db]);
      return createElement('ul', null, titles?.map((t) => createElement('li', { key: t }, t)) ?? 'loading');
    }

    render(createElement(DatabaseProvider, { database }, createElement(TaskList)));
    expect(screen.getByText('loading')).toBeTruthy();
    await act(() => database.ready);
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull());

    await act(() =>
      database.write(async () => {
        await database.get<Task>('tasks').create((t) => { t.title = 'Bravo'; });
        await database.get<Task>('tasks').create((t) => { t.title = 'Alpha'; });
      }),
    );
    await waitFor(() => expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Alpha', 'Bravo']));
  });

  it('withDatabase injects the database prop', () => {
    const database = createDatabase();
    const Inner = ({ database: db, label }: { database: Database; label: string }) =>
      createElement('span', null, `${label}:${db.schema.version}`);
    const Wrapped = withDatabase(Inner);
    render(createElement(DatabaseProvider, { database }, createElement(Wrapped, { label: 'v' })));
    expect(screen.getByText('v:1')).toBeTruthy();
    expect(Wrapped.displayName).toBe('withDatabase(Inner)');
  });
});
