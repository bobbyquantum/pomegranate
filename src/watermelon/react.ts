/**
 * React bindings: `DatabaseProvider`, `useDatabase`, `withDatabase`.
 * Uses its own context so the compat `Database` (not the core one) is provided.
 */

import { createContext, createElement, useContext } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { Database } from './Database';

const DatabaseContext = createContext<Database | null>(null);

export interface DatabaseProviderProps {
  database: Database;
  children?: ReactNode;
}

export function DatabaseProvider({ database, children }: DatabaseProviderProps): ReactElement {
  if (!database) {
    throw new Error('DatabaseProvider requires a `database` prop');
  }
  return createElement(DatabaseContext.Provider, { value: database }, children);
}

export function useDatabase(): Database {
  const database = useContext(DatabaseContext);
  if (!database) {
    throw new Error(
      'useDatabase() must be used within a <DatabaseProvider database={…}> from pomegranate-db/watermelon',
    );
  }
  return database;
}

/** HOC injecting the `database` prop. */
export function withDatabase<P extends { database: Database }>(
  Component: ComponentType<P>,
): ComponentType<Omit<P, 'database'>> {
  function WithDatabase(props: Omit<P, 'database'>): ReactElement {
    const database = useDatabase();
    return createElement(Component, { ...props, database } as P);
  }
  WithDatabase.displayName = `withDatabase(${Component.displayName ?? Component.name ?? 'Component'})`;
  return WithDatabase;
}
