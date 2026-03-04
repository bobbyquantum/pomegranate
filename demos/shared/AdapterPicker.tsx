/**
 * Shared adapter-picker chip row for PomegranateDB demo apps.
 *
 * Renders a horizontal scrolling row of chips — one per available adapter.
 * Tapping a chip fires `onSelect(variant)` so the parent can swap the
 * DatabaseSuspenseProvider.  Chips carry testIDs (`adapter-option-{variant}`)
 * for Maestro / Detox automation.
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { POMEGRANATE, POMEGRANATE_FAINT, GRAY_200, GRAY_700 } from './styles';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AdapterOption {
  /** Key used in `createAdapter(variant)`, e.g. `'expo-sqlite'` */
  variant: string;
  /** Full display name shown in the header badge */
  name: string;
  /** Short label for the chip (defaults to `name`) */
  label?: string;
  /** Only available on native (iOS / Android) */
  nativeOnly?: boolean;
  /** Only available on web */
  webOnly?: boolean;
}

interface Props {
  options: AdapterOption[];
  selected: string;
  onSelect: (variant: string) => void;
}

// ─── Component ─────────────────────────────────────────────────────────────

/** Horizontal chip-row for selecting the database adapter at runtime. */
export function AdapterPicker({ options, selected, onSelect }: Props) {
  const available = options.filter((o) => {
    if (o.nativeOnly && Platform.OS === 'web') return false;
    if (o.webOnly && Platform.OS !== 'web') return false;
    return true;
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={pickerStyles.row}
      style={pickerStyles.container}
    >
      {available.map((opt) => (
        <Pressable
          key={opt.variant}
          testID={`adapter-option-${opt.variant}`}
          onPress={() => onSelect(opt.variant)}
          style={({ pressed }) => [
            pickerStyles.chip,
            opt.variant === selected && pickerStyles.chipSelected,
            pressed && pickerStyles.chipPressed,
          ]}
        >
          <Text
            style={[
              pickerStyles.chipText,
              opt.variant === selected && pickerStyles.chipTextSelected,
            ]}
            numberOfLines={1}
          >
            {opt.label ?? opt.name}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const pickerStyles = StyleSheet.create({
  container: {
    maxHeight: 46,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GRAY_200,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: POMEGRANATE_FAINT,
    borderWidth: 1,
    borderColor: GRAY_200,
  },
  chipSelected: {
    backgroundColor: POMEGRANATE,
    borderColor: POMEGRANATE,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: GRAY_700,
  },
  chipTextSelected: {
    color: '#fff',
  },
});
