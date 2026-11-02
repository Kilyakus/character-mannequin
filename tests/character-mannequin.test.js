import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCapsuleMannequin, buildCapsuleMannequinModel, CAPSULE_MANNEQUIN_BONE_MAP, CAPSULE_MANNEQUIN_BONES, CAPSULE_MANNEQUIN_MATERIAL_ORDER } from 'character-mannequin';
import profile from 'character-mannequin/character';

function dispose(body) { body.mesh.geometry.dispose();for(const m of body.mesh.material)m.dispose(); }

test('pure data API works without a renderer or Three.js instance',()=>{
  const character=createCapsuleMannequin();
  assert.equal(character.id,'capsule-mannequin');assert.equal(character.version,'1.0.0');
  assert.equal(CAPSULE_MANNEQUIN_BONES.length,85);assert.equal(character.rig.bones.length,85);
  assert.equal(Object.keys(CAPSULE_MANNEQUIN_BONE_MAP).length,21);
  assert.throws(()=>character.build(),/three\.js/i);
  assert.deepEqual(CAPSULE_MANNEQUIN_MATERIAL_ORDER,['porcelain','secondary','joint','accent','face']);
  assert.equal(profile.id,character.id);
});

test('builds the original geometry, hierarchy and complete 21-node bindings',()=>{
  const character=createCapsuleMannequin({THREE});const body=character.build();
  assert.equal(body.shellCount,78);assert.equal(body.skeleton.bones.length,85);
  assert.equal(body.mesh.geometry.getAttribute('position').count,35884);
  assert.equal(body.mesh.geometry.index.count/3,71456);assert.equal(body.mesh.material.length,5);
  assert.equal(body.mesh.isSkinnedMesh,true);assert.ok(body.group.children.includes(body.mesh));
  const {bindings,missing}=character.bindings(body.skeleton);assert.deepEqual(missing,[]);assert.equal(Object.keys(bindings).length,21);
  assert.equal(bindings.head.bone.name,'Head');
  assert.ok(Object.values(bindings).every(x=>x.bone?.isBone));dispose(body);
});

test('palette variations do not change geometry or the reference rig',()=>{
  const character=createCapsuleMannequin({THREE});const palette=character.paletteFromColor('#4377be',{face:'#010203'});
  assert.equal(palette.face,'#010203');const plain=character.build(),variant=character.build({palette});
  assert.deepEqual(Array.from(plain.mesh.geometry.attributes.position.array),Array.from(variant.mesh.geometry.attributes.position.array));
  assert.notEqual(plain.mesh.material[0].color.getHex(),variant.mesh.material[0].color.getHex());
  assert.equal(variant.mesh.material[4].color.getHexString(),'010203');
  assert.deepEqual(plain.skeleton.bones.map(x=>x.name),variant.skeleton.bones.map(x=>x.name));
  const shortcut=buildCapsuleMannequinModel({THREE});assert.equal(shortcut.shellCount,78);dispose(plain);dispose(variant);dispose(shortcut);
});
