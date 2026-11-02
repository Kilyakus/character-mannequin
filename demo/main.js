import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStudio } from 'nodejs-preparatorio';
import 'nodejs-preparatorio/styles.css';
import './style.css';
import { createCapsuleMannequin, CAPSULE_MANNEQUIN_MATERIAL_ORDER } from '../src/index.js';
import { createPoseEditor, PRESETS } from './pose.js';
import { ORIGINAL_BONE_NAMES } from './bone-names.js';
const originalName=b=>ORIGINAL_BONE_NAMES[b.name]||b.name;
const labels={'Hips':'Таз','spine':'Позвоночник','Lowerchest':'Нижняя грудь','upper chest':'Грудная клетка','neck':'Шея','Head':'Голова','Jaw':'Челюсть','Eye L':'Левый глаз','Eye R':'Правый глаз','shoulder.L':'Левая ключица','shoulder.R':'Правая ключица','upper_arm.L':'Левое плечо','upper_arm.R':'Правое плечо','forearm.L':'Левое предплечье','forearm.R':'Правое предплечье','hand.L':'Левая кисть','hand.R':'Правая кисть','thigh.L':'Левое бедро','thigh.R':'Правое бедро','shin.L':'Левая голень','shin.R':'Правая голень','foot.L':'Левая стопа','foot.R':'Правая стопа','Toes L':'Левые пальцы ноги','Toes R':'Правые пальцы ноги'};
const labelFor=b=>labels[originalName(b)]||originalName(b);

const character=createCapsuleMannequin({THREE}), body=character.build(),model=body.group;
let renderer,camera,controls,scene,viewport,colorInput,colorOutput,editor,studio,grid,poseUI,lastSelection;
const icons={
  viewport:'M2.2 4.6 8 1.8l5.8 2.8v6.8L8 14.2l-5.8-2.8V4.6Z M2.2 4.6 8 7.4l5.8-2.8 M8 7.4v6.8',
  structure:'M2.5 4h2 M2.5 8h2 M2.5 12h2 M6 4h7.5 M6 8h7.5 M6 12h7.5',
  properties:'M2.6 4.4h10.8 M2.6 8h10.8 M2.6 11.6h10.8 M5.6 3v2.8 M10.4 6.6v2.8 M6.6 10.2V13',
  character:'M8 2.4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5 M3.7 13.5c.2-3 1.8-4.6 4.3-4.6s4.1 1.6 4.3 4.6',
  pose:'M8 1.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 1 0 0-2.8 M8 5v4 M8 6 4 4.5 M8 6l4 1 M8 9l-3 4.5 M8 9l3.4 4.5',
  palette:'M8 2.5a5.5 5.5 0 1 0 0 11c1.1 0 1.7-.6 1.7-1.5 0-.5-.2-.9-.2-1.3 0-.7.6-1 1.3-1h.8a2 2 0 0 0 2-2C13.6 4.8 11.2 2.5 8 2.5Z M5 6h.1 M8 4.8h.1 M11 6h.1',
  console:'M2.5 3h11v10h-11z M4.4 5.5l2.2 2-2.2 2 M8 10h3.2',
};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
const button=(text,id,action)=>{const b=el('button','prep-button',text);b.type='button';if(id)b.id=id;b.addEventListener('click',action);return b};
const tab=id=>({type:'tab-area',widgets:[id],currentIndex:0});
const split=(orientation,children,sizes)=>({type:'split-area',orientation,children,sizes});
function view(name='angle'){if(!controls)return;controls.enableDamping=false;controls.update();const target=new THREE.Vector3(0,.95,0);const p={angle:[2.15,1.8,3.15],front:[0,.95,4],side:[4,.95,0]}[name];camera.position.set(...p);controls.target.copy(target);controls.update();controls.enableDamping=true}
function updateColor(value){const palette=character.paletteFromColor(value);CAPSULE_MANNEQUIN_MATERIAL_ORDER.forEach((key,i)=>body.mesh.material[i].color.set(palette[key]));if(colorOutput)colorOutput.value=value.toUpperCase()}
function syncPose(state){
  if(!state)return;for(const b of document.querySelectorAll('.mannequin-bone-button'))b.classList.toggle('active',b.dataset.bone===state.selected?.name);
  if(poseUI){poseUI.name.textContent=state.selected?originalName(state.selected):'Кость не выбрана';poseUI.fields.hidden=!state.selected;poseUI.empty.hidden=!!state.selected;poseUI.preset.textContent=PRESETS[state.preset]?.label||'Своя поза';
    if(state.selected&&editor){poseUI.parent.disabled=!state.selected.parent?.isBone;poseUI.parent.textContent=state.selected.parent?.isBone?`Родитель: ${labelFor(state.selected.parent)}`:'Нет родительской кости';poseUI.childCount.textContent=`Дочерние кости: ${state.selected.children.filter(c=>c.isBone).length}`;const angles=editor.relativeEuler();for(const axis of ['x','y','z']){const deg=THREE.MathUtils.radToDeg(angles[axis]);const v=Number(deg.toFixed(1));poseUI.ranges[axis].value=String(v);if(document.activeElement!==poseUI.numbers[axis])poseUI.numbers[axis].value=String(v)}}}
  if(state.selected&&state.selected!==lastSelection&&studio){if(studio.isToolDocked('pose'))studio.activateTool('pose');else document.querySelector('[role=tab][data-tab=pose]')?.click()}lastSelection=state.selected;
}
function createViewport(container){
  container.classList.add('mannequin-stage-body');viewport=el('div','mannequin-viewport');viewport.id='viewport';viewport.setAttribute('aria-label','Трёхмерный процедурный манекен');
  const top=el('div','mannequin-view-top');
  for(const [label,id,action] of [['3/4','viewAngle',()=>view('angle')],['Фас','viewFront',()=>view('front')],['Бок','viewSide',()=>view('side')]])top.append(button(label,id,action));
  const toggle=(label,id,initial,fn)=>{const b=button(label,id,()=>{const v=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(v));fn(v)});b.setAttribute('aria-pressed',String(initial));return b};
  top.append(toggle('Суставы','toggleJoints',false,v=>editor.setMarkers(v)),toggle('Скелет','toggleSkeleton',false,v=>editor.setSkeleton(v)),toggle('Сетка','toggleGrid',true,v=>{grid.visible=v}));
  const bottom=el('div','mannequin-viewport-actions'),hint=el('span','mannequin-viewport-hint','Клик — кость · Мышь — обзор · Shift — шаг 15°');bottom.append(hint,button('Сбросить камеру','resetCamera',()=>view()));container.append(viewport,top,bottom);
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x1d1d1d);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;viewport.append(renderer.domElement);
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(2.15,1.8,3.15);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.95,0);controls.enableDamping=true;controls.minDistance=1.5;controls.maxDistance=9;
  scene.add(new THREE.HemisphereLight(0xddeaff,0x44413d,2.1));const light=new THREE.DirectionalLight(0xfff4e8,3.2);light.position.set(3,6,5);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=light.shadow.camera.bottom=-3;light.shadow.camera.right=light.shadow.camera.top=3;scene.add(light);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x252525,roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);grid=new THREE.GridHelper(20,40,0x3a3a3a,0x303030);grid.position.y=.001;scene.add(grid);scene.add(model);
  let bounds=new THREE.Box3().setFromObject(model);model.scale.setScalar(1.78/bounds.getSize(new THREE.Vector3()).y);model.updateMatrixWorld(true);bounds.setFromObject(model);model.position.y=-bounds.min.y;model.updateMatrixWorld(true);body.mesh.frustumCulled=false;
  editor=createPoseEditor({body,model,scene,camera,renderer,orbit:controls,onChange:syncPose});editor.restore();
  const resize=()=>{const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)};new ResizeObserver(resize).observe(viewport);resize();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});
}
function renderStructure(container){
  container.classList.add('mannequin-structure');const head=el('div','mannequin-tree-head','Сцена');container.append(head);
  container.append(el('div','mannequin-tree-row active','◇  Капсульный манекен'));
  const search=el('input','mannequin-input');search.id='boneSearch';search.type='search';search.placeholder='Поиск кости';search.setAttribute('aria-label','Поиск кости');container.append(search);
  const results=el('div','mannequin-results'),skeleton=el('details','mannequin-tree-group');skeleton.open=true;skeleton.append(el('summary','',`Скелет · ${body.skeleton.bones.length} костей`));
  const map=new Map(body.skeleton.bones.map(b=>[b.name,b]));
  const makeBoneButton=(bone)=>{const b=button(originalName(bone),'',event=>{event.stopPropagation();editor.select(bone)});b.className='mannequin-bone-button';b.title=labelFor(bone);b.dataset.bone=bone.name;return b};
  const appendBone=(bone,parent)=>{const children=bone.children.filter(c=>c.isBone&&map.has(c.name));const line=el('details','mannequin-bone');const label=el('summary');if(!children.length)line.classList.add('leaf');label.append(makeBoneButton(bone));line.append(label);for(const child of children)appendBone(child,line);parent.append(line)};
  for(const b of body.skeleton.bones.filter(b=>!b.parent?.isBone))appendBone(b,skeleton);container.append(skeleton,results);
  search.addEventListener('input',()=>{const q=search.value.trim().toLocaleLowerCase();skeleton.hidden=!!q;results.replaceChildren();if(q)for(const b of body.skeleton.bones)if(originalName(b).toLocaleLowerCase().includes(q)||b.name.toLocaleLowerCase().includes(q)||labelFor(b).toLocaleLowerCase().includes(q))results.append(makeBoneButton(b));syncPose(editor&&{selected:editor.selected,preset:editor.preset})});
  container.append(el('div','mannequin-tree-row',`Геометрия · ${body.shellCount} оболочек`),el('div','mannequin-tree-row',`Материалы · ${body.mesh.material.length}`));
  window.addEventListener('keydown',e=>{if(e.key==='/'&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)){e.preventDefault();search.focus()}});
}
function renderCharacter(container){const card=el('div','mannequin-card');card.append(el('strong','','Капсульный манекен'),el('p','prep-note','Процедурная модель и скелет. Выберите кость, чтобы изменить позу.'));const stats=el('div','mannequin-stats');for(const [label,value] of [['Кости',body.skeleton.bones.length],['Оболочки',body.shellCount],['Материалы',body.mesh.material.length],['Привязки',Object.keys(character.boneMap).length]]){const row=el('div','mannequin-stat');row.append(el('span','',label),el('b','',String(value)));stats.append(row)}card.append(stats);container.append(card)}
function renderPalette(container){const row=el('label','prep-field');row.append(el('span','','Базовый цвет'));const wrap=el('div','mannequin-color-row');colorInput=el('input');colorInput.type='color';colorInput.id='color';colorInput.value='#4c73c9';colorInput.setAttribute('aria-label','Базовый цвет');colorOutput=el('output');colorOutput.id='colorValue';colorOutput.value=colorInput.value.toUpperCase();const reset=button('Сбросить','resetColor',e=>{e.preventDefault();colorInput.value='#4c73c9';updateColor(colorInput.value)});colorInput.addEventListener('input',()=>updateColor(colorInput.value));wrap.append(colorInput,colorOutput,reset);row.append(wrap);container.append(row,el('p','prep-note','Палитра создаётся из одного цвета. Скелет и геометрия не меняются.'));updateColor(colorInput.value)}
function renderPose(container){
  const presets=el('div','mannequin-button-grid');for(const [id,p] of Object.entries(PRESETS))presets.append(button(p.label,'preset-'+id,()=>editor.applyPreset(id)));
  const status=el('div','mannequin-pose-status');status.append(el('span','','Текущая поза: '));const preset=el('strong','','Т-поза');status.append(preset);
  const name=el('strong','mannequin-selected','Кость не выбрана');name.id='selectedBone';const empty=el('p','prep-note','Выберите кость в структуре или на модели.');const fields=el('div','mannequin-pose-fields');fields.hidden=true;
  const ranges={},numbers={};for(const axis of ['x','y','z']){const label=el('label','mannequin-axis');const top=el('span','mannequin-axis-heading',`Вращение ${axis.toUpperCase()}`);const number=el('input','mannequin-number');number.type='number';number.min='-180';number.max='180';number.step='1';number.id='angle-'+axis;number.setAttribute('aria-label',`Угол ${axis.toUpperCase()}`);top.append(number);const range=el('input','mannequin-range');range.type='range';range.min='-180';range.max='180';range.step='1';range.id='range-'+axis;range.setAttribute('aria-label',`Вращение ${axis.toUpperCase()}`);range.addEventListener('input',()=>editor.setAngle(axis,Number(range.value)));number.addEventListener('input',()=>{if(number.value!=='')editor.setAngle(axis,Number(number.value))});number.addEventListener('blur',()=>syncPose({selected:editor.selected,preset:editor.preset}));label.append(top,range);fields.append(label);ranges[axis]=range;numbers[axis]=number}
  const relations=el('div','mannequin-relations');const parent=button('Родитель','parentBone',()=>{if(editor.selected?.parent?.isBone)editor.select(editor.selected.parent)});const childCount=el('span','prep-note');relations.append(parent,childCount);
  const focus=button('К выбранной кости','focusBone',()=>{if(!editor.selected)return;controls.enableDamping=false;controls.update();const next=editor.selected.getWorldPosition(new THREE.Vector3());camera.position.add(next.clone().sub(controls.target));controls.target.copy(next);controls.update();controls.enableDamping=true});
  fields.append(relations,focus);
  const spaceRow=el('label','mannequin-space');spaceRow.append(el('span','','Оси манипулятора'));const space=el('select','mannequin-input');space.id='transformSpace';space.setAttribute('aria-label','Оси манипулятора');for(const [v,l] of [['local','Локальные'],['world','Мировые']]){const o=el('option','',l);o.value=v;space.append(o)}space.addEventListener('change',()=>editor.setSpace(space.value));spaceRow.append(space);fields.append(spaceRow,button('Сбросить кость','resetBone',()=>editor.resetSelected()));
  const file=el('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.id='poseFile';const message=el('p','prep-note');message.id='poseMessage';message.setAttribute('role','status');
  file.addEventListener('change',async()=>{try{const f=file.files[0];if(!f)return;if(f.size>1024*1024)throw Error('Файл слишком большой');const count=editor.importPose(JSON.parse(await f.text()));message.textContent=`Загружено костей: ${count}`}catch(e){message.textContent=`Не удалось загрузить позу: ${e.message}`}finally{file.value=''}});
  const io=el('div','mannequin-button-grid');io.append(button('Скачать JSON','exportPose',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(editor.exportPose(),null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='capsule-pose.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message.textContent='Поза сохранена в JSON'}),button('Загрузить позу','importPose',()=>file.click()));
  container.append(el('div','mannequin-section-label','Готовые позы'),presets,status,el('div','mannequin-section-label','Выбранная кость'),name,empty,fields,el('div','mannequin-section-label','Файл позы'),io,file,message,el('p','prep-note','FK-позирование: вращение костей, не IK. Поза сохраняется в браузере.'));poseUI={preset,name,empty,fields,ranges,numbers,parent,childCount};if(editor)syncPose({selected:editor.selected,preset:editor.preset});
}
window.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)){e.preventDefault();view()}});
studio=await createStudio({id:'character-mannequin-demo',mount:'#app',title:'Character Mannequin',anchor:'viewport',menus:[{label:'Вид',items:[{label:'Сбросить камеру',onClick:()=>view()},{label:'Сбросить раскладку',onClick:s=>s.resetLayout()}]}],panels:[
 {id:'viewport',title:'Просмотр',iconPath:icons.viewport,hideable:false,render:createViewport},
 {id:'structure',title:'Структура',iconPath:icons.structure,mode:'split-left',ref:'viewport',render:renderStructure},
 {id:'properties',title:'Свойства',iconPath:icons.properties,mode:'split-right',ref:'viewport',tools:true},
 {id:'console',title:'Консоль',iconPath:icons.console,mode:'split-bottom',collapsible:true,collapsed:true,hint:'Манекен готов',controls:[{type:'text',text:'Процедурная модель собрана локально. Персонаж не требует FBX-файлов.'}]},
],tools:[
 {id:'character',label:'Персонаж',iconPath:icons.character,controls:[{type:'heading',label:'Персонаж'}],render:renderCharacter},
 {id:'pose',label:'Поза',iconPath:icons.pose,controls:[{type:'heading',label:'Поза'}],render:renderPose},
 {id:'palette',label:'Палитра',iconPath:icons.palette,controls:[{type:'heading',label:'Палитра'}],render:renderPalette},
],layout:split('vertical',[split('horizontal',[tab('structure'),tab('viewport'),tab('properties')],[.19,.59,.22]),tab('console')],[.93,.07])});
window.__MANNEQUIN_DEMO__={studio,character,body,scene,camera,controls,renderer,editor};
