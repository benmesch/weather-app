/* BenWeather — Orchestrator */

import state from './state.js';
import nav from './nav.js';

import { loadSettings, saveCardOrder, saveLocations, saveComparisons,
         comparisonKey, getComparisonLocsForIdx, currentCardIdx,
         navigateToCard, refreshCurrent, refreshAlerts, loadWeather } from './api.js';

import { renderView, navigateToDetail, navigateToDashboard, navigateToComparison } from './routing.js';

import { renderDashboard } from './dashboard.js';

import { fetchAndRenderDetail, renderDetail, cleanupRadar } from './detail.js';

import { openHistory } from './history.js';

import { loadAllComparisonSummaries, renderComparisonView } from './comparison.js';

import { openSearch, closeSearch, doSearch } from './search.js';

import { openActionPicker, closeActionPicker, openAddComparison, closeAddComparison,
         onCompSelectChange, onCompSearchInput, saveNewComparison } from './add-comparison.js';

import { openSettings, closeSettings, openCompConfig } from './settings.js';

import { bindGlobalEvents } from './gestures.js';

// Register all cross-module functions on nav
nav.loadSettings = loadSettings;
nav.saveCardOrder = saveCardOrder;
nav.saveLocations = saveLocations;
nav.saveComparisons = saveComparisons;
nav.comparisonKey = comparisonKey;
nav.getComparisonLocsForIdx = getComparisonLocsForIdx;
nav.currentCardIdx = currentCardIdx;
nav.navigateToCard = navigateToCard;
nav.refreshCurrent = refreshCurrent;
nav.refreshAlerts = refreshAlerts;
nav.loadWeather = loadWeather;

nav.renderView = renderView;
nav.navigateToDetail = navigateToDetail;
nav.navigateToDashboard = navigateToDashboard;
nav.navigateToComparison = navigateToComparison;

nav.renderDashboard = renderDashboard;

nav.fetchAndRenderDetail = fetchAndRenderDetail;
nav.renderDetail = renderDetail;
nav.cleanupRadar = cleanupRadar;

nav.openHistory = openHistory;

nav.loadAllComparisonSummaries = loadAllComparisonSummaries;
nav.renderComparisonView = renderComparisonView;

nav.openSearch = openSearch;
nav.closeSearch = closeSearch;
nav.doSearch = doSearch;

nav.openActionPicker = openActionPicker;
nav.closeActionPicker = closeActionPicker;
nav.openAddComparison = openAddComparison;
nav.closeAddComparison = closeAddComparison;
nav.onCompSelectChange = onCompSelectChange;
nav.onCompSearchInput = onCompSearchInput;
nav.saveNewComparison = saveNewComparison;

nav.openSettings = openSettings;
nav.closeSettings = closeSettings;
nav.openCompConfig = openCompConfig;

nav.bindGlobalEvents = bindGlobalEvents;

// Init
document.addEventListener("DOMContentLoaded", async () => {
    await loadSettings();
    // Render skeleton immediately — location names and card order are
    // already known, so the dashboard shows structure right away even
    // before current-conditions data arrives.
    renderView();
    bindGlobalEvents();
    registerSW();
    // Fetch current conditions & alerts in the background.
    // refreshCurrent() and refreshAlerts() will re-render the dashboard
    // only if the user is still on it (won't snap away from detail/comparison).
    refreshCurrent();
    refreshAlerts();
});

function registerSW() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/static/sw.js").catch(err => {
            console.error("SW registration failed", err);
        });
    }
}
