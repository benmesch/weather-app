/* BenWeather — Shared mutable state */

const state = {
    locations: [],
    allCurrent: {},
    activeLocation: null,
    activeWeather: null,
    searchTimeout: null,
    historyChartMeta: null,
    allAlerts: {},
    radarMap: null,
    radarInterval: null,
    comparisons: [],
    comparisonDataMap: new Map(),
    showingComparisonIdx: -1,
    cardOrder: [],
    addCompLoc1: null,
    addCompLoc2: null,
    addCompSearchTimeout1: null,
    addCompSearchTimeout2: null,
};

export default state;
