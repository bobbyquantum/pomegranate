/**
 * WatermelonDB `Query<T>` — a lazily executed set of `Q` clauses bound to a
 * collection.
 */

import type { QueryBuilder } from '../query/QueryBuilder';
import type { QueryDescriptor } from '../query/types';
import type { Clause } from './Q';
import { applyClauses } from './Q';
import type { Collection } from './Collection';
import type { Model } from './Model';
import { WatermelonObservable } from './observable';

export class Query<T extends Model = Model> {
  readonly collection: Collection<T>;
  readonly clauses: readonly Clause[];

  constructor(collection: Collection<T>, clauses: readonly Clause[]) {
    this.collection = collection;
    this.clauses = Object.freeze([...clauses]);
  }

  /** The table this query runs against. */
  get table(): string {
    return this.collection.table;
  }

  /** The compiled core query descriptor (useful for debugging). */
  get description(): QueryDescriptor {
    return this.builder().build();
  }

  /** A new query with more clauses appended. */
  extend(...clauses: Array<Clause | readonly Clause[]>): Query<T> {
    // WatermelonDB accepts nested clause arrays (e.g. `query(clausesArray)`).
    const flat = clauses.flat() as Clause[];
    return new Query<T>(this.collection, [...this.clauses, ...flat]);
  }

  async fetch(): Promise<T[]> {
    await this.collection.database.ready;
    return this.collection.pomegranate.fetch(this.builder());
  }

  async fetchIds(): Promise<string[]> {
    const records = await this.fetch();
    return records.map((record) => record.id);
  }

  async fetchCount(): Promise<number> {
    await this.collection.database.ready;
    return this.collection.pomegranate.count(this.builder());
  }

  /** Emits the matching records, then again whenever the set/order of ids changes. */
  observe(): WatermelonObservable<T[]> {
    return WatermelonObservable.defer(async () => {
      await this.collection.database.ready;
      return this.collection.pomegranate.observeQuery(this.builder());
    });
  }

  /** Like `observe()`, but also re-emits when one of `columns` changes on a matched record. */
  observeWithColumns(columns: string[]): WatermelonObservable<T[]> {
    const cols = [...columns];
    return WatermelonObservable.defer(async () => {
      await this.collection.database.ready;
      return this.collection.pomegranate.observeQuery(this.builder(), { columns: cols });
    });
  }

  /** Emits the count, then again whenever it changes. `isThrottled` is accepted and ignored. */
  observeCount(_isThrottled?: boolean): WatermelonObservable<number> {
    return WatermelonObservable.defer(async () => {
      await this.collection.database.ready;
      return this.collection.pomegranate.observeCount(this.builder());
    });
  }

  /** Build the core query for these clauses (fresh each time — builders are mutable). */
  builder(): QueryBuilder {
    const qb = this.collection.pomegranate.query();
    applyClauses(qb, this.clauses);
    return qb;
  }
}
