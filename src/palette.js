// Материалы капсульного манекена и палитры для хостов.
//
// Пять материалов эталона: тёплый фарфор корпуса, вторичные оболочки, мягкие
// шарниры, акцент и лицо. Здесь же — две операции, которых хватает любому
// хосту: собрать палитру из одного тона (NPC, варианты цвета) и получить
// итоговый список материалов с учётом переопределений.
//
// Модуль не импортирует Three.js и ничего не знает о движках: цвета — это
// числа и строки, а в материал их кладёт генератор модели.

/** Материалы эталона: цвет (линейный), шероховатость, металличность. */
export const CAPSULE_MANNEQUIN_MATERIALS = Object.freeze([
  Object.freeze({ key: 'porcelain', name: '01 · warm porcelain', color: Object.freeze([0.78, 0.785, 0.77]), roughness: 0.36, metalness: 0.08 }),
  Object.freeze({ key: 'secondary', name: '02 · mist / secondary shell', color: Object.freeze([0.59, 0.625, 0.635]), roughness: 0.44, metalness: 0.1 }),
  Object.freeze({ key: 'joint', name: '03 · soft charcoal / articulated joints', color: Object.freeze([0.092, 0.127, 0.146]), roughness: 0.47, metalness: 0.19 }),
  Object.freeze({ key: 'accent', name: '04 · brushed nickel / discreet mark', color: Object.freeze([0.71, 0.75, 0.75]), roughness: 0.32, metalness: 0.58 }),
  Object.freeze({ key: 'face', name: '05 · graphite / minimal face', color: Object.freeze([0.07, 0.105, 0.12]), roughness: 0.38, metalness: 0.08 }),
]);

/** Порядок материалов в меше. Совпадает с порядком групп геометрии. */
export const CAPSULE_MANNEQUIN_MATERIAL_ORDER = Object.freeze(
  CAPSULE_MANNEQUIN_MATERIALS.map((entry) => entry.key),
);

/** Цвета по умолчанию в виде, в котором их удобно показывать в интерфейсе. */
export const CAPSULE_MANNEQUIN_DEFAULT_COLORS = Object.freeze({
  porcelain: '#c9c9c5',
  secondary: '#9d9fa1',
  joint: '#1d2225',
  accent: '#b6bdbc',
  face: '#14191c',
});

/** Ключи палитры — их же принимает `build({ palette })`. */
export const CAPSULE_MANNEQUIN_COLOR_KEYS = Object.freeze(
  CAPSULE_MANNEQUIN_MATERIALS.map((entry) => entry.key),
);

/**
 * Итоговые материалы с учётом переопределений палитры.
 *
 * `palette` — объект вида `{ porcelain: '#e8eaee', joint: 0x2a3340 }`.
 * Неизвестные ключи игнорируются, отсутствующие берут эталонные цвета, поэтому
 * палитра может быть частичной: хвост, лицо или всё тело отдельно.
 */
export function resolveMaterialPalette(palette = null) {
  const source = palette && typeof palette === 'object' ? palette : {};
  return CAPSULE_MANNEQUIN_MATERIALS.map((entry) => ({
    ...entry,
    override: source[entry.key],
  }));
}

/**
 * Палитра тела из одного цвета.
 *
 * Один тон задаёт весь манекен: корпус и вторичные оболочки сдвигаются к
 * светлому, шарниры и лицо — к почти чёрному. Так тело любого цвета читается
 * так же, как эталон: светлая оболочка, тёмные суставы. Точные слоты можно
 * переопределить вторым аргументом.
 */
export function capsulePaletteFromColor(color, overrides = null) {
  const base = color === null || color === undefined
    ? CAPSULE_MANNEQUIN_DEFAULT_COLORS.porcelain
    : color;
  const targets = {
    porcelain: ['#efede7', 0.78],
    secondary: ['#9aa0a6', 0.52],
    joint: ['#11151a', 0.86],
    accent: ['#cfd4d3', 0.6],
    face: ['#090c0f', 0.9],
  };
  const palette = {};
  for (const [key, [target, amount]] of Object.entries(targets)) {
    palette[key] = mixHexColors(base, target, amount);
  }
  if (overrides && typeof overrides === 'object') {
    for (const key of Object.keys(targets)) {
      if (overrides[key] !== undefined) palette[key] = overrides[key];
    }
  }
  return palette;
}

/** `#rrggbb` из числа или строки; `null`, если цвет не разобрать. */
export function normalizeHexColor(color) {
  if (Number.isFinite(color)) return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
  const text = String(color ?? '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(text) ? `#${text.toLowerCase()}` : null;
}

function hexToRgb(color) {
  const hex = normalizeHexColor(color)?.slice(1);
  if (!hex) return null;
  const value = Number.parseInt(hex, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Смешать два цвета: `amount` — доля второго (0…1). */
function mixHexColors(from, to, amount) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return normalizeHexColor(from) || CAPSULE_MANNEQUIN_DEFAULT_COLORS.porcelain;
  const t = Math.max(0, Math.min(1, amount));
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * t);
  const value = (channel(0) << 16) | (channel(1) << 8) | channel(2);
  return `#${value.toString(16).padStart(6, '0')}`;
}
