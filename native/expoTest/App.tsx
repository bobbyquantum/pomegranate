/**
 * Expo integration test app entry point.
 *
 * Uses ExpoSQLiteDriver to exercise PomegranateDB on a real SQLite
 * database via expo-sqlite, then falls back to LokiAdapter if
 * expo-sqlite is unavailable.
 */

import React from 'react';
import { Text, View, ScrollView, StyleSheet } from 'react-native';
import { registerTests, runTests } from 'pomegranate-db/src/integrationTests';
import { LokiAdapter } from 'pomegranate-db/src/adapters/loki/LokiAdapter';
import type { TestReport } from 'pomegranate-db/src/integrationTests';

// Try to import expo-sqlite driver
let createAdapter: () => any;
try {
  const { createExpoSQLiteDriver } = require('pomegranate-db/src/adapters/expo-sqlite');
  createAdapter = () => createExpoSQLiteDriver({ databaseName: 'expo-integration-test.db' });
  console.log('[PomegranateDB] Using ExpoSQLiteDriver');
} catch {
  createAdapter = () => new LokiAdapter({ databaseName: 'expo-integration-test' });
  console.log('[PomegranateDB] Falling back to LokiAdapter');
}

export default function App() {
  const [status, setStatus] = React.useState<'running' | 'passed' | 'failed'>('running');
  const [report, setReport] = React.useState<TestReport | null>(null);
  const [logs, setLogs] = React.useState<string[]>([]);

  React.useEffect(() => {
    (async () => {
      registerTests(createAdapter);

      const result = await runTests((msg) => {
        console.log(msg);
        setLogs((prev) => [...prev, msg]);
      });

      setReport(result);
      setStatus(result.errorCount > 0 ? 'failed' : 'passed');

      console.log(`\n${'='.repeat(60)}`);
      console.log(`PomegranateDB Expo Integration Tests: ${result.errorCount === 0 ? 'PASSED' : 'FAILED'}`);
      console.log(`${result.passCount}/${result.testCount} passed in ${result.duration}ms`);
      console.log(`${'='.repeat(60)}\n`);
    })();
  }, []);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>PomegranateDB Expo Tests</Text>
      <Text style={[styles.status, status === 'passed' ? styles.pass : status === 'failed' ? styles.fail : styles.running]}>
        {status === 'running' ? '⏳ Running...' : status === 'passed' ? '✅ All tests passed' : '❌ Some tests failed'}
      </Text>
      {report && (
        <Text style={styles.summary}>
          {report.passCount}/{report.testCount} passed in {report.duration}ms
        </Text>
      )}
      <View style={styles.logContainer}>
        {logs.map((log, i) => (
          <Text key={i} style={[styles.log, log.includes('✗') ? styles.fail : undefined]}>
            {log}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 60, backgroundColor: '#1a1a1a' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  status: { fontSize: 18, marginBottom: 4 },
  summary: { fontSize: 14, color: '#aaa', marginBottom: 16 },
  logContainer: { paddingBottom: 40 },
  log: { fontSize: 11, color: '#ccc', fontFamily: 'monospace', marginBottom: 2 },
  pass: { color: '#4caf50' },
  fail: { color: '#f44336' },
  running: { color: '#ff9800' },
});
