/**
 * Капсульный манекен — самостоятельный персонаж-плагин.
 *
 * ## Зачем отдельный пакет
 *
 * Персонаж не принадлежит ни одному движку и ни одному хосту: он не
 * импортирует ни Rephlexia Studio, ни `spring-ik`, ни `rephlexia`, ни даже
 * Three.js. Всё, что ему нужно, хост передаёт сам — сборку Three.js и, если
 * нужно, палитру. Поэтому одно и то же тело можно поставить в редактор
 * Spring IK, в физику Rephlexia, в превью персонажа или в чужую игру.
 *
 * ## Что внутри
 *
 * - `rig.js` — 85 костей rest-позы как данные (имена, иерархия, локальные
 *   матрицы). Чистые числа: годятся любому движку, даже без рендера.
 * - `model.js` — генератор тела из примитивов: 78 оболочек, один скиннованный
 *   меш, 5 материалов. Повторяет эталонный `capsule_mannequin.fbx` по числу
 *   вершин, треугольников, габаритам и центрам.
 * - `palette.js` — пять материалов и вывод палитры из одного цвета.
 * - `bindings.js` — словари «узел → кость» и «кость → часть тела», поиск костей
 *   и сборка привязки с rest-трансформами.
 * - `character.js` — профиль для хостов, которые работают в формате
 *   character-плагинов Studio (декларация модели, привязки, secondary physics).
 *
 * ## Использование
 *
 * ```js
 * import { createCapsuleMannequin } from './index.js';
 * import * as THREE from 'three';
 *
 * const mannequin = createCapsuleMannequin({ THREE });
 * const body = mannequin.build();                     // группа: Armature + SkinnedMesh
 * const red = mannequin.build({ palette: { porcelain: '#e05a2b' } });
 *
 * // Для любого движка, который водит скелет:
 * const { bindings, missing } = mannequin.bindings(body.skeleton);
 * // bindings.root.bone → кость Hips, bindings.head.bone → Head, всего 21 узел
 *
 * // Для слоя эффектов (урон/захват/тепловая карта):
 * mannequin.partForBone(bindings.head.bone);          // → 'head'
 * ```
 *
 * Ничего не выполняется при импорте: ни сцены, ни рендерера, ни глобального
 * состояния — только данные и фабрики.
 */

import { createCapsuleMannequinModelBuilder } from './model.js';
import {
  CAPSULE_MANNEQUIN_BONES,
  CAPSULE_MANNEQUIN_HEIGHT_UNITS,
  CAPSULE_MANNEQUIN_ROOT,
} from './rig.js';
import {
  CAPSULE_MANNEQUIN_COLOR_KEYS,
  CAPSULE_MANNEQUIN_DEFAULT_COLORS,
  CAPSULE_MANNEQUIN_MATERIAL_ORDER,
  CAPSULE_MANNEQUIN_MATERIALS,
  capsulePaletteFromColor,
  normalizeHexColor,
  resolveMaterialPalette,
} from './palette.js';
import {
  CAPSULE_MANNEQUIN_BODY_PARTS,
  CAPSULE_MANNEQUIN_BONE_MAP,
  CAPSULE_MANNEQUIN_BONE_PARTS,
  CAPSULE_MANNEQUIN_NODE_IDS,
  buildCapsuleMannequinBindings,
  capsuleMannequinPartForBone,
  findCapsuleMannequinBone,
} from './bindings.js';

export const CAPSULE_MANNEQUIN_PLUGIN_ID = 'capsule-mannequin';
export const CAPSULE_MANNEQUIN_VERSION = '1.0.0';

export {
  // Риг
  CAPSULE_MANNEQUIN_BONES,
  CAPSULE_MANNEQUIN_HEIGHT_UNITS,
  CAPSULE_MANNEQUIN_ROOT,
  // Материалы и палитра
  CAPSULE_MANNEQUIN_COLOR_KEYS,
  CAPSULE_MANNEQUIN_DEFAULT_COLORS,
  CAPSULE_MANNEQUIN_MATERIAL_ORDER,
  CAPSULE_MANNEQUIN_MATERIALS,
  capsulePaletteFromColor,
  normalizeHexColor,
  resolveMaterialPalette,
  // Привязки и части тела
  CAPSULE_MANNEQUIN_BODY_PARTS,
  CAPSULE_MANNEQUIN_BONE_MAP,
  CAPSULE_MANNEQUIN_BONE_PARTS,
  CAPSULE_MANNEQUIN_NODE_IDS,
  buildCapsuleMannequinBindings,
  capsuleMannequinPartForBone,
  findCapsuleMannequinBone,
  // Генератор
  createCapsuleMannequinModelBuilder,
};

/**
 * Готовый персонаж под конкретную сборку Three.js.
 *
 * `THREE` нужен только для сборки геометрии: риг, карта узлов и палитра —
 * чистые данные, поэтому экземпляр можно создать и без Three.js (серверный
 * расчёт позы, валидация, инструменты). Тогда `build()` честно падает с
 * понятной ошибкой, а не тихо возвращает пустую группу.
 *
 * @param {object} [options]
 * @param {object} [options.THREE] сборка three.js хоста (нужна для `build`)
 * @param {object} [options.palette] палитра по умолчанию для этого экземпляра
 * @returns {object} API персонажа
 */
export function createCapsuleMannequin({ THREE = null, palette = null } = {}) {
  const buildModel = THREE ? createCapsuleMannequinModelBuilder(THREE) : null;
  const requireModel = () => {
    if (!buildModel) {
      throw new Error('Капсульный манекен: для сборки тела нужна сборка three.js (`createCapsuleMannequin({ THREE })`).');
    }
    return buildModel;
  };
  return {
    id: CAPSULE_MANNEQUIN_PLUGIN_ID,
    version: CAPSULE_MANNEQUIN_VERSION,
    THREE,
    /** Собрать тело: `{ group, mesh, armature, skeleton, bones, shellCount }`. */
    build(options = {}) {
      return requireModel()({ palette, ...options });
    },
    /** Только группа тела — удобно для сцены, если детали не нужны. */
    buildGroup(options = {}) {
      return requireModel()({ palette, ...options }).group;
    },
    /** Данные рига: имена, иерархия, rest-матрицы. */
    rig: Object.freeze({
      bones: CAPSULE_MANNEQUIN_BONES,
      root: CAPSULE_MANNEQUIN_ROOT,
      heightUnits: CAPSULE_MANNEQUIN_HEIGHT_UNITS,
    }),
    /** 21 узел → кость. */
    boneMap: CAPSULE_MANNEQUIN_BONE_MAP,
    /** Кость → часть тела. */
    boneParts: CAPSULE_MANNEQUIN_BONE_PARTS,
    /** Привязка узлов к скелету собранного тела. */
    bindings(skeleton, options = {}) {
      return buildCapsuleMannequinBindings({ skeleton, THREE, ...options });
    },
    /** Часть тела, к которой относится кость (с подъёмом по иерархии). */
    partForBone(bone, options = {}) {
      return capsuleMannequinPartForBone(bone, options);
    },
    /** Палитра из одного цвета — например, для NPC или вариантов окраски. */
    paletteFromColor(color, overrides = null) {
      return capsulePaletteFromColor(color, overrides);
    },
    /** Итоговые материалы палитры (без сборки геометрии). */
    materials(customPalette = null) {
      return resolveMaterialPalette(customPalette ?? palette);
    },
  };
}

/**
 * Разово собрать тело, если экземпляр персонажа не нужен.
 * @param {{THREE: object, palette?: object}} options
 */
export function buildCapsuleMannequinModel({ THREE, palette = null } = {}) {
  return createCapsuleMannequinModelBuilder(THREE)({ palette });
}

export default {
  id: CAPSULE_MANNEQUIN_PLUGIN_ID,
  version: CAPSULE_MANNEQUIN_VERSION,
  create: createCapsuleMannequin,
  build: buildCapsuleMannequinModel,
};
