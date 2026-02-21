/* BenWeather — Action picker & add-comparison flow */

import state from './state.js';
import nav from './nav.js';
import { displayName, esc } from './utils.js';

export function openActionPicker() {
    let el = document.getElementById("add-action-overlay");
    if (!el) {
        el = document.createElement("div");
        el.id = "add-action-overlay";
        el.className = "overlay hidden";
        el.innerHTML = `<div class="overlay-content">
            <div class="overlay-header"><h2>Add</h2><button class="close-btn" id="add-action-close-injected">&times;</button></div>
            <button class="add-action-btn" id="add-action-location-injected">Add Location</button>
            <button class="add-action-btn" id="add-action-comparison-injected">Add Comparison</button>
        </div>`;
        document.body.appendChild(el);
        el.querySelector("#add-action-close-injected").addEventListener("click", closeActionPicker);
        el.querySelector("#add-action-location-injected").addEventListener("click", () => { closeActionPicker(); nav.openSearch(); });
        el.querySelector("#add-action-comparison-injected").addEventListener("click", () => { closeActionPicker(); openAddComparison(); });
        el.addEventListener("click", (e) => { if (e.target.classList.contains("overlay")) e.target.classList.add("hidden"); });
    }
    el.classList.remove("hidden");
}

export function closeActionPicker() {
    document.getElementById("add-action-overlay")?.classList.add("hidden");
}

export function openAddComparison() {
    state.addCompLoc1 = null;
    state.addCompLoc2 = null;
    populateCompSlot(1);
    populateCompSlot(2);
    document.getElementById("add-comp-search-1").classList.add("hidden");
    document.getElementById("add-comp-search-2").classList.add("hidden");
    document.getElementById("add-comparison-overlay").classList.remove("hidden");
}

export function closeAddComparison() {
    document.getElementById("add-comparison-overlay").classList.add("hidden");
}

function populateCompSlot(slot) {
    const sel = document.getElementById(`add-comp-sel-${slot}`);
    let html = '<option value="" disabled selected>Select location</option>';
    state.locations.forEach((l, i) => {
        html += `<option value="saved-${i}">${esc(displayName(l))}</option>`;
    });
    html += '<option value="search">Search for new...</option>';
    sel.innerHTML = html;
}

export function onCompSelectChange(slot) {
    const sel = document.getElementById(`add-comp-sel-${slot}`);
    const val = sel.value;
    const searchDiv = document.getElementById(`add-comp-search-${slot}`);
    if (val === "search") {
        searchDiv.classList.remove("hidden");
        const input = document.getElementById(`add-comp-search-input-${slot}`);
        input.value = "";
        document.getElementById(`add-comp-search-results-${slot}`).innerHTML = "";
        setTimeout(() => input.focus(), 50);
        if (slot === 1) state.addCompLoc1 = null;
        else state.addCompLoc2 = null;
    } else if (val.startsWith("saved-")) {
        searchDiv.classList.add("hidden");
        const idx = parseInt(val.replace("saved-", ""));
        if (slot === 1) state.addCompLoc1 = { ...state.locations[idx] };
        else state.addCompLoc2 = { ...state.locations[idx] };
    }
}

export function onCompSearchInput(slot, query) {
    const key = slot === 1 ? "addCompSearchTimeout1" : "addCompSearchTimeout2";
    clearTimeout(state[key]);
    if (!query || query.length < 2) {
        document.getElementById(`add-comp-search-results-${slot}`).innerHTML = "";
        return;
    }
    state[key] = setTimeout(async () => {
        try {
            const resp = await fetch(`/api/locations/search?q=${encodeURIComponent(query)}`);
            const results = await resp.json();
            const container = document.getElementById(`add-comp-search-results-${slot}`);
            if (!results.length) {
                container.innerHTML = '<div class="loading" style="padding:10px">No results</div>';
                return;
            }
            container.innerHTML = results.map(r => `
                <div class="search-result-item" data-loc='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
                    <div class="search-result-name">${esc(r.name)}</div>
                    <div class="search-result-region">${esc([r.region, r.country].filter(Boolean).join(", "))}</div>
                </div>
            `).join("");
            container.querySelectorAll(".search-result-item").forEach(el => {
                el.addEventListener("click", () => {
                    const loc = JSON.parse(el.dataset.loc);
                    onCompSearchPick(slot, loc);
                });
            });
        } catch (e) {
            console.error("Comp search failed", e);
        }
    }, 300);
}

function onCompSearchPick(slot, loc) {
    if (slot === 1) state.addCompLoc1 = loc;
    else state.addCompLoc2 = loc;
    const sel = document.getElementById(`add-comp-sel-${slot}`);
    Array.from(sel.options).forEach(o => { if (o.value.startsWith("new-")) o.remove(); });
    const opt = document.createElement("option");
    opt.value = `new-${loc.lat}-${loc.lon}`;
    opt.textContent = `${loc.name}${loc.region ? ", " + loc.region : ""}`;
    sel.insertBefore(opt, sel.querySelector('[value="search"]'));
    sel.value = opt.value;
    document.getElementById(`add-comp-search-${slot}`).classList.add("hidden");
}

export async function saveNewComparison() {
    if (!state.addCompLoc1 || !state.addCompLoc2) return;
    if (state.addCompLoc1.lat === state.addCompLoc2.lat && state.addCompLoc1.lon === state.addCompLoc2.lon) return;
    const newComp = { loc1: { ...state.addCompLoc1 }, loc2: { ...state.addCompLoc2 } };
    const newKey = nav.comparisonKey(newComp);
    if (state.comparisons.some(c => nav.comparisonKey(c) === newKey)) {
        closeAddComparison();
        return;
    }
    state.comparisons.push(newComp);
    state.cardOrder.push({ type: "comp", key: newKey });
    await nav.saveComparisons();
    await nav.saveCardOrder();
    closeAddComparison();
    nav.renderDashboard();
}
