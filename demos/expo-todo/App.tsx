/**
 * PomegranateDB Expo Demo — Todo App
 *
 * Demonstrates: schema, models, CRUD, live queries, hooks, reactive observation.
 */
import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import {
  Text,
  View,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Keyboard,
  ScrollView,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  DatabaseSuspenseProvider,
  useLiveQuery,
  useDatabase,
  useCollection,
  useCount,
  LokiAdapter,
  SQLiteAdapter,
} from 'pomegranate-db';
import { Todo } from './src/database';
import {
  runBenchmarks,
  formatMs,
  formatOpsPerSec,
  type BenchmarkSuite,
} from '../shared/benchmarks';
import {
  styles,
  POMEGRANATE,
  GRAY_400,
} from '../shared/styles';

type Filter = 'all' | 'active' | 'completed';

// ─── Add Todo Input ────────────────────────────────────────────────────────

function AddTodo() {
  const db = useDatabase();
  const [title, setTitle] = useState('');
  const titleRef = useRef('');

  const handleChangeText = useCallback((text: string) => {
    titleRef.current = text;
    setTitle(text);
  }, []);

  const handleAdd = useCallback(async () => {
    const trimmed = titleRef.current.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    await db.write(async () => {
      await db.get(Todo).create({ title: trimmed, createdAt: new Date() });
    });
    titleRef.current = '';
    setTitle('');
  }, [db]);

  return (
    <View style={styles.inputCard}>
      <TextInput
        testID="todo-input"
        style={styles.input}
        placeholder="What needs to be done?"
        placeholderTextColor={GRAY_400}
        value={title}
        onChangeText={handleChangeText}
        onSubmitEditing={handleAdd}
        returnKeyType="done"
      />
      <Pressable
        testID="add-todo-btn"
        style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
        onPress={handleAdd}
      >
        <Text style={styles.addBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

// ─── Todo Item ─────────────────────────────────────────────────────────────

function TodoItem({ todo }: { todo: Todo }) {
  const db = useDatabase();
  const isCompleted = todo.getField('isCompleted') as boolean;
  const title = todo.getField('title') as string;

  const handleToggle = useCallback(async () => {
    await db.write(() => todo.toggleComplete());
  }, [db, todo]);

  const handleDelete = useCallback(async () => {
    await db.write(() => todo.destroyPermanently());
  }, [db, todo]);

  return (
    <View testID="todo-item" style={styles.todoRow}>
      <Pressable
        testID="todo-checkbox"
        onPress={handleToggle}
        style={({ pressed }) => [
          styles.checkbox,
          isCompleted && styles.checkboxDone,
          pressed && styles.checkboxPressed,
        ]}
      >
        {isCompleted && <Text style={styles.checkmark}>✓</Text>}
      </Pressable>
      <Text
        style={[styles.todoTitle, isCompleted && styles.todoTitleDone]}
        numberOfLines={2}
      >
        {title}
      </Text>
      <Pressable
        testID="todo-delete"
        onPress={handleDelete}
        style={({ pressed }) => [styles.deleteBtn, pressed && styles.deleteBtnPressed]}
        hitSlop={8}
      >
        <Text style={styles.deleteText}>✕</Text>
      </Pressable>
    </View>
  );
}

// ─── Filter Tabs ───────────────────────────────────────────────────────────

function FilterTabs({
  active,
  onChange,
}: {
  active: Filter;
  onChange: (f: Filter) => void;
}) {
  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Done' },
  ];

  return (
    <View style={styles.filterRow}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[styles.filterTab, active === tab.key && styles.filterTabActive]}
        >
          <Text
            style={[
              styles.filterTabText,
              active === tab.key && styles.filterTabTextActive,
            ]}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Todo List ─────────────────────────────────────────────────────────────

function TodoList() {
  const [filter, setFilter] = useState<Filter>('all');
  const collection = useCollection<Todo>(Todo);

  const { results: allTodos } = useLiveQuery<Todo>(collection);
  const { count: totalCount } = useCount<Todo>(collection);
  const { count: completedCount } = useCount<Todo>(collection, (qb) => {
    qb.where('isCompleted', 'eq', true);
  });

  const filtered =
    filter === 'all'
      ? allTodos
      : filter === 'completed'
        ? allTodos.filter((t) => t.getField('isCompleted'))
        : allTodos.filter((t) => !t.getField('isCompleted'));

  const activeCount = totalCount - completedCount;

  return (
    <View style={styles.listContainer}>
      <FilterTabs active={filter} onChange={setFilter} />

      <View style={styles.statsRow}>
        <Text testID="stats-text" style={styles.statsText}>
          {activeCount} remaining · {completedCount} done
        </Text>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>
            {filter === 'completed' ? '🎯' : filter === 'active' ? '🎉' : '📝'}
          </Text>
          <Text style={styles.emptyTitle}>
            {filter === 'completed'
              ? 'Nothing completed yet'
              : filter === 'active'
                ? 'All done!'
                : 'No todos yet'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {filter === 'all' ? 'Add one above to get started' : 'Switch filters or add more'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TodoItem todo={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Seed / Clear Buttons ──────────────────────────────────────────────────

function BottomActions() {
  const db = useDatabase();
  const collection = useCollection<Todo>(Todo);
  const { count } = useCount<Todo>(collection);

  const handleSeed = useCallback(async () => {
    const samples = [
      'Buy groceries 🛒',
      'Walk the dog 🐕',
      'Write PomegranateDB docs 📖',
      'Review pull requests 🔍',
      'Plan sprint 📋',
    ];
    await db.write(async () => {
      for (const t of samples) {
        await db.get(Todo).create({ title: t, createdAt: new Date() });
      }
    });
  }, [db]);

  const handleClearCompleted = useCallback(async () => {
    const collection = db.get(Todo);
    const completed = await collection.fetch(
      collection.query((qb) => qb.where('isCompleted', 'eq', true)),
    );
    if (completed.length === 0) return;
    await db.write(async () => {
      await db.batch(
        completed.map((t) => ({ type: 'destroyPermanently' as const, table: 'todos', id: t.id })),
      );
    });
  }, [db]);

  return (
    <View style={styles.bottomActions}>
      <Pressable
        testID="seed-btn"
        onPress={handleSeed}
        style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
      >
        <Text style={styles.actionBtnText}>+ Add samples</Text>
      </Pressable>

      {count > 0 && (
        <Pressable
          testID="clear-completed-btn"
          onPress={handleClearCompleted}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.actionBtnSecondary,
            pressed && styles.actionBtnPressed,
          ]}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnTextSecondary]}>
            Clear completed
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── DB Size / Download helpers ────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Query SQLite file size via PRAGMA page_count × page_size */
async function getDbFileSize(db: any): Promise<number | null> {
  try {
    const driver = db?._adapter?._driver;
    if (!driver?.query) return null;
    const [pc] = await driver.query('PRAGMA page_count');
    const [ps] = await driver.query('PRAGMA page_size');
    const pageCount = Number(pc?.page_count ?? pc?.['page_count'] ?? 0);
    const pageSize = Number(ps?.page_size ?? ps?.['page_size'] ?? 0);
    if (pageCount && pageSize) return pageCount * pageSize;
    return null;
  } catch {
    return null;
  }
}

/** List all files in OPFS (for debugging / download) */
async function listOpfsFiles(): Promise<{ name: string; handle: any; size: number }[]> {
  const root = await (navigator as any).storage.getDirectory();
  const files: { name: string; handle: any; size: number }[] = [];
  async function walk(dir: any, prefix: string) {
    for await (const [name, handle] of dir) {
      if (handle.kind === 'file') {
        const f = await handle.getFile();
        files.push({ name: prefix + name, handle, size: f.size });
      } else if (handle.kind === 'directory') {
        await walk(handle, prefix + name + '/');
      }
    }
  }
  await walk(root, '');
  return files;
}

// "SQLite format 3\0" magic header (first 16 bytes of every SQLite file)
const SQLITE_MAGIC = new Uint8Array([0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66,0x6f,0x72,0x6d,0x61,0x74,0x20,0x33,0x00]);

function findSqliteOffset(buf: ArrayBuffer): number {
  const u8 = new Uint8Array(buf);
  outer: for (let i = 0; i <= u8.length - SQLITE_MAGIC.length; i++) {
    for (let j = 0; j < SQLITE_MAGIC.length; j++) {
      if (u8[i + j] !== SQLITE_MAGIC[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Extract and download the SQLite database from OPFS.
 * wa-sqlite's OPFS VFS stores pages with a metadata prefix.
 * We find "SQLite format 3" in the largest file and slice from there.
 */
async function extractAndDownloadDb(
  setInfo: (s: string) => void,
): Promise<void> {
  if (Platform.OS !== 'web') return;
  try {
    const files = await listOpfsFiles();
    const listing = files.map((f) => `${f.name} (${formatBytes(f.size)})`).join('\n');

    const sorted = [...files].sort((a, b) => b.size - a.size);
    if (sorted.length === 0) {
      setInfo('No files in OPFS');
      return;
    }

    const main = sorted[0];
    const file = await main.handle.getFile();
    const buf = await file.arrayBuffer();
    const offset = findSqliteOffset(buf);

    if (offset < 0) {
      setInfo(`${listing}\n\nNo SQLite header found in ${main.name}`);
      return;
    }

    const dbBytes = buf.slice(offset);
    const blob = new Blob([dbBytes], { type: 'application/x-sqlite3' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pomegranate.db';
    a.click();
    URL.revokeObjectURL(a.href);

    setInfo(`${listing}\n\nExtracted ${formatBytes(dbBytes.byteLength)} from ${main.name} (offset ${offset})`);
  } catch (e: any) {
    setInfo(`Error: ${e?.message ?? e}`);
  }
}

// ─── Benchmark Panel ───────────────────────────────────────────────────────

function BenchmarkPanel() {
  const db = useDatabase();
  const [suite, setSuite] = useState<BenchmarkSuite | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [opfsInfo, setOpfsInfo] = useState('');

  const refreshSize = useCallback(async () => {
    setDbSize(await getDbFileSize(db));
  }, [db]);

  // Refresh size on mount and after each benchmark
  useEffect(() => { refreshSize(); }, [refreshSize]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setSuite(null);
    setProgress('Preparing…');
    try {
      const result = await runBenchmarks(
        db,
        Todo,
        ADAPTER_NAME,
        setProgress,
      );
      setSuite(result);
      await refreshSize();
    } catch (error) {
      setProgress(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [db]);

  const handleReset = useCallback(() => {
    Alert.alert('Reset Database', 'This will delete all data and re-create the database. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            await db.reset();
            setSuite(null);
            setProgress('Database reset ✓');
          } catch (error) {
            setProgress(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      },
    ]);
  }, [db]);

  const handleBulkInsert = useCallback(async () => {
    setRunning(true);
    setProgress('Inserting 500 todos…');
    try {
      await db.write(async () => {
        for (let i = 0; i < 500; i++) {
          await db.get(Todo).create({
            title: `Todo #${i + 1}`,
            isCompleted: i % 3 === 0,
            priority: i % 5,
            createdAt: new Date(),
          });
        }
      });
      setProgress('Inserted 500 todos ✓ (167 completed, 333 active)');
      await refreshSize();
    } catch (error) {
      setProgress(`Insert failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [db, refreshSize]);

  return (
    <ScrollView style={styles.benchContainer} contentContainerStyle={styles.benchContent}>
      <Text testID="benchmark-title" style={styles.benchTitle}>⚡ Database Benchmarks</Text>
      <Text style={styles.benchDesc}>
        Runs insert, query, update, and delete operations to measure adapter performance.
      </Text>

      {/* DB file size card */}
      <View style={styles.dbSizeCard}>
        <Text style={styles.dbSizeLabel}>Database size</Text>
        <Text style={styles.dbSizeValue}>
          {dbSize != null ? formatBytes(dbSize) : '—'}
        </Text>
        {Platform.OS === 'web' && (
          <Pressable
            onPress={() => extractAndDownloadDb(setOpfsInfo)}
            style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.downloadBtnText}>⬇ Download .db</Text>
          </Pressable>
        )}
      </View>
      {opfsInfo !== '' && (
        <Text style={styles.opfsInfo}>{opfsInfo}</Text>
      )}

      <Pressable
        testID="benchmark-btn"
        onPress={handleRun}
        disabled={running}
        style={({ pressed }) => [
          styles.benchButton,
          running && styles.benchButtonDisabled,
          pressed && !running && styles.benchButtonPressed,
        ]}
      >
        {running ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.benchButtonText}>Run Benchmarks</Text>
        )}
      </Pressable>

      <Pressable
        onPress={handleReset}
        disabled={running}
        style={({ pressed }) => [
          styles.benchButton,
          styles.benchResetButton,
          running && styles.benchButtonDisabled,
          pressed && !running && { opacity: 0.7 },
        ]}
      >
        <Text style={[styles.benchButtonText, styles.benchResetButtonText]}>🗑 Reset Database</Text>
      </Pressable>

      <Pressable
        onPress={handleBulkInsert}
        disabled={running}
        style={({ pressed }) => [
          styles.benchButton,
          styles.benchResetButton,
          running && styles.benchButtonDisabled,
          pressed && !running && { opacity: 0.7 },
        ]}
      >
        <Text style={[styles.benchButtonText, styles.benchResetButtonText]}>📦 Bulk Insert 500 Todos</Text>
      </Pressable>

      {(running || (!suite && progress)) && <Text style={styles.benchProgress}>{progress}</Text>}

      {suite && (
        <View testID="benchmark-complete" style={styles.benchResults}>
          <View style={styles.benchSummary}>
            <Text testID="benchmark-summary" style={styles.benchSummaryText}>
              {suite.adapter} — Total: {formatMs(suite.totalMs)}
            </Text>
          </View>

          {/* Table header */}
          <View style={styles.benchTableRow}>
            <Text style={[styles.benchTableCell, styles.benchTableHeader, { flex: 2 }]}>Operation</Text>
            <Text style={[styles.benchTableCell, styles.benchTableHeader]}>Total</Text>
            <Text style={[styles.benchTableCell, styles.benchTableHeader]}>Avg</Text>
            <Text style={[styles.benchTableCell, styles.benchTableHeader]}>ops/s</Text>
          </View>

          {/* Table rows */}
          {suite.results.map((r, i) => (
            <View
              key={r.name}
              style={[styles.benchTableRow, i % 2 === 0 && styles.benchTableRowAlt]}
            >
              <Text style={[styles.benchTableCell, { flex: 2 }]} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={styles.benchTableCell}>{formatMs(r.totalMs)}</Text>
              <Text style={styles.benchTableCell}>{formatMs(r.avgMs)}</Text>
              <Text style={[styles.benchTableCell, styles.benchOps]}>
                {formatOpsPerSec(r.opsPerSec)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header() {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.logoSquircle}>
          <Image source={require('./assets/logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={styles.headerTextGroup}>
          <Text style={styles.headerTitle}>PomegranateDB</Text>
          <Text style={styles.headerSubtitle}>Reactive offline-first database</Text>
        </View>
      </View>
      <View style={styles.adapterBadge}>
        <Text style={styles.adapterBadgeText}>{ADAPTER_NAME}</Text>
      </View>
    </View>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────

type Tab = 'todos' | 'benchmarks';

function MainApp() {
  const [tab, setTab] = useState<Tab>('todos');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <Header />

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <Pressable
          testID="tab-todos"
          onPress={() => setTab('todos')}
          style={[styles.tab, tab === 'todos' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'todos' && styles.tabTextActive]}>📝 Todos</Text>
        </Pressable>
        <Pressable
          testID="tab-benchmarks"
          onPress={() => setTab('benchmarks')}
          style={[styles.tab, tab === 'benchmarks' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'benchmarks' && styles.tabTextActive]}>⚡ Benchmarks</Text>
        </Pressable>
      </View>

      {tab === 'todos' ? (
        <>
          <AddTodo />
          <TodoList />
          <BottomActions />
        </>
      ) : (
        <BenchmarkPanel />
      )}
    </SafeAreaView>
  );
}

// ─── Database setup (stable reference, outside render) ─────────────────────
//
// Adapter is selected by the EXPO_PUBLIC_ADAPTER env var:
//   loki-idb           LokiAdapter + IndexedDB (web default)
//   loki-memory        LokiAdapter, no persistence (native default)
//   expo-sqlite        SQLiteAdapter + expo-sqlite async (iOS / Android / web)
//   expo-sqlite-sync   SQLiteAdapter + expo-sqlite sync JSI (iOS / Android only)
//   op-sqlite          SQLiteAdapter + op-sqlite sync (iOS / Android only)
//   op-sqlite-async    SQLiteAdapter + op-sqlite async (iOS / Android only)
//   native-sqlite      SQLiteAdapter + JSI bridge (iOS / Android only)

function createAdapter(): { adapter: LokiAdapter | SQLiteAdapter; name: string } {
  const variant =
    process.env.EXPO_PUBLIC_ADAPTER ??
    (Platform.OS === 'web' ? 'loki-idb' : 'loki-memory');

  if (variant === 'expo-sqlite') {
    // Requires expo-sqlite: npx expo install expo-sqlite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createExpoSQLiteDriver } = require('pomegranate-db/expo');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-demo',
        driver: createExpoSQLiteDriver(),
      }),
      name: 'ExpoSQLite (async)',
    };
  }

  if (variant === 'expo-sqlite-sync') {
    // Sync JSI path — faster on native, no web support
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createExpoSQLiteDriver } = require('pomegranate-db/expo');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-demo',
        driver: createExpoSQLiteDriver({ preferSync: true }),
      }),
      name: 'ExpoSQLite (sync)',
    };
  }

  if (variant === 'op-sqlite') {
    // Requires @op-engineering/op-sqlite (native only, no web)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpSQLiteDriver } = require('pomegranate-db/op-sqlite');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-demo',
        driver: createOpSQLiteDriver(),
      }),
      name: 'OpSQLite (sync)',
    };
  }

  if (variant === 'op-sqlite-async') {
    // Async path — dispatches to worker thread, slightly slower per-op
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpSQLiteDriver } = require('pomegranate-db/op-sqlite');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-demo',
        driver: createOpSQLiteDriver({ preferSync: false }),
      }),
      name: 'OpSQLite (async)',
    };
  }

  if (variant === 'native-sqlite') {
    // PomegranateDB's own JSI C++ bridge (native only, no web)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createNativeSQLiteDriver } = require('pomegranate-db/native-sqlite');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-demo',
        driver: createNativeSQLiteDriver(),
      }),
      name: 'NativeSQLite (JSI)',
    };
  }

  if (variant === 'loki-idb') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IncrementalIDBAdapter = require('lokijs/src/incremental-indexeddb-adapter');
    return {
      adapter: new LokiAdapter({
        databaseName: 'pomegranate-demo',
        persistenceAdapter: new IncrementalIDBAdapter(),
      }),
      name: 'Loki + IndexedDB',
    };
  }

  // loki-memory (native default): pure in-memory, works on all platforms
  return {
    adapter: new LokiAdapter({ databaseName: 'pomegranate-demo' }),
    name: 'Loki (memory)',
  };
}

const { adapter, name: ADAPTER_NAME } = createAdapter();

export default function App() {
  return (
    <SafeAreaProvider>
      <Suspense
        fallback={
          <View style={styles.splash}>
            <Image
              source={require('./assets/logo.png')}
              style={styles.splashLogo}
              resizeMode="contain"
            />
            <ActivityIndicator size="large" color={POMEGRANATE} style={{ marginTop: 24 }} />
            <Text style={styles.splashText}>Loading database…</Text>
          </View>
        }
      >
        <DatabaseSuspenseProvider adapter={adapter} models={[Todo]}>
          <MainApp />
        </DatabaseSuspenseProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}

