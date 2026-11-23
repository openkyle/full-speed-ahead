import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=readFileSync(new URL('../scripts/vehicle-combat.js',import.meta.url),'utf8');
function extract(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));const tail=source.slice(start);const next=tail.slice(1).search(/\n(?:async )?function /);return next<0?tail:tail.slice(0,next+1);}
function setup(){
 const context=vm.createContext({MODULE_ID:'full-speed-ahead',CREW_COMBATANT_FLAG:'crewCombatant',
 game:{user:{isGM:true},modules:new Map([['drag-ruler',{active:true}]]),settings:{get:()=>true},combats:[]},
 isVehicleActor:a=>a?.type==='vehicle',getVehicleCombatSpeed:a=>a.system.attributes.movement.fly,
 dragRuler:{getMovedDistanceFromToken:()=>100},CONFIG:{Combat:{}},
 });
 vm.runInContext(['getDragRulerMovementRanges','isVehicleHistoryAnchor','installDragRulerCrewHistoryBridge','ensureVehicleHistoryAnchors'].map(extract).join('\n'),context);
 return context;
}
const ship={actor:{type:'vehicle',system:{attributes:{movement:{fly:600}}}}};
test('vehicle ranges include history once and turn yellow before exhausting the shared pool',()=>{
 const c=setup();const ranges=c.getDragRulerMovementRanges(ship,{speed:600,remaining:500});
 assert.equal(ranges[0].range,450);assert.equal(ranges[1].range,600);
 assert.equal(ranges[1].color,'fsa-combat-low');
 // Ruler measures 100 history + 500 new movement, not just the new distance.
 assert.equal(ranges.at(-1).range-100,500);
});
test('disabled history is not added; exhausted pool allows no new movement',()=>{
 const c=setup();c.game.settings.get=()=>false;
 assert.equal(c.getDragRulerMovementRanges(ship,{speed:600,remaining:500})[1].range,500);
 c.game.settings.get=()=>true;
 assert.equal(c.getDragRulerMovementRanges(ship,{speed:600,remaining:0})[1].range,100);
});
test('outside combat vehicle speed is finite and character walk/dash colours remain available',()=>{
 const c=setup();assert.equal(c.getDragRulerMovementRanges(ship,null)[1].range,600);
 const ranges=c.getDragRulerMovementRanges({actor:{type:'character',system:{attributes:{movement:{walk:30}}}}},null);
 assert.equal(ranges[0].range,30);assert.equal(ranges[1].range,60);
});
test('history records are excluded from turn order, without removing actual combatants',()=>{
 const c=setup();const crew={getFlag:()=>false};const anchor={getFlag:()=>true};
 class Combat{setupTurns(){this.turns=[crew,anchor];return this.turns;}}
 c.CONFIG.Combat.documentClass=Combat;const combat=new Combat();c.game.combats=[combat];
 c.installDragRulerCrewHistoryBridge();assert.deepEqual(combat.turns,[crew]);
 assert.deepEqual(combat.setupTurns(),[crew]);
 c.installDragRulerCrewHistoryBridge();assert.deepEqual(combat.setupTurns(),[crew]);
});
test('existing encounters gain one real ship-linked record for Drag Ruler socket history',async()=>{
 const c=setup();const actor={id:'ship-actor',type:'vehicle'};const token={id:'ship-token',name:'FrenShip',actor};
 const crew={getFlag:()=>({vehicleTokenId:token.id})};let created=[];
 const combat={combatants:[crew],scene:{tokens:new Map([[token.id,token]])},getCombatantByToken:()=>created[0],
 async createEmbeddedDocuments(type,rows){assert.equal(type,'Combatant');created.push(...rows);}};
 await c.ensureVehicleHistoryAnchors(combat);await c.ensureVehicleHistoryAnchors(combat);
 assert.equal(created.length,1);assert.equal(created[0].actorId,actor.id);assert.equal(created[0].tokenId,token.id);
 assert.equal(created[0].flags['full-speed-ahead'].movementHistoryAnchor,true);
});
test('players do not create history records and existing native ship records are reused',async()=>{
 const c=setup();const combat={combatants:[{getFlag:()=>({vehicleTokenId:'ship'})}],getCombatantByToken:()=>({id:'existing'}),createEmbeddedDocuments:()=>assert.fail('duplicate')};
 await c.ensureVehicleHistoryAnchors(combat);c.game.user.isGM=false;await c.ensureVehicleHistoryAnchors(combat);
});
