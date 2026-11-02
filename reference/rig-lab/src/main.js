import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// All assets are local: the browser never needs a CDN or a backend API.
const $ = (id) => document.getElementById(id);
const dom = {
  stage: $('stage'), canvas: $('sceneCanvas'), loading: $('loadingOverlay'),
  progress: $('loadingProgress'), loadingMessage: $('loadingMessage'),
  boneTree: $('boneTree'), search: $('boneSearch'), tooltip: $('boneTooltip'),
  inspector: $('boneInspector'), emptySelection: $('emptySelection'),
  toast: $('toast'), poseName: $('poseName'), viewportStatus: $('viewportStatus'),
};

const friendly = {
  'Hips': 'Таз', 'spine': 'Позвоночник', 'Lowerchest': 'Нижняя грудь',
  'upper chest': 'Грудная клетка', 'neck': 'Шея', 'Head': 'Голова', 'Jaw': 'Челюсть',
  'Eye L': 'Левый глаз', 'Eye R': 'Правый глаз',
  'shoulder.L': 'Левая ключица', 'upper_arm.L': 'Левое плечо',
  'forearm.L': 'Левое предплечье', 'hand.L': 'Левая кисть',
  'shoulder.R': 'Правая ключица', 'upper_arm.R': 'Правое плечо',
  'forearm.R': 'Правое предплечье', 'hand.R': 'Правая кисть',
  'Wrist Twist L': 'Левое запястье', 'Wrist Twist R': 'Правое запястье',
  'thigh.L': 'Левое бедро', 'shin.L': 'Левая голень', 'foot.L': 'Левая стопа',
  'Toes L': 'Левые пальцы ноги', 'thigh.R': 'Правое бедро', 'shin.R': 'Правая голень',
  'foot.R': 'Правая стопа', 'Toes R': 'Правые пальцы ноги',
  'ROOT Breasts': 'Вторичные кости груди', 'ButtBone L': 'Таз: дополнительная Л',
  'ButtBone R': 'Таз: дополнительная П',
};

const groups = [
  { id: 'torso', title: 'КОРПУС И ГОЛОВА', defaultOpen: true },
  { id: 'leftArm', title: 'ЛЕВАЯ РУКА', defaultOpen: true },
  { id: 'rightArm', title: 'ПРАВАЯ РУКА', defaultOpen: true },
  { id: 'leftLeg', title: 'ЛЕВАЯ НОГА', defaultOpen: true },
  { id: 'rightLeg', title: 'ПРАВАЯ НОГА', defaultOpen: true },
  { id: 'fingers', title: 'ПАЛЬЦЫ РУК', defaultOpen: false },
  { id: 'secondary', title: 'ДОП. / КОНЦЕВЫЕ', defaultOpen: false },
];
const groupOpen = new Map(groups.map(g => [g.id, g.defaultOpen]));
const primaryNames = new Set([
  'Hips', 'spine', 'Lowerchest', 'upper chest', 'neck', 'Head',
  'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L', 'Wrist Twist L',
  'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R', 'Wrist Twist R',
  'thigh.L', 'shin.L', 'foot.L', 'Toes L',
  'thigh.R', 'shin.R', 'foot.R', 'Toes R',
]);
const POSE_STORAGE = 'capsule-rig-lab-pose-v1';
const THREE_AXES = 'XYZ';

let scene, camera, renderer, orbit, transform, skeletonHelper, grid;
let character = null;
let skinnedMeshes = [];
let bones = [];
const rawNames = new WeakMap();
const byName = new Map();
const restRotations = new Map();
const markerByBone = new Map();
const markerMeshes = [];
let selectedBone = null;
let hoveredBone = null;
let jointsVisible = true;
let linesVisible = false;
let gridVisible = true;
let draggingGizmo = false;
let cameraTween = null;
let activePreset = 'relaxed';
let saveTimer = null;
let toastTimer = null;
let downPoint = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tmpWorld = new THREE.Vector3();
const localQ = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

function rawName(bone) { return rawNames.get(bone) || bone?.name || '—'; }
function labelFor(name) {
  if (friendly[name]) return friendly[name];
  if (name.startsWith('Breast')) return 'Доп. грудная кость';
  if (name.startsWith('ButtBone')) return 'Доп. кость таза';
  if (name.endsWith('_end')) return 'Концевая · ' + name.slice(0, -4);
  return name;
}
function category(name) {
  if (name.endsWith('_end') || name.includes('Breast') || name.includes('ButtBone')) return 'secondary';
  if (/^(point|Mid|ring|Ring|Pink|pink|thumb)\s/i.test(name)) return 'fingers';
  if (/^(shoulder\.|upper_arm\.|forearm\.|hand\.|Wrist Twist)/.test(name)) {
    return name.endsWith('.L') || name.endsWith(' L') ? 'leftArm' : 'rightArm';
  }
  if (/^(thigh\.|shin\.|foot\.|Toes )/.test(name)) {
    return name.endsWith('.L') || name.endsWith(' L') ? 'leftLeg' : 'rightLeg';
  }
  return 'torso';
}
function sideFor(name) {
  if (name.endsWith('.L') || name.endsWith(' L') || /Eye L/.test(name)) return 'ЛЕВАЯ';
  if (name.endsWith('.R') || name.endsWith(' R') || /Eye R/.test(name)) return 'ПРАВАЯ';
  return 'ЦЕНТР';
}

function toast(message, error = false) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle('is-error', error);
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 3100);
}

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(2.0, 2.0, 4.4);
  renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0d1c29, 0);

  orbit = new OrbitControls(camera, dom.canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.085;
  orbit.target.set(0, 1.07, 0);
  orbit.minDistance = 1.9;
  orbit.maxDistance = 12;
  orbit.maxPolarAngle = Math.PI / 2.02;
  orbit.update();

  transform = new TransformControls(camera, dom.canvas);
  transform.setMode('rotate');
  transform.setSpace('local');
  transform.setSize(0.53);
  scene.add(transform.getHelper());
  transform.getHelper().visible = false;
  transform.addEventListener('dragging-changed', (e) => {
    draggingGizmo = !!e.value;
    orbit.enabled = !e.value;
    if (!e.value) { updateInspectorValues(); queueSave(); }
  });
  transform.addEventListener('objectChange', () => {
    if (!selectedBone) return;
    updateInspectorValues();
    setPoseName('custom');
  });

  const hemi = new THREE.HemisphereLight(0xe8f9f4, 0x314454, 2.15);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e9, 3.0);
  key.position.set(-3.2, 8.5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 3;
  key.shadow.camera.left = -3.1; key.shadow.camera.right = 3.1;
  key.shadow.camera.top = 4.0; key.shadow.camera.bottom = -3.1;
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 18;
  key.shadow.bias = -0.00013;
  key.shadow.normalBias = 0.022;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0x9ec7e2, 1.15);
  fill.position.set(2.8, 3.1, -2.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc7fae7, 1.5);
  rim.position.set(0.8, 4.0, -4);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({
    color: 0x1b2a33, roughness: 0.98, metalness: 0.05, transparent: true, opacity: 0.89,
  }));
  ground.name = 'Ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  scene.add(ground);
  grid = new THREE.GridHelper(12, 32, 0x5b8b89, 0x38515b);
  grid.position.y = -0.008;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  grid.material.depthWrite = false;
  scene.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.13, 1.139, 120), new THREE.MeshBasicMaterial({
    color: 0x82cdbb, side: THREE.DoubleSide, transparent: true, opacity: 0.23, depthWrite: false,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.001;
  ring.name = 'Ground scale ring';
  scene.add(ring);

  const observer = new ResizeObserver(() => resize());
  observer.observe(dom.stage);
  resize();
  requestAnimationFrame(animate);
}

function getHomeDistance() {
  const aspect = Math.max(0.45, dom.stage.clientWidth / Math.max(1, dom.stage.clientHeight));
  return 4.95 * Math.max(1, 0.68 / aspect);
}
function desiredView(view = 'angle') {
  const dirs = {
    angle: new THREE.Vector3(0.42, 0.21, 0.88),
    front: new THREE.Vector3(0, 0.12, 1),
    side: new THREE.Vector3(1, 0.12, 0),
  };
  const target = new THREE.Vector3(0, 1.07, 0);
  const position = target.clone().add(dirs[view].clone().normalize().multiplyScalar(getHomeDistance()));
  return { target, position };
}
function resize() {
  if (!renderer) return;
  const w = Math.max(1, dom.stage.clientWidth), h = Math.max(1, dom.stage.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function moveCamera(view = 'angle', instant = false) {
  const desired = desiredView(view);
  if (instant) {
    camera.position.copy(desired.position);
    orbit.target.copy(desired.target);
    orbit.update();
    cameraTween = null;
  } else {
    cameraTween = {
      start: performance.now(), duration: 680,
      fromPos: camera.position.clone(), toPos: desired.position,
      fromTarget: orbit.target.clone(), toTarget: desired.target,
    };
  }
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('is-active', el.dataset.view === view));
}
function focusSelected() {
  if (!selectedBone) { moveCamera('angle'); return; }
  selectedBone.getWorldPosition(tmpWorld);
  const target = tmpWorld.clone();
  const direction = camera.position.clone().sub(orbit.target).normalize();
  const position = target.clone().addScaledVector(direction, Math.min(getHomeDistance() * 0.62, 3.2));
  cameraTween = {
    start: performance.now(), duration: 650,
    fromPos: camera.position.clone(), toPos: position,
    fromTarget: orbit.target.clone(), toTarget: target,
  };
}
function animate(time) {
  requestAnimationFrame(animate);
  if (cameraTween) {
    const u = Math.min(1, (time - cameraTween.start) / cameraTween.duration);
    const eased = 1 - Math.pow(1 - Math.max(0, u), 3);
    camera.position.lerpVectors(cameraTween.fromPos, cameraTween.toPos, eased);
    orbit.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
    if (u >= 1) cameraTween = null;
  }
  orbit.update();
  if (character) {
    character.updateMatrixWorld(true);
    for (const [bone, marker] of markerByBone) {
      bone.getWorldPosition(marker.position);
      const primary = primaryNames.has(rawName(bone));
      marker.visible = jointsVisible && (primary || linesVisible || selectedBone === bone || hoveredBone === bone);
      const r = bone === selectedBone ? 0.041 : (bone === hoveredBone ? 0.034 : primary ? 0.025 : 0.012);
      marker.scale.setScalar(r);
      marker.material = bone === selectedBone ? selectedMarkerMaterial :
                        bone === hoveredBone ? hoverMarkerMaterial :
                        primary ? markerMaterial : detailMarkerMaterial;
    }
    // SkeletonHelper refreshes its line vertices in updateMatrixWorld() during rendering.
  }
  renderer.render(scene, camera);
}

const markerGeometry = new THREE.SphereGeometry(1, 10, 8);
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xc4e8dd, transparent: true, opacity: .67, depthTest: false, depthWrite: false });
const detailMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x83b5ac, transparent: true, opacity: .65, depthTest: false, depthWrite: false });
const hoverMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false });
const selectedMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x9ef4d5, depthTest: false, depthWrite: false });

function loadCharacter() {
  const path = `${import.meta.env.BASE_URL}model/capsule_character.glb`;
  new GLTFLoader().load(path, (gltf) => {
    character = gltf.scene;
    character.name = 'Capsule / original 85-bone rig';
    scene.add(character);
    skinnedMeshes = [];
    character.traverse((o) => {
      if (o.isSkinnedMesh) {
        skinnedMeshes.push(o);
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // bone transforms can extend beyond the rest-pose box
      }
    });
    if (!skinnedMeshes.length) throw new Error('No skinned meshes found in the GLB');
    bones = skinnedMeshes[0].skeleton.bones;
    if (bones.length !== 85) throw new Error(`Expected 85 original bones; found ${bones.length}`);

    // Three.js sanitizes node names (e.g. upper_arm.L -> upper_armL). The
    // parser association recovers EXACT original bone names from glTF JSON.
    for (const bone of bones) {
      const association = gltf.parser.associations.get(bone);
      const name = association?.nodes !== undefined
        ? gltf.parser.json.nodes[association.nodes]?.name || bone.name
        : bone.name;
      rawNames.set(bone, name);
      byName.set(name, bone);
      restRotations.set(bone, bone.quaternion.clone());
    }
    const box = new THREE.Box3().setFromObject(character, true);
    const dimensions = box.getSize(new THREE.Vector3());
    const scale = 2.22 / dimensions.y;
    character.scale.setScalar(scale);
    character.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(character, true);
    const center = fitted.getCenter(new THREE.Vector3());
    character.position.set(-center.x, -fitted.min.y + 0.012, -center.z);
    character.updateMatrixWorld(true);

    skeletonHelper = new THREE.SkeletonHelper(character);
    skeletonHelper.visible = false;
    skeletonHelper.material.color.set(0x93d9c8);
    skeletonHelper.material.transparent = true;
    skeletonHelper.material.opacity = .62;
    skeletonHelper.material.depthTest = false;
    skeletonHelper.material.depthWrite = false;
    scene.add(skeletonHelper);
    for (const bone of bones) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.userData.bone = bone;
      marker.name = `Handle: ${rawName(bone)}`;
      marker.renderOrder = 15;
      marker.frustumCulled = false;
      scene.add(marker);
      markerByBone.set(bone, marker);
      markerMeshes.push(marker);
    }

    $('boneCount').textContent = String(bones.length);
    dom.viewportStatus.textContent = `${bones.length} КОСТЕЙ · ${skinnedMeshes.length} МАТЕРИАЛОВ`;
    renderBoneTree();
    const saved = tryRestorePose();
    if (!saved) applyPreset('relaxed', false);
    selectBone(byName.get('upper_arm.L'), false);
    moveCamera('angle', true);
    dom.progress.style.width = '100%';
    setTimeout(() => { dom.loading.classList.add('is-hidden'); setTimeout(() => dom.loading.remove(), 400); }, 220);
  }, (event) => {
    if (event.total) {
      const progress = Math.max(4, Math.min(92, event.loaded / event.total * 92));
      dom.progress.style.width = `${progress.toFixed(1)}%`;
      dom.loadingMessage.textContent = `Загружено ${Math.round(progress)}%`;
    }
  }, (error) => {
    console.error(error);
    loadingError('Не удалось загрузить персонажа. Проверьте, что сайт запущен через npm run dev.');
  });
}
function loadingError(message) {
  dom.loading.querySelector('strong').textContent = 'Ошибка загрузки';
  dom.loading.querySelector('p').textContent = message;
  dom.loadingMessage.textContent = 'Подробнее в консоли браузера';
  dom.progress.style.width = '100%';
  dom.progress.style.background = '#e9b2a8';
  dom.viewportStatus.textContent = 'МОДЕЛЬ НЕ ЗАГРУЖЕНА';
}

function renderBoneTree() {
  const search = dom.search.value.trim().toLocaleLowerCase('ru');
  const currentScroll = dom.boneTree.scrollTop;
  dom.boneTree.replaceChildren();
  let shown = 0;
  for (const group of groups) {
    const items = bones.filter(bone => {
      const name = rawName(bone);
      return category(name) === group.id && (!search || (name + ' ' + labelFor(name)).toLocaleLowerCase('ru').includes(search));
    });
    if (!items.length) continue;
    shown += items.length;
    const block = document.createElement('div');
    block.className = 'bone-group';
    const open = search ? true : groupOpen.get(group.id);
    if (open) block.classList.add('is-open');
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'group-heading';
    heading.setAttribute('aria-expanded', String(open));
    heading.innerHTML = `<span class="group-chevron">▸</span><span></span><span class="group-count">${items.length.toString().padStart(2, '0')}</span>`;
    heading.children[1].textContent = group.title;
    heading.addEventListener('click', () => {
      const next = !block.classList.contains('is-open');
      groupOpen.set(group.id, next);
      block.classList.toggle('is-open', next);
      heading.setAttribute('aria-expanded', String(next));
    });
    block.append(heading);
    const contents = document.createElement('div');
    contents.className = 'group-contents';
    for (const bone of items) {
      const name = rawName(bone);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bone-row' + (bone === selectedBone ? ' is-selected' : '');
      row.dataset.bone = name;
      row.title = `${labelFor(name)} · ${name}`;
      const dot = document.createElement('span'); dot.className = 'bone-node';
      const text = document.createElement('span'); text.className = 'bone-text'; text.textContent = labelFor(name);
      row.append(dot, text);
      if (group.id === 'fingers' || group.id === 'secondary') {
        const code = document.createElement('span'); code.className = 'bone-code';
        code.textContent = name.endsWith('_end') ? 'END' : (name.match(/\b[123]\b/)?.[0] ?? '');
        row.append(code);
      }
      row.addEventListener('click', () => { selectBone(bone); closeDrawers(); });
      contents.append(row);
    }
    block.append(contents);
    dom.boneTree.append(block);
  }
  if (!shown) {
    const empty = document.createElement('div');
    empty.className = 'tree-loading';
    empty.textContent = 'Ничего не найдено';
    dom.boneTree.append(empty);
  }
  if (!search) dom.boneTree.scrollTop = currentScroll;
}
function updateTreeSelection(scrollToSelection = false) {
  const selectedName = selectedBone ? rawName(selectedBone) : '';
  let selectedRow = null;
  for (const row of dom.boneTree.querySelectorAll('.bone-row')) {
    const active = row.dataset.bone === selectedName;
    row.classList.toggle('is-selected', active);
    if (active) selectedRow = row;
  }
  if (scrollToSelection && selectedRow) {
    const group = selectedRow.closest('.bone-group');
    if (group && !group.classList.contains('is-open')) {
      group.classList.add('is-open');
      groupOpen.set(category(selectedName), true);
      group.querySelector('.group-heading')?.setAttribute('aria-expanded', 'true');
    }
    selectedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
function selectBone(bone, scroll = true) {
  selectedBone = bone || null;
  if (selectedBone) {
    transform.attach(selectedBone);
    transform.getHelper().visible = true;
    const name = rawName(selectedBone);
    const index = bones.indexOf(selectedBone) + 1;
    $('selectedFriendly').textContent = labelFor(name);
    $('selectedRaw').textContent = name;
    $('selectedCounter').textContent = `КОСТЬ ${String(index).padStart(2, '0')} / ${bones.length}`;
    $('selectedSide').textContent = sideFor(name);
    const parent = selectedBone.parent?.isBone ? selectedBone.parent : null;
    $('parentBone').textContent = parent ? labelFor(rawName(parent)) : '— (корень)';
    $('parentBone').disabled = !parent;
    $('parentBone').onclick = parent ? () => selectBone(parent) : null;
    $('childCount').textContent = String(selectedBone.children.filter(c => c.isBone).length);
    updateInspectorValues();
  } else {
    transform.detach();
    transform.getHelper().visible = false;
  }
  dom.inspector.hidden = !selectedBone;
  dom.emptySelection.hidden = !!selectedBone;
  updateTreeSelection(scroll);
}

function relativeEuler(bone) {
  const rest = restRotations.get(bone);
  if (!rest) return new THREE.Euler();
  localQ.copy(rest).invert().multiply(bone.quaternion).normalize();
  return tmpEuler.setFromQuaternion(localQ, 'XYZ');
}
function updateInspectorValues() {
  if (!selectedBone) return;
  const e = relativeEuler(selectedBone);
  for (let i = 0; i < 3; i++) {
    const axis = THREE_AXES[i];
    const degrees = THREE.MathUtils.radToDeg(e[axis.toLowerCase()]);
    const value = Number(degrees.toFixed(1));
    const slider = $(`slider${axis}`), number = $(`number${axis}`);
    slider.value = String(Math.round(value));
    slider.style.setProperty('--fill', `${((value + 180) / 360 * 100).toFixed(1)}%`);
    if (document.activeElement !== number) number.value = String(value);
  }
}
function rotateSelected(axis, degrees) {
  if (!selectedBone || !Number.isFinite(degrees)) return;
  const e = relativeEuler(selectedBone).clone();
  e[axis.toLowerCase()] = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(degrees, -180, 180));
  selectedBone.quaternion.copy(restRotations.get(selectedBone)).multiply(new THREE.Quaternion().setFromEuler(e));
  selectedBone.updateMatrixWorld(true);
  updateInspectorValues();
  setPoseName('custom');
  queueSave();
}
function resetBone() {
  if (!selectedBone) return;
  selectedBone.quaternion.copy(restRotations.get(selectedBone));
  selectedBone.updateMatrixWorld(true);
  updateInspectorValues();
  setPoseName('custom');
  queueSave();
  toast(`${labelFor(rawName(selectedBone))}: возвращена исходная ориентация`);
}
function resetAllBones() {
  for (const bone of bones) bone.quaternion.copy(restRotations.get(bone));
  character?.updateMatrixWorld(true);
  updateInspectorValues();
}
function poseBone(name, x = 0, y = 0, z = 0) {
  const bone = byName.get(name);
  if (!bone) return;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z), 'XYZ',
  ));
  bone.quaternion.copy(restRotations.get(bone)).multiply(q);
}
const presets = {
  rest: { title: 'ИСХОДНАЯ Т-ПОЗА', rotations: [] },
  relaxed: { title: 'СПОКОЙНАЯ ПОЗА', rotations: [
    ['upper_arm.L', 7, 0, -38], ['upper_arm.R', 7, 0, 37],
    ['forearm.L', 11, 0, -3], ['forearm.R', 12, 0, 3],
    ['hand.L', -5, 0, 0], ['hand.R', -5, 0, 0],
  ] },
  hello: { title: 'ПРИВЕТСТВИЕ', rotations: [
    ['upper_arm.L', 0, 0, -47], ['forearm.L', 16, 0, 3],
    ['upper_arm.R', 0, 0, -49], ['forearm.R', 14, 0, -44],
    ['hand.R', 0, 0, -13], ['Head', 0, 9, 4],
  ] },
  step: { title: 'ШАГ ВПЕРЁД', rotations: [
    ['upper_arm.L', -5, 0, -37], ['upper_arm.R', 6, 0, 36],
    ['forearm.L', 14, 0, 5], ['forearm.R', 11, 0, -7],
    ['thigh.L', -23, 0, 0], ['shin.L', 35, 0, 0], ['foot.L', -8, 0, 0],
    ['thigh.R', 10, 0, 0], ['shin.R', 6, 0, 0],
  ] },
};
function setPoseName(id) {
  activePreset = id;
  dom.poseName.textContent = presets[id]?.title || 'СВОЯ ПОЗА';
  document.querySelectorAll('[data-preset]').forEach(el => el.classList.toggle('is-active', el.dataset.preset === id));
}
function applyPreset(id, notify = true) {
  if (!bones.length || !presets[id]) return;
  resetAllBones();
  for (const [name, x, y, z] of presets[id].rotations) poseBone(name, x, y, z);
  character.updateMatrixWorld(true);
  updateInspectorValues();
  setPoseName(id);
  queueSave();
  if (notify) toast(`${id === 'rest' ? 'Все кости возвращены к Т-позе' : `Поза: ${presets[id].title.toLocaleLowerCase('ru')}`}`);
}

function poseData() {
  const pose = {};
  for (const bone of bones) {
    const q = restRotations.get(bone).clone().invert().multiply(bone.quaternion).normalize();
    pose[rawName(bone)] = q.toArray().map(n => Number(n.toFixed(7)));
  }
  return { format: 'capsule-rig-pose', version: 1, source: 'anime-base-tall.fbx',
           created: new Date().toISOString(), bones: pose };
}
function applyPoseData(data, notify = true) {
  if (data?.format !== 'capsule-rig-pose' || data?.version !== 1 || typeof data?.bones !== 'object')
    throw new Error('Файл не похож на позу Capsule Lab');
  resetAllBones();
  let count = 0;
  for (const [name, components] of Object.entries(data.bones)) {
    const bone = byName.get(name);
    if (!bone || !Array.isArray(components) || components.length !== 4 ||
        components.some(n => !Number.isFinite(n))) continue;
    const relative = new THREE.Quaternion().fromArray(components);
    if (relative.lengthSq() < 0.01) continue;
    bone.quaternion.copy(restRotations.get(bone)).multiply(relative.normalize());
    count++;
  }
  if (!count) throw new Error('В файле нет костей этого скелета');
  character.updateMatrixWorld(true);
  updateInspectorValues();
  setPoseName('custom');
  queueSave();
  if (notify) toast(`Загружена поза: ${count} костей`);
}
function queueSave() {
  clearTimeout(saveTimer);
  if (!bones.length) return;
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(POSE_STORAGE, JSON.stringify(poseData())); } catch (_) { /* storage optional */ }
  }, 360);
}
function tryRestorePose() {
  try {
    const saved = localStorage.getItem(POSE_STORAGE);
    if (saved) { applyPoseData(JSON.parse(saved), false); return true; }
  } catch (err) { console.warn('Autosaved pose unavailable:', err); }
  return false;
}
function downloadPose() {
  if (!bones.length) return toast('Сначала дождитесь загрузки модели', true);
  const json = JSON.stringify(poseData(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'capsule-pose.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Поза сохранена в capsule-pose.json');
}

function rayFromEvent(event) {
  const rect = dom.canvas.getBoundingClientRect();
  mouse.set((event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
}
function raycastMarkers() {
  if (!jointsVisible) return null;
  const picks = raycaster.intersectObjects(markerMeshes.filter(m => m.visible), false);
  return picks[0]?.object?.userData.bone || null;
}
function raycastMesh() {
  if (!skinnedMeshes.length) return null;
  const hit = raycaster.intersectObjects(skinnedMeshes, false)[0];
  if (!hit?.face) return null;
  const mesh = hit.object;
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  if (!indices || !weights) return null;
  const influence = new Map();
  for (const vert of [hit.face.a, hit.face.b, hit.face.c]) {
    for (let j = 0; j < 4; j++) {
      const weight = weights.getComponent(vert, j);
      if (weight <= 0) continue;
      const index = indices.getComponent(vert, j);
      influence.set(index, (influence.get(index) || 0) + weight);
    }
  }
  let best = -1, strength = 0;
  for (const [index, value] of influence) if (value > strength) { best = index; strength = value; }
  return mesh.skeleton.bones[best] || null;
}
function handlePointerMove(event) {
  if (!bones.length || draggingGizmo || transform.axis) {
    dom.tooltip.classList.remove('is-visible');
    dom.canvas.style.cursor = transform?.axis ? 'grab' : 'auto';
    return;
  }
  rayFromEvent(event);
  const bone = raycastMarkers();
  hoveredBone = bone;
  dom.canvas.style.cursor = bone ? 'pointer' : 'auto';
  if (bone) {
    const rect = dom.stage.getBoundingClientRect();
    dom.tooltip.textContent = `${labelFor(rawName(bone))} · ${rawName(bone)}`;
    dom.tooltip.style.left = `${Math.min(rect.width - 160, event.clientX - rect.left + 5)}px`;
    dom.tooltip.style.top = `${event.clientY - rect.top}px`;
    dom.tooltip.classList.add('is-visible');
  } else dom.tooltip.classList.remove('is-visible');
}
function setupCanvasEvents() {
  dom.canvas.addEventListener('pointerdown', (event) => {
    cameraTween = null;
    downPoint = { x: event.clientX, y: event.clientY, gizmo: !!transform?.axis };
  });
  dom.canvas.addEventListener('pointerup', (event) => {
    if (!downPoint) return;
    const distance = Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y);
    const usedGizmo = downPoint.gizmo || draggingGizmo;
    downPoint = null;
    if (distance > 5 || usedGizmo || !bones.length) return;
    rayFromEvent(event);
    const bone = raycastMarkers() || raycastMesh();
    if (bone) { selectBone(bone); closeDrawers(); }
    else selectBone(null);
  });
  dom.canvas.addEventListener('pointermove', handlePointerMove);
  dom.canvas.addEventListener('pointerleave', () => {
    hoveredBone = null;
    dom.tooltip.classList.remove('is-visible');
    dom.canvas.style.cursor = 'auto';
  });
}

function closeDrawers() {
  $('bonesPanel').classList.remove('is-open');
  $('inspectorPanel').classList.remove('is-open');
  document.querySelector('.workspace').classList.remove('has-drawer');
}
function toggleDrawer(id) {
  const panel = $(id), open = !panel.classList.contains('is-open');
  closeDrawers();
  if (open) {
    panel.classList.add('is-open');
    document.querySelector('.workspace').classList.add('has-drawer');
  }
}
function showHelp(show = true) { $('helpModal').hidden = !show; }

function setupUI() {
  setupCanvasEvents();
  $('mobileBonesBtn').addEventListener('click', () => toggleDrawer('bonesPanel'));
  $('mobileInspectorBtn').addEventListener('click', () => toggleDrawer('inspectorPanel'));
  dom.stage.addEventListener('click', (e) => {
    if (document.querySelector('.workspace').classList.contains('has-drawer')) {
      if (e.target === dom.stage || e.target === dom.canvas) closeDrawers();
    }
  });
  dom.search.addEventListener('input', renderBoneTree);
  document.querySelectorAll('[data-preset]').forEach(button => {
    button.addEventListener('click', () => applyPreset(button.dataset.preset));
  });
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => moveCamera(button.dataset.view));
  });
  $('fitView').addEventListener('click', () => moveCamera('angle'));
  $('focusBone').addEventListener('click', focusSelected);
  $('resetBone').addEventListener('click', resetBone);
  $('resetAll').addEventListener('click', () => applyPreset('rest'));
  $('headerExport').addEventListener('click', downloadPose);
  $('exportPose').addEventListener('click', downloadPose);
  $('importPose').addEventListener('click', () => $('poseFile').click());
  $('poseFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) try { applyPoseData(JSON.parse(await file.text())); }
    catch (error) { toast(error.message || 'Не удалось прочитать JSON', true); }
    e.target.value = '';
  });
  for (const axis of THREE_AXES) {
    const slider = $(`slider${axis}`), number = $(`number${axis}`);
    slider.addEventListener('input', () => {
      number.value = slider.value;
      rotateSelected(axis, Number(slider.value));
    });
    number.addEventListener('input', () => {
      if (number.value === '' || number.value === '-') return;
      rotateSelected(axis, Number(number.value));
    });
    number.addEventListener('blur', updateInspectorValues);
  }
  document.querySelectorAll('[data-space]').forEach(button => {
    button.addEventListener('click', () => {
      transform.setSpace(button.dataset.space);
      document.querySelectorAll('[data-space]').forEach(el => el.classList.toggle('is-active', el === button));
    });
  });
  $('jointToggle').addEventListener('click', () => {
    jointsVisible = !jointsVisible;
    $('jointToggle').classList.toggle('is-active', jointsVisible);
    $('jointToggle').setAttribute('aria-pressed', String(jointsVisible));
  });
  $('lineToggle').addEventListener('click', () => {
    linesVisible = !linesVisible;
    if (skeletonHelper) skeletonHelper.visible = linesVisible;
    $('lineToggle').classList.toggle('is-active', linesVisible);
    $('lineToggle').setAttribute('aria-pressed', String(linesVisible));
  });
  $('gridToggle').addEventListener('click', () => {
    gridVisible = !gridVisible;
    if (grid) grid.visible = gridVisible;
    $('gridToggle').classList.toggle('is-active', gridVisible);
    $('gridToggle').setAttribute('aria-pressed', String(gridVisible));
  });
  $('helpBtn').addEventListener('click', () => showHelp(true));
  $('closeHelp').addEventListener('click', () => showHelp(false));
  $('gotIt').addEventListener('click', () => showHelp(false));
  $('helpModal').addEventListener('click', (event) => { if (event.target === $('helpModal')) showHelp(false); });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') transform?.setRotationSnap(THREE.MathUtils.degToRad(15));
    const textTarget = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
    if (event.key === 'Escape') {
      if (!$('helpModal').hidden) showHelp(false); else { closeDrawers(); selectBone(null); }
      return;
    }
    if (textTarget) return;
    if (event.key === '/') { event.preventDefault(); dom.search.focus(); return; }
    if (event.key.toLowerCase() === 'f') moveCamera('angle');
    if (event.key.toLowerCase() === 'r') resetBone();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') transform?.setRotationSnap(null);
  });
}

try {
  initScene();
  setupUI();
  loadCharacter();
} catch (error) {
  console.error('Capsule Lab failed to start:', error);
  loadingError('Не удалось создать 3D-сцену. Проверьте поддержку WebGL в браузере.');
}
