/**
 * Utility functions: ID generation, timestamps, etc.
 */

let _idCounter = 0;

/**
 * Generate a unique ID suitable for record primary keys.
 * Uses a combination of timestamp + random to avoid collisions.
 * In production, you'd swap this for a proper UUID or CUID generator.
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  const counter = (_idCounter++).toString(36);
  return `${timestamp}${random}${counter}`;
}

/**
 * Current timestamp in milliseconds (epoch).
 */
export function now(): number {
  return Date.now();
}

/**
 * Sanitize a table name to prevent injection.
 */
export function sanitizeTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: "${name}"`);
  }
  return name;
}

/**
 * Sanitize a column name to prevent injection.
 */
export function sanitizeColumnName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid column name: "${name}"`);
  }
  return name;
}

/**
 * Convert a Date to epoch ms for storage.
 */
export function dateToTimestamp(date: Date | number | null): number | null {
  if (date === null) return null;
  if (typeof date === 'number') return date;
  return date.getTime();
}

/**
 * Convert epoch ms back to a Date.
 */
export function timestampToDate(ts: number | null): Date | null {
  if (ts === null) return null;
  return new Date(ts);
}

/**
 * Simple deep-freeze for objects (one level).
 */
export function freeze<T extends object>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

/**
 * Invariant — throws if condition is falsy.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}

/**
 * Logger (can be swapped out).
 */
export const logger = {
  warn(msg: string, ...args: unknown[]): void {
    console.warn(`[PomegranateDB] ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    console.error(`[PomegranateDB] ${msg}`, ...args);
  },
  debug(msg: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[PomegranateDB] ${msg}`, ...args);
    }
  },
};
