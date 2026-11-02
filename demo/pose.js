import * as THREE from 'three';
import { ORIGINAL_BONE_NAMES } from './bone-names.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export const PRESETS = {
  rest: { label: 'Т-поза', rotations: [] },
  relaxed: { label: 'Спокойно', rotations: [
    ['upper_arm.L',7,0,-38], ['upper_arm.R',7,0,37], ['forearm.L',11,0,-3],
    ['forearm.R',12,0,3], ['hand.L',-5,0,0], ['hand.R',-5,0,0],
  ] },
  hello: { label: 'Привет', rotations: [
    ['upper_arm.L',0,0,-47], ['forearm.L',16,0,3], ['upper_arm.R',0,0,-49],
    ['forearm.R',14,0,-44], ['hand.R',0,0,-13], ['Head',0,9,4],
  ] },
  step: { label: 'Шаг', rotations: [
    ['upper_arm.L',-5,0,-37], ['upper_arm.R',6,0,36], ['forearm.L',14,0,5],
    ['forearm.R',11,0,-7], ['thigh.L',-23,0,0], ['shin.L',35,0,0],
    ['foot.L',-8,0,0], ['thigh.R',10,0,0], ['shin.R',6,0,0],
  ] },
};
const STORAGE = 'capsule-rig-lab-pose-v1';

// Pose editor works on the procedural skeleton, never on a loaded model.
export function createPoseEditor({ body, model, scene, camera, renderer, orbit, onChange = () => {} }) {
  const bones=body.skeleton.bones, byName=new Map();
  const originalName=b=>ORIGINAL_BONE_NAMES[b.name]||b.name;
  for(const bone of bones){byName.set(bone.name,bone);byName.set(originalName(bone),bone)}
  const rest=new Map(bones.map(b=>[b,b.quaternion.clone().normalize()]));
  const transform=new TransformControls(camera,renderer.domElement);
  transform.setMode('rotate'); transform.setSpace('local'); transform.setSize(.65);
  const helper=transform.getHelper(); scene.add(helper); helper.visible=false;
  const skeleton=new THREE.SkeletonHelper(model); skeleton.visible=false; skeleton.material.depthTest=false; skeleton.renderOrder=5;scene.add(skeleton);
  const markers=new THREE.Group();markers.visible=false;scene.add(markers);
  const sphere=new THREE.SphereGeometry(.012,10,8), markerMaterial=new THREE.MeshBasicMaterial({color:0x8ab5ed,depthTest:false}), selectedMaterial=new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false});
  const markerByBone=new Map();
  for(const bone of bones){const m=new THREE.Mesh(sphere,markerMaterial);m.userData.bone=bone;m.renderOrder=6;markers.add(m);markerByBone.set(bone,m)}
  const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
  let selected=null,down=null,dragging=false,preset='rest', timer;
  function notify(){onChange({selected,preset})}
  function refresh(){ model.updateMatrixWorld(true); for(const bone of bones)bone.getWorldPosition(markerByBone.get(bone).position); body.mesh.computeBoundingSphere(); notify(); }
  function select(bone){if(bone&&!rest.has(bone))return;selected=bone||null;if(selected){transform.attach(selected);helper.visible=true}else{transform.detach();helper.visible=false}for(const [b,m] of markerByBone)m.material=b===selected?selectedMaterial:markerMaterial;notify()}
  function relativeEuler(bone=selected){return bone?new THREE.Euler().setFromQuaternion(rest.get(bone).clone().invert().multiply(bone.quaternion).normalize(),'XYZ'):new THREE.Euler()}
  function save(){clearTimeout(timer);timer=setTimeout(()=>{try{localStorage.setItem(STORAGE,JSON.stringify(exportPose()))}catch{}},250)}
  function changed(){preset='custom';refresh();save()}
  function setAngle(axis,degrees){if(!selected||!['x','y','z'].includes(axis)||!Number.isFinite(degrees))return;const e=relativeEuler();e[axis]=THREE.MathUtils.degToRad(THREE.MathUtils.clamp(degrees,-180,180));selected.quaternion.copy(rest.get(selected)).multiply(new THREE.Quaternion().setFromEuler(e));changed()}
  function resetSelected(){if(!selected)return;selected.quaternion.copy(rest.get(selected));changed()}
  function applyPreset(id){if(!Object.hasOwn(PRESETS,id))throw new Error('Неизвестная поза');for(const b of bones)b.quaternion.copy(rest.get(b));for(const [name,x,y,z] of PRESETS[id].rotations){const b=byName.get(name);if(b)b.quaternion.copy(rest.get(b)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...[x,y,z].map(THREE.MathUtils.degToRad),'XYZ')))}preset=id;refresh();save()}
  function exportPose(){const result=Object.create(null);for(const b of bones)result[originalName(b)]=rest.get(b).clone().invert().multiply(b.quaternion).normalize().toArray().map(n=>Number(n.toFixed(7)));return {format:'capsule-rig-pose',version:1,source:'anime-base-tall.fbx',created:new Date().toISOString(),bones:result}}
  function importPose(data){
    if(data?.format!=='capsule-rig-pose'||data?.version!==1||!data.bones||typeof data.bones!=='object'||Array.isArray(data.bones))throw Error('Неверный формат файла позы');
    const valid=[];for(const [name,q] of Object.entries(data.bones)){const b=byName.get(name);if(!b)continue;if(!Array.isArray(q)||q.length!==4||q.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw Error(`Некорректная кость: ${name}`);const v=new THREE.Quaternion().fromArray(q);if(!Number.isFinite(v.lengthSq())||v.lengthSq()<.01)throw Error(`Некорректное вращение: ${name}`);valid.push([b,v.normalize()])}
    if(!valid.length)throw Error('В файле нет костей этого скелета');
    // Validate first: a bad file must not destroy the current pose.
    for(const b of bones)b.quaternion.copy(rest.get(b));for(const [b,q] of valid)b.quaternion.copy(rest.get(b)).multiply(q);changed();return valid.length;
  }
  function restore(){try{const raw=localStorage.getItem(STORAGE);if(raw)importPose(JSON.parse(raw))}catch(e){console.warn('Сохранённая поза не восстановлена:',e.message)}}
  function setMarkers(value){markers.visible=Boolean(value)}
  function setSkeleton(value){skeleton.visible=Boolean(value)}
  function setSpace(value){transform.setSpace(value==='world'?'world':'local')}
  transform.addEventListener('dragging-changed',e=>{dragging=!!e.value;orbit.enabled=!dragging;if(!dragging)save()});
  transform.addEventListener('objectChange',()=>{if(selected)changed()});
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,button:e.button,axis:transform.axis}});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down||down.button!==0||dragging||down.axis||transform.axis||Math.hypot(e.clientX-down.x,e.clientY-down.y)>4){down=null;return} down=null;
    const rect=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(mouse,camera);
    const m=markers.visible?ray.intersectObjects(markers.children,false)[0]:null;
    if(m){select(m.object.userData.bone);return}
    const hit=ray.intersectObject(body.mesh,false)[0];if(!hit?.face){select(null);return}
    const idx=body.mesh.geometry.getAttribute('skinIndex'),weights=body.mesh.geometry.getAttribute('skinWeight'),influence=new Map();
    for(const v of [hit.face.a,hit.face.b,hit.face.c])for(let i=0;i<4;i++){const w=weights.getComponent(v,i);if(w>0){const k=idx.getComponent(v,i);influence.set(k,(influence.get(k)||0)+w)}}
    let best=-1,max=0;for(const [k,w] of influence)if(w>max){best=k;max=w}select(bones[best]||null);
  });
  function keydown(e){if(e.key==='Shift')transform.setRotationSnap(THREE.MathUtils.degToRad(15));if(e.target instanceof HTMLElement&&(e.target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))return;if(e.key==='Escape')select(null);if(e.key.toLowerCase()==='r'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&selected){e.preventDefault();resetSelected()}}
  function keyup(e){if(e.key==='Shift')transform.setRotationSnap(null)}
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',()=>{transform.setRotationSnap(null);orbit.enabled=true});
  refresh();return {bones,byName,originalName,select,get selected(){return selected},get preset(){return preset},relativeEuler,setAngle,resetSelected,applyPreset,exportPose,importPose,restore,setMarkers,setSkeleton,setSpace,transform,markers,skeleton};
}
