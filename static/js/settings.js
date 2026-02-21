/* BenWeather — Settings overlay & comparison config */

import state from './state.js';
import nav from './nav.js';
import { displayName, esc } from './utils.js';

export function openSettings() {
    const overlay = document.getElementById("settings-overlay");
    const container = document.getElementById("settings-cards") || document.getElementById("settings-locations");
    const len = state.cardOrder.length;

    let html = "";
    for (let i = 0; i < len; i++) {
        const card = state.cardOrder[i];
        if (card.type === "loc") {
            const loc = state.locations.find(l => `${l.lat},${l.lon}` === card.key);
            if (!loc) continue;
            const locIdx = state.locations.indexOf(loc);
            html += `
            <div class="settings-location-item" data-card-idx="${i}">
                <div class="settings-reorder-btns">
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="down" ${i === len - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
                </div>
                <div class="settings-loc-emoji-badge settings-loc-config-btn" data-loc-idx="${locIdx}">${esc(loc.emoji || "+")}</div>
                <div class="settings-loc-info settings-loc-config-btn" data-loc-idx="${locIdx}">
                    <div class="settings-loc-name">${esc(loc.display_name || loc.name)}</div>
                    <div class="settings-loc-region">${esc([loc.region, loc.country].filter(Boolean).join(", "))}</div>
                </div>
                <button class="settings-delete-btn" data-card-idx="${i}" data-card-type="loc" data-card-key="${card.key}" aria-label="Remove">&times;</button>
            </div>`;
        } else if (card.type === "comp") {
            const ci = state.comparisons.findIndex(c => nav.comparisonKey(c) === card.key);
            if (ci < 0) continue;
            const locs = nav.getComparisonLocsForIdx(ci);
            const n1 = locs ? displayName(locs.loc1) : "Unknown";
            const n2 = locs ? displayName(locs.loc2) : "Unknown";
            html += `
            <div class="settings-location-item" data-card-idx="${i}">
                <div class="settings-reorder-btns">
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="down" ${i === len - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
                </div>
                <div class="settings-comp-icon settings-comp-config-btn" data-comp-idx="${ci}">vs</div>
                <div class="settings-loc-info settings-comp-config-btn" data-comp-idx="${ci}">
                    <div class="settings-loc-name">${esc(n1)} vs ${esc(n2)}</div>
                </div>
                <button class="settings-delete-btn" data-card-idx="${i}" data-card-type="comp" data-card-key="${card.key}" aria-label="Remove">&times;</button>
            </div>`;
        }
    }

    if (!html) {
        html = '<div class="settings-comp-none">No cards added.</div>';
    }

    container.innerHTML = html;
    overlay.classList.remove("hidden");

    // Reorder buttons
    container.querySelectorAll(".settings-move-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const idx = parseInt(btn.dataset.cardIdx);
            const dir = btn.dataset.dir;
            const swap = dir === "up" ? idx - 1 : idx + 1;
            if (swap < 0 || swap >= state.cardOrder.length) return;
            [state.cardOrder[idx], state.cardOrder[swap]] = [state.cardOrder[swap], state.cardOrder[idx]];
            await nav.saveCardOrder();
            openSettings();
            nav.renderDashboard();
        });
    });

    // Delete buttons
    container.querySelectorAll(".settings-delete-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const type = btn.dataset.cardType;
            const key = btn.dataset.cardKey;
            const cardIdx = parseInt(btn.dataset.cardIdx);
            state.cardOrder.splice(cardIdx, 1);
            await nav.saveCardOrder();
            if (type === "loc") {
                const li = state.locations.findIndex(l => `${l.lat},${l.lon}` === key);
                if (li >= 0) state.locations.splice(li, 1);
                await nav.saveLocations();
            } else if (type === "comp") {
                const ci = state.comparisons.findIndex(c => nav.comparisonKey(c) === key);
                if (ci >= 0) state.comparisons.splice(ci, 1);
                await nav.saveComparisons();
            }
            openSettings();
            nav.renderDashboard();
        });
    });

    // Location config buttons
    container.querySelectorAll(".settings-loc-config-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const li = parseInt(btn.dataset.locIdx);
            openLocConfig(li);
        });
    });

    // Comparison config buttons
    container.querySelectorAll(".settings-comp-config-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const ci = parseInt(btn.dataset.compIdx);
            openCompConfig(ci);
        });
    });
}

function openLocConfig(li) {
    const loc = state.locations[li];
    if (!loc) return;

    let overlay = document.getElementById("loc-config-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "loc-config-overlay";
        overlay.className = "overlay hidden";
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e) => {
            if (e.target.classList.contains("overlay")) overlay.classList.add("hidden");
        });
    }

    overlay.innerHTML = `<div class="overlay-content">
        <div class="overlay-header">
            <h2>Location Settings</h2>
            <button class="close-btn" id="loc-config-close">&times;</button>
        </div>
        <div class="loc-config-row">
            <div class="loc-config-label">Emoji</div>
            <input type="text" class="settings-emoji-input" id="loc-config-emoji" value="${esc(loc.emoji || "")}" placeholder="+" maxlength="2" aria-label="Emoji">
        </div>
        <div class="loc-config-row">
            <div class="loc-config-label">Name</div>
            <input type="text" class="loc-config-display-name-input" id="loc-config-name" value="${esc(loc.display_name || "")}" placeholder="${esc(loc.name)}" aria-label="Display name">
        </div>
        <div class="loc-config-original">Original: ${esc(loc.name)}</div>
    </div>`;

    overlay.classList.remove("hidden");

    document.getElementById("loc-config-close").addEventListener("click", () => {
        overlay.classList.add("hidden");
    });

    const save = async () => {
        loc.emoji = document.getElementById("loc-config-emoji").value.trim() || "";
        loc.display_name = document.getElementById("loc-config-name").value.trim() || "";
        await nav.saveLocations();
        openSettings();
        nav.renderDashboard();
    };
    document.getElementById("loc-config-emoji").addEventListener("change", save);
    document.getElementById("loc-config-name").addEventListener("change", save);
}

const METRIC_LIST = [
    { key: "sunshine_hours", label: "Sunshine hours" },
    { key: "rainy_days", label: "Rainy days" },
    { key: "overcast_days", label: "Overcast days" },
    { key: "cozy_overcast_days", label: "Cozy overcast days" },
    { key: "snow_days", label: "Snow days" },
    { key: "freezing_days", label: "Freezing days" },
    { key: "hot_days", label: "Hot days" },
    { key: "sticky_days", label: "Sticky days" },
    { key: "avg_daylight_hours", label: "Daylight hours" },
    { key: "avg_sunset_min", label: "Avg sunset time" },
];

function toggleIcon(mode) {
    return mode === "scored" ? "\u2713" : mode === "display" ? "\u25D0" : "\u2715";
}

function openCompConfig(ci) {
    const comp = state.comparisons[ci];
    if (!comp) return;
    const locs = nav.getComparisonLocsForIdx(ci);
    if (!locs) return;

    let overlay = document.getElementById("comp-config-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "comp-config-overlay";
        overlay.className = "overlay hidden";
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (e) => {
            if (e.target.classList.contains("overlay")) overlay.classList.add("hidden");
        });
    }

    const name1 = locs.loc1.name;
    const name2 = locs.loc2.name;
    const emoji1 = comp.loc1.emoji || "";
    const emoji2 = comp.loc2.emoji || "";
    const hidden = new Set(comp.hidden_metrics || []);
    const displayOnly = new Set(comp.display_metrics || []);

    let metricsHtml = "";
    for (const m of METRIC_LIST) {
        const mode = hidden.has(m.key) ? "hidden" : displayOnly.has(m.key) ? "display" : "scored";
        metricsHtml += `<label class="comp-config-metric-row" data-metric="${m.key}" data-mode="${mode}">
            <span class="metric-toggle">${toggleIcon(mode)}</span>
            <span>${esc(m.label)}</span>
        </label>`;
    }

    overlay.innerHTML = `<div class="overlay-content">
        <div class="overlay-header">
            <h2>Comparison Settings</h2>
            <button class="close-btn" id="comp-config-close">&times;</button>
        </div>
        <div class="comp-config-row">
            <input type="text" class="settings-emoji-input" id="comp-config-emoji-1" value="${esc(emoji1)}" placeholder="+" maxlength="2" aria-label="Emoji for ${esc(name1)}">
            <div class="comp-config-name">${esc(name1)}</div>
        </div>
        <div class="comp-config-row">
            <input type="text" class="settings-emoji-input" id="comp-config-emoji-2" value="${esc(emoji2)}" placeholder="+" maxlength="2" aria-label="Emoji for ${esc(name2)}">
            <div class="comp-config-name">${esc(name2)}</div>
        </div>
        <div class="comp-config-section-label">Metrics</div>
        <div class="comp-config-metrics">${metricsHtml}</div>
    </div>`;

    overlay.classList.remove("hidden");

    document.getElementById("comp-config-close").addEventListener("click", () => {
        overlay.classList.add("hidden");
    });

    const saveEmojis = async () => {
        comp.loc1.emoji = document.getElementById("comp-config-emoji-1").value.trim() || "";
        comp.loc2.emoji = document.getElementById("comp-config-emoji-2").value.trim() || "";
        await nav.saveComparisons();
        openSettings();
        nav.renderDashboard();
    };
    document.getElementById("comp-config-emoji-1").addEventListener("change", saveEmojis);
    document.getElementById("comp-config-emoji-2").addEventListener("change", saveEmojis);

    overlay.querySelectorAll('.comp-config-metric-row').forEach(row => {
        row.addEventListener("click", async (e) => {
            e.preventDefault();
            // Cycle: scored → display → hidden → scored
            const cur = row.dataset.mode;
            const next = cur === "scored" ? "display" : cur === "display" ? "hidden" : "scored";
            row.dataset.mode = next;
            row.querySelector(".metric-toggle").textContent = toggleIcon(next);

            // Clear old cache entry before updating
            const oldNotScored = [...(comp.hidden_metrics || []), ...(comp.display_metrics || [])].sort().join(",");
            const baseKey = nav.comparisonKey(comp);
            const oldCacheKey = oldNotScored ? `${baseKey}#${oldNotScored}` : baseKey;
            state.comparisonDataMap.delete(oldCacheKey);

            // Rebuild both arrays from all rows
            const newHidden = [];
            const newDisplay = [];
            overlay.querySelectorAll('.comp-config-metric-row').forEach(r => {
                if (r.dataset.mode === "hidden") newHidden.push(r.dataset.metric);
                else if (r.dataset.mode === "display") newDisplay.push(r.dataset.metric);
            });
            comp.hidden_metrics = newHidden;
            comp.display_metrics = newDisplay;
            await nav.saveComparisons();
            if (state.showingComparisonIdx === ci) {
                nav.renderComparisonView(ci);
            }
        });
    });
}

export { openCompConfig };

export function closeSettings() {
    document.getElementById("settings-overlay").classList.add("hidden");
}
