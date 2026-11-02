// Профиль персонажа в формате character-плагинов Studio.
//
// Это ТОЛЬКО адаптер: ни логики тела, ни геометрии здесь нет. Всё, что умеет
// манекен, лежит в `index.js` и работает без Studio — пакет можно подключить к
// любому хосту (см. README.md рядом). Профиль лишь описывает, как этот персонаж
// выглядит для студии: источник модели, карту костей и вторичную физику.
//
// Three.js не импортируется: хост передаёт свою сборку в `model.build({ THREE })`
// так же, как он передаёт её движку.
import {
  CAPSULE_MANNEQUIN_BONE_MAP,
  CAPSULE_MANNEQUIN_BONE_PARTS,
  createCapsuleMannequin,
} from './index.js';

export default {
  id: 'capsule-mannequin',
  name: 'Капсульный манекен',
  subtitle: 'Процедурная копия эталона · 78 оболочек, 85 костей, без FBX',
  default: false,
  playable: true,
  // Студия уже показывает этого персонажа как встроенного (`builtin-capsule`):
  // плагин — тот же персонаж в переносимом виде, второй карточки в ростере не
  // нужно. Поле читает хост, а не движок.
  builtInAlias: 'builtin-capsule',
  model: {
    // Схема `procedural:` + собственная сборка: файл модели не нужен вовсе.
    source: 'procedural:capsule-mannequin',
    importStrategy: 'legacy',
    // Геометрия в единицах FBX (×100), коэффициент тот же, что у AnimeBase3.
    scaleFactor: 0.52,
    /**
     * Собрать тело.
     * @param {{THREE?: object, palette?: object}} [options]
     *   сборка three.js хоста и палитра материалов
     * @returns {object} группа `CapsuleMannequin` (Armature + скиннованный меш)
     */
    build: ({ THREE = null, palette = null } = {}) => createCapsuleMannequin({ THREE, palette }).buildGroup(),
  },
  rig: {
    strategy: 'legacy',
    boneMap: CAPSULE_MANNEQUIN_BONE_MAP,
    // Кость → часть тела: по ней слой эффектов (урон, захват, тепловая карта)
    // понимает, что именно подсвечивать.
    boneParts: CAPSULE_MANNEQUIN_BONE_PARTS,
    preserveFineBones: true,
    // Мягкие кости эталонного рига: у манекена они есть, поэтому ведут себя как
    // у AnimeBase — гасятся пружиной от родительской кости корпуса.
    secondaryPhysics: [
      {
        bones: ['Breast_L', 'Breast_L001', 'Breast_R', 'Breast_R001'],
        sourceBone: 'upper_chest',
      },
      {
        bones: ['ButtBone_L', 'ButtBone_L001', 'ButtBone_R', 'ButtBone_R001'],
        sourceBone: 'Hips',
      },
    ],
  },
};
