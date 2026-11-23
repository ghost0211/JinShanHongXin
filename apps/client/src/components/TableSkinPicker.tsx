import React from 'react';

const TABLE_SKINS = [
  { id: 'classic', label: '经典' },
  { id: 'night-blue', label: '海派夜蓝' },
  { id: 'cinnabar', label: '朱砂金' },
] as const;

type TableSkin = (typeof TABLE_SKINS)[number]['id'];
const STORAGE_KEY = 'jinshan.tableSkin';

function isTableSkin(value: unknown): value is TableSkin {
  return TABLE_SKINS.some(({ id }) => id === value);
}

export function readTableSkin(): TableSkin {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isTableSkin(saved)) return saved;
  } catch {
    // Storage may be disabled. Classic is still available as the default.
  }
  return 'classic';
}

export function saveTableSkin(skin: TableSkin): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, skin);
  } catch {
    // The current table can still switch skins without storage.
  }
}

interface TableSkinPickerProps {
  value: TableSkin;
  onChange: (skin: TableSkin) => void;
}

export function TableSkinPicker({ value, onChange }: TableSkinPickerProps) {
  return (
    <label className="table-skin-picker">
      <span className="table-skin-swatch" aria-hidden="true" />
      <span className="table-skin-label">皮肤</span>
      <select
        aria-label="牌桌皮肤"
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isTableSkin(next)) onChange(next);
        }}
      >
        {TABLE_SKINS.map(({ id, label }) => (
          <option value={id} key={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
