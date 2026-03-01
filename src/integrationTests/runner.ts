/**
 * Lightweight integration test runner for native platforms.
 *
 * Provides describe/it/expect without pulling in Jest.
 * Reports results as a JSON payload suitable for the native bridge reporter.
 */

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

export interface TestReport {
  testCount: number;
  passCount: number;
  errorCount: number;
  duration: number;
  results: TestResult[];
}

type TestFn = () => Promise<void>;

interface TestCase {
  name: string;
  fn: TestFn;
}

interface TestSuite {
  name: string;
  tests: TestCase[];
  beforeEach?: TestFn;
  afterEach?: TestFn;
}

// ─── Global state ──────────────────────────────────────────────────────────

const _suites: TestSuite[] = [];
let _currentSuite: TestSuite | null = null;

// ─── DSL ───────────────────────────────────────────────────────────────────

export function describe(name: string, fn: () => void): void {
  const suite: TestSuite = { name, tests: [] };
  _suites.push(suite);
  _currentSuite = suite;
  fn();
  _currentSuite = null;
}

export function it(name: string, fn: TestFn): void {
  if (!_currentSuite) throw new Error('it() must be called inside describe()');
  _currentSuite.tests.push({ name, fn });
}

export function beforeEach(fn: TestFn): void {
  if (!_currentSuite) throw new Error('beforeEach() must be called inside describe()');
  _currentSuite.beforeEach = fn;
}

export function afterEach(fn: TestFn): void {
  if (!_currentSuite) throw new Error('afterEach() must be called inside describe()');
  _currentSuite.afterEach = fn;
}

// ─── Assertions ────────────────────────────────────────────────────────────

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export const expect = (actual: unknown) => ({
  toBe(expected: unknown) {
    if (actual !== expected)
      {throw new AssertionError(
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );}
  },
  toEqual(expected: unknown) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new AssertionError(`Expected deep equal:\n  expected: ${b}\n  got: ${a}`);
  },
  toBeTruthy() {
    if (!actual) throw new AssertionError(`Expected truthy, got ${JSON.stringify(actual)}`);
  },
  toBeFalsy() {
    if (actual) throw new AssertionError(`Expected falsy, got ${JSON.stringify(actual)}`);
  },
  toBeNull() {
    if (actual !== null) throw new AssertionError(`Expected null, got ${JSON.stringify(actual)}`);
  },
  toBeNotNull() {
    if (actual === null) throw new AssertionError('Expected non-null');
  },
  toBeGreaterThan(n: number) {
    if (typeof actual !== 'number' || actual <= n)
      {throw new AssertionError(`Expected ${actual} > ${n}`);}
  },
  toBeGreaterThanOrEqual(n: number) {
    if (typeof actual !== 'number' || actual < n)
      {throw new AssertionError(`Expected ${actual} >= ${n}`);}
  },
  toHaveLength(n: number) {
    const len = (actual as any)?.length;
    if (len !== n) throw new AssertionError(`Expected length ${n}, got ${len}`);
  },
  toContain(item: unknown) {
    if (!Array.isArray(actual) || !actual.includes(item))
      {throw new AssertionError(`Expected array to contain ${JSON.stringify(item)}`);}
  },
  toThrow() {
    if (typeof actual !== 'function') throw new AssertionError('Expected a function');
    try {
      (actual as () => void)();
      throw new AssertionError('Expected function to throw');
    } catch (error: unknown) {
      if (error instanceof AssertionError) throw error;
      // OK — it threw
    }
  },
  async toReject() {
    if (typeof actual !== 'function') throw new AssertionError('Expected an async function');
    try {
      await (actual as () => Promise<void>)();
      throw new AssertionError('Expected promise to reject');
    } catch (error: unknown) {
      if (error instanceof AssertionError) throw error;
      // OK — it rejected
    }
  },
});

// ─── Runner ────────────────────────────────────────────────────────────────

export async function runTests(onProgress?: (msg: string) => void): Promise<TestReport> {
  const results: TestResult[] = [];
  const totalStart = Date.now();

  for (const suite of _suites) {
    onProgress?.(`▶ ${suite.name}`);

    for (const test of suite.tests) {
      const fullName = `${suite.name} > ${test.name}`;
      const start = Date.now();

      try {
        if (suite.beforeEach) await suite.beforeEach();
        await test.fn();
        if (suite.afterEach) await suite.afterEach();

        results.push({
          name: fullName,
          passed: true,
          message: `✓ ${fullName}`,
          duration: Date.now() - start,
        });
        onProgress?.(`  ✓ ${test.name}`);
      } catch (error: any) {
        try {
          if (suite.afterEach) await suite.afterEach();
        } catch {}

        results.push({
          name: fullName,
          passed: false,
          message: `✗ ${fullName}: ${error?.message ?? String(error)}`,
          duration: Date.now() - start,
        });
        onProgress?.(`  ✗ ${test.name}: ${error?.message}`);
      }
    }
  }

  // Clear suites for potential re-run
  _suites.length = 0;

  const passCount = results.filter((r) => r.passed).length;

  return {
    testCount: results.length,
    passCount,
    errorCount: results.length - passCount,
    duration: Date.now() - totalStart,
    results,
  };
}
