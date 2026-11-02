// Контракты между персонажем и движком: имена узлов, привязка и части тела.
//
// Персонаж обязан говорить с любым движком на одном языке. Здесь три словаря:
//
//   1. `CAPSULE_MANNEQUIN_BONE_MAP` — 21 узел приложения → имя кости. По этой
//      карте Spring IK и Rephlexia находят кости движка в скелете манекена:
//      совпадение точное, имён, поэтому эвристик нет.
//   2. `CAPSULE_MANNEQUIN_BONE_PARTS` — имя кости → часть тела. По этой карте
//      слой эффектов (подсветка урона, захват, тепловая карта) понимает, что
//      «горит» вместе с костью. Ключи частей — канонические имена рэгдолла
//      Rephlexia, но это просто строки: любой движок может сопоставить их со
//      своими группами.
//   3. `buildCapsuleMannequinBindings` — готовая привязка: для каждого узла
//      отдаёт кость, её rest-позицию/поворот и локальный поворот родителя.
//      Этого достаточно, чтобы движок начал водить скелет без знания о том,
//      как модель построена.
//
// Модуль не импортирует Three.js: объекты приходят снаружи, наружу уходят
// обычные числа и ссылки на кости.

/** 21 узел приложения → кость манекена. */
export const CAPSULE_MANNEQUIN_BONE_MAP = Object.freeze({
  root: 'Hips',
  waist: 'spine',
  chest: 'upper_chest',
  neck: 'neck',
  head: 'Head',
  shoulderL: 'upper_armL',
  elbowL: 'forearmL',
  wristL: 'handL',
  handL: 'Mid_1_L',
  shoulderR: 'upper_armR',
  elbowR: 'forearmR',
  wristR: 'handR',
  handR: 'Mid_1_R',
  hipL: 'thighL',
  kneeL: 'shinL',
  ankleL: 'footL',
  footL: 'Toes_L',
  hipR: 'thighR',
  kneeR: 'shinR',
  ankleR: 'footR',
  footR: 'Toes_R',
});

/** Узлы приложения в том порядке, в котором их ждут движки. */
export const CAPSULE_MANNEQUIN_NODE_IDS = Object.freeze(Object.keys(CAPSULE_MANNEQUIN_BONE_MAP));

/** Имя кости → часть тела (в терминах канонического рэгдолла). */
export const CAPSULE_MANNEQUIN_BONE_PARTS = Object.freeze({
  Hips: 'pelvis',
  spine: 'torso',
  Lowerchest: 'torso',
  upper_chest: 'torso',
  neck: 'head',
  Head: 'head',
  Head1: 'head',
  Head2: 'head',
  shoulderL: 'upperArmL',
  upper_armL: 'upperArmL',
  forearmL: 'lowerArmL',
  handL: 'lowerArmL',
  Mid_1_L: 'lowerArmL',
  shoulderR: 'upperArmR',
  upper_armR: 'upperArmR',
  forearmR: 'lowerArmR',
  handR: 'lowerArmR',
  Mid_1_R: 'lowerArmR',
  thighL: 'upperLegL',
  shinL: 'lowerLegL',
  footL: 'footL',
  Toes_L: 'footL',
  thighR: 'upperLegR',
  shinR: 'lowerLegR',
  footR: 'footR',
  Toes_R: 'footR',
});

/** Части тела, которые умеет подсвечивать слой эффектов. */
export const CAPSULE_MANNEQUIN_BODY_PARTS = Object.freeze([
  'pelvis', 'torso', 'neck', 'head',
  'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR',
  'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR',
  'footL', 'footR',
]);

/** Найти кость по имени в скелете, массиве костей или в корне модели. */
export function findCapsuleMannequinBone(source, name) {
  if (!source || !name) return null;
  const bones = Array.isArray(source)
    ? source
    : (Array.isArray(source.bones) ? source.bones : null);
  if (bones) return bones.find((bone) => bone?.name === name) || null;
  let found = null;
  source.traverse?.((node) => {
    if (!found && node?.name === name && (node.isBone || node.isObject3D)) found = node;
  });
  return found;
}

/**
 * Собрать привязку узлов к костям манекена.
 *
 * @param {object} options
 * @param {object|Array} options.skeleton скелет модели или массив костей
 * @param {object} options.THREE сборка three.js хоста
 * @param {object} [options.boneMap] своя карта узлов (по умолчанию стандартная)
 * @returns {{bindings: object, missing: string[]}}
 */
export function buildCapsuleMannequinBindings({ skeleton, THREE, boneMap = CAPSULE_MANNEQUIN_BONE_MAP } = {}) {
  if (!THREE?.Vector3 || !THREE?.Quaternion) {
    throw new TypeError('buildCapsuleMannequinBindings: нужен THREE хоста');
  }
  const bindings = {};
  const missing = [];
  for (const [nodeId, boneName] of Object.entries(boneMap || {})) {
    const bone = findCapsuleMannequinBone(skeleton, boneName);
    if (!bone) {
      missing.push(`${nodeId}→${boneName}`);
      continue;
    }
    bindings[nodeId] = {
      bone,
      bindLocal: bone.position.clone(),
      restWorld: bone.getWorldPosition(new THREE.Vector3()),
      restQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
      restLocalQuat: bone.quaternion.clone(),
      parentRestQuat: bone.parent
        ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
        : new THREE.Quaternion(),
    };
  }
  return { bindings, missing };
}

/** Часть тела для кости: точное имя, а если его нет — по иерархии вверх. */
export function capsuleMannequinPartForBone(bone, { parts = CAPSULE_MANNEQUIN_BONE_PARTS, maxDepth = 24 } = {}) {
  let node = bone;
  for (let depth = 0; node && depth < maxDepth; depth += 1) {
    const part = parts?.[node.name];
    if (part) return part;
    node = node.parent;
  }
  return null;
}
