/**
 * PomegranateDB Bare React Native Demo — Todo App
 *
 * Zero Expo dependencies. Demonstrates: schema, models, CRUD, live queries,
 * hooks, reactive observation using only React Native + PomegranateDB.
 */
import React, { useState, useCallback, useRef, useMemo, Suspense } from 'react';
import {
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
  Alert,
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
import {
  styles,
  POMEGRANATE,
  GRAY_400,
} from '../shared/styles';
import { AdapterPicker, type AdapterOption } from '../shared/AdapterPicker';

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

// ─── Benchmark Panel ───────────────────────────────────────────────────────

function BenchmarkPanel({ adapterName }: { adapterName: string }) {
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
        adapterName,
        setProgress,
      );
      setSuite(result);
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
    } catch (error) {
      setProgress(`Insert failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  }, [db]);

  return (
    <ScrollView style={styles.benchContainer} contentContainerStyle={styles.benchContent}>
      <Text testID="benchmark-title" style={styles.benchTitle}>⚡ Database Benchmarks</Text>
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

function Header({ adapterName }: { adapterName: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.logoSquircle}>
          <Image source={require('./assets/logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={styles.headerTextGroup}>
          <Text style={styles.headerTitle}>PomegranateDB</Text>
          <Text style={styles.headerSubtitle}>Bare React Native · No Expo</Text>
        </View>
      </View>
      <View style={styles.adapterBadge}>
        <Text style={styles.adapterBadgeText}>{adapterName}</Text>
      </View>
    </View>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────

type Tab = 'todos' | 'benchmarks';

function MainContent({ adapterName }: { adapterName: string }) {
  const [tab, setTab] = useState<Tab>('todos');

  return (
    <>
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
        <BenchmarkPanel adapterName={adapterName} />
      )}
    </>
  );
}

// ─── Adapter configuration ─────────────────────────────────────────────────

const ADAPTER_OPTIONS: AdapterOption[] = [
  { variant: 'op-sqlite', name: 'OpSQLite (sync)', label: 'OpSQL' },
  { variant: 'op-sqlite-async', name: 'OpSQLite (async)', label: 'OpSQL Async' },
  { variant: 'native-sqlite', name: 'NativeSQLite (JSI)', label: 'Native JSI' },
  { variant: 'loki-memory', name: 'Loki (memory)', label: 'Loki Mem' },
];

const DEFAULT_VARIANT = process.env.ADAPTER ?? 'loki-memory';

function createAdapter(variant: string): { adapter: LokiAdapter | SQLiteAdapter; name: string } {

  if (variant === 'op-sqlite') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpSQLiteDriver } = require('pomegranate-db/op-sqlite');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-bare-demo',
        driver: createOpSQLiteDriver(),
      }),
      name: 'OpSQLite (sync)',
    };
  }

  if (variant === 'op-sqlite-async') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpSQLiteDriver } = require('pomegranate-db/op-sqlite');
    return {
      adapter: new SQLiteAdapter({
        databaseName: 'pomegranate-bare-demo',
        driver: createOpSQLiteDriver({ preferSync: false }),
      }),
      name: 'OpSQLite (async)',
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

export default function App() {
  const [variant, setVariant] = useState(DEFAULT_VARIANT);
  const { adapter, name: adapterName } = useMemo(() => createAdapter(variant), [variant]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={POMEGRANATE} />
        <Header adapterName={adapterName} />
        <AdapterPicker
          options={ADAPTER_OPTIONS}
          selected={variant}
          onSelect={setVariant}
        />
        <Suspense
          fallback={
            <View style={styles.loadingContent}>
              <ActivityIndicator size="large" color={POMEGRANATE} />
              <Text style={styles.loadingText}>Loading database…</Text>
            </View>
          }
        >
          <DatabaseSuspenseProvider key={variant} adapter={adapter} models={[Todo]}>
            <MainContent adapterName={adapterName} />
          </DatabaseSuspenseProvider>
        </Suspense>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
