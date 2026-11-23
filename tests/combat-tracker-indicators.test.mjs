import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../scripts/vehicle-combat.js', import.meta.url), 'utf8');
function getFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\nfunction ', start + 1));
}
const context = vm.createContext({ game: { users: [] }, escapeHtml: s => String(s).replaceAll('"', '&quot;') });
vm.runInContext(source.slice(source.indexOf('const PRIMARY_CREW_ROLE_ABILITIES'), source.indexOf('const VEHICLE_CREW_ABILITY_KEYS')) +
    ['clampVehicleCombatNumber', 'buildVehicleHealthBar', 'getCrewActionIndicator', 'buildVehicleActionDots', 'buildVehicleMovementBar', 'getVehicleSheetHealthGradient'].map(getFunction).join('\n'), context);

test('health thresholds use HP independently of the fixed shield segment', () => {
    for (const [value, color] of [[100, '#238a45'], [50, '#e4bd32'], [25, '#d93636'], [0, '#d93636']]) {
        const html = context.buildVehicleHealthBar({ system: { attributes: { hp: { value, max: 100 } } } }, { hp: 0, max: 50 });
        assert.ok(html.includes(`height: ${value}%; background: ${color}`));
        assert.match(html, /health-shields"><div style="height: 0%/);
    }
});
test('half shields and full health are independent and missing shields remain empty', () => {
    const actor = { system: { attributes: { hp: { value: 100, max: 100 } } } };
    assert.match(context.buildVehicleHealthBar(actor, { hp: 25, max: 50 }), /health-shields"><div style="height: 50%/);
    assert.match(context.buildVehicleHealthBar(actor, null), /health-shields"><div style="height: 0%/);
});
test('all seven roles match the ship sheet, including Engineering and Sensors Expert aliases', () => {
    const roles = [
        ['Captain', "Captain's Action", '#42a568'], ['First Officer', "First Officer’s Action", '#d6b44c'],
        ['Navigator', "Navigator's Action", '#ce4968'], ['Quartermaster', "Quartermaster's Action", '#e0e0e0'],
        ['Engineering', "Engineer's Action", '#395bc9'], ['Sensors Expert', "Sensor Expert's Action", '#bc43c8'],
        ['Gunner', "Gunner's Action", '#dc8639']
    ];
    for (const [role, name, color] of roles) {
        const actor = { items: [{ name, system: { uses: { value: 0, max: 1 } } }] };
        assert.equal(context.getCrewActionIndicator(actor, role).color, color);
        assert.equal(context.getCrewActionIndicator(actor, role).spent, true);
        actor.items[0].system.uses.value = 1;
        assert.equal(context.getCrewActionIndicator(actor, role).spent, false);
    }
});
test('missing action data is not falsely marked spent', () => {
    assert.equal(context.getCrewActionIndicator({ items: [] }, 'Captain').spent, false);
    assert.match(context.getCrewActionIndicator(null, 'Henchman').label, /not tracked/);
});
test('crew dot can be hollow while ship and player reminders stay filled', () => {
    context.game.users = [{ name: 'Player', character: { id: 'crew' }, color: '#12ab34' }];
    const html = context.buildVehicleActionDots({ items: [{ name: "Captain's Action", system: { uses: { value: 0, max: 1 } } }] }, { actor: { id: 'crew' } }, { role: 'Captain' });
    assert.equal((html.match(/ is-spent/g) ?? []).length, 1);
    assert.ok(html.includes('--fsa-dot-color: #12ab34'));
    assert.ok(html.includes('--fsa-dot-color: #999999'));
});
test('movement fill displays the shared remaining value without a separate counter', () => {
    const html = context.buildVehicleMovementBar({ speed: 600, remaining: 150, recovery: 75, unit: 'm' });
    assert.match(html, /150 \/ 600 m/);
    assert.match(html, /--fsa-movement-percent: 25%/);
    assert.match(html, /--fsa-movement-color: #c4c4c4/);
});


test('sheet health reserves the right quarter for shields independently of HP', () => {
    const actor = { system: { attributes: { hp: { value: 100, max: 100 } } } };
    assert.match(context.getVehicleSheetHealthGradient(actor, { hp: 40, max: 40 }), /#3268d2 75%, #3268d2 100%/);
    assert.match(context.getVehicleSheetHealthGradient(actor, { hp: 20, max: 40 }), /#3268d2 75%, #3268d2 87.5%/);
    assert.match(context.getVehicleSheetHealthGradient(actor, { hp: 0, max: 40 }), /#3268d2 75%, #3268d2 75%/);
    actor.system.attributes.hp.value = 50;
    assert.match(context.getVehicleSheetHealthGradient(actor, null), /#e4bd32 37.5%/);
    actor.system.attributes.hp.value = 25;
    assert.match(context.getVehicleSheetHealthGradient(actor, null), /#d93636 18.75%/);
});
