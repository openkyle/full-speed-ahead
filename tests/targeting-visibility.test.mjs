import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../scripts/targetingsystem.js", import.meta.url), "utf8");

function setup() {
    const hooks = new Map();
    const listeners = new Map();
    class DisplayObject {
        visible = true;
        position = { set() {} };
        beginFill() {}
        drawRect() {}
        endFill() {}
        on() {}
    }
    const target = { id: "target", actor: {}, document: {}, visible: true, isVisible: true, center: { x: 100, y: 100 }, w: 100, h: 100 };
    const acting = { id: "source", actor: { type: "character" } };
    const stage = { children: [], addChild(e) { this.children.push(e); }, removeChild(e) { this.children.splice(this.children.indexOf(e), 1); }, on() {}, off() {} };
    const context = vm.createContext({
        console, setTimeout,
        game: { user: { isGM: false }, settings: { get: () => false } },
        canvas: { scene: { grid: { units: "ft" } }, tokens: { placeables: [target] }, stage, effects: { visibility: { testVisibility: () => true } } },
        ui: { windows: {}, notifications: { error() {}, warn() {} } },
        document: { body: { style: {} }, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
        PIXI: { Graphics: DisplayObject, Text: DisplayObject },
        Hooks: {
            on(name, fn) { if (!hooks.has(name)) hooks.set(name, new Set()); hooks.get(name).add(fn); return fn; },
            once() {},
            off(name, fn) { hooks.get(name)?.delete(fn); }
        }
    });
    vm.runInContext(source.replace("export class TargetingSystem", "class TargetingSystem") + "\nglobalThis.TargetingSystem = TargetingSystem;", context);
    vm.runInContext(`
        isAnyQuickTargetEnabled = () => true;
        isQuickTargetEnabledForSource = () => true;
        getActorAttacks = () => ({ weapons: [], spells: [] });
        getTargetingData = () => ({ distance: 10, validAttacks: [] });
        stopFoundryEvent = () => {};
    `, context);
    return { context, target, acting, stage, hooks, listeners,
        emit(name) { for (const fn of [...(hooks.get(name) ?? [])]) fn(); },
        visible() { context.target = target; return vm.runInContext("isTokenVisibleToCurrentUser(target)", context); }
    };
}

test("players cannot mark occluded, hidden, or uncertain targets", () => {
    const s = setup();
    assert.equal(s.visible(), true);
    s.context.canvas.effects.visibility.testVisibility = () => false;
    assert.equal(s.visible(), false);
    s.context.canvas.effects.visibility.testVisibility = () => { throw new Error("Vision unavailable"); };
    assert.equal(s.visible(), false);
    delete s.context.canvas.effects.visibility.testVisibility;
    assert.equal(s.visible(), false);
    s.context.canvas.effects.visibility.testVisibility = () => true;
    s.target.document.hidden = true;
    assert.equal(s.visible(), false);
});

test("occluded targets create no overlays", async () => {
    const s = setup();
    s.context.canvas.effects.visibility.testVisibility = () => false;
    await s.context.TargetingSystem.highlightWeaponRange(s.acting);
    assert.equal(s.stage.children.length, 0);
});

test("vision refresh hides all labels and hit areas and cleanup removes listeners", async () => {
    const s = setup();
    await s.context.TargetingSystem.highlightWeaponRange(s.acting);
    assert.equal(s.stage.children.length, 5);
    s.context.canvas.effects.visibility.testVisibility = () => false;
    s.emit("sightRefresh");
    assert.ok(s.stage.children.every(e => !e.visible));
    s.context.canvas.effects.visibility.testVisibility = () => true;
    s.emit("sightRefresh");
    assert.ok(s.stage.children.every(e => e.visible));
    s.target.visible = false;
    s.emit("refreshToken");
    assert.ok(s.stage.children.every(e => !e.visible));
    s.listeners.get("keydown")({ key: "Escape" });
    assert.equal(s.stage.children.length, 0);
    for (const name of ["sightRefresh", "refreshToken", "canvasTearDown"]) assert.equal(s.hooks.get(name).size, 0);
});

test("GM visibility keeps its existing behavior", () => {
    const s = setup();
    s.context.game.user.isGM = true;
    s.context.canvas.effects.visibility.testVisibility = () => false;
    assert.equal(s.visible(), true);
    s.target.document.hidden = true;
    assert.equal(s.visible(), false);
});
