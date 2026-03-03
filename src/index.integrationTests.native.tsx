/**
 * React Native integration test entry point.
 *
 * Registers as a React Native app component that runs PomegranateDB
 * integration tests and reports results via the BridgeTestReporter
 * native module.
 */

import React from 'react';
import { AppRegistry, Text, View, NativeModules, StyleSheet, ScrollView } from 'react-native';

import { registerTests, runTests } from './integrationTests';
import type { TestReport } from './integrationTests';

function TestRunner() {
  const [status, setStatus] = React.useState<'running' | 'passed' | 'failed'>('running');
  const [report, setReport] = React.useState<TestReport | null>(null);
  const [logs, setLogs] = React.useState<string[]>([]);

  React.useEffect(() => {
    (async () => {
      // Register all tests (using LokiAdapter by default)
      registerTests();

      const result = await runTests((msg) => {
        console.log(msg);
        setLogs((prev) => [...prev, msg]);
      });

      setReport(result);
      setStatus(result.errorCount > 0 ? 'failed' : 'passed');

      // Report to native test runner
      try {
        NativeModules.BridgeTestReporter?.testsFinished({
          testCount: result.testCount,
          passCount: result.passCount,
          errorCount: result.errorCount,
          duration: result.duration,
          results: result.results.map((r) => ({
            passed: r.passed,
            message: r.message,
          })),
        });
      } catch (error) {
        console.warn('BridgeTestReporter not available:', error);
      }
    })();
  }, []);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>PomegranateDB Tests</Text>
      <Text
        style={[
          styles.status,
          status === 'passed' ? styles.pass : (status === 'failed' ? styles.fail : styles.running),
        ]}
      >
        {status === 'running'
          ? '⏳ Running...'
          : (status === 'passed'
            ? '✅ All tests passed'
            : '❌ Some tests failed')}
      </Text>
      {report && (
        <Text style={styles.summary}>
          {report.passCount}/{report.testCount} passed in {report.duration}ms
        </Text>
      )}
      {logs.map((log, i) => (
        <Text key={i} style={[styles.log, log.includes('✗') ? styles.fail : undefined]}>
          {log}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 60, backgroundColor: '#1a1a1a' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  status: { fontSize: 18, marginBottom: 4 },
  summary: { fontSize: 14, color: '#aaa', marginBottom: 16 },
  log: { fontSize: 12, color: '#ccc', fontFamily: 'monospace', marginBottom: 2 },
  pass: { color: '#4caf50' },
  fail: { color: '#f44336' },
  running: { color: '#ff9800' },
});

AppRegistry.registerComponent('pomegranateTest', () => TestRunner);
