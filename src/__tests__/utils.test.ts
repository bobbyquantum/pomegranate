import {
  generateId,
  now,
  sanitizeTableName,
  sanitizeColumnName,
  dateToTimestamp,
  timestampToDate,
  freeze,
  invariant,
  logger,
} from '../utils';

describe('utils', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  describe('generateId', () => {
    it('returns unique ids even if timestamp and random are stable', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_709_765_432_100);
      jest.spyOn(Math, 'random').mockReturnValue(0.123_456_789);

      const first = generateId();
      const second = generateId();

      expect(first).not.toBe(second);
      expect(first).toContain(Date.now().toString(36));
      expect(second).toContain(Date.now().toString(36));
    });
  });

  describe('now', () => {
    it('returns the current epoch timestamp', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

      expect(now()).toBe(1_700_000_000_000);
    });
  });

  describe('sanitizeTableName', () => {
    it('allows safe SQL identifiers', () => {
      expect(sanitizeTableName('todos')).toBe('todos');
      expect(sanitizeTableName('_todo_items_2')).toBe('_todo_items_2');
    });

    it('rejects unsafe SQL identifiers', () => {
      expect(() => sanitizeTableName('2todos')).toThrow('Invalid table name: "2todos"');
      expect(() => sanitizeTableName('todo-items')).toThrow('Invalid table name: "todo-items"');
      expect(() => sanitizeTableName('todos;DROP TABLE users')).toThrow(
        'Invalid table name: "todos;DROP TABLE users"',
      );
    });
  });

  describe('sanitizeColumnName', () => {
    it('allows safe SQL identifiers', () => {
      expect(sanitizeColumnName('createdAt')).toBe('createdAt');
      expect(sanitizeColumnName('_priority_2')).toBe('_priority_2');
    });

    it('rejects unsafe SQL identifiers', () => {
      expect(() => sanitizeColumnName('created-at')).toThrow(
        'Invalid column name: "created-at"',
      );
      expect(() => sanitizeColumnName('priority desc')).toThrow(
        'Invalid column name: "priority desc"',
      );
    });
  });

  describe('dateToTimestamp', () => {
    it('converts dates and preserves primitive values', () => {
      const date = new Date('2024-01-02T03:04:05.678Z');

      expect(dateToTimestamp(date)).toBe(date.getTime());
      expect(dateToTimestamp(123)).toBe(123);
      expect(dateToTimestamp(null)).toBeNull();
    });
  });

  describe('timestampToDate', () => {
    it('converts timestamps back to dates', () => {
      const value = 1_704_164_645_678;

      expect(timestampToDate(value)).toEqual(new Date(value));
      expect(timestampToDate(null)).toBeNull();
    });
  });

  describe('freeze', () => {
    it('freezes and returns the same object', () => {
      const value = { name: 'todo' };
      const frozen = freeze(value);

      expect(frozen).toBe(value);
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(() => {
        (frozen as { name: string }).name = 'updated';
      }).toThrow(TypeError);
    });
  });

  describe('invariant', () => {
    it('does not throw for truthy values', () => {
      expect(() => invariant(true, 'should not fail')).not.toThrow();
      expect(() => invariant('value', 'should not fail')).not.toThrow();
    });

    it('throws a prefixed error for falsy values', () => {
      expect(() => invariant(0, 'missing value')).toThrow('Invariant violation: missing value');
    });
  });

  describe('logger', () => {
    it('prefixes warn and error messages', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      logger.warn('warned', { id: 1 });
      logger.error('failed', { id: 2 });

      expect(warnSpy).toHaveBeenCalledWith('[PomegranateDB] warned', { id: 1 });
      expect(errorSpy).toHaveBeenCalledWith('[PomegranateDB] failed', { id: 2 });
    });

    it('only logs debug messages in development', () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

      process.env.NODE_ENV = 'test';
      logger.debug('hidden');
      expect(debugSpy).not.toHaveBeenCalled();

      process.env.NODE_ENV = 'development';
      logger.debug('shown', 123);
      expect(debugSpy).toHaveBeenCalledWith('[PomegranateDB] shown', 123);
    });
  });
});