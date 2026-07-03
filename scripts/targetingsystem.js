// targetingsystem.js: Range overlays, the T-key targeting override, and private attack cards.

const MODULE_ID = "full-speed-ahead";

export class TargetingSystem {
    static async highlightWeaponRange(sourceToken = null) {
        if (!game.settings.get(MODULE_ID, "enableTargetingSystem")) {
            console.log("Targeting System is disabled in settings. Exiting highlightWeaponRange.");
            return;
        }

        const selectedToken = sourceToken ?? getActingToken();
        if (!selectedToken) return;

        const actor = selectedToken.actor;
        if (!actor) {
            ui.notifications.warn("The selected token does not have an actor.");
            return;
        }

        const gridUnit = canvas.scene.grid.units;
        if (gridUnit.toLowerCase() !== "ft" && gridUnit.toLowerCase() !== "m") {
            ui.notifications.error("There are weapons equipped that function at this range.");
            return;
        }

        const hiddenWindows = [...Object.values(ui.windows)];
        hiddenWindows.forEach(win => win.minimize());

        const { weapons, spells } = getActorAttacks(actor);

        ui.notifications.error("Please click on the enemy you wish to target!");
        document.body.style.cursor = "crosshair";

        let floatingElements = [];
        let cleanedUp = false;
        let longRangeTemplate;
        let shortRangeTemplate;

        if (actor.type === "vehicle") {
            const templates = await createVehicleRangeTemplates(selectedToken);
            longRangeTemplate = templates.longRangeTemplate;
            shortRangeTemplate = templates.shortRangeTemplate;
        }

        for (let token of canvas.tokens.placeables) {
            if (!isPotentialTarget(token, selectedToken)) continue;

            const { distance, validAttacks } = getTargetingData(selectedToken, token, weapons, spells);
            const { text, textColor } = getRangeLabel(distance, validAttacks);

            const transparentMat = new PIXI.Graphics();
            transparentMat.beginFill(0x000000, 0.001);
            transparentMat.drawRect(token.center.x - token.w / 2, token.center.y - token.h / 2, token.w, token.h);
            transparentMat.endFill();
            transparentMat.interactive = true;
            transparentMat.buttonMode = true;
            canvas.stage.addChild(transparentMat);
            floatingElements.push(transparentMat);

            const targetNameText = new PIXI.Text(token.name, {
                fontFamily: "Arial",
                fontSize: 22,
                fill: "#FFFFFF",
                stroke: "#000000",
                strokeThickness: 4,
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 4
            });
            targetNameText.position.set(token.center.x + 60, token.center.y - 42);
            canvas.stage.addChild(targetNameText);
            floatingElements.push(targetNameText);

            const floatingText = new PIXI.Text(text, {
                fontFamily: "Arial",
                fontSize: 24,
                fill: textColor,
                stroke: "#000000",
                strokeThickness: 4,
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 4
            });
            floatingText.position.set(token.center.x + 60, token.center.y - 16);
            canvas.stage.addChild(floatingText);
            floatingElements.push(floatingText);

            const distanceText = `${distance} ${actor.type === "vehicle" ? "M" : "ft"} away`;
            const floatingDistanceText = new PIXI.Text(distanceText, {
                fontFamily: "Arial",
                fontSize: 20,
                fill: "#FFFFFF",
                align: "left",
                padding: 2,
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 4
            });
            floatingDistanceText.position.set(token.center.x + 62, token.center.y + 14);
            canvas.stage.addChild(floatingDistanceText);
            floatingElements.push(floatingDistanceText);

            const clickIconText = new PIXI.Text("⌖", {
                fontFamily: "Arial",
                fontSize: 60,
                fill: "#FF0000",
                stroke: "#000000",
                strokeThickness: 8,
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 4
            });
            clickIconText.position.set(token.center.x - 32, token.center.y - 48);
            clickIconText.interactive = true;
            clickIconText.buttonMode = true;
            canvas.stage.addChild(clickIconText);
            floatingElements.push(clickIconText);

            const selectTarget = async () => {
                await TargetingSystem.targetTokenAndShowAttacks(selectedToken, token, validAttacks, distance);
                cleanupTargetingDisplay();
                selectedToken.control({ releaseOthers: true });
            };

            transparentMat.on("pointerdown", selectTarget);
            clickIconText.on("pointerdown", selectTarget);
        }

        if (game.settings.get(MODULE_ID, "autoRemoveTargetingTemplate")) {
            const removalSeconds = Math.max(1, getRangeNumber(game.settings.get(MODULE_ID, "targetingTemplateRemovalSeconds")) || 10);
            setTimeout(() => cleanupTargetingDisplay(), removalSeconds * 1000);
        }

        function cleanupTargetingDisplay() {
            if (cleanedUp) return;
            cleanedUp = true;

            floatingElements.forEach(element => {
                if (canvas.stage.children.includes(element)) canvas.stage.removeChild(element);
            });
            floatingElements = [];
            document.body.style.cursor = "default";

            if (longRangeTemplate?.[0]) canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [longRangeTemplate[0].id]);
            if (shortRangeTemplate?.[0]) canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [shortRangeTemplate[0].id]);

            hiddenWindows.forEach(win => win.maximize());
        }
    }

    static async handleTargetShortcut(event) {
        if (!isTargetShortcutEvent(event)) return;
        if (!game.settings.get(MODULE_ID, "enableTargetingSystem")) return;
        if (!canvas?.ready || !canvas.tokens) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const sourceToken = getActingToken();
        if (!sourceToken) return;

        const hoveredToken = getHoveredTargetToken(sourceToken);
        if (!hoveredToken) {
            await TargetingSystem.highlightWeaponRange(sourceToken);
            return;
        }

        const { weapons, spells } = getActorAttacks(sourceToken.actor);
        const { distance, validAttacks } = getTargetingData(sourceToken, hoveredToken, weapons, spells);
        await TargetingSystem.targetTokenAndShowAttacks(sourceToken, hoveredToken, validAttacks, distance);
    }

    static async targetTokenAndShowAttacks(sourceToken, targetToken, validAttacks, distance) {
        setOnlyTarget(targetToken);
        ui.notifications.warn(`[Targeting] ${targetToken.name} has been targeted.`);
        console.log(`[Targeting System] ${targetToken.name} has been targeted.`);
        AudioHelper.play({ src: "/modules/full-speed-ahead/sounds/lockon.ogg", volume: 0.3, autoplay: true, loop: false });
        await TargetingSystem.createAttackCard(sourceToken, targetToken, validAttacks, distance);
    }

    static async createAttackCard(sourceToken, targetToken, validAttacks, distance) {
        const content = buildAttackCardContent(sourceToken, targetToken, validAttacks, distance);
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ token: sourceToken }),
            content,
            whisper: [game.user.id]
        });
    }

    static async rollAttackFromChat(event) {
        event.preventDefault();
        event.stopPropagation();

        const button = event.currentTarget;
        const item = await fromUuid(button.dataset.itemUuid);
        const targetToken = await getTokenObjectFromUuid(button.dataset.targetTokenUuid);
        const disadvantage = button.dataset.disadvantage === "true";

        if (!item) {
            ui.notifications.warn("That attack could not be found on the actor anymore.");
            return;
        }

        if (targetToken) setOnlyTarget(targetToken);

        const rollEvent = {
            altKey: disadvantage,
            ctrlKey: false,
            shiftKey: false,
            metaKey: false,
            currentTarget: button,
            target: button,
            preventDefault: () => {},
            stopPropagation: () => {}
        };

        const rollOptions = { event: rollEvent, disadvantage, advantage: false };
        if (typeof item.use === "function") await item.use(rollOptions);
        else if (typeof item.roll === "function") await item.roll(rollOptions);
        else ui.notifications.warn(`${item.name} cannot be rolled directly by Full Speed Ahead.`);
    }
}

async function createVehicleRangeTemplates(selectedToken) {
    const actor = selectedToken.actor;
    let longRangeTemplate;
    let shortRangeTemplate;
    const weaponArrayItems = actor.items.filter(i => i.type === "weapon" && getRangeNumber(i.system.range?.long) > 0);
    if (!weaponArrayItems.length) return { longRangeTemplate, shortRangeTemplate };

    const highestLongRangeItem = weaponArrayItems.reduce((max, item) => getRangeNumber(item.system.range.long) > getRangeNumber(max.system.range.long) ? item : max);
    const longRange = getRangeNumber(highestLongRangeItem.system.range.long) - 50;
    const shortRange = getRangeNumber(highestLongRangeItem.system.range.value) - 50;
    const unit = highestLongRangeItem.system.range.units;

    if (longRange <= 0 || shortRange <= 0 || (unit !== "m" && unit !== "ft")) {
        return { longRangeTemplate, shortRangeTemplate };
    }

    longRangeTemplate = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
        t: "circle",
        user: game.user.id,
        x: selectedToken.center.x,
        y: selectedToken.center.y,
        distance: longRange,
        borderColor: "",
        fillColor: "#898234",
        fillAlpha: 0.0,
        flags: { "myModule.weaponLongRangeTemplate": true }
    }]);

    shortRangeTemplate = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
        t: "circle",
        user: game.user.id,
        x: selectedToken.center.x,
        y: selectedToken.center.y,
        distance: shortRange,
        borderColor: "",
        fillColor: "#159504",
        fillAlpha: 0.0,
        flags: { "myModule.weaponShortRangeTemplate": true }
    }]);

    return { longRangeTemplate, shortRangeTemplate };
}

function getActingToken() {
    const controlled = canvas.tokens.controlled.filter(token => token.actor);
    if (controlled.length === 1) return controlled[0];

    if (controlled.length > 1) {
        ui.notifications.warn("Please select only the character you are acting as.");
        return null;
    }

    const character = game.user.character;
    if (character) {
        const characterTokens = canvas.tokens.placeables.filter(token => token.actor?.id === character.id && !token.document.hidden);
        if (characterTokens.length === 1) return characterTokens[0];
        if (characterTokens.length > 1) {
            ui.notifications.warn("Please select the specific token you are acting as.");
            return null;
        }
    }

    ui.notifications.warn("Please select the token you are acting as first.");
    return null;
}

function getActorAttacks(actor) {
    if (!actor) return { weapons: [], spells: [] };
    const weapons = actor.items.filter(item => item.type === "weapon" && item.system.equipped);
    const spells = actor.items.filter(item => item.type === "spell" && item.system.range?.value);
    return { weapons, spells };
}

function getTargetingData(sourceToken, targetToken, weapons, spells) {
    const distance = canvas.grid.measureDistances([{ ray: new Ray(sourceToken.center, targetToken.center) }], { gridSpaces: true })[0];
    const validWeapons = weapons.filter(weapon => distance <= getAttackRanges(weapon).long);
    const validSpells = spells.filter(spell => distance <= getRangeNumber(spell.system.range?.value));
    return { distance, validAttacks: [...validWeapons, ...validSpells] };
}

function getRangeLabel(distance, validAttacks) {
    if (!validAttacks.length) return { text: "[Out of Range]", textColor: "#FF0000" };
    const inShortRange = distance <= Math.min(...validAttacks.map(attack => getAttackRanges(attack).short));
    return {
        text: "[In Range]",
        textColor: inShortRange ? "#00FF00" : "#FFFF00"
    };
}

function isPotentialTarget(token, selectedToken) {
    if (!token?.actor) return false;
    if (token.id === selectedToken.id || token.document.hidden) return false;
    return !(token.actor.hasPlayerOwner && !token.actor.testUserPermission(game.user, "OWNER"));
}

function getHoveredTargetToken(sourceToken) {
    const hovered = canvas.tokens.hover ?? canvas.tokens.placeables.find(token => token.hover || token._hover);
    if (!hovered || hovered.id === sourceToken.id || hovered.document.hidden) return null;
    return hovered;
}

function setOnlyTarget(targetToken) {
    game.user.targets.forEach(token => {
        if (token.id !== targetToken.id) token.setTarget(false, { user: game.user });
    });
    targetToken.setTarget(true, { user: game.user });
}

function buildAttackCardContent(sourceToken, targetToken, validAttacks, distance) {
    const sourceName = escapeHtml(sourceToken.name);
    const targetName = escapeHtml(targetToken.name);
    const distanceText = escapeHtml(`${distance} ${sourceToken.actor?.type === "vehicle" ? "M" : "ft"} away`);

    if (!validAttacks.length) {
        return `<div class="full-speed-ahead-target-card">
            <p><strong>${sourceName}</strong> has no available attacks in range for <strong>${targetName}</strong>.</p>
            <p>${distanceText}</p>
        </div>`;
    }

    const buttons = validAttacks.map(attack => {
        const ranges = getAttackRanges(attack);
        const disadvantage = distance > ranges.short && distance <= ranges.long;
        const prefix = disadvantage ? "[Dis.] " : "";
        const title = disadvantage ? "Roll with disadvantage" : "Roll normally";
        return `<button type="button"
                class="full-speed-ahead-roll-attack"
                data-item-uuid="${escapeHtml(attack.uuid)}"
                data-target-token-uuid="${escapeHtml(targetToken.document.uuid)}"
                data-disadvantage="${disadvantage ? "true" : "false"}"
                title="${title}"
                style="display:block;width:100%;margin:4px 0;text-align:left;">
            ${escapeHtml(prefix + attack.name)}
        </button>`;
    }).join("");

    return `<div class="full-speed-ahead-target-card">
        <p><strong>${sourceName}</strong> targeting <strong>${targetName}</strong></p>
        <p>${distanceText}</p>
        <div>${buttons}</div>
    </div>`;
}

async function getTokenObjectFromUuid(uuid) {
    const document = await fromUuid(uuid);
    if (!document) return null;
    return document.object ?? canvas.tokens.get(document.id) ?? null;
}

function isTargetShortcutEvent(event) {
    if (event.repeat) return false;
    if (event.key?.toLowerCase() !== "t" && event.code !== "KeyT") return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;

    const target = event.target;
    if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return false;
    return true;
}

function escapeHtml(value) {
    if (globalThis.foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(String(value ?? ""));
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[character]));
}

function getRangeNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value ?? "").replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getAttackRanges(attack) {
    const short = getRangeNumber(attack.system.range?.value);
    const long = getRangeNumber(attack.system.range?.long) || short;
    return { short, long };
}

Hooks.on("ready", () => {
    game.modules.get(MODULE_ID).api = {
        ...(game.modules.get(MODULE_ID).api ?? {}),
        highlightWeaponRange: TargetingSystem.highlightWeaponRange
    };

    document.addEventListener("keydown", event => TargetingSystem.handleTargetShortcut(event), true);

    Hooks.on("renderChatMessage", (_message, html) => {
        html.find(".full-speed-ahead-roll-attack").on("click", event => TargetingSystem.rollAttackFromChat(event));
    });

    console.log("Targeting System has been initialized");
});
