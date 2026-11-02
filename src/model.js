import { CAPSULE_MANNEQUIN_BONES } from './rig.js';
import {
  CAPSULE_MANNEQUIN_MATERIAL_ORDER,
  resolveMaterialPalette,
} from './palette.js';

/**
 * Капсульный манекен — тело, собранное кодом из примитивов.
 *
 * Пакет самостоятельный: он не импортирует ни Studio, ни движки, ни Three.js.
 * Хост передаёт свой `THREE` в фабрику (`createCapsuleMannequinModelBuilder`),
 * поэтому одно и то же тело работает в любом рендерере на Three.js — в
 * spring-ik, в rephlexia или в чужом проекте.
 *
 * Геометрия повторяет эталон (`build_capsule_character.py`): 78 отдельных
 * оболочек на исходном скелете anime-base-tall, каждая — эллиптическая
 * «пилюля» с переменным радиусом, торцы скруглены косинусной фаской, у части
 * деталей есть лёгкое утолщение по середине (`bulge`), и каждая оболочка жёстко
 * привязана к одной кости (вес 1.0). Формулы, числа и порядок деталей — те же.
 *
 * Пространство координат — как у исходного скелета: Z вверх, −Y вперёд,
 * 1 единица модели ≈ 0.01 м; корневой объект разворачивается в Y-up так же, как
 * это делает импорт FBX, и масштабируется на 100 (единицы FBX), чтобы хост мог
 * применить тот же `scaleFactor`, что и у моделей на FBX.
 */

/** Частота сэмплов на скруглённом торце — как в эталонном скрипте. */
const CAP_STEPS = Object.freeze([0.014, 0.06, 0.14, 0.25, 0.39, 0.55, 0.72, 0.87, 1.0]);
const MID_STEPS = Object.freeze([0.2, 0.4, 0.6, 0.8]);

/** Масштаб единиц модели при импорте: выставлен у эталонного FBX. */
const MODEL_UNIT_SCALE = 100;

export function createCapsuleMannequinModelBuilder(THREE) {
  if (!THREE?.Vector3 || !THREE?.Bone) {
    throw new TypeError('Капсульный манекен: фабрике нужен THREE (любая сборка three.js)');
  }

    const MATERIAL_ORDER = CAPSULE_MANNEQUIN_MATERIAL_ORDER;

    /**
     * Записать цвет палитры в материал.
     *
     * Палитра приходит из интерфейса как `#rrggbb` (sRGB) или числом; материал
     * живёт в линейном пространстве, поэтому цвет переводится один раз здесь.
     */
    function applyPaletteColor(target, value) {
      if (Array.isArray(value) && value.length >= 3) {
        target.setRGB(Number(value[0]), Number(value[1]), Number(value[2]), THREE.LinearSRGBColorSpace);
        return target;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        target.setHex(value);
        return target;
      }
      if (typeof value === 'string' && value.trim()) {
        target.setStyle(value.trim());
        return target;
      }
      return target;
  }

    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

  class CapsuleMeshBuilder {
    constructor(bonesByName, boneOrder) {
      this.bones = bonesByName;
      this.boneOrder = boneOrder;
      this.positions = [];
      this.skinIndices = [];
      this.faces = [];
      this.faceMaterials = [];
      this.parts = [];
      this.indexCount = 0;
  }

    _vertex(point, boneName) {
      const boneIndex = this.boneOrder.indexOf(boneName);
      if (boneIndex < 0) throw new Error(`Капсульный манекен: неизвестная кость ${boneName}`);
      this.positions.push(point.x, point.y, point.z);
      this.skinIndices.push(boneIndex, 0, 0, 0);
      return (this.positions.length / 3) - 1;
  }

    _face(indices, material) {
      const materialIndex = MATERIAL_ORDER.indexOf(material);
      if (materialIndex < 0) throw new Error(`Капсульный манекен: неизвестный материал ${material}`);
      this.faces.push(indices);
      this.faceMaterials.push(materialIndex);
      this.indexCount += (indices.length - 2) * 3;
  }

    /**
     * Эллиптическая «пилюля» между двумя точками rest-позы.
     *
     * Скругление торцов считается долей длины (`cap`), поперечные радиусы — пара
     * `[u, v]` в базисе, где `ref` задаёт первую ось сечения. Всё как в эталоне.
     */
    capsule(label, boneName, p0, p1, radiiStart, radiiEnd = null, options = {}) {
      const startIndex = this.indexCount;
      const {
        mat = 'porcelain',
        ref = [1, 0, 0],
        cap = null,
        bulge = 0,
        sides = 28,
      } = options;
      const start = v3(p0[0], p0[1], p0[2]);
      const end = v3(p1[0], p1[1], p1[2]);
      const vector = end.clone().sub(start);
      const length = vector.length();
      if (length <= 1e-6) throw new Error(`Капсульный манекен: нулевая длина у «${label}»`);
      const axis = vector.clone().divideScalar(length);
      const reference = v3(ref[0], ref[1], ref[2]);
      let u = reference.clone().sub(axis.clone().multiplyScalar(reference.dot(axis)));
      if (u.length() < 1e-5) u = v3(1, 0, 0).sub(axis.clone().multiplyScalar(axis.x));
      if (u.length() < 1e-5) u = v3(0, 1, 0).sub(axis.clone().multiplyScalar(axis.y));
      u.normalize();
      const v = new THREE.Vector3().crossVectors(axis, u).normalize();
      const r0 = [radiiStart[0], radiiStart[1]];
      const r1 = radiiEnd ? [radiiEnd[0], radiiEnd[1]] : [radiiStart[0], radiiStart[1]];
      let capFactor = cap;
      if (capFactor === null) {
        capFactor = Math.max(0.115, Math.min(0.47, (0.9 * Math.max(r0[0], r0[1], r1[0], r1[1])) / length));
      }
      capFactor = Math.max(0.06, Math.min(0.49, capFactor));

      const values = new Set();
      for (const f of CAP_STEPS) values.add(capFactor * f);
      for (const f of MID_STEPS) values.add(capFactor + (1 - 2 * capFactor) * f);
      for (const f of CAP_STEPS) values.add(1 - capFactor * f);
      const samples = [...values].sort((a, b) => a - b);

      const bottom = this._vertex(start, boneName);
      const rings = [];
      for (const t of samples) {
        let roundFactor = 1;
        if (t < capFactor) {
          const s = t / capFactor;
          roundFactor = Math.sqrt(Math.max(0, 1 - (1 - s) ** 2));
        } else if (t > 1 - capFactor) {
          const s = (1 - t) / capFactor;
          roundFactor = Math.sqrt(Math.max(0, 1 - (1 - s) ** 2));
        }
        const organic = 1 + bulge * Math.sin(Math.PI * t);
        const rU = (r0[0] * (1 - t) + r1[0] * t) * roundFactor * organic;
        const rV = (r0[1] * (1 - t) + r1[1] * t) * roundFactor * organic;
        const center = start.clone().addScaledVector(vector, t);
        const ring = [];
        for (let j = 0; j < sides; j += 1) {
          const angle = (2 * Math.PI * j) / sides;
          const point = center.clone()
            .addScaledVector(u, rU * Math.cos(angle))
            .addScaledVector(v, rV * Math.sin(angle));
          ring.push(this._vertex(point, boneName));
        }
        rings.push(ring);
      }
      const top = this._vertex(end, boneName);
      for (let j = 0; j < sides; j += 1) {
        const k = (j + 1) % sides;
        this._face([bottom, rings[0][k], rings[0][j]], mat);
      }
      for (let r = 0; r < rings.length - 1; r += 1) {
        const a = rings[r];
        const b = rings[r + 1];
        for (let j = 0; j < sides; j += 1) {
          const k = (j + 1) % sides;
          this._face([a[j], a[k], b[k], b[j]], mat);
        }
      }
      for (let j = 0; j < sides; j += 1) {
        const k = (j + 1) % sides;
        this._face([top, rings[rings.length - 1][j], rings[rings.length - 1][k]], mat);
      }
      this.parts.push({ label, bone: boneName, material: mat, start: startIndex, count: this.indexCount - startIndex });
  }

    /** Шар сустава: та же «пилюля» от низа до верха, с торцами по половине длины. */
    ball(label, boneName, center, radii, options = {}) {
      const { mat = 'joint', sides = 24 } = options;
      const [rx, ry, rz] = radii;
      const middle = v3(center[0], center[1], center[2]);
      this.capsule(
        label,
        boneName,
        [middle.x, middle.y, middle.z - rz],
        [middle.x, middle.y, middle.z + rz],
        [rx, ry],
        [rx, ry],
        { mat, ref: [1, 0, 0], cap: 0.5, sides },
      );
  }

    build() {
      const vertexCount = this.positions.length / 3;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndices, 4));
      const weights = new Float32Array(vertexCount * 4);
      for (let i = 0; i < vertexCount; i += 1) weights[i * 4] = 1;
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const indices = [];
      for (const face of this.faces) {
        for (let i = 1; i < face.length - 1; i += 1) indices.push(face[0], face[i], face[i + 1]);
      }
      geometry.setIndex(indices);
      const normal = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
      geometry.setAttribute('normal', normal);
      geometry.computeVertexNormals();
      // Группы материалов — по порядку деталей: так же, как их набирает эталон.
      let runStart = 0;
      let runMaterial = this.faceMaterials[0];
      for (let f = 1; f <= this.faceMaterials.length; f += 1) {
        const material = f < this.faceMaterials.length ? this.faceMaterials[f] : null;
        if (material === runMaterial) continue;
        const triangles = (f - runStart) * 0;
        const start = this._trianglesBefore(runStart) * 3;
        const count = (this._trianglesBefore(f) - this._trianglesBefore(runStart)) * 3;
        geometry.addGroup(start, count, runMaterial);
        runStart = f;
        runMaterial = material;
        void triangles;
      }
      return { geometry, partCount: this.parts.length, parts: this.parts };
  }

    _trianglesBefore(faceIndex) {
      let total = 0;
      for (let i = 0; i < faceIndex; i += 1) total += this.faces[i].length - 2;
      return total;
  }
  }

  /** Скелет из данных: имена, иерархия и rest-матрицы исходного скелета. */
  function buildSkeleton() {
    const bones = new Map();
    const boneOrder = CAPSULE_MANNEQUIN_BONES.map((entry) => entry.name);
    const matrix = new THREE.Matrix4();
    for (const entry of CAPSULE_MANNEQUIN_BONES) {
      const bone = new THREE.Bone();
      bone.name = entry.name;
      matrix.fromArray(entry.local);
      bone.matrix.copy(matrix);
      bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
      bones.set(entry.name, bone);
  }
    const roots = [];
    for (const entry of CAPSULE_MANNEQUIN_BONES) {
      const bone = bones.get(entry.name);
      if (!entry.parent) {
        roots.push(bone);
        continue;
      }
      const parent = bones.get(entry.parent);
      if (!parent) throw new Error(`Капсульный манекен: нет родителя ${entry.parent}`);
      parent.add(bone);
  }
    return { bones, boneOrder, roots };
  }

  /**
   * Собрать тело манекена: 78 оболочек на 85 костях, как в эталоне.
   *
   * Возвращает готовую группу: `Armature` (кости) и `Capsule_Character`
   * (скиннованный меш) с тем же разворотом и масштабом единиц, что у эталонного
   * FBX, — чтобы привязка 21 узла и физика Rephlexia работали без исключений.
   */
    function build({ palette = null } = {}) {
    const { bones, boneOrder, roots } = buildSkeleton();
    const headOf = (name) => {
      const entry = CAPSULE_MANNEQUIN_BONES.find((bone) => bone.name === name);
      if (!entry) throw new Error(`Капсульный манекен: нет кости ${name}`);
      return entry.head;
  };
    const tailOf = (name) => {
      const entry = CAPSULE_MANNEQUIN_BONES.find((bone) => bone.name === name);
      if (!entry) throw new Error(`Капсульный манекен: нет кости ${name}`);
      return entry.tail;
  };
    const toVector = (p) => v3(p[0], p[1], p[2]);
    const h = (name) => toVector(headOf(name));
    const t = (name) => toVector(tailOf(name));

    // Единичный масштаб эталона: длина бедра / 2.0881.
    const scale = t('thighL').clone().sub(h('thighL')).length() / 2.0881;
    const p = (x = 0, y = 0, z = 0) => v3(x * scale, y * scale, z * scale);
    const tuple = (vector) => [vector.x, vector.y, vector.z];

    const m = new CapsuleMeshBuilder(bones, boneOrder);
    const hips = h('Hips');
    const spine = h('spine');
    const lower = h('Lowerchest');
    const chest = h('upper_chest');

    // Тёмные вставки-соединители: закрывают стыки сегментов корпуса.
    m.capsule('Pelvis/spine inset', 'Hips',
      tuple(hips.clone().add(p(0, 0, 0.31))), tuple(hips.clone().add(p(0, 0, 0.53))),
      [0.56 * scale, 0.31 * scale], null, { mat: 'joint', ref: [1, 0, 0], cap: 0.22 });
    m.capsule('Lower back inset', 'spine',
      tuple(t('spine').clone().add(p(0, 0, -0.085))), tuple(t('spine').clone().add(p(0, 0, 0.105))),
      [0.56 * scale, 0.31 * scale], null, { mat: 'joint', ref: [1, 0, 0], cap: 0.19 });
    m.capsule('Rib/sternum inset', 'Lowerchest',
      tuple(t('Lowerchest').clone().add(p(0, 0, -0.085))), tuple(t('Lowerchest').clone().add(p(0, 0, 0.13))),
      [0.67 * scale, 0.35 * scale], null, { mat: 'joint', ref: [1, 0, 0], cap: 0.19 });

    m.capsule('Pelvis', 'Hips',
      tuple(hips.clone().add(p(0, -0.01, -0.24))), tuple(hips.clone().add(p(0, -0.01, 0.46))),
      [0.72 * scale, 0.4 * scale], [0.78 * scale, 0.44 * scale],
      { mat: 'porcelain', ref: [1, 0, 0], cap: 0.27 });
    m.capsule('Waist', 'spine',
      tuple(spine.clone().add(p(0, -0.015, 0.1))), tuple(t('spine').clone().add(p(0, 0, -0.005))),
      [0.62 * scale, 0.34 * scale], [0.65 * scale, 0.37 * scale],
      { mat: 'secondary', ref: [1, 0, 0], cap: 0.2 });
    m.capsule('Rib cage', 'Lowerchest',
      tuple(lower.clone().add(p(0, 0, 0.02))), tuple(t('Lowerchest').clone().add(p(0, 0, 0.005))),
      [0.67 * scale, 0.39 * scale], [0.78 * scale, 0.45 * scale],
      { mat: 'porcelain', ref: [1, 0, 0], cap: 0.18 });
    m.capsule('Upper chest', 'upper_chest',
      tuple(chest.clone().add(p(0, 0, 0.04))), tuple(t('upper_chest').clone().add(p(0, 0, 0.025))),
      [0.77 * scale, 0.45 * scale], [0.99 * scale, 0.53 * scale],
      { mat: 'porcelain', ref: [1, 0, 0], cap: 0.15, bulge: 0.05 });
    // Маленькая неброская метка на груди — едет вместе с костью груди.
    const mark = h('upper_chest').lerp(t('upper_chest'), 0.58);
    m.capsule('Chest hallmark', 'upper_chest',
      tuple(mark.clone().add(p(-0.115, -0.555, 0))), tuple(mark.clone().add(p(0.115, -0.555, 0))),
      [0.022 * scale, 0.019 * scale], null,
      { mat: 'accent', ref: [0, 0, 1], cap: 0.37, sides: 20 });

    const neckBase = h('neck');
    m.capsule('Inner neck', 'neck',
      tuple(neckBase.clone().add(p(0, 0, -0.14))), tuple(t('neck').clone().add(p(0, 0, 0.1))),
      [0.225 * scale, 0.22 * scale], null, { mat: 'joint', ref: [1, 0, 0], cap: 0.3 });
    m.capsule('Neck shell', 'neck',
      tuple(neckBase.clone().add(p(0, 0, 0.035))), tuple(t('neck').clone().add(p(0, 0, -0.06))),
      [0.235 * scale, 0.225 * scale], null, { mat: 'secondary', ref: [1, 0, 0], cap: 0.27 });

    const headBase = h('Head');
    m.capsule('Head', 'Head',
      tuple(headBase.clone().add(p(0, 0, -0.17))), tuple(t('Head').clone().add(p(0, 0, 0.89))),
      [0.5 * scale, 0.455 * scale], [0.59 * scale, 0.49 * scale],
      { mat: 'porcelain', ref: [1, 0, 0], cap: 0.36, bulge: 0.025, sides: 40 });
    for (const name of ['Eye_L', 'Eye_R']) {
      const eye = h(name);
      m.ball(`Eye dot ${name}`, name, tuple(eye.clone().add(p(0, -0.39, 0.12))),
        [0.052 * scale, 0.027 * scale, 0.078 * scale], { mat: 'face', sides: 20 });
  }
    const jaw = h('Jaw');
    m.capsule('Neutral mouth', 'Jaw',
      tuple(jaw.clone().add(p(-0.112, -0.502, -0.025))), tuple(jaw.clone().add(p(0.112, -0.502, -0.025))),
      [0.014 * scale, 0.015 * scale], null, { mat: 'face', ref: [0, 0, 1], cap: 0.38, sides: 16 });

    for (const side of ['L', 'R']) {
      const shoulder = `shoulder${side}`;
      const upper = `upper_arm${side}`;
      const forearm = `forearm${side}`;
      const hand = `hand${side}`;
      const udir = t(upper).clone().sub(h(upper)).normalize();
      const fdir = t(forearm).clone().sub(h(forearm)).normalize();
      const hdir = t(hand).clone().sub(h(hand)).normalize();

      m.capsule(`Shoulder cap ${side}`, shoulder,
        tuple(h(shoulder).clone().addScaledVector(udir, 0.055 * scale)),
        tuple(t(shoulder).clone().addScaledVector(udir, -0.014 * scale)),
        [0.275 * scale, 0.282 * scale], [0.295 * scale, 0.295 * scale],
        { mat: 'porcelain', ref: [0, 0, 1], cap: 0.4, sides: 28 });
      m.ball(`Shoulder joint ${side}`, upper, tuple(h(upper)),
        [0.285 * scale, 0.245 * scale, 0.268 * scale], { mat: 'joint' });
      m.capsule(`Upper arm ${side}`, upper,
        tuple(h(upper).clone().addScaledVector(udir, 0.17 * scale)),
        tuple(t(upper).clone().addScaledVector(udir, -0.115 * scale)),
        [0.265 * scale, 0.242 * scale], [0.213 * scale, 0.2 * scale],
        { mat: 'porcelain', ref: [0, 0, 1], cap: 0.27, bulge: 0.05 });
      m.ball(`Elbow ${side}`, forearm, tuple(h(forearm)),
        [0.198 * scale, 0.188 * scale, 0.198 * scale], { mat: 'joint' });
      m.capsule(`Forearm ${side}`, forearm,
        tuple(h(forearm).clone().addScaledVector(fdir, 0.125 * scale)),
        tuple(t(forearm).clone().addScaledVector(fdir, -0.11 * scale)),
        [0.213 * scale, 0.194 * scale], [0.158 * scale, 0.151 * scale],
        { mat: 'secondary', ref: [0, 0, 1], cap: 0.19, bulge: 0.06 });
      const twist = `Wrist_Twist_${side}`;
      m.capsule(`Wrist bearing ${side}`, twist,
        tuple(h(twist).clone().addScaledVector(fdir, -0.025 * scale)),
        tuple(t(twist).clone().addScaledVector(fdir, 0.012 * scale)),
        [0.135 * scale, 0.138 * scale], [0.134 * scale, 0.136 * scale],
        { mat: 'joint', ref: [0, 0, 1], cap: 0.27, sides: 24 });
      m.capsule(`Palm ${side}`, hand,
        tuple(h(hand).clone().addScaledVector(hdir, 0.018 * scale)),
        tuple(t(hand).clone().addScaledVector(hdir, 0.092 * scale)),
        [0.155 * scale, 0.205 * scale], [0.119 * scale, 0.229 * scale],
        { mat: 'porcelain', ref: [0, 0, 1], cap: 0.28, sides: 28 });

      // Четыре независимых пальца: каждая фаланга на своей кости.
      const chains = [
        [`point_1_${side}`, `point_2_${side}`, `point_3_${side}`],
        [`Mid_1_${side}`, `Mid_2_${side}`, `Mid_3_${side}`],
        [`ring_1_${side}`, `ring_2_${side}`, `ring_3_${side}`],
        [`Pink_1_${side}`, `Pink_2_${side}`, `pink_3_${side}`],
      ];
      const endBones = [`point_3_${side}_end`, `Mid_3_${side}_end`, `ring_3_${side}_end`, `pink_3_${side}_end`];
      chains.forEach((chain, fingerIndex) => {
        const endName = endBones[fingerIndex];
        chain.forEach((name, phalanxIndex) => {
          let start = h(name).clone();
          let finish = t(name).clone();
          const direction = finish.clone().sub(start).normalize();
          if (phalanxIndex === 0) start = start.clone().addScaledVector(direction, -0.022 * scale);
          if (phalanxIndex === 2) finish = t(endName).clone().addScaledVector(direction, -0.018 * scale);
          const size = (1 - 0.07 * fingerIndex) * (1 - 0.13 * phalanxIndex);
          const radius = [0.045 * scale * size, 0.045 * scale * size];
          m.capsule(`Finger ${fingerIndex + 1}.${phalanxIndex + 1} ${side}`, name,
            tuple(start), tuple(finish), radius, [radius[0] * 0.84, radius[1] * 0.85],
            { mat: 'porcelain', ref: [0, 0, 1], cap: 0.33, sides: 12 });
        });
      });
      for (const i of [1, 2, 3]) {
        const name = `thumb_${i}_${side}`;
        let start = h(name).clone();
        let finish = t(name).clone();
        const direction = finish.clone().sub(start).normalize();
        if (i === 1) start = start.clone().addScaledVector(direction, 0.027 * scale);
        if (i === 3) finish = t(`thumb_3_${side}_end`).clone().addScaledVector(direction, -0.015 * scale);
        const r = (0.088 - 0.016 * (i - 1)) * scale;
        m.capsule(`Thumb ${i} ${side}`, name, tuple(start), tuple(finish),
          [r, r * 0.91], [r * 0.83, r * 0.76],
          { mat: 'secondary', ref: [0, 0, 1], cap: 0.36, sides: 16 });
      }

      const thigh = `thigh${side}`;
      const shin = `shin${side}`;
      const foot = `foot${side}`;
      const toes = `Toes_${side}`;
      m.ball(`Hip joint ${side}`, thigh, tuple(h(thigh)),
        [0.29 * scale, 0.28 * scale, 0.3 * scale], { mat: 'joint' });
      m.capsule(`Thigh ${side}`, thigh,
        tuple(h(thigh).clone().lerp(t(thigh), 0.095)), tuple(h(thigh).clone().lerp(t(thigh), 0.92)),
        [0.346 * scale, 0.321 * scale], [0.266 * scale, 0.241 * scale],
        { mat: 'porcelain', ref: [1, 0, 0], cap: 0.155, bulge: 0.04 });
      m.ball(`Knee joint ${side}`, shin, tuple(h(shin)),
        [0.254 * scale, 0.247 * scale, 0.265 * scale], { mat: 'joint' });
      m.capsule(`Shin ${side}`, shin,
        tuple(h(shin).clone().lerp(t(shin), 0.075)), tuple(h(shin).clone().lerp(t(shin), 0.927)),
        [0.264 * scale, 0.244 * scale], [0.16 * scale, 0.162 * scale],
        { mat: 'secondary', ref: [1, 0, 0], cap: 0.14, bulge: 0.12 });
      m.ball(`Kneecap ${side}`, shin,
        tuple(h(shin).clone().add(p(0, -0.19, 0.005))),
        [0.165 * scale, 0.066 * scale, 0.142 * scale], { mat: 'porcelain', sides: 24 });
      const ankle = h(foot);
      m.ball(`Ankle joint ${side}`, foot, tuple(ankle),
        [0.177 * scale, 0.177 * scale, 0.178 * scale], { mat: 'joint', sides: 24 });
      m.capsule(`Foot ${side}`, foot,
        tuple(ankle.clone().add(p(0, 0.195, -0.275))), tuple(t(foot).clone().add(p(0, -0.085, 0.075))),
        [0.255 * scale, 0.205 * scale], [0.295 * scale, 0.169 * scale],
        { mat: 'porcelain', ref: [1, 0, 0], cap: 0.3, sides: 28 });
      m.capsule(`Sole ${side}`, foot,
        tuple(ankle.clone().add(p(0, 0.135, -0.493))), tuple(t(foot).clone().add(p(0, -0.075, -0.051))),
        [0.24 * scale, 0.033 * scale], [0.275 * scale, 0.037 * scale],
        { mat: 'joint', ref: [1, 0, 0], cap: 0.25, sides: 24 });
      m.capsule(`Toe ${side}`, toes,
        tuple(h(toes).clone().add(p(0, 0.015, 0.073))),
        tuple(t(`${toes}_end`).clone().add(p(0, 0.012, 0.096))),
        [0.29 * scale, 0.162 * scale], [0.255 * scale, 0.134 * scale],
        { mat: 'porcelain', ref: [1, 0, 0], cap: 0.35, sides: 28 });
      m.capsule(`Toe sole ${side}`, toes,
        tuple(h(toes).clone().add(p(0, 0.015, -0.073))),
        tuple(t(`${toes}_end`).clone().add(p(0, 0.035, -0.001))),
        [0.265 * scale, 0.028 * scale], [0.235 * scale, 0.028 * scale],
        { mat: 'joint', ref: [1, 0, 0], cap: 0.3, sides: 20 });
  }

    const { geometry, partCount, parts } = m.build();

    // Кости: отдельная группа `Armature` с тем же разворотом, что у эталонного FBX.
    const armature = new THREE.Group();
    armature.name = 'Armature';
    armature.rotation.x = -Math.PI / 2;
    armature.scale.setScalar(MODEL_UNIT_SCALE);
    for (const bone of roots) armature.add(bone);
    armature.updateMatrixWorld(true);

    const paletteEntries = resolveMaterialPalette(palette);
    const materials = paletteEntries.map((entry) => {
      const material = new THREE.MeshStandardMaterial({
        name: entry.name,
        roughness: entry.roughness,
        metalness: entry.metalness,
      });
      material.color.setRGB(entry.color[0], entry.color[1], entry.color[2], THREE.LinearSRGBColorSpace);
      if (entry.override !== undefined) applyPaletteColor(material.color, entry.override);
      return material;
  });

    const mesh = new THREE.SkinnedMesh(geometry, materials);
    mesh.name = 'Capsule_Character';
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(MODEL_UNIT_SCALE);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    const group = new THREE.Group();
    group.name = 'CapsuleMannequin';
    group.add(armature);
    group.add(mesh);
    group.updateMatrixWorld(true);

    const skeleton = new THREE.Skeleton(boneOrder.map((name) => bones.get(name)));
    mesh.bind(skeleton);
    group.userData.__proceduralCapsuleMannequin = { shellCount: partCount, parts };

    return {
      group,
      mesh,
      armature,
      skeleton,
      bones,
      boneMap: Object.fromEntries(boneOrder.map((name) => [name, name])),
      shellCount: partCount,
  };
  }

    return build;
  }
