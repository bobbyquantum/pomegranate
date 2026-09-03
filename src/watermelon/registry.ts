/**
 * Links core collections to their compat wrappers, so a `Model` constructed
 * by the core (which only knows the core collection) can find its compat
 * collection and database.
 */

import type { ModelCollectionRef } from '../model/Model';
import type { Collection } from './Collection';

const registry = new WeakMap<object, Collection>();

export function registerCompatCollection(core: ModelCollectionRef, compat: Collection): void {
  registry.set(core, compat);
}

export function compatCollectionFor(core: ModelCollectionRef): Collection | undefined {
  return registry.get(core);
}
