/**
 * React hooks for PomegranateDB.
 *
 * Provides reactive hooks that subscribe to database observables
 * and re-render components when data changes.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Collection } from '../collection/Collection';
import type { Model } from '../model/Model';
import type { QueryBuilder } from '../query/QueryBuilder';
import type { Observable, Unsubscribe } from '../observable/Subject';

// ─── useObservable ─────────────────────────────────────────────────────────

/**
 * Subscribe to any Observable and return its latest value.
 */
export function useObservable<T>(observable: Observable<T> | null | undefined, initialValue: T): T {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    if (!observable) return;

    const unsub = observable.subscribe((v) => {
      setValue(v);
    });

    return unsub;
  }, [observable]);

  return value;
}

// ─── useLiveQuery ──────────────────────────────────────────────────────────

/**
 * Execute a query and subscribe to live updates.
 * Re-runs the query whenever the collection changes.
 */
export function useLiveQuery<M extends Model>(
  collection: Collection<M> | null | undefined,
  buildQuery?: (qb: QueryBuilder) => void,
  deps: unknown[] = [],
): { results: M[]; isLoading: boolean } {
  const [results, setResults] = useState<M[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!collection) return;

    setIsLoading(true);

    const qb = buildQuery ? collection.query(buildQuery) : collection.query();
    const observable = collection.observeQuery(qb);

    const unsub = observable.subscribe((records) => {
      setResults(records);
      setIsLoading(false);
    });

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, ...deps]);

  return { results, isLoading };
}

// ─── useById ──────────────────────────────────────────────────────────────

/**
 * Observe a single record by ID.
 * Returns null if not found, undefined while loading.
 */
export function useById<M extends Model>(
  collection: Collection<M> | null | undefined,
  id: string | null | undefined,
): { record: M | null | undefined; isLoading: boolean } {
  const [record, setRecord] = useState<M | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!collection || !id) {
      setRecord(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const observable = collection.observeById(id);
    const unsub = observable.subscribe((r) => {
      setRecord(r);
      setIsLoading(false);
    });

    return unsub;
  }, [collection, id]);

  return { record, isLoading };
}

// ─── useField ─────────────────────────────────────────────────────────────

/**
 * Observe a specific field on a record.
 * Only re-renders when that field changes.
 */
export function useField<M extends Model>(
  record: M | null | undefined,
  fieldName: string,
): { value: unknown; isLoading: boolean } {
  const [value, setValue] = useState<unknown>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!record) {
      setValue(undefined);
      setIsLoading(false);
      return;
    }

    // Get initial value
    try {
      setValue(record.getField(fieldName));
      setIsLoading(false);
    } catch {
      setIsLoading(false);
    }

    const observable = record.observeField(fieldName);
    const unsub = observable.subscribe((v) => {
      setValue(v);
      setIsLoading(false);
    });

    return unsub;
  }, [record, fieldName]);

  return { value, isLoading };
}

// ─── useSearch ────────────────────────────────────────────────────────────

export interface UseSearchOptions {
  term: string;
  fields: string[];
  limit?: number;
  offset?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
  extend?: (qb: QueryBuilder) => void;
}

export interface UseSearchResult<M extends Model> {
  results: M[];
  total: number;
  isLoading: boolean;
  hasMore: boolean;
}

/**
 * Full-text search with pagination and live results.
 */
export function useSearch<M extends Model>(
  collection: Collection<M> | null | undefined,
  options: UseSearchOptions,
  deps: unknown[] = [],
): UseSearchResult<M> {
  const [results, setResults] = useState<M[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  useEffect(() => {
    if (!collection || !options.term) {
      setResults([]);
      setTotal(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    const doSearch = async () => {
      try {
        const result = await collection.search({
          term: options.term,
          fields: options.fields,
          limit,
          offset,
          orderBy: options.orderBy,
          extend: options.extend,
        });

        if (!cancelled) {
          setResults(result.records);
          setTotal(result.total);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    doSearch();

    // Re-run search when collection changes
    const unsub = collection.changes$.subscribe(() => {
      doSearch();
    });

    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, options.term, options.fields.join(','), limit, offset, ...deps]);

  const hasMore = offset + limit < total;

  return { results, total, isLoading, hasMore };
}

// ─── useCount ─────────────────────────────────────────────────────────────

/**
 * Observe the count of records matching a query.
 */
export function useCount<M extends Model>(
  collection: Collection<M> | null | undefined,
  buildQuery?: (qb: QueryBuilder) => void,
  deps: unknown[] = [],
): { count: number; isLoading: boolean } {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!collection) return;

    setIsLoading(true);

    const qb = buildQuery ? collection.query(buildQuery) : collection.query();
    const observable = collection.observeCount(qb);

    const unsub = observable.subscribe((c) => {
      setCount(c);
      setIsLoading(false);
    });

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, ...deps]);

  return { count, isLoading };
}

// ─── DatabaseProvider ──────────────────────────────────────────────────────

import { createContext, useContext, createElement, type ReactNode } from 'react';
import type { Database } from '../database/Database';
import type { DatabaseConfig } from '../database/Database';

const DatabaseContext = createContext<Database | null>(null);

/**
 * Provide a Database instance to the React tree.
 */
export const DatabaseProvider = DatabaseContext.Provider;

/**
 * Get the Database instance from context.
 */
export function useDatabase(): Database {
  const db = useContext(DatabaseContext);
  if (!db) {
    throw new Error(
      'useDatabase() must be used within a <DatabaseProvider>. ' +
        'Wrap your app with <DatabaseProvider value={db}>.',
    );
  }
  return db;
}

/**
 * Get a collection by model class from context.
 */
export function useCollection<M extends Model>(modelClass: {
  schema: { table: string };
}): Collection<M> {
  const db = useDatabase();
  return db.collection(modelClass.schema.table) as Collection<M>;
}

// ─── DatabaseSuspenseProvider ──────────────────────────────────────────────

/**
 * Status of an async database initialization resource.
 * Used internally by DatabaseSuspenseProvider.
 */
type ResourceStatus<T> =
  | { state: 'pending'; promise: Promise<void> }
  | { state: 'resolved'; value: T }
  | { state: 'rejected'; error: unknown };

/**
 * Create a Suspense-compatible resource that initializes a Database.
 * Follows the React Suspense "throw a promise" contract:
 * - First call: throws a promise (React suspends)
 * - After resolved: returns the Database
 * - On error: throws the error (React error boundary catches it)
 */
function createDatabaseResource(config: DatabaseConfig): { read(): Database } {
  const { Database: DB } = require('../database/Database');
  const db = new DB(config);

  let status: ResourceStatus<Database> = {
    state: 'pending',
    promise: db.initialize().then(
      () => {
        status = { state: 'resolved', value: db };
      },
      (error: unknown) => {
        status = { state: 'rejected', error: error };
      },
    ),
  };

  return {
    read(): Database {
      switch (status.state) {
        case 'pending':
          throw status.promise;
        case 'rejected':
          throw status.error;
        case 'resolved':
          return status.value;
      }
    },
  };
}

/**
 * Props for DatabaseSuspenseProvider.
 */
export interface DatabaseSuspenseProviderProps extends DatabaseConfig {
  children: ReactNode;
}

// Cache to avoid re-creating the resource on re-render
const resourceCache = new WeakMap<object, ReturnType<typeof createDatabaseResource>>();

/**
 * A Suspense-compatible database provider.
 *
 * Creates and initializes a Database, suspending the component tree until
 * the database is ready. Wrap with `<Suspense fallback={...}>` to show
 * a loading state.
 *
 * @example
 * ```tsx
 * import { Suspense } from 'react';
 * import { DatabaseSuspenseProvider, useLiveQuery } from 'pomegranate-db';
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<Text>Preparing database...</Text>}>
 *       <DatabaseSuspenseProvider
 *         adapter={new LokiAdapter({ databaseName: 'myapp' })}
 *         models={[Post, Comment]}
 *       >
 *         <MyApp />
 *       </DatabaseSuspenseProvider>
 *     </Suspense>
 *   );
 * }
 * ```
 */
export function DatabaseSuspenseProvider({
  children,
  ...config
}: DatabaseSuspenseProviderProps): ReactNode {
  // Use the adapter as cache key — stable across re-renders
  const cacheKey = config.adapter as object;
  let resource = resourceCache.get(cacheKey);
  if (!resource) {
    resource = createDatabaseResource(config);
    resourceCache.set(cacheKey, resource);
  }

  const db = resource.read(); // Suspends if not ready

  return createElement(DatabaseProvider, { value: db }, children);
}
