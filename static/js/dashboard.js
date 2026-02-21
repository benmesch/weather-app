/* BenWeather — Dashboard view */

import state from './state.js';
import nav from './nav.js';
import { displayName, displayNameTrailing, esc, alertSeverityClass } from './utils.js';

export function renderDashboard() {
    const container = document.getElementById("weather-container");
    document.getElementById("back-btn").classList.add("hidden");
    document.getElementById("add-btn").classList.remove("hidden");
    document.getElementById("header-title").textContent = "BenWeather";

    if (!state.cardOrder.length) {
        container.innerHTML = `<div class="loading">No locations added. Tap + to add one.</div>`;
        return;
    }

    let html = "";
    for (const card of state.cardOrder) {
        if (card.type === "loc") {
            const loc = state.locations.find(l => `${l.lat},${l.lon}` === card.key);
            if (!loc) continue;
            const key = card.key;
            const cur = state.allCurrent[key];
            if (cur) {
                const temp = Math.round(cur.temperature || 0);
                const hi = cur.today_high != null ? Math.round(cur.today_high) : "--";
                const lo = cur.today_low != null ? Math.round(cur.today_low) : "--";
                const alerts = state.allAlerts[key] || [];
                const alertBadge = alerts.length ? `<div class="loc-card-alert ${alertSeverityClass(alerts)}">${esc(alerts[0].event)}${alerts.length > 1 ? ` +${alerts.length - 1}` : ""}</div>` : "";
                html += `
                <div class="location-card" data-lat="${loc.lat}" data-lon="${loc.lon}">
                    ${alertBadge}
                    <div class="loc-card-top">
                        <div>
                            <div class="loc-card-name">${esc(displayName(loc))}</div>
                            <div class="loc-card-region">${esc(loc.region || "")}</div>
                            <div class="loc-card-desc">${esc(cur.weather_desc || "")}</div>
                        </div>
                        <div style="text-align:right">
                            <div class="loc-card-icon">${cur.weather_icon || ""}</div>
                            <div class="loc-card-temp">${temp}°</div>
                        </div>
                    </div>
                    <div class="loc-card-details">
                        <span>H:${hi}° L:${lo}°</span>
                        <span>Feels ${Math.round(cur.feels_like || 0)}°</span>
                        <span>Wind ${Math.round(cur.wind_speed || 0)} mph</span>
                        <span>${Math.round(cur.humidity || 0)}% Hum</span>
                        ${(cur.precipitation || 0) > 0 ? `<span class="loc-card-precip">${cur.precipitation}" rain</span>` : ""}
                    </div>
                </div>`;
            } else {
                html += `
                <div class="location-card" data-lat="${loc.lat}" data-lon="${loc.lon}">
                    <div class="loc-card-top">
                        <div>
                            <div class="loc-card-name">${esc(displayName(loc))}</div>
                            <div class="loc-card-region">${esc(loc.region || "")}</div>
                        </div>
                        <div class="loading-spinner"></div>
                    </div>
                </div>`;
            }
        } else if (card.type === "comp") {
            const ci = state.comparisons.findIndex(c => nav.comparisonKey(c) === card.key);
            if (ci < 0) continue;
            const locs = nav.getComparisonLocsForIdx(ci);
            if (!locs) continue;
            const n1 = displayNameTrailing(locs.loc1);
            const n2 = displayName(locs.loc2);
            html += `<div class="comparison-card" data-comp-idx="${ci}">
                <div class="comparison-card-inner">
                    <div class="comparison-card-text">
                        <div class="comparison-card-title">${esc(n1)} vs ${esc(n2)}</div>
                        <div class="comparison-card-sub" id="comp-card-sub-${ci}">Loading...</div>
                    </div>
                    <span class="comparison-card-arrow">&rsaquo;</span>
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;

    nav.loadAllComparisonSummaries();

    container.querySelectorAll(".comparison-card").forEach(card => {
        card.addEventListener("click", () => {
            const idx = parseInt(card.dataset.compIdx);
            nav.navigateToComparison(idx);
        });
    });
    container.querySelectorAll(".location-card").forEach(card => {
        card.addEventListener("click", () => {
            const lat = parseFloat(card.dataset.lat);
            const lon = parseFloat(card.dataset.lon);
            const loc = state.locations.find(l => l.lat === lat && l.lon === lon);
            if (loc) nav.navigateToDetail(loc);
        });
    });
}
