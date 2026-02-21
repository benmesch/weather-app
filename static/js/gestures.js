/* BenWeather — Touch/swipe, pull-to-refresh, header buttons, overlay close handlers */

import state from './state.js';
import nav from './nav.js';

export function bindGlobalEvents() {
    // Header buttons
    document.getElementById("back-btn").addEventListener("click", nav.navigateToDashboard);
    document.getElementById("add-btn").addEventListener("click", nav.openActionPicker);
    document.getElementById("settings-btn").addEventListener("click", () => {
        if (state.showingComparisonIdx >= 0) {
            nav.openCompConfig(state.showingComparisonIdx);
        } else {
            nav.openSettings();
        }
    });

    // Action picker buttons
    document.getElementById("add-action-close")?.addEventListener("click", nav.closeActionPicker);
    document.getElementById("add-action-location")?.addEventListener("click", () => {
        nav.closeActionPicker();
        nav.openSearch();
    });
    document.getElementById("add-action-comparison")?.addEventListener("click", () => {
        nav.closeActionPicker();
        nav.openAddComparison();
    });

    // Close buttons
    document.getElementById("search-close")?.addEventListener("click", nav.closeSearch);
    document.getElementById("settings-close")?.addEventListener("click", nav.closeSettings);
    document.getElementById("history-close")?.addEventListener("click", () => {
        document.getElementById("history-overlay").classList.add("hidden");
        state.historyChartMeta = null;
        const tooltip = document.getElementById("history-tooltip");
        if (tooltip) tooltip.classList.remove("visible");
    });
    document.getElementById("comparison-close")?.addEventListener("click", () => {
        document.getElementById("comparison-overlay").classList.add("hidden");
    });
    document.getElementById("add-comparison-close")?.addEventListener("click", nav.closeAddComparison);
    document.getElementById("add-comp-save")?.addEventListener("click", nav.saveNewComparison);

    // Add-comparison selects + search inputs
    document.getElementById("add-comp-sel-1")?.addEventListener("change", () => nav.onCompSelectChange(1));
    document.getElementById("add-comp-sel-2")?.addEventListener("change", () => nav.onCompSelectChange(2));
    document.getElementById("add-comp-search-input-1")?.addEventListener("input", (e) => nav.onCompSearchInput(1, e.target.value.trim()));
    document.getElementById("add-comp-search-input-2")?.addEventListener("input", (e) => nav.onCompSearchInput(2, e.target.value.trim()));

    // Search input debounce
    document.getElementById("location-search-input")?.addEventListener("input", (e) => {
        clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(() => nav.doSearch(e.target.value.trim()), 300);
    });

    // Close overlays on backdrop tap
    for (const id of ["location-search-overlay", "settings-overlay", "history-overlay", "comparison-overlay", "add-action-overlay", "add-comparison-overlay"]) {
        document.getElementById(id)?.addEventListener("click", (e) => {
            if (e.target.classList.contains("overlay")) {
                e.target.classList.add("hidden");
            }
        });
    }

    // Pull-to-refresh + swipe between locations
    let touchStartX = 0, touchStartY = 0;
    let pulling = false;
    let swiping = false;

    document.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;

        pulling = window.scrollY === 0;

        swiping = state.cardOrder.length > 0
            && !e.target.closest(".hourly-scroll, .precip-strip, .history-chart, #radar-map")
            && !e.target.closest(".overlay");
    }, { passive: true });

    document.addEventListener("touchend", (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        // Pull-to-refresh
        if (pulling && dy > 80) {
            nav.refreshCurrent();
            if (state.activeLocation && state.activeWeather) {
                nav.fetchAndRenderDetail(state.activeLocation);
            }
        }
        pulling = false;

        // Swipe cycle: Dashboard -> cardOrder[0] -> ... -> cardOrder[n-1] -> Dashboard
        if (swiping && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
            const ci = nav.currentCardIdx();
            if (ci === -1 && !state.activeLocation && state.showingComparisonIdx < 0) {
                if (dx < 0 && state.cardOrder.length) nav.navigateToCard(0);
                else if (dx > 0 && state.cardOrder.length) nav.navigateToCard(state.cardOrder.length - 1);
            } else if (ci >= 0) {
                if (dx < 0) {
                    if (ci < state.cardOrder.length - 1) nav.navigateToCard(ci + 1);
                    else nav.navigateToDashboard();
                } else {
                    if (ci > 0) nav.navigateToCard(ci - 1);
                    else nav.navigateToDashboard();
                }
            }
        }
        swiping = false;
    }, { passive: true });

    // Visibility change — refresh on app resume
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            nav.refreshCurrent();
        }
    });

    // iOS keyboard: push overlay content above keyboard
    if (window.visualViewport) {
        const onVVResize = () => {
            const offset = Math.max(0, window.innerHeight - window.visualViewport.height);
            document.documentElement.style.setProperty("--kb-offset", `${offset}px`);
        };
        window.visualViewport.addEventListener("resize", onVVResize);
        window.visualViewport.addEventListener("scroll", onVVResize);
    }
}
