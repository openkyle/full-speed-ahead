// targetingsystem.js: Module code for Highlight Tokens Based on Selected Token Weapon and Spell Range
// This module finds player-controlled tokens on the canvas and illuminates them based on weapon and spell ranges.

export class TargetingSystem {
    static async highlightWeaponRange() {
        // Check if the targeting system is enabled in the settings
        if (!game.settings.get('full-speed-ahead', 'enableTargetingSystem')) {
            console.log('Targeting System is disabled in settings. Exiting highlightWeaponRange.');
            return;
        }

        // Hide all open character sheets and other UI windows
        let hiddenWindows = [...Object.values(ui.windows)];
        hiddenWindows.forEach(win => win.minimize());

        // Check the canvas grid scale unit
        const gridUnit = canvas.scene.grid.units;
        if (gridUnit.toLowerCase() !== "ft" && gridUnit.toLowerCase() !== "m") {
            ui.notifications.error("There are weapons equipped that function at this range.");
            return;
        }

        let selectedToken;

        if (canvas.tokens.controlled.length === 1) {
            // Use the selected token to calculate range if one is selected
            selectedToken = canvas.tokens.controlled[0];
        } else {
            // Get all tokens from the active canvas that the current user has ownership of
            const controlledTokens = canvas.tokens.placeables.filter(token => 
                token.actor && 
                token.actor.testUserPermission(game.user, "OWNER") // Owner permission check
            );

            if (controlledTokens.length !== 1) {
                ui.notifications.warn("Please select a character first.");
                return;
            }

            selectedToken = controlledTokens[0];
        }

        const actor = selectedToken.actor;
        
        // Get equipped weapons from selected token's items
        let weapons = actor.items.filter(item => item.type === 'weapon' && item.system.equipped);
        // Get spells with proper nested range information
        let spells = actor.items.filter(item => item.type === 'spell' && item.system.range?.value);

        // Display a message to prompt user to select their target
        ui.notifications.error("Please click on the enemy you wish to target!");

        // Set global canvas cursor to the red ⌖ symbol until the user selects a target
        document.body.style.cursor = 'crosshair';

        // Store references to the created elements for later removal
        let floatingElements = [];
        let cleanedUp = false;

        // Draw long and short range templates once before iterating over tokens
        let longRangeTemplate, shortRangeTemplate;

        // Check if the actor is a vehicle before creating range templates
        if (actor.type === 'vehicle') {
            // Find the weapon array items on the vehicle actor
            let weaponArrayItems = actor.items.filter(i => i.type === "weapon" && getRangeNumber(i.system.range?.long) > 0);
            if (weaponArrayItems.length > 0) {
                // Extract the highest long range from the weapon array items
                let highestLongRangeItem = weaponArrayItems.reduce((max, item) => getRangeNumber(item.system.range.long) > getRangeNumber(max.system.range.long) ? item : max);
                let longRange = getRangeNumber(highestLongRangeItem.system.range.long) - 50; // Subtract 50 from long range for drawing purposes
                let unit = highestLongRangeItem.system.range.units;

                // Extract the short range from the weapon array item
                let shortRange = getRangeNumber(highestLongRangeItem.system.range.value) - 50; // Subtract 50 from short range for drawing purposes

                if (longRange > 0 && shortRange > 0 && (unit === "m" || unit === "ft")) {
                    // Use the selected token to create range templates
                    let rollingToken = selectedToken;

                    // Create a measured template for long range (yellow border, fully transparent fill)
                    let longRangeTemplateData = {
                        t: "circle",
                        user: game.user.id,
                        x: rollingToken.center.x,
                        y: rollingToken.center.y,
                        distance: longRange,
                        borderColor: "",
                        fillColor: "#898234",
                        fillAlpha: 0.0,
                        flags: { "myModule.weaponLongRangeTemplate": true }
                    };

                    longRangeTemplate = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [longRangeTemplateData]);

                    // Create a measured template for short range (green border, fully transparent fill)
                    let shortRangeTemplateData = {
                        t: "circle",
                        user: game.user.id,
                        x: rollingToken.center.x,
                        y: rollingToken.center.y,
                        distance: shortRange,
                        borderColor: "",
                        fillColor: "#159504",
                        fillAlpha: 0.0,
                        flags: { "myModule.weaponShortRangeTemplate": true }
                    };

                    shortRangeTemplate = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [shortRangeTemplateData]);
                }
            }
        }

        // Iterate over all tokens on the canvas
        for (let token of canvas.tokens.placeables) {
            // Skip the selected token itself, if the token is invisible, or if the token belongs to another player
            if (token.id === selectedToken.id || token.document.hidden || (token.actor.hasPlayerOwner && !token.actor.testUserPermission(game.user, "OWNER"))) continue;

            // Calculate the distance to the selected token
            let distance = canvas.grid.measureDistances([{ ray: new Ray(selectedToken.center, token.center) }], { gridSpaces: true })[0];

            // Determine text label and color based on range
            let text = "";
            let textColor = "#FFFFFF";

            let validWeapons = weapons.filter(weapon => distance <= getAttackRanges(weapon).long);

            let validSpells = spells.filter(spell => {
                let spellRange = getRangeNumber(spell.system.range?.value);
                return distance <= spellRange;
            });

            // Combine valid weapons and spells
            let validAttacks = [...validWeapons, ...validSpells];

            if (validAttacks.length > 0) {
                if (distance <= Math.min(...validAttacks.map(attack => getAttackRanges(attack).short))) {
                    text = "[In Range]";
                    textColor = "#00FF00"; // Green for within short range
                } else {
                    text = "[In Range]";
                    textColor = "#FFFF00"; // Yellow for within long range
                }
            } else {
                text = "[Out of Range]";
                textColor = "#FF0000"; // Red for outside range
            }

            // Create a transparent clickable mat over the token
            let transparentMat = new PIXI.Graphics();
            transparentMat.beginFill(0x000000, 0.001); // Nearly transparent fill
            transparentMat.drawRect(token.center.x - token.w / 2, token.center.y - token.h / 2, token.w, token.h);
            transparentMat.endFill();
            transparentMat.interactive = true;
            transparentMat.buttonMode = true; // Show clickable cursor
            canvas.stage.addChild(transparentMat);
            floatingElements.push(transparentMat);

            // Create a floating text for range label
            let floatingText = new PIXI.Text(text, {
                fontFamily: "Arial",
                fontSize: 24, // Smaller font size
                fill: textColor,
                stroke: "#000000",
                strokeThickness: 4,
                dropShadow: true, // Add shadow for better visibility
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 4
            });
            floatingText.position.set(token.center.x + 60, token.center.y - 20); // Position further lower and to the left of the token
            canvas.stage.addChild(floatingText);
            floatingElements.push(floatingText);

            // Create a floating text for distance label in white with padding on the left side
            let distanceText = `${distance} ${actor.type === 'vehicle' ? 'M' : 'ft'} away`;
            let floatingDistanceText = new PIXI.Text(distanceText, {
                fontFamily: "Arial",
                fontSize: 20, // Smaller font size for distance
                fill: "#FFFFFF",
                align: "left",
                padding: 2, // Add 2 px padding to the left side
                dropShadow: true, // Add shadow for better visibility
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 4
            });
            floatingDistanceText.position.set(token.center.x + 62, token.center.y + 10); // Position below the main text with padding adjustment
            canvas.stage.addChild(floatingDistanceText);
            floatingElements.push(floatingDistanceText);

            // Create a floating text for the letter X above the target token (clickicon)
            let clickIconText = new PIXI.Text("⌖", {
                fontFamily: "Arial",
                fontSize: 60, // Large font size
                fill: "#FF0000", // Red color for visibility
                stroke: "#000000",
                strokeThickness: 8,
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 4
            });
            clickIconText.position.set(token.center.x - 32, token.center.y - 48); // Position above the token
            clickIconText.interactive = true;
            clickIconText.buttonMode = true; // Make the icon clickable, like a button
            canvas.stage.addChild(clickIconText);
            floatingElements.push(clickIconText);

            // Add click event listener for selecting the target
            const selectTarget = () => {
                // Set the token as targeted
                token.setTarget(true, { user: game.user });
                ui.notifications.warn(`[Targeting] ${token.name} has been targeted.`);
                console.log(`[Targeting System] ${token.name} has been targeted.`);

                // Play sound effect when a target is selected
                AudioHelper.play({ src: '/modules/full-speed-ahead/sounds/lockon.ogg', volume: 0.3, autoplay: true, loop: false });

                // Retrieve and print attacks for the selected token that are in range
                const attackNames = validAttacks.map(attack => {
                    let { short: shortRange, long: longRange } = getAttackRanges(attack);
                    if (distance > shortRange && distance <= longRange) {
                        return { name: attack.name, longRange: true };
                    } else {
                        return { name: attack.name, longRange: false };
                    }
                });
                if (attackNames.length > 0) {
                    let chatMessage = `${selectedToken.name} can hit ${token.name} with the following attacks:
<ul>`;
                    attackNames.forEach(attack => {
                        if (attack.longRange) {
                            chatMessage += `<li><em>[Dis.] ${attack.name}</em></li>`;
                        } else {
                            chatMessage += `<li>${attack.name}</li>`;
                        }
                    });
                    chatMessage += `</ul>`;
                    ChatMessage.create({ content: chatMessage, whisper: game.user.isGM ? [game.user.id] : [] });
                } else {
                    ChatMessage.create({ content: `${selectedToken.name} has no available attacks in range for ${token.name}.`, whisper: game.user.isGM ? [game.user.id] : [] });
                }

                cleanupTargetingDisplay();

                // Re-select the original player token
                selectedToken.control({ releaseOthers: true });
            };

            transparentMat.on('pointerdown', selectTarget);
            clickIconText.on('pointerdown', selectTarget); // Make clickIconText also trigger targeting
        }

        if (game.settings.get('full-speed-ahead', 'autoRemoveTargetingTemplate')) {
            const removalSeconds = Math.max(1, getRangeNumber(game.settings.get('full-speed-ahead', 'targetingTemplateRemovalSeconds')) || 10);
            setTimeout(() => cleanupTargetingDisplay(), removalSeconds * 1000);
        }

        function cleanupTargetingDisplay() {
            if (cleanedUp) return;
            cleanedUp = true;

            floatingElements.forEach(element => {
                if (canvas.stage.children.includes(element)) {
                    canvas.stage.removeChild(element);
                }
            });
            floatingElements = []; // Clear the reference array

            // Revert cursor back to default
            document.body.style.cursor = 'default';

            // Remove templates if they exist
            if (longRangeTemplate && longRangeTemplate[0]) canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [longRangeTemplate[0].id]);
            if (shortRangeTemplate && shortRangeTemplate[0]) canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [shortRangeTemplate[0].id]);

            // Restore all previously hidden windows
            hiddenWindows.forEach(win => win.maximize());
        }
    }
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

// Register the module function
Hooks.on('ready', () => {
    game.modules.get('full-speed-ahead').api = {
        ...(game.modules.get('full-speed-ahead').api ?? {}),
        highlightWeaponRange: TargetingSystem.highlightWeaponRange
    };
    console.log('Targeting System has been initialized');
});
