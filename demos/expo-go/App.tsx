/**
 * PomegranateDB — Expo Go Demo
 *
 * This demo runs **inside Expo Go** with no custom native build.
 * It uses the expo-sqlite adapter, which ships inside Expo Go.
 *
 * Usage:
 *   cd demos/expo-go
 *   npm install
 *   npx expo start          # scan QR with Expo Go on your phone
 */
import React, { useState, useCallback, useEffect, Suspense } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
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
  SQLiteAdapter,
  LokiAdapter,
  m,
  Model,
} from 'pomegranate-db';
import { createExpoSQLiteDriver } from 'pomegranate-db/expo';
import {
  runBenchmarks,
  formatMs,
  formatOpsPerSec,
  type BenchmarkSuite,
} from '../shared/benchmarks';

// ─── Schema & Model ────────────────────────────────────────────────────────

const TodoSchema = m.model('todos', {
  title: m.text(),
  isCompleted: m.boolean().default(false),
  priority: m.number().default(0),
  notes: m.text().optional(),
  createdAt: m.date('created_at').readonly(),
});

class Todo extends Model<typeof TodoSchema> {
  static schema = TodoSchema;

  toggleComplete = this.writer(async () => {
    const current = this.getField('isCompleted');
    await this.update({ isCompleted: !current });
  });
}

// ─── Colors ────────────────────────────────────────────────────────────────

const POMEGRANATE = '#c0392b';
const POMEGRANATE_LIGHT = '#e74c3c';
const POMEGRANATE_FAINT = '#fdf0ef';
const GRAY_50 = '#fafafa';
const GRAY_100 = '#f5f5f5';
const GRAY_200 = '#eeeeee';
const GRAY_400 = '#bdbdbd';
const GRAY_500 = '#9e9e9e';
const GRAY_700 = '#616161';
const GRAY_900 = '#212121';

type Filter = 'all' | 'active' | 'completed';

// ─── Add Todo ──────────────────────────────────────────────────────────────

function AddTodo() {
  const db = useDatabase();
  const [title, setTitle] = useState('');

  const handleAdd = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await db.write(async () => {
      await db.get(Todo).create({ title: trimmed, createdAt: new Date() });
    });
    setTitle('');
  }, [db, title]);

  return (
    <View style={styles.inputCard}>
      <TextInput
        style={styles.input}
        placeholder="What needs to be done?"
        placeholderTextColor={GRAY_400}
        value={title}
        onChangeText={setTitle}
        onSubmitEditing={handleAdd}
        returnKeyType="done"
      />
      <Pressable
        style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
        onPress={handleAdd}
        accessibilityLabel="Add todo"
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
    <View style={styles.todoRow}>
      <Pressable
        onPress={handleToggle}
        style={({ pressed }) => [
          styles.checkbox,
          isCompleted && styles.checkboxDone,
          pressed && styles.checkboxPressed,
        ]}
      >
        {isCompleted && <Text style={styles.checkmark}>✓</Text>}
      </Pressable>
      <Text style={[styles.todoTitle, isCompleted && styles.todoTitleDone]} numberOfLines={2}>
        {title}
      </Text>
      <Pressable
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

function FilterTabs({ active, onChange }: { active: Filter; onChange: (f: Filter) => void }) {
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
          <Text style={[styles.filterTabText, active === tab.key && styles.filterTabTextActive]}>
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
        <Text style={styles.statsText}>
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

// ─── Seed / Clear ──────────────────────────────────────────────────────────

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
    const col = db.get(Todo);
    const completed = await col.fetch(col.query((qb) => qb.where('isCompleted', 'eq', true)));
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
        onPress={handleSeed}
        style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
      >
        <Text style={styles.actionBtnText}>+ Add samples</Text>
      </Pressable>

      {count > 0 && (
        <Pressable
          onPress={handleClearCompleted}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.actionBtnSecondary,
            pressed && styles.actionBtnPressed,
          ]}
        >
          <Text style={[styles.actionBtnText, styles.actionBtnTextSecondary]}>Clear completed</Text>
        </Pressable>
      )}
    </View>
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

/** Download all OPFS files as a single zip-like bundle, or individually */
async function downloadDb(): Promise<void> {
  if (Platform.OS !== 'web') return;
  try {
    const files = await listOpfsFiles();
    console.log('[OPFS] files:', files.map((f) => `${f.name} (${f.size})`));
    if (files.length === 0) {
      (window as any).alert('No files found in OPFS'); // eslint-disable-line no-alert
      return;
    }
    // Download each file
    for (const { name, handle } of files) {
      const file = await handle.getFile();
      const blob = new Blob([await file.arrayBuffer()]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name.replace(/\//g, '_');
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (e) {
    console.error('Download failed', e);
  }
}

// ─── Benchmark Panel ───────────────────────────────────────────────────────

function BenchmarkPanel() {
  const db = useDatabase();
  const [suite, setSuite] = useState<BenchmarkSuite | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [dbSize, setDbSize] = useState<number | null>(null);

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
            onPress={downloadDb}
            style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.downloadBtnText}>⬇ Download .db</Text>
          </Pressable>
        )}
      </View>

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

// ─── Main ──────────────────────────────────────────────────────────────────

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

// ─── Database setup ────────────────────────────────────────────────────────
//
// Adapter is selected by EXPO_PUBLIC_ADAPTER env var:
//   expo-sqlite       SQLiteAdapter + expo-sqlite async (default — works in Expo Go)
//   expo-sqlite-sync  SQLiteAdapter + expo-sqlite sync JSI (native only)
//   loki-memory       LokiAdapter, no persistence
//   loki-idb          LokiAdapter + IndexedDB (web only)

function createAdapter(): { adapter: SQLiteAdapter | LokiAdapter; name: string } {
  const variant = process.env.EXPO_PUBLIC_ADAPTER ?? 'expo-sqlite';

  if (variant === 'expo-sqlite-sync') {
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-expo-go-demo',
        driver: createExpoSQLiteDriver({ preferSync: true }),
      }),
      name: 'ExpoSQLite (sync)',
    };
  }

  if (variant === 'loki-idb') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IncrementalIDBAdapter = require('lokijs/src/incremental-indexeddb-adapter');
    return {
      adapter: new LokiAdapter({
        databaseName: 'pomegranate-expo-go-demo',
        persistenceAdapter: new IncrementalIDBAdapter(),
      }),
      name: 'Loki + IndexedDB',
    };
  }

  if (variant === 'loki-memory') {
    return {
      adapter: new LokiAdapter({ databaseName: 'pomegranate-expo-go-demo' }),
      name: 'Loki (memory)',
    };
  }

  // Default: expo-sqlite async
  return {
    adapter: new SQLiteAdapter({
      databaseName: 'pomegranate-expo-go-demo',
      driver: createExpoSQLiteDriver(),
    }),
    name: 'ExpoSQLite (async)',
  };
}

const { adapter, name: ADAPTER_NAME } = createAdapter();

export default function App() {
  return (
    <SafeAreaProvider>
      <Suspense
        fallback={
          <View style={styles.splash}>
            <Image source={require('./assets/logo.png')} style={styles.splashLogo} resizeMode="contain" />
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

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GRAY_50 },

  // Header
  header: {
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 20,
    backgroundColor: POMEGRANATE,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoSquircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 10,
  },
  headerTextGroup: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  adapterBadge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  adapterBadgeText: {
    color: 'rgba(255,255,255,0.90)',
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: GRAY_200,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: POMEGRANATE,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: GRAY_500,
  },
  tabTextActive: {
    color: POMEGRANATE,
  },

  // Input
  inputCard: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: GRAY_200,
  },
  input: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderColor: GRAY_200,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    backgroundColor: GRAY_100,
    color: GRAY_900,
  },
  addBtn: {
    marginLeft: 10,
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: POMEGRANATE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnPressed: { backgroundColor: POMEGRANATE_LIGHT },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: '600', lineHeight: 26 },

  // Filters
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 8 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: GRAY_100 },
  filterTabActive: { backgroundColor: POMEGRANATE_FAINT },
  filterTabText: { fontSize: 13, fontWeight: '600', color: GRAY_500 },
  filterTabTextActive: { color: POMEGRANATE },

  // Stats
  statsRow: { paddingHorizontal: 20, paddingVertical: 8 },
  statsText: {
    fontSize: 12,
    color: GRAY_500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },

  // List
  listContainer: { flex: 1 },
  list: { paddingBottom: 20 },

  // Todo row
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 6,
    borderRadius: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: GRAY_400,
    marginRight: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxDone: { backgroundColor: POMEGRANATE, borderColor: POMEGRANATE },
  checkboxPressed: { opacity: 0.7 },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  todoTitle: { flex: 1, fontSize: 16, color: GRAY_900, lineHeight: 22 },
  todoTitleDone: { textDecorationLine: 'line-through', color: GRAY_400 },
  deleteBtn: { padding: 4, marginLeft: 8 },
  deleteBtnPressed: { opacity: 0.5 },
  deleteText: { fontSize: 16, color: GRAY_400, fontWeight: '500' },

  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: GRAY_700 },
  emptySubtitle: { fontSize: 14, color: GRAY_500, marginTop: 4 },

  // Bottom actions
  bottomActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: GRAY_200,
    backgroundColor: '#fff',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: POMEGRANATE_FAINT,
    alignItems: 'center',
  },
  actionBtnSecondary: { backgroundColor: GRAY_100 },
  actionBtnPressed: { opacity: 0.7 },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: POMEGRANATE },
  actionBtnTextSecondary: { color: GRAY_700 },

  // Splash
  splash: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  splashLogo: { width: 80, height: 80 },
  splashText: { marginTop: 16, fontSize: 15, color: GRAY_500 },

  // Benchmark panel
  benchContainer: { flex: 1, backgroundColor: GRAY_50 },
  benchContent: { padding: 20, paddingBottom: 40 },
  benchTitle: { fontSize: 22, fontWeight: '700', color: GRAY_900, marginBottom: 6 },
  benchDesc: { fontSize: 14, color: GRAY_500, marginBottom: 20, lineHeight: 20 },
  benchButton: {
    backgroundColor: POMEGRANATE,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  benchButtonDisabled: { opacity: 0.6 },
  benchButtonPressed: { backgroundColor: POMEGRANATE_LIGHT },
  benchButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  benchResetButton: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: GRAY_400, marginBottom: 8 },
  benchResetButtonText: { color: GRAY_700, fontSize: 14 },
  dbSizeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: GRAY_200,
  },
  dbSizeLabel: { fontSize: 13, color: GRAY_500, fontWeight: '600', marginRight: 8 },
  dbSizeValue: { fontSize: 15, fontWeight: '700', color: GRAY_900, flex: 1 },
  downloadBtn: {
    backgroundColor: POMEGRANATE_FAINT,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  downloadBtnText: { fontSize: 12, fontWeight: '700', color: POMEGRANATE },
  benchProgress: { fontSize: 13, color: GRAY_500, textAlign: 'center', marginBottom: 12 },
  benchResults: { marginTop: 8 },
  benchSummary: {
    backgroundColor: POMEGRANATE_FAINT,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  benchSummaryText: { fontSize: 15, fontWeight: '700', color: POMEGRANATE, textAlign: 'center' },
  benchTableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_200,
  },
  benchTableRowAlt: { backgroundColor: GRAY_100 },
  benchTableCell: { flex: 1, fontSize: 12, color: GRAY_700 },
  benchTableHeader: { fontWeight: '700', color: GRAY_900, fontSize: 11, textTransform: 'uppercase' },
  benchOps: { fontWeight: '700', color: POMEGRANATE },
});
