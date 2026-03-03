/**
 * PomegranateDB Bare React Native Demo — Todo App
 *
 * Zero Expo dependencies. Demonstrates: schema, models, CRUD, live queries,
 * hooks, reactive observation using only React Native + PomegranateDB.
 */
import React, { useState, useCallback, useRef, Suspense } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Image,
  ScrollView,
  Keyboard,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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

// ─── Constants ─────────────────────────────────────────────────────────────

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
      for (const t of completed) {
        await t.destroyPermanently();
      }
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

// ─── Benchmark Panel ───────────────────────────────────────────────────────

function BenchmarkPanel() {
  const db = useDatabase();
  const [suite, setSuite] = useState<BenchmarkSuite | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');

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
    } catch (error) {
      setProgress(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [db]);

  return (
    <ScrollView style={styles.benchContainer} contentContainerStyle={styles.benchContent}>
      <Text style={styles.benchTitle}>⚡ Database Benchmarks</Text>
      <Text style={styles.benchDesc}>
        Runs insert, query, update, and delete operations to measure adapter performance.
      </Text>

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

      {running && <Text style={styles.benchProgress}>{progress}</Text>}

      {suite && (
        <View style={styles.benchResults}>
          <View style={styles.benchSummary}>
            <Text style={styles.benchSummaryText}>
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
      <View style={styles.logoSquircle}>
        <Image source={require('./assets/logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <View style={styles.headerTextGroup}>
        <Text style={styles.headerTitle}>PomegranateDB</Text>
        <Text style={styles.headerSubtitle}>Bare React Native · No Expo</Text>
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
      <StatusBar barStyle="light-content" backgroundColor={POMEGRANATE} />
      <Header />

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => setTab('todos')}
          style={[styles.tab, tab === 'todos' && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === 'todos' && styles.tabTextActive]}>📝 Todos</Text>
        </Pressable>
        <Pressable
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
// Adapter is selected by the ADAPTER env var (inlined at build time via
// babel-plugin-transform-inline-environment-variables):
//   loki-memory     LokiAdapter, no persistence (default)
//   op-sqlite       SQLiteAdapter + op-sqlite    (iOS / Android)
//   native-sqlite   SQLiteAdapter + JSI bridge   (iOS / Android)

function createAdapter(): { adapter: LokiAdapter | SQLiteAdapter; name: string } {
  const variant = process.env.ADAPTER ?? 'loki-memory';

  if (variant === 'op-sqlite') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpSQLiteDriver } = require('pomegranate-db/op-sqlite');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-bare-demo',
        driver: createOpSQLiteDriver(),
      }),
      name: 'OpSQLite',
    };
  }

  if (variant === 'native-sqlite') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createNativeSQLiteDriver } = require('pomegranate-db/native-sqlite');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-bare-demo',
        driver: createNativeSQLiteDriver(),
      }),
      name: 'NativeSQLite (JSI)',
    };
  }

  // loki-memory (default): pure in-memory, works on all platforms
  return {
    adapter: new LokiAdapter({ databaseName: 'pomegranate-bare-demo' }),
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
            <Text style={styles.splashEmoji}>🔴</Text>
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
  container: {
    flex: 1,
    backgroundColor: GRAY_50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 18,
    paddingHorizontal: 20,
    backgroundColor: POMEGRANATE,
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
    width: 34,
    height: 34,
  },
  headerTextGroup: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  adapterBadge: {
    marginLeft: 8,
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'center',
  },
  adapterBadgeText: {
    color: 'rgba(255,255,255,0.90)',
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
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
  addBtnPressed: {
    backgroundColor: POMEGRANATE_LIGHT,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 26,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: GRAY_100,
  },
  filterTabActive: {
    backgroundColor: POMEGRANATE_FAINT,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: GRAY_500,
  },
  filterTabTextActive: {
    color: POMEGRANATE,
  },
  statsRow: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  statsText: {
    fontSize: 12,
    color: GRAY_500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
  },
  list: {
    paddingBottom: 20,
  },
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
  checkboxDone: {
    backgroundColor: POMEGRANATE,
    borderColor: POMEGRANATE,
  },
  checkboxPressed: {
    opacity: 0.7,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  todoTitle: {
    flex: 1,
    fontSize: 16,
    color: GRAY_900,
    lineHeight: 22,
  },
  todoTitleDone: {
    textDecorationLine: 'line-through',
    color: GRAY_400,
  },
  deleteBtn: {
    padding: 4,
    marginLeft: 8,
  },
  deleteBtnPressed: {
    opacity: 0.5,
  },
  deleteText: {
    fontSize: 16,
    color: GRAY_400,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: GRAY_700,
  },
  emptySubtitle: {
    fontSize: 14,
    color: GRAY_500,
    marginTop: 4,
  },
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
  actionBtnSecondary: {
    backgroundColor: GRAY_100,
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: POMEGRANATE,
  },
  actionBtnTextSecondary: {
    color: GRAY_700,
  },
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  splashEmoji: {
    fontSize: 64,
  },
  splashText: {
    marginTop: 16,
    fontSize: 15,
    color: GRAY_500,
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
  },
  tabActive: {
    borderBottomWidth: 2,
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

  // Benchmarks
  benchContainer: {
    flex: 1,
  },
  benchContent: {
    padding: 20,
    paddingBottom: 40,
  },
  benchTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: GRAY_900,
    marginBottom: 6,
  },
  benchDesc: {
    fontSize: 14,
    color: GRAY_500,
    marginBottom: 16,
    lineHeight: 20,
  },
  benchButton: {
    backgroundColor: POMEGRANATE,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  benchButtonPressed: {
    backgroundColor: POMEGRANATE_LIGHT,
  },
  benchButtonDisabled: {
    opacity: 0.6,
  },
  benchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  benchProgress: {
    fontSize: 13,
    color: GRAY_500,
    textAlign: 'center',
    marginBottom: 12,
  },
  benchResults: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GRAY_200,
    backgroundColor: '#fff',
  },
  benchSummary: {
    backgroundColor: POMEGRANATE_FAINT,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_200,
  },
  benchSummaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: POMEGRANATE,
  },
  benchTableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  benchTableRowAlt: {
    backgroundColor: GRAY_50,
  },
  benchTableCell: {
    flex: 1,
    fontSize: 12,
    color: GRAY_700,
  },
  benchTableHeader: {
    fontWeight: '700',
    color: GRAY_900,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  benchOps: {
    fontWeight: '700',
    color: POMEGRANATE,
  },
});
