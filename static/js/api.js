/* BenWeather — Server communication & data management */

import state from './state.js';
import nav from './nav.js';

export async function loadSettings() {
    try {
        const resp = await fetch("/api/settings");
        const data = await resp.json();
        state.locations = data.locations || [];
        state.comparisons = data.comparisons || [];
        if (!state.comparisons.length && state.locations.length >= 2) {
            state.comparisons = [{
                loc1: { ...state.locations[0] },
                loc2: { ...state.locations[1] },
            }];
            await saveComparisons();
        }
        state.cardOrder = data.card_order || [];
        await rebuildCardOrderIfNeeded();
    } catch (e) {
        console.error("Failed to load settings", e);
    }
}

async function rebuildCardOrderIfNeeded() {
    const existing = new Set(state.cardOrder.map(c => c.key));
    let changed = false;
    for (const loc of state.locations) {
        const key = `${loc.lat},${loc.lon}`;
        if (!existing.has(key)) {
            state.cardOrder.push({ type: "loc", key });
            existing.add(key);
            changed = true;
        }
    }
    for (const comp of state.comparisons) {
        const key = comparisonKey(comp);
        if (!existing.has(key)) {
            state.cardOrder.push({ type: "comp", key });
            existing.add(key);
            changed = true;
        }
    }
    const locKeys = new Set(state.locations.map(l => `${l.lat},${l.lon}`));
    const compKeys = new Set(state.comparisons.map(c => comparisonKey(c)));
    const before = state.cardOrder.length;
    state.cardOrder = state.cardOrder.filter(c =>
        (c.type === "loc" && locKeys.has(c.key)) ||
        (c.type === "comp" && compKeys.has(c.key))
    );
    if (state.cardOrder.length !== before) changed = true;
    if (changed) await saveCardOrder();
}

export async function saveCardOrder() {
    try {
        await fetch("/api/settings/card-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ card_order: state.cardOrder }),
        });
    } catch (e) {
        console.error("Failed to save card order", e);
    }
}

export async function saveLocations() {
    try {
        await fetch("/api/settings/locations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locations: state.locations }),
        });
    } catch (e) {
        console.error("Failed to save locations", e);
    }
}

export async function saveComparisons() {
    try {
        await fetch("/api/settings/comparisons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comparisons: state.comparisons }),
        });
    } catch (e) {
        console.error("Failed to save comparisons", e);
    }
}

export function comparisonKey(comp) {
    const k1 = `${comp.loc1.lat},${comp.loc1.lon}`;
    const k2 = `${comp.loc2.lat},${comp.loc2.lon}`;
    return [k1, k2].sort().join("|");
}

export function getComparisonLocsForIdx(idx) {
    const comp = state.comparisons[idx];
    if (!comp || !comp.loc1 || !comp.loc2) return null;
    const enrich = (cl) => {
        const saved = state.locations.find(l => l.lat === cl.lat && l.lon === cl.lon);
        return saved ? { ...cl, emoji: saved.emoji || cl.emoji } : cl;
    };
    return { loc1: enrich(comp.loc1), loc2: enrich(comp.loc2) };
}

export function currentCardIdx() {
    if (state.showingComparisonIdx >= 0) {
        const comp = state.comparisons[state.showingComparisonIdx];
        if (comp) return state.cardOrder.findIndex(c => c.type === "comp" && c.key === comparisonKey(comp));
    } else if (state.activeLocation) {
        const key = `${state.activeLocation.lat},${state.activeLocation.lon}`;
        return state.cardOrder.findIndex(c => c.type === "loc" && c.key === key);
    }
    return -1;
}

export function navigateToCard(cardIdx) {
    const card = state.cardOrder[cardIdx];
    if (!card) return;
    if (card.type === "loc") {
        const loc = state.locations.find(l => `${l.lat},${l.lon}` === card.key);
        if (loc) nav.navigateToDetail(loc);
    } else if (card.type === "comp") {
        const ci = state.comparisons.findIndex(c => comparisonKey(c) === card.key);
        if (ci >= 0) nav.navigateToComparison(ci);
    }
}

export async function refreshCurrent() {
    try {
        const resp = await fetch("/api/refresh-current", { method: "POST" });
        const data = await resp.json();
        state.allCurrent = data;
        // Only re-render if user is on the dashboard (not detail or comparison)
        if (!state.activeLocation && state.showingComparisonIdx < 0) {
            nav.renderDashboard();
        }
    } catch (e) {
        console.error("Failed to refresh current", e);
    }
}

export async function refreshAlerts() {
    for (const loc of state.locations) {
        try {
            const resp = await fetch(`/api/alerts?lat=${loc.lat}&lon=${loc.lon}`);
            const alerts = await resp.json();
            const key = `${loc.lat},${loc.lon}`;
            state.allAlerts[key] = Array.isArray(alerts) ? alerts : [];
        } catch (e) {
            console.error("Failed to fetch alerts", e);
        }
    }
    // Only re-render if user is on the dashboard (not detail or comparison)
    if (!state.activeLocation && state.showingComparisonIdx < 0) {
        nav.renderDashboard();
    }
}

export async function loadWeather(loc) {
    try {
        const resp = await fetch(`/api/weather?lat=${loc.lat}&lon=${loc.lon}`);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        console.error("Failed to load weather", e);
        return null;
    }
}
