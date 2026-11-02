import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800},acceptDownloads:true}), errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>requests.push(r.url()));
await page.addInitScript(()=>{if(!sessionStorage.getItem('pose-test')){localStorage.clear();sessionStorage.setItem('pose-test','yes')}});
try{
  await page.goto(process.env.DEMO_URL||'http://localhost:5180/');await page.waitForFunction(()=>window.__MANNEQUIN_DEMO__?.editor,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.bones.length),85);
  // Select through searchable hierarchy; the corresponding dock tool opens.
  await page.locator('#boneSearch').fill('upper_arm.L');await page.getByRole('button',{name:'upper_arm.L',exact:true}).click();
  assert.equal(await page.locator('#selectedBone').textContent(),'upper_arm.L');assert.equal(await page.getByRole('tab',{name:'Поза',exact:true}).getAttribute('aria-selected'),'true');
  const before=await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.selected.quaternion.toArray());
  // Find an actual rotation ring using the transform control's ray picker, then drag it.
  let hit=null;for(let y=235;y<=350&&!hit;y+=7)for(let x=610;x<=710&&!hit;x+=7){await page.mouse.move(x,y);const axis=await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.transform.axis);if(['X','Y','Z'].includes(axis))hit={x,y}}
  assert.ok(hit,'3D rotation ring is available');await page.mouse.down();await page.mouse.move(hit.x+35,hit.y+30,{steps:12});await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.selected.quaternion.toArray()),before);assert.equal(await page.evaluate(()=>__MANNEQUIN_DEMO__.controls.enabled),true);
  await page.locator('#range-z').evaluate(el=>{el.value='42';el.dispatchEvent(new Event('input',{bubbles:true}))});assert.equal(await page.locator('#angle-z').inputValue(),'42');
  await page.locator('#transformSpace').selectOption('world');assert.equal(await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.transform.space),'world');
  await page.keyboard.down('Shift');assert.ok(await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.transform.rotationSnap)>0);await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.transform.rotationSnap),null);
  await page.locator('#toggleJoints').click();await page.locator('#toggleSkeleton').click();await page.locator('#toggleGrid').click();assert.deepEqual(await page.evaluate(()=>[__MANNEQUIN_DEMO__.editor.markers.visible,__MANNEQUIN_DEMO__.editor.skeleton.visible]),[true,true]);assert.equal(await page.locator('#toggleGrid').getAttribute('aria-pressed'),'false');
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportPose').click();const downloaded=JSON.parse(await fs.readFile(await (await downloadPromise).path(),'utf8'));
  assert.equal(downloaded.format,'capsule-rig-pose');assert.equal(Object.keys(downloaded.bones).length,85);assert.ok(downloaded.bones['upper_arm.L']);assert.equal(downloaded.bones.upper_armL,undefined);
  await page.locator('#preset-rest').click();assert.equal(await page.locator('#angle-z').inputValue(),'0');
  await page.locator('#poseFile').setInputFiles({name:'pose.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(downloaded))});await page.waitForFunction(()=>document.querySelector('#angle-z').value==='42');
  const poseBeforeInvalid=await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.selected.quaternion.toArray());
  await page.locator('#poseFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'capsule-rig-pose',version:1,bones:{'upper_arm.L':[0,0,0,0]}}))});
  await page.waitForFunction(()=>document.querySelector('#poseMessage').textContent.includes('Не удалось'));assert.deepEqual(await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.selected.quaternion.toArray()),poseBeforeInvalid);
  await page.locator('#preset-relaxed').click();assert.ok(Math.abs(Number(await page.locator('#angle-z').inputValue())+38)<.2);
  await page.locator('#preset-hello').click();assert.ok(Math.abs(Number(await page.locator('#angle-z').inputValue())+47)<.2);
  await page.locator('#preset-step').click();assert.ok(Math.abs(Number(await page.locator('#angle-z').inputValue())+37)<.2);
  // Local storage preserves pose over reload, using the original Rig Lab schema.
  await page.waitForTimeout(350);await page.reload();await page.waitForFunction(()=>window.__MANNEQUIN_DEMO__?.editor,null,{timeout:90000});
  const value=await page.evaluate(()=>{const e=__MANNEQUIN_DEMO__.editor;return e.relativeEuler(e.byName.get('upper_arm.L')).z*180/Math.PI});assert.ok(Math.abs(value+37)<.2);
  // Click an actual skinned head surface, not the tree.
  await page.locator('#viewFront').click();await page.getByRole('tab',{name:'Поза',exact:true}).click();await page.locator('#preset-rest').click();
  const rect=await page.locator('canvas').boundingBox();let selected=null;
  for(let dy=-30;dy<=30&&!selected;dy+=10)for(let dx=-30;dx<=30&&!selected;dx+=10){const point=await page.evaluate(()=>{const {editor,camera,renderer}=__MANNEQUIN_DEMO__;const v=editor.byName.get('Head').getWorldPosition(camera.position.clone());v.y+=.06;v.project(camera);const r=renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}});await page.mouse.click(point.x+dx,point.y+dy);selected=await page.evaluate(()=>__MANNEQUIN_DEMO__.editor.selected?.name==='Head')}
  assert.ok(selected,'head can be picked on procedural skinned mesh');
  assert.ok(!requests.some(url=>/\.(fbx|glb|blend)(\?|$)/i.test(url)),'the live demo never loads a model asset');assert.deepEqual(errors,[]);
  console.log('Pose presets, skinned picking, real gizmo drag, angles, JSON, persistence and asset-free runtime passed');
}finally{await browser.close()}
