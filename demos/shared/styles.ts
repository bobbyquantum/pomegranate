/**
 * Shared styles & color tokens for PomegranateDB demo apps.
 *
 * Extracted so App.tsx can focus on the database code.
 */
import { StyleSheet, Platform } from 'react-native';

// ─── Color Tokens ──────────────────────────────────────────────────────────

export const POMEGRANATE = '#c0392b';
export const POMEGRANATE_LIGHT = '#e74c3c';
export const POMEGRANATE_FAINT = '#fdf0ef';
export const GRAY_50 = '#fafafa';
export const GRAY_100 = '#f5f5f5';
export const GRAY_200 = '#eeeeee';
export const GRAY_400 = '#bdbdbd';
export const GRAY_500 = '#9e9e9e';
export const GRAY_700 = '#616161';
export const GRAY_900 = '#212121';

// ─── Styles ────────────────────────────────────────────────────────────────

export const styles = StyleSheet.create({
  // Layout
  container: {
    flex: 1,
    backgroundColor: GRAY_50,
  },

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

  // Input
  inputCard: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: GRAY_200,
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
    }),
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

  // Filters
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

  // Stats
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

  // List
  listContainer: {
    flex: 1,
  },
  list: {
    paddingBottom: 20,
  },

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
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
    }),
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

  // Empty state
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

  // Splash / loading
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  splashLogo: {
    width: 80,
    height: 80,
  },
  splashEmoji: {
    fontSize: 64,
  },
  splashText: {
    marginTop: 16,
    fontSize: 15,
    color: GRAY_500,
  },

  // Benchmark panel
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
  benchResetButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: GRAY_400,
    marginBottom: 8,
  },
  benchResetButtonText: {
    color: GRAY_700,
    fontSize: 14,
  },
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
  dbSizeLabel: {
    fontSize: 13,
    color: GRAY_500,
    fontWeight: '600',
    marginRight: 8,
  },
  dbSizeValue: {
    fontSize: 15,
    fontWeight: '700',
    color: GRAY_900,
    flex: 1,
  },
  downloadBtn: {
    backgroundColor: POMEGRANATE_FAINT,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  downloadBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: POMEGRANATE,
  },
  opfsInfo: {
    fontSize: 11,
    color: GRAY_500,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    backgroundColor: GRAY_100,
    borderRadius: 6,
    padding: 8,
    marginBottom: 12,
    lineHeight: 16,
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
