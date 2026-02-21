/* BenWeather — Location search overlay */

import state from './state.js';
import nav from './nav.js';
import { esc } from './utils.js';

export function openSearch() {
    document.getElementById("location-search-overlay").classList.remove("hidden");
    const input = document.getElementById("location-search-input");
    input.value = "";
    document.getElementById("search-results").innerHTML = "";
    setTimeout(() => input.focus(), 100);
}

export function closeSearch() {
    document.getElementById("location-search-overlay").classList.add("hidden");
}

export async function doSearch(query) {
    if (!query || query.length < 2) {
        document.getElementById("search-results").innerHTML = "";
        return;
    }

    try {
        const resp = await fetch(`/api/locations/search?q=${encodeURIComponent(query)}`);
        const results = await resp.json();
        const container = document.getElementById("search-results");

        if (!results.length) {
            container.innerHTML = `<div class="loading">No results found</div>`;
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
                addLocation(loc);
            });
        });
    } catch (e) {
        console.error("Search failed", e);
    }
}

async function addLocation(loc) {
    if (state.locations.some(l => l.lat === loc.lat && l.lon === loc.lon)) {
        closeSearch();
        return;
    }
    state.locations.push(loc);
    const key = `${loc.lat},${loc.lon}`;
    state.cardOrder.push({ type: "loc", key });
    await nav.saveLocations();
    await nav.saveCardOrder();
    closeSearch();
    nav.refreshCurrent();
    nav.renderDashboard();
}
