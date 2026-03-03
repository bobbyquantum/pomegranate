/**
 * Ambient module declarations for untyped third-party dependencies.
 */

// lokijs ships no type declarations; @types/lokijs only covers the main entry.
declare module 'lokijs' {
  const Loki: any;
  export default Loki;
}

declare module 'lokijs/src/incremental-indexeddb-adapter' {
  const IncrementalIDBAdapter: any;
  export default IncrementalIDBAdapter;
}
