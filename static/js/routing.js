/* BenWeather — View dispatcher & navigation */

import state from './state.js';
import nav from './nav.js';

export function renderView() {
    if (state.showingComparisonIdx >= 0) {
        nav.renderComparisonView(state.showingComparisonIdx);
    } else if (state.activeLocation) {
        nav.renderDetail();
    } else {
        nav.renderDashboard();
    }
}

export function navigateToDetail(loc) {
    state.showingComparisonIdx = -1;
    state.activeLocation = loc;
    state.activeWeather = null;
    renderView();
    nav.fetchAndRenderDetail(loc);
}

export function navigateToDashboard() {
    nav.cleanupRadar();
    state.activeLocation = null;
    state.activeWeather = null;
    state.showingComparisonIdx = -1;
    document.getElementById("header-title").textContent = "BenWeather";
    document.getElementById("back-btn").classList.add("hidden");
    document.getElementById("add-btn").classList.remove("hidden");
    renderView();
}

export function navigateToComparison(idx) {
    nav.cleanupRadar();
    state.activeLocation = null;
    state.activeWeather = null;
    state.showingComparisonIdx = idx;
    renderView();
}
