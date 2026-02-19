/* BenWeather — Frontend */

// ── State ──────────────────────────────────────────────────────
let _locations = [];
let _allCurrent = {};        // key -> current conditions dict
let _activeLocation = null;  // Location obj or null (null = dashboard)
let _activeWeather = null;   // full WeatherData for active location
let _searchTimeout = null;
let _historyChartMeta = null;  // stored chart geometry for tap-to-inspect
let _allAlerts = {};           // key -> alert array
let _radarMap = null;          // Leaflet map instance (cleanup on view change)
let _radarInterval = null;     // animation timer
let _comparisons = [];              // array of {loc1: {lat,lon,...}, loc2: {lat,lon,...}}
let _comparisonDataMap = new Map();  // sorted "lat,lon|lat,lon" -> comparison result
let _showingComparisonIdx = -1;      // -1 = not showing, 0+ = index into _comparisons
let _cardOrder = [];                 // [{type:"loc",key:"lat,lon"}, {type:"comp",key:"lat,lon|lat,lon"}]

// ── Init ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await _loadSettings();
    _renderView();
    _refreshCurrent();
    _refreshAlerts();
    _bindGlobalEvents();
    _registerSW();
});

// ── Settings / Data ────────────────────────────────────────────
async function _loadSettings() {
    try {
        const resp = await fetch("/api/settings");
        const data = await resp.json();
        _locations = data.locations || [];
        _comparisons = data.comparisons || [];
        // Auto-create default comparison if none saved and 2+ locations
        if (!_comparisons.length && _locations.length >= 2) {
            _comparisons = [{
                loc1: { ..._locations[0] },
                loc2: { ..._locations[1] },
            }];
            await _saveComparisons();
        }
        // Load or build card order
        _cardOrder = data.card_order || [];
        await _rebuildCardOrderIfNeeded();
    } catch (e) {
        console.error("Failed to load settings", e);
    }
}

async function _rebuildCardOrderIfNeeded() {
    // Ensure every location and comparison has a card_order entry
    const existing = new Set(_cardOrder.map(c => c.key));
    let changed = false;
    for (const loc of _locations) {
        const key = `${loc.lat},${loc.lon}`;
        if (!existing.has(key)) {
            _cardOrder.push({ type: "loc", key });
            existing.add(key);
            changed = true;
        }
    }
    for (const comp of _comparisons) {
        const key = _comparisonKey(comp);
        if (!existing.has(key)) {
            _cardOrder.push({ type: "comp", key });
            existing.add(key);
            changed = true;
        }
    }
    // Remove stale entries
    const locKeys = new Set(_locations.map(l => `${l.lat},${l.lon}`));
    const compKeys = new Set(_comparisons.map(c => _comparisonKey(c)));
    const before = _cardOrder.length;
    _cardOrder = _cardOrder.filter(c =>
        (c.type === "loc" && locKeys.has(c.key)) ||
        (c.type === "comp" && compKeys.has(c.key))
    );
    if (_cardOrder.length !== before) changed = true;
    if (changed) await _saveCardOrder();
}

async function _saveCardOrder() {
    try {
        await fetch("/api/settings/card-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ card_order: _cardOrder }),
        });
    } catch (e) {
        console.error("Failed to save card order", e);
    }
}

async function _saveLocations() {
    try {
        await fetch("/api/settings/locations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locations: _locations }),
        });
    } catch (e) {
        console.error("Failed to save locations", e);
    }
}

async function _saveComparisons() {
    try {
        await fetch("/api/settings/comparisons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comparisons: _comparisons }),
        });
    } catch (e) {
        console.error("Failed to save comparisons", e);
    }
}

function _comparisonKey(comp) {
    const k1 = `${comp.loc1.lat},${comp.loc1.lon}`;
    const k2 = `${comp.loc2.lat},${comp.loc2.lon}`;
    return [k1, k2].sort().join("|");
}

function _getComparisonLocsForIdx(idx) {
    const comp = _comparisons[idx];
    if (!comp || !comp.loc1 || !comp.loc2) return null;
    // Use comparison's own stored data; overlay any matching saved-location emoji
    const enrich = (cl) => {
        const saved = _locations.find(l => l.lat === cl.lat && l.lon === cl.lon);
        return saved ? { ...cl, emoji: saved.emoji || cl.emoji } : cl;
    };
    return { loc1: enrich(comp.loc1), loc2: enrich(comp.loc2) };
}

function _currentCardIdx() {
    if (_showingComparisonIdx >= 0) {
        const comp = _comparisons[_showingComparisonIdx];
        if (comp) return _cardOrder.findIndex(c => c.type === "comp" && c.key === _comparisonKey(comp));
    } else if (_activeLocation) {
        const key = `${_activeLocation.lat},${_activeLocation.lon}`;
        return _cardOrder.findIndex(c => c.type === "loc" && c.key === key);
    }
    return -1;
}

function _navigateToCard(cardIdx) {
    const card = _cardOrder[cardIdx];
    if (!card) return;
    if (card.type === "loc") {
        const loc = _locations.find(l => `${l.lat},${l.lon}` === card.key);
        if (loc) _navigateToDetail(loc);
    } else if (card.type === "comp") {
        const ci = _comparisons.findIndex(c => _comparisonKey(c) === card.key);
        if (ci >= 0) _navigateToComparison(ci);
    }
}

async function _refreshCurrent() {
    try {
        const resp = await fetch("/api/refresh-current", { method: "POST" });
        const data = await resp.json();
        _allCurrent = data;
        if (!_activeLocation) _renderDashboard();
    } catch (e) {
        console.error("Failed to refresh current", e);
    }
}

async function _refreshAlerts() {
    for (const loc of _locations) {
        try {
            const resp = await fetch(`/api/alerts?lat=${loc.lat}&lon=${loc.lon}`);
            const alerts = await resp.json();
            const key = `${loc.lat},${loc.lon}`;
            _allAlerts[key] = Array.isArray(alerts) ? alerts : [];
        } catch (e) {
            console.error("Failed to fetch alerts", e);
        }
    }
    if (!_activeLocation) _renderDashboard();
}

async function _loadWeather(loc) {
    try {
        const resp = await fetch(`/api/weather?lat=${loc.lat}&lon=${loc.lon}`);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        console.error("Failed to load weather", e);
        return null;
    }
}

// ── Routing / Views ────────────────────────────────────────────
function _renderView() {
    if (_showingComparisonIdx >= 0) {
        _renderComparisonView(_showingComparisonIdx);
    } else if (_activeLocation) {
        _renderDetail();
    } else {
        _renderDashboard();
    }
}

function _navigateToDetail(loc) {
    _showingComparisonIdx = -1;
    _activeLocation = loc;
    _activeWeather = null;
    _renderView();
    _fetchAndRenderDetail(loc);
}

function _navigateToDashboard() {
    _cleanupRadar();
    _activeLocation = null;
    _activeWeather = null;
    _showingComparisonIdx = -1;
    document.getElementById("header-title").textContent = "BenWeather";
    document.getElementById("back-btn").classList.add("hidden");
    document.getElementById("add-btn").classList.remove("hidden");
    _renderView();
}

function _navigateToComparison(idx) {
    _cleanupRadar();
    _activeLocation = null;
    _activeWeather = null;
    _showingComparisonIdx = idx;
    _renderView();
}

// ── Dashboard ──────────────────────────────────────────────────
function _renderDashboard() {
    const container = document.getElementById("weather-container");
    document.getElementById("back-btn").classList.add("hidden");
    document.getElementById("add-btn").classList.remove("hidden");
    document.getElementById("header-title").textContent = "BenWeather";

    if (!_cardOrder.length) {
        container.innerHTML = `<div class="loading">No locations added. Tap + to add one.</div>`;
        return;
    }

    let html = "";
    for (const card of _cardOrder) {
        if (card.type === "loc") {
            const loc = _locations.find(l => `${l.lat},${l.lon}` === card.key);
            if (!loc) continue;
            const key = card.key;
            const cur = _allCurrent[key];
            if (cur) {
                const temp = Math.round(cur.temperature || 0);
                const hi = cur.today_high != null ? Math.round(cur.today_high) : "--";
                const lo = cur.today_low != null ? Math.round(cur.today_low) : "--";
                const alerts = _allAlerts[key] || [];
                const alertBadge = alerts.length ? `<div class="loc-card-alert ${_alertSeverityClass(alerts)}">${_esc(alerts[0].event)}${alerts.length > 1 ? ` +${alerts.length - 1}` : ""}</div>` : "";
                html += `
                <div class="location-card" data-lat="${loc.lat}" data-lon="${loc.lon}">
                    ${alertBadge}
                    <div class="loc-card-top">
                        <div>
                            <div class="loc-card-name">${_esc(_displayName(loc))}</div>
                            <div class="loc-card-region">${_esc(loc.region || "")}</div>
                            <div class="loc-card-desc">${_esc(cur.weather_desc || "")}</div>
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
                            <div class="loc-card-name">${_esc(_displayName(loc))}</div>
                            <div class="loc-card-region">${_esc(loc.region || "")}</div>
                        </div>
                        <div class="loading-spinner"></div>
                    </div>
                </div>`;
            }
        } else if (card.type === "comp") {
            const ci = _comparisons.findIndex(c => _comparisonKey(c) === card.key);
            if (ci < 0) continue;
            const locs = _getComparisonLocsForIdx(ci);
            if (!locs) continue;
            const n1 = _displayNameTrailing(locs.loc1);
            const n2 = _displayName(locs.loc2);
            html += `<div class="comparison-card" data-comp-idx="${ci}">
                <div class="comparison-card-inner">
                    <div class="comparison-card-text">
                        <div class="comparison-card-title">${_esc(n1)} vs ${_esc(n2)}</div>
                        <div class="comparison-card-sub" id="comp-card-sub-${ci}">Loading...</div>
                    </div>
                    <span class="comparison-card-arrow">&rsaquo;</span>
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;

    // Load all comparison summaries async
    _loadAllComparisonSummaries();

    // Bind card taps
    container.querySelectorAll(".comparison-card").forEach(card => {
        card.addEventListener("click", () => {
            const idx = parseInt(card.dataset.compIdx);
            _navigateToComparison(idx);
        });
    });
    container.querySelectorAll(".location-card").forEach(card => {
        card.addEventListener("click", () => {
            const lat = parseFloat(card.dataset.lat);
            const lon = parseFloat(card.dataset.lon);
            const loc = _locations.find(l => l.lat === lat && l.lon === lon);
            if (loc) _navigateToDetail(loc);
        });
    });
}

// ── Detail View ────────────────────────────────────────────────
async function _fetchAndRenderDetail(loc) {
    const data = await _loadWeather(loc);
    if (!data) {
        document.getElementById("weather-container").innerHTML =
            `<div class="loading">Unable to load weather data.</div>`;
        return;
    }
    _activeWeather = data;

    // Merge fresh current conditions from _allCurrent
    const key = `${loc.lat},${loc.lon}`;
    if (_allCurrent[key]) {
        _activeWeather.current = _allCurrent[key];
    }

    _renderDetail();
}

function _renderDetail() {
    const container = document.getElementById("weather-container");
    const loc = _activeLocation;
    if (!loc) return;

    document.getElementById("header-title").textContent = _displayName(loc);
    document.getElementById("back-btn").classList.remove("hidden");
    document.getElementById("add-btn").classList.add("hidden");

    if (!_activeWeather) {
        container.innerHTML = `<div class="loading"><div class="loading-spinner"></div><br>Loading...</div>`;
        return;
    }

    const w = _activeWeather;
    let html = "";

    // Weather alerts
    html += _renderAlerts(w);

    // Current conditions
    html += _renderCurrent(w);

    // 15-min precipitation
    html += _renderPrecipStrip(w);

    // Hourly
    html += _renderHourly(w);

    // Sun & Moon
    html += _renderSunMoon(w);

    // Weather Radar
    html += _renderRadar();

    // Daily
    html += _renderDaily(w);

    // Air quality
    html += _renderAQI(w);

    // History button
    html += `<button class="history-btn" id="history-btn">
        <span>60-Day History</span>
        <span class="history-btn-arrow">&rsaquo;</span>
    </button>`;

    _cleanupRadar();
    container.innerHTML = html;
    _initRadar(loc);

    // Scroll page to top, then scroll hourly strip to "now" horizontally
    window.scrollTo(0, 0);
    const nowEl = container.querySelector(".hourly-item.now");
    if (nowEl) {
        const scroll = nowEl.closest(".hourly-scroll");
        if (scroll) scroll.scrollLeft = nowEl.offsetLeft - scroll.offsetLeft;
    }

    // History button
    document.getElementById("history-btn")?.addEventListener("click", () => _openHistory(loc));
}

function _renderAlerts(w) {
    const alerts = w.alerts || [];
    if (!alerts.length) return "";

    let html = `<div class="section-title">Weather Alerts</div>`;
    for (const a of alerts) {
        const sev = (a.severity || "").toLowerCase();
        const sevClass = (sev === "extreme" || sev === "severe") ? "alert-severe"
            : sev === "moderate" ? "alert-moderate" : "alert-minor";
        const onset = a.onset ? new Date(a.onset).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
        const expires = a.expires ? new Date(a.expires).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
        html += `
        <div class="alert-card ${sevClass}">
            <div class="alert-header">
                <span class="alert-event">${_esc(a.event)}</span>
                <span class="alert-severity">${_esc(a.severity)}</span>
            </div>
            ${a.headline ? `<div class="alert-headline">${_esc(a.headline)}</div>` : ""}
            ${onset || expires ? `<div class="alert-times">${onset ? `From: ${onset}` : ""}${onset && expires ? " &mdash; " : ""}${expires ? `Until: ${expires}` : ""}</div>` : ""}
            ${a.description ? `<details class="alert-details"><summary>Details</summary><p>${_esc(a.description)}</p>${a.instruction ? `<p><strong>Instructions:</strong> ${_esc(a.instruction)}</p>` : ""}</details>` : ""}
        </div>`;
    }
    return html;
}

function _alertSeverityClass(alerts) {
    const severities = alerts.map(a => (a.severity || "").toLowerCase());
    if (severities.includes("extreme") || severities.includes("severe")) return "alert-badge-severe";
    if (severities.includes("moderate")) return "alert-badge-moderate";
    return "alert-badge-minor";
}

function _renderCurrent(w) {
    const c = w.current;
    if (!c) return "";

    const temp = Math.round(c.temperature || 0);
    const feels = Math.round(c.feels_like || 0);
    const icon = c.weather_icon || "";
    const desc = c.weather_desc || "";

    // Forecast text — show first 3 periods (e.g. "Tonight" + "Sunday" + "Sunday Night")
    let forecastHtml = "";
    if (w.forecast_text && w.forecast_text.length) {
        const count = Math.min(w.forecast_text.length, 3);
        for (let fi = 0; fi < count; fi++) {
            const p = w.forecast_text[fi];
            forecastHtml += `<div class="current-forecast-text"><strong>${_esc(p.name)}:</strong> ${_esc(p.detailed)}</div>`;
        }
    }

    // Visibility formatting
    let visStr = "--";
    if (c.visibility != null) {
        const visMi = c.visibility / 1609.34;
        visStr = visMi >= 10 ? "10+ mi" : visMi.toFixed(1) + " mi";
    }

    // Precipitation
    const precipVal = c.precipitation || 0;

    // Sunrise/sunset for current card
    let sunrise = "", sunset = "", daylight = "";
    if (w.daily && w.daily.length) {
        sunrise = _formatTime(w.daily[0].sunrise);
        sunset = _formatTime(w.daily[0].sunset);
        const riseMs = new Date(w.daily[0].sunrise).getTime();
        const setMs = new Date(w.daily[0].sunset).getTime();
        if (riseMs && setMs) {
            const diffMin = Math.round((setMs - riseMs) / 60000);
            daylight = `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
        }
    }

    const fetchedTime = _formatTime(c.fetched_at || w.fetched_at || "");

    return `
    <div class="current-card">
        ${fetchedTime ? `<div class="current-fetched-at">${fetchedTime}</div>` : ""}
        <div class="current-icon">${icon}</div>
        <div class="current-temp">${temp}°</div>
        <div class="current-desc">${_esc(desc)}</div>
        <div class="current-feels">Feels like ${feels}°</div>
        ${sunrise ? `<div class="sun-times"><span>Sunrise ${sunrise}</span>${daylight ? `<span class="sun-daylight">${daylight}</span>` : ""}<span>Sunset ${sunset}</span></div>` : ""}
        ${forecastHtml}
        <div class="current-details">
            <div class="current-detail-item">
                <div class="current-detail-label">Wind</div>
                <div class="current-detail-value">${Math.round(c.wind_speed || 0)} mph ${c.wind_direction || ""}</div>
            </div>
            <div class="current-detail-item">
                <div class="current-detail-label">Humidity</div>
                <div class="current-detail-value">${Math.round(c.humidity || 0)}%</div>
            </div>
            <div class="current-detail-item">
                <div class="current-detail-label">UV Index</div>
                <div class="current-detail-value">${c.uv_index != null ? Math.round(c.uv_index) : "--"}</div>
            </div>
            ${c.cloud_cover != null ? `<div class="current-detail-item">
                <div class="current-detail-label">Cloud Cover</div>
                <div class="current-detail-value">${Math.round(c.cloud_cover)}%</div>
            </div>` : ""}
            <div class="current-detail-item">
                <div class="current-detail-label">Visibility</div>
                <div class="current-detail-value">${visStr}</div>
            </div>
            <div class="current-detail-item">
                <div class="current-detail-label">Precip</div>
                <div class="current-detail-value">${precipVal > 0 ? precipVal + '"' : "None"}</div>
            </div>
        </div>
    </div>`;
}

function _precipSummary(slots) {
    const hasPrecip = slots.some(s => (s.precipitation || 0) > 0);
    if (!hasPrecip) return "No precipitation expected in the next 6 hours";

    // Determine type from totals
    const totalRain = slots.reduce((a, s) => a + (s.rain || 0), 0);
    const totalSnow = slots.reduce((a, s) => a + (s.snowfall || 0), 0);
    const type = totalSnow > totalRain ? "snow" : "rain";

    // Peak rate for intensity
    const peak = Math.max(...slots.map(s => s.precipitation || 0));
    const intensity = peak > 0.12 ? "Heavy" : peak > 0.04 ? "Moderate" : "Light";

    const firstPrecipIdx = slots.findIndex(s => (s.precipitation || 0) > 0);
    const lastPrecipIdx = slots.length - 1 - [...slots].reverse().findIndex(s => (s.precipitation || 0) > 0);
    const currentlyPrecip = firstPrecipIdx === 0;

    if (currentlyPrecip) {
        // Check if it stops within the window
        const firstDryAfterStart = slots.findIndex((s, i) => i > 0 && (s.precipitation || 0) === 0);
        if (firstDryAfterStart === -1 || lastPrecipIdx >= slots.length - 1) {
            return `${intensity} ${type} continuing for 6+ hours`;
        }
        const endMin = firstDryAfterStart * 15;
        return `${intensity} ${type}, ending in ~${endMin} min`;
    } else {
        const startMin = firstPrecipIdx * 15;
        return `${intensity} ${type} expected in ~${startMin} min`;
    }
}

function _renderPrecipStrip(w) {
    if (!w.minutely || !w.minutely.length) return "";

    // Find current 15-min slot and show next 6 hours (24 slots)
    const now = new Date();
    let startIdx = 0;
    for (let i = 0; i < w.minutely.length; i++) {
        if (new Date(w.minutely[i].time) > now) {
            startIdx = Math.max(0, i - 1);
            break;
        }
    }

    const slots = w.minutely.slice(startIdx, startIdx + 24);
    const maxPrecip = Math.max(...slots.map(s => s.precipitation || 0), 0.01);
    const hasPrecip = slots.some(s => (s.precipitation || 0) > 0);

    // Accumulation total (convert inches → mm)
    const totalIn = slots.reduce((a, s) => a + (s.precipitation || 0), 0);
    const totalRain = slots.reduce((a, s) => a + (s.rain || 0), 0);
    const totalSnow = slots.reduce((a, s) => a + (s.snowfall || 0), 0);
    const totalMm = totalIn * 25.4;
    const precipEmoji = totalSnow > totalRain ? "\u2744\uFE0F" : "\uD83C\uDF27\uFE0F";
    const totalStr = totalMm > 0
        ? precipEmoji + " " + (totalMm >= 10 ? (totalMm / 10).toFixed(1) + " cm" : totalMm.toFixed(1) + " mm")
        : "0 mm";

    // Summary text
    const summary = _precipSummary(slots);

    let inner = `<div class="precip-header"><span>Next 6 Hours</span><span class="precip-total">${totalStr} total</span></div>`;
    inner += `<div class="precip-summary">${summary}</div>`;

    if (!hasPrecip) {
        // No bars needed — summary already says no precip
    } else {
        inner += `<div class="precip-strip">`;
        for (const s of slots) {
            const amt = s.precipitation || 0;
            const pct = Math.max(4, (amt / maxPrecip) * 50);
            const t = _formatTime(s.time);

            // Determine bar type: snow, mixed, or rain
            const rain = s.rain || 0;
            const snow = s.snowfall || 0;
            let barClass = "precip-bar";
            if (snow > 0 && rain > 0) barClass += " mixed";
            else if (snow > rain) barClass += " snow";

            // Amount label (convert inches → mm)
            let amtLabel = "";
            if (amt > 0) {
                const mm = amt * 25.4;
                amtLabel = mm < 0.1 ? "Tr" : mm.toFixed(1);
            }

            inner += `<div class="precip-bar-wrap">
                ${amtLabel ? `<div class="precip-bar-amount">${amtLabel}</div>` : ""}
                <div class="${barClass}" style="height:${pct}px"></div>
                <div class="precip-bar-time">${t}</div>
            </div>`;
        }
        inner += `</div>`;
    }

    return `<div class="precip-strip-card">${inner}</div>`;
}

function _renderHourly(w) {
    if (!w.hourly || !w.hourly.length) return "";

    const now = new Date();
    // Find current hour index
    let startIdx = 0;
    for (let i = 0; i < w.hourly.length; i++) {
        if (new Date(w.hourly[i].time) >= now) {
            startIdx = Math.max(0, i - 1);
            break;
        }
    }

    // Show up to 48 hours
    const hours = w.hourly.slice(startIdx, startIdx + 48);
    let items = "";
    let prevDateStr = "";
    for (let i = 0; i < hours.length; i++) {
        const h = hours[i];
        const hDate = new Date(h.time);
        const dateStr = hDate.toDateString();
        const isNow = i === 0;

        // Insert day separator when date changes (skip for the first "Now" item)
        if (dateStr !== prevDateStr && !isNow) {
            const dayLabel = hDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            items += `<div class="hourly-day-sep"><span>${dayLabel}</span></div>`;
        }
        prevDateStr = dateStr;

        const time = isNow ? "Now" : _formatTime(h.time);
        const temp = Math.round(h.temperature || 0);
        const feels = Math.round(h.feels_like || 0);
        const precip = Math.round(h.precipitation_prob || 0);
        const showFeels = feels !== temp;
        items += `
        <div class="hourly-item${isNow ? " now" : ""}">
            <span class="hourly-time">${time}</span>
            <span class="hourly-icon">${h.weather_icon || ""}</span>
            <div class="hourly-precip-bar"><div class="hourly-precip-fill" style="height:${precip}%"></div></div>
            <span class="hourly-temp">${temp}°</span>
            ${showFeels ? `<span class="hourly-feels">${feels}°</span>` : ""}
            ${precip > 0 ? `<span class="hourly-precip">${precip}%</span>` : ""}
            ${h.wind_speed >= 5 ? `<span class="hourly-wind">${Math.round(h.wind_speed)} ${h.wind_direction || ""}</span>` : ""}
            ${h.cloud_cover != null && h.cloud_cover >= 50 ? `<span class="hourly-cloud">${Math.round(h.cloud_cover)}%☁</span>` : ""}
        </div>`;
    }

    return `
    <div class="section-title">Hourly Forecast</div>
    <div class="hourly-card"><div class="hourly-scroll">${items}</div></div>`;
}

function _renderSunMoon(w) {
    const sm = w.sun_moon || {};
    const sun = sm.sun || {};
    const moon = sm.moon || {};

    // Fallback to Open-Meteo sunrise/sunset if USNO not available
    let sunRise = sun.rise || "";
    let sunSet = sun.set || "";
    if (!sunRise && w.daily && w.daily.length) {
        sunRise = _formatTime(w.daily[0].sunrise);
        sunSet = _formatTime(w.daily[0].sunset);
    }

    // Compute daylight hours
    let daylight = "";
    if (sunRise && sunSet) {
        // Parse HH:MM format from USNO
        const toMin = (t) => {
            // Handle both "07:02" and "7:02AM" formats
            const parts = t.match(/(\d+):(\d+)/);
            if (!parts) return 0;
            let h = parseInt(parts[1]);
            let m = parseInt(parts[2]);
            // If from Open-Meteo _formatTime (has AM/PM), convert
            if (/PM/i.test(t) && h < 12) h += 12;
            if (/AM/i.test(t) && h === 12) h = 0;
            return h * 60 + m;
        };
        // For USNO times (24h format), use directly; for Open-Meteo ISO, use Date
        let diffMin;
        if (w.daily && w.daily.length && w.daily[0].sunrise) {
            const riseMs = new Date(w.daily[0].sunrise).getTime();
            const setMs = new Date(w.daily[0].sunset).getTime();
            diffMin = Math.round((setMs - riseMs) / 60000);
        } else {
            diffMin = toMin(sunSet) - toMin(sunRise);
        }
        if (diffMin > 0) {
            daylight = `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
        }
    }

    // Moon phase emoji
    const phaseEmoji = _moonPhaseEmoji(moon.phase);

    // Format USNO times (HH:MM 24h) to 12h
    const fmt12 = (t) => {
        if (!t) return "--";
        const parts = t.match(/(\d+):(\d+)/);
        if (!parts) return t;
        let h = parseInt(parts[1]);
        const m = parts[2];
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return m === "00" ? `${h}${ap}` : `${h}:${m}${ap}`;
    };

    const sunRiseFmt = sun.rise ? fmt12(sun.rise) : sunRise;
    const sunSetFmt = sun.set ? fmt12(sun.set) : sunSet;
    const moonRiseFmt = fmt12(moon.rise);
    const moonSetFmt = fmt12(moon.set);
    const dawn = sun.dawn ? fmt12(sun.dawn) : "";
    const dusk = sun.dusk ? fmt12(sun.dusk) : "";

    return `
    <div class="section-title">Sun & Moon</div>
    <div class="sun-moon-card">
        <div class="sun-moon-row">
            <div class="sun-moon-col">
                <div class="sun-moon-label">Sunrise</div>
                <div class="sun-moon-value">${sunRiseFmt}</div>
            </div>
            <div class="sun-moon-col sun-moon-center">
                <div class="sun-moon-daylight">${daylight}</div>
                <div class="sun-moon-sublabel">of daylight</div>
            </div>
            <div class="sun-moon-col">
                <div class="sun-moon-label">Sunset</div>
                <div class="sun-moon-value">${sunSetFmt}</div>
            </div>
        </div>
        ${dawn ? `<div class="sun-moon-twilight">Dawn ${dawn} &middot; Dusk ${dusk}</div>` : ""}
        <div class="sun-moon-divider"></div>
        <div class="sun-moon-row">
            <div class="sun-moon-col">
                <div class="sun-moon-label">Moonrise</div>
                <div class="sun-moon-value">${moonRiseFmt}</div>
            </div>
            <div class="sun-moon-col sun-moon-center">
                <div class="sun-moon-phase-icon">${phaseEmoji}</div>
                <div class="sun-moon-phase-name">${_esc(moon.phase || "")}</div>
                ${moon.illumination ? `<div class="sun-moon-illum">${_esc(moon.illumination)} illuminated</div>` : ""}
            </div>
            <div class="sun-moon-col">
                <div class="sun-moon-label">Moonset</div>
                <div class="sun-moon-value">${moonSetFmt}</div>
            </div>
        </div>
        ${moon.next_phase ? `<div class="sun-moon-next">Next: ${_esc(moon.next_phase)} on ${_formatDay(moon.next_phase_date)}</div>` : ""}
    </div>`;
}

function _moonPhaseEmoji(phase) {
    if (!phase) return "";
    const p = phase.toLowerCase();
    if (p === "new moon") return "\u{1F311}";
    if (p.includes("waxing crescent")) return "\u{1F312}";
    if (p.includes("first quarter")) return "\u{1F313}";
    if (p.includes("waxing gibbous")) return "\u{1F314}";
    if (p === "full moon") return "\u{1F315}";
    if (p.includes("waning gibbous")) return "\u{1F316}";
    if (p.includes("last quarter") || p.includes("third quarter")) return "\u{1F317}";
    if (p.includes("waning crescent")) return "\u{1F318}";
    return "\u{1F319}";
}

function _renderRadar() {
    return `
    <div class="section-title">Weather Radar</div>
    <div class="radar-card">
        <div id="radar-map"></div>
        <div class="radar-controls">
            <button class="radar-play-btn" id="radar-play">&#9654;</button>
            <span class="radar-time" id="radar-time">--</span>
            <input type="range" class="radar-slider" id="radar-slider" min="0" max="0" value="0">
        </div>
        <div class="radar-attr"><a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a></div>
    </div>`;
}

function _initRadar(loc) {
    const mapEl = document.getElementById("radar-map");
    if (!mapEl) return;

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const map = L.map("radar-map", { zoomControl: false }).setView([loc.lat, loc.lon], 7);

    if (isDark) {
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
        }).addTo(map);
    } else {
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        }).addTo(map);
    }

    _radarMap = map;

    fetch("https://api.rainviewer.com/public/weather-maps.json")
        .then(r => r.json())
        .then(data => {
            const host = data.host;
            const frames = (data.radar && data.radar.past) || [];
            if (!frames.length) return;

            const slider = document.getElementById("radar-slider");
            const timeLabel = document.getElementById("radar-time");
            const playBtn = document.getElementById("radar-play");
            if (!slider || !timeLabel || !playBtn) return;

            slider.max = frames.length - 1;
            slider.value = frames.length - 1;
            let currentIdx = frames.length - 1;
            let radarLayer = null;

            function showFrame(idx) {
                currentIdx = idx;
                const path = frames[idx].path;
                const url = `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`;
                if (radarLayer) map.removeLayer(radarLayer);
                radarLayer = L.tileLayer(url, { opacity: 0.6, maxNativeZoom: 7, maxZoom: 19 }).addTo(map);
                slider.value = idx;
                const ts = new Date(frames[idx].time * 1000);
                timeLabel.textContent = ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            }

            showFrame(currentIdx);

            let playing = false;
            playBtn.addEventListener("click", () => {
                if (playing) {
                    clearInterval(_radarInterval);
                    _radarInterval = null;
                    playing = false;
                    playBtn.innerHTML = "&#9654;";
                } else {
                    playing = true;
                    playBtn.innerHTML = "&#9646;&#9646;";
                    _radarInterval = setInterval(() => {
                        currentIdx = (currentIdx + 1) % frames.length;
                        showFrame(currentIdx);
                    }, 500);
                }
            });

            slider.addEventListener("input", () => {
                showFrame(parseInt(slider.value));
            });
        })
        .catch(err => console.error("Radar fetch failed", err));
}

function _cleanupRadar() {
    if (_radarInterval) { clearInterval(_radarInterval); _radarInterval = null; }
    if (_radarMap) { _radarMap.remove(); _radarMap = null; }
}

function _renderDaily(w) {
    if (!w.daily || !w.daily.length) return "";

    // Determine min/max across all days for temp bar scaling
    let globalMin = Infinity, globalMax = -Infinity;
    for (const d of w.daily) {
        if (d.temp_min < globalMin) globalMin = d.temp_min;
        if (d.temp_max > globalMax) globalMax = d.temp_max;
    }
    const range = globalMax - globalMin || 1;

    let rows = "";
    for (let i = 0; i < w.daily.length; i++) {
        const d = w.daily[i];
        const dayName = i === 0 ? "Today" : i === 1 ? "Tmrw" : _formatDay(d.date);
        const lo = Math.round(d.temp_min);
        const hi = Math.round(d.temp_max);
        const precip = Math.round(d.precipitation_prob_max || 0);

        // Bar position
        const left = ((d.temp_min - globalMin) / range) * 100;
        const width = ((d.temp_max - d.temp_min) / range) * 100;

        rows += `
        <div class="daily-row">
            <div class="daily-day">${dayName}</div>
            <div class="daily-icon">${d.weather_icon || ""}</div>
            <div class="daily-temps">
                <span class="daily-low">${lo}°</span>
                <div class="daily-bar-track">
                    <div class="daily-bar-fill" style="left:${left}%;width:${Math.max(width, 4)}%"></div>
                </div>
                <span class="daily-high">${hi}°</span>
            </div>
            <div class="daily-extra">
                ${precip > 0 ? `<span class="daily-precip">${precip}%</span>` : ""}
                <span class="daily-wind">${Math.round(d.wind_speed_max || 0)} mph</span>
            </div>
        </div>`;
    }

    return `
    <div class="section-title">14-Day Forecast</div>
    <div class="daily-list">${rows}</div>`;
}

function _renderAQI(w) {
    if (!w.air_quality || !w.air_quality.length) return "";

    // Find current hour's AQI
    const now = new Date();
    let aqi = null;
    for (const a of w.air_quality) {
        if (new Date(a.time) <= now) aqi = a;
        else break;
    }
    if (!aqi || aqi.us_aqi == null) return "";

    const pollutants = [
        { name: "PM2.5", value: aqi.pm2_5, unit: "ug/m3" },
        { name: "PM10", value: aqi.pm10, unit: "ug/m3" },
        { name: "O3", value: aqi.ozone, unit: "ug/m3" },
        { name: "NO2", value: aqi.no2, unit: "ug/m3" },
        { name: "SO2", value: aqi.so2, unit: "ug/m3" },
        { name: "CO", value: aqi.co, unit: "ug/m3" },
    ];

    let pollutantHtml = "";
    for (const p of pollutants) {
        if (p.value != null) {
            pollutantHtml += `
            <div class="aqi-pollutant">
                <span class="aqi-pollutant-name">${p.name}</span>
                <span class="aqi-pollutant-value">${Math.round(p.value)} ${p.unit}</span>
            </div>`;
        }
    }

    return `
    <div class="section-title">Air Quality</div>
    <div class="aqi-card">
        <div class="aqi-header">
            <div class="aqi-ring" style="background:${aqi.aqi_color}">
                <span class="aqi-ring-value">${aqi.us_aqi}</span>
            </div>
            <div>
                <div class="aqi-label">${_esc(aqi.aqi_label)}</div>
                <div class="aqi-sublabel">US AQI</div>
            </div>
        </div>
        <div class="aqi-pollutants">${pollutantHtml}</div>
    </div>`;
}

// ── History ────────────────────────────────────────────────────
async function _openHistory(loc) {
    const overlay = document.getElementById("history-overlay");
    const content = document.getElementById("history-content");
    const title = document.getElementById("history-title");

    title.textContent = `${_displayName(loc)} — 60-Day History`;
    content.innerHTML = `<div class="loading"><div class="loading-spinner"></div></div>`;
    overlay.classList.remove("hidden");

    try {
        const resp = await fetch(`/api/history?lat=${loc.lat}&lon=${loc.lon}`);
        const data = await resp.json();
        if (!data || !data.length) {
            content.innerHTML = `<div class="loading">No history available yet.</div>`;
            return;
        }
        _renderHistory(data, content);
    } catch (e) {
        content.innerHTML = `<div class="loading">Failed to load history.</div>`;
    }
}

function _renderHistory(data, container) {
    // Calculate stats
    const highs = data.map(d => d.high).filter(v => v != null);
    const lows = data.map(d => d.low).filter(v => v != null);
    const precips = data.map(d => d.precip).filter(v => v != null);
    const avgHigh = highs.length ? (highs.reduce((a, b) => a + b, 0) / highs.length).toFixed(1) : "--";
    const avgLow = lows.length ? (lows.reduce((a, b) => a + b, 0) / lows.length).toFixed(1) : "--";
    const totalPrecip = precips.reduce((a, b) => a + b, 0).toFixed(2);
    const rainyDays = precips.filter(p => p > 0.01).length;

    // Canvas chart
    const chartWidth = Math.max(data.length * 8, 300);
    const chartHeight = 120;
    const precipHeight = 30;

    let html = `
    <div class="history-chart">
        <canvas id="history-canvas" width="${chartWidth}" height="${chartHeight + precipHeight + 30}"></canvas>
    </div>
    <div class="history-stats">
        <div class="history-stat"><div class="history-stat-value">${avgHigh}°</div><div class="history-stat-label">Avg High</div></div>
        <div class="history-stat"><div class="history-stat-value">${avgLow}°</div><div class="history-stat-label">Avg Low</div></div>
        <div class="history-stat"><div class="history-stat-value">${totalPrecip}"</div><div class="history-stat-label">Total Precip</div></div>
        <div class="history-stat"><div class="history-stat-value">${rainyDays}</div><div class="history-stat-label">Rainy Days</div></div>
    </div>`;

    container.innerHTML = html;

    // Draw chart on next frame
    requestAnimationFrame(() => {
        _drawHistoryChart(data, chartWidth, chartHeight, precipHeight);
        const canvas = document.getElementById("history-canvas");
        if (canvas) {
            canvas.addEventListener("click", _handleHistoryTap);
            canvas.addEventListener("touchend", _handleHistoryTap);
        }
    });
}

function _drawHistoryChart(data, chartWidth, chartHeight, precipHeight) {
    const canvas = document.getElementById("history-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    // Colors
    const highColor = "#ff7043";
    const lowColor = "#42a5f5";
    const precipColor = "rgba(33,150,243,0.5)";
    const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
    const textColor = isDark ? "#999" : "#666";

    const allTemps = data.flatMap(d => [d.high, d.low]).filter(v => v != null);
    const minTemp = Math.min(...allTemps) - 5;
    const maxTemp = Math.max(...allTemps) + 5;
    const tempRange = maxTemp - minTemp || 1;
    const maxPrecip = Math.max(...data.map(d => d.precip || 0), 0.1);

    const pad = { top: 10, bottom: 4, left: 0, right: 0 };
    const plotW = chartWidth - pad.left - pad.right;
    const plotH = chartHeight - pad.top - pad.bottom;

    const dx = plotW / Math.max(data.length - 1, 1);

    function tempY(v) {
        return pad.top + plotH - ((v - minTemp) / tempRange) * plotH;
    }

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(chartWidth - pad.right, y);
        ctx.stroke();
    }

    // High line
    ctx.strokeStyle = highColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
        if (data[i].high == null) continue;
        const x = pad.left + i * dx;
        const y = tempY(data[i].high);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Low line
    ctx.strokeStyle = lowColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    started = false;
    for (let i = 0; i < data.length; i++) {
        if (data[i].low == null) continue;
        const x = pad.left + i * dx;
        const y = tempY(data[i].low);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Precip bars at bottom
    const precipTop = chartHeight + 10;
    for (let i = 0; i < data.length; i++) {
        const p = data[i].precip || 0;
        if (p <= 0) continue;
        const barH = (p / maxPrecip) * precipHeight;
        const x = pad.left + i * dx - 2;
        ctx.fillStyle = precipColor;
        ctx.fillRect(x, precipTop + precipHeight - barH, 4, barH);
    }

    // Month boundaries — vertical lines + labels
    ctx.font = "11px sans-serif";
    ctx.fillStyle = textColor;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let prevMonth = -1;
    for (let i = 0; i < data.length; i++) {
        const d = new Date(data[i].date + "T12:00:00");
        const mo = d.getMonth();
        if (mo !== prevMonth) {
            const x = pad.left + i * dx;
            // Vertical separator at month boundary (skip first day)
            if (prevMonth !== -1) {
                ctx.strokeStyle = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)";
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(x, pad.top);
                ctx.lineTo(x, precipTop + precipHeight);
                ctx.stroke();
            }
            // Month label below precip bars
            ctx.fillStyle = textColor;
            ctx.textAlign = i === 0 ? "left" : "center";
            ctx.fillText(monthNames[mo], x, precipTop + precipHeight + 12);
            prevMonth = mo;
        }
    }

    // Temp scale labels on right edge
    ctx.fillStyle = textColor;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
        const temp = Math.round(maxTemp - (tempRange / 4) * i);
        const y = pad.top + (plotH / 4) * i;
        ctx.fillText(temp + "°", chartWidth - pad.right - 2, y - 3);
    }

    // Save geometry for tap-to-inspect
    _historyChartMeta = { data, dx, pad, minTemp, maxTemp, tempRange, plotH, chartWidth, chartHeight, precipHeight, highColor, lowColor };
}

// ── History Tap-to-Inspect ─────────────────────────────────────
function _handleHistoryTap(e) {
    e.preventDefault();
    if (!_historyChartMeta) return;
    const canvas = document.getElementById("history-canvas");
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    let clientX, clientY;
    if (e.changedTouches) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    const canvasX = (clientX - rect.left) * scaleX;

    const m = _historyChartMeta;
    const idx = Math.round((canvasX - m.pad.left) / m.dx);
    if (idx < 0 || idx >= m.data.length) return;

    const record = m.data[idx];

    // Redraw chart with highlight
    _drawHistoryChart(m.data, m.chartWidth, m.chartHeight, m.precipHeight);
    _drawHistoryHighlight(idx);

    // Show tooltip
    _showHistoryTooltip(record, clientX, clientY);
}

function _drawHistoryHighlight(idx) {
    const canvas = document.getElementById("history-canvas");
    if (!canvas || !_historyChartMeta) return;
    const ctx = canvas.getContext("2d");
    const m = _historyChartMeta;
    const x = m.pad.left + idx * m.dx;

    function tempY(v) {
        return m.pad.top + m.plotH - ((v - m.minTemp) / m.tempRange) * m.plotH;
    }
    const m_pad_top = m.pad.top || 10;

    // Vertical line
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, m_pad_top);
    ctx.lineTo(x, m.chartHeight + m.precipHeight + 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dots for high/low
    const record = m.data[idx];
    if (record.high != null) {
        ctx.fillStyle = m.highColor;
        ctx.beginPath();
        ctx.arc(x, tempY(record.high), 4, 0, Math.PI * 2);
        ctx.fill();
    }
    if (record.low != null) {
        ctx.fillStyle = m.lowColor;
        ctx.beginPath();
        ctx.arc(x, tempY(record.low), 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function _showHistoryTooltip(record, clientX, clientY) {
    let tooltip = document.getElementById("history-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "history-tooltip";
        tooltip.className = "history-tooltip";
        document.body.appendChild(tooltip);
    }

    const dateStr = new Date(record.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const hi = record.high != null ? Math.round(record.high) + "°" : "--";
    const lo = record.low != null ? Math.round(record.low) + "°" : "--";
    const precip = record.precip != null ? record.precip.toFixed(2) + '"' : "--";

    tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px">${dateStr}</div>
        <div>High: <span style="color:#ff7043">${hi}</span></div>
        <div>Low: <span style="color:#42a5f5">${lo}</span></div>
        <div>Precip: ${precip}</div>
    `;

    // Position tooltip near tap point
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = clientX + 12;
    let top = clientY - 60;
    if (left + 140 > vw) left = clientX - 152;
    if (top < 10) top = clientY + 12;
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";

    tooltip.classList.add("visible");

    // Auto-hide after 3 seconds
    clearTimeout(tooltip._hideTimer);
    tooltip._hideTimer = setTimeout(() => {
        tooltip.classList.remove("visible");
    }, 3000);
}

// ── Comparison ─────────────────────────────────────────────────
async function _loadAllComparisonSummaries() {
    for (let ci = 0; ci < _comparisons.length; ci++) {
        _loadComparisonSummaryForIdx(ci);
    }
}

async function _loadComparisonSummaryForIdx(ci) {
    const locs = _getComparisonLocsForIdx(ci);
    if (!locs) return;
    const sub = document.getElementById(`comp-card-sub-${ci}`);
    const comp = _comparisons[ci];
    const cacheKey = _comparisonKey(comp);
    try {
        const resp = await fetch(`/api/comparison?lat1=${locs.loc1.lat}&lon1=${locs.loc1.lon}&lat2=${locs.loc2.lat}&lon2=${locs.loc2.lon}`);
        if (!resp.ok) { if (sub) sub.textContent = "Unable to load"; return; }
        const data = await resp.json();
        _comparisonDataMap.set(cacheKey, data);
        if (sub) {
            const name1 = _displayName(locs.loc1);
            const name2 = _displayName(locs.loc2);
            // Calculate current streak from most recent months
            const monthsDesc = [...data.months].reverse();
            let streakWinner = null;
            let streakCount = 0;
            for (const m of monthsDesc) {
                if (!streakWinner && m.winner !== "tie") {
                    streakWinner = m.winner;
                    streakCount = 1;
                } else if (streakWinner && m.winner === streakWinner) {
                    streakCount++;
                } else {
                    break;
                }
            }
            const streakName = streakWinner === "loc1" ? name1 : streakWinner === "loc2" ? name2 : null;
            if (streakName && streakCount > 1) {
                sub.innerHTML = `${_esc(streakName)} ${streakCount} month streak`;
            } else if (streakName) {
                sub.innerHTML = `${_esc(streakName)} won last month`;
            } else {
                sub.innerHTML = "Tied last month";
            }
        }
    } catch (e) {
        console.error("Failed to load comparison", e);
        if (sub) sub.textContent = "Unable to load";
    }
}

async function _renderComparisonView(idx) {
    const container = document.getElementById("weather-container");
    document.getElementById("back-btn").classList.remove("hidden");
    document.getElementById("add-btn").classList.add("hidden");

    const locs = _getComparisonLocsForIdx(idx);
    if (!locs) { container.innerHTML = `<div class="loading">Need at least 2 locations.</div>`; return; }
    const e1 = locs.loc1.emoji || "";
    const e2 = locs.loc2.emoji || "";
    document.getElementById("header-title").textContent = `${e1} vs ${e2}`;

    const comp = _comparisons[idx];
    const cacheKey = _comparisonKey(comp);
    const cached = _comparisonDataMap.get(cacheKey);

    if (cached) {
        _renderComparisonContent(container, cached, locs);
        return;
    }

    container.innerHTML = `<div class="loading"><div class="loading-spinner"></div><br>Loading comparison...</div>`;
    try {
        const resp = await fetch(`/api/comparison?lat1=${locs.loc1.lat}&lon1=${locs.loc1.lon}&lat2=${locs.loc2.lat}&lon2=${locs.loc2.lon}`);
        if (!resp.ok) { container.innerHTML = `<div class="loading">Failed to load comparison.</div>`; return; }
        const data = await resp.json();
        _comparisonDataMap.set(cacheKey, data);
        if (_showingComparisonIdx === idx) _renderComparisonContent(container, data, locs);
    } catch (e) {
        console.error("Comparison fetch failed", e);
        container.innerHTML = `<div class="loading">Failed to load comparison.</div>`;
    }
}

function _renderComparisonContent(container, data, locs) {
    _renderComparison(data, container, locs);
    window.scrollTo(0, 0);
}

function _renderComparison(data, container, locs) {
    const name1 = _displayName(locs.loc1);
    const name2 = _displayName(locs.loc2);

    // Overall summary
    const winnerName = data.overall_winner === "loc1" ? name1 : data.overall_winner === "loc2" ? name2 : null;
    const totalMonths = data.months.length;
    const ties = totalMonths - data.loc1_wins - data.loc2_wins;
    const wlt = (w, l, t) => t ? `${w}-${l}-${t}` : `${w}-${l}`;
    let summaryText;
    if (winnerName) {
        const record = data.overall_winner === "loc1" ? wlt(data.loc1_wins, data.loc2_wins, ties) : wlt(data.loc2_wins, data.loc1_wins, ties);
        summaryText = `${_esc(winnerName)} ${record}`;
    } else {
        summaryText = `Tied ${wlt(data.loc1_wins, data.loc2_wins, ties)}`;
    }

    let html = "";
    html += `<div class="comparison-overall">
        <div class="comparison-overall-title">${summaryText}</div>
        <div class="comparison-overall-sub">${_esc(name1)} vs ${_esc(name2)} &middot; ${data.window_start.slice(0, 4)} to ${data.window_end.slice(0, 4)}</div>
    </div>`;

    // Net score chart by calendar year
    html += _renderCompChart(data, name1, name2);

    // Month-by-month rows (most recent first), grouped by consecutive sweeps
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthsDesc = [...data.months].reverse();
    const fmtMonth = (m) => { const [y, mo] = m.month.split("-"); return `${monthNames[parseInt(mo) - 1]} ${y}`; };
    const isSweep = (m) => m.winner !== "tie" && (m.loc1_score === 0 || m.loc2_score === 0);

    // Build groups: consecutive sweeps by same location get merged
    const groups = [];
    let run = null;
    for (const m of monthsDesc) {
        if (isSweep(m) && run && run.sweeper === m.winner) {
            run.months.push(m);
        } else {
            if (run) groups.push(run);
            if (isSweep(m)) {
                run = { type: "sweep", sweeper: m.winner, months: [m] };
            } else {
                run = null;
                groups.push({ type: "single", months: [m] });
            }
        }
    }
    if (run) groups.push(run);

    // Render single-month card
    const renderMonthCard = (m) => {
        const monthLabel = fmtMonth(m);
        const winnerLabel = m.winner === "loc1" ? name1 : m.winner === "loc2" ? name2 : "Tie";
        const winnerClass = m.winner !== "tie" ? `winner-${m.winner}` : "";
        let sunsetNote = "";
        if (m.sunset_diff != null && m.sunset_diff !== 0) {
            const absDiff = Math.abs(m.sunset_diff);
            const laterName = m.sunset_diff > 0 ? name1 : name2;
            sunsetNote = `<div class="comparison-month-sunset">${_esc(laterName)} sunsets avg ${absDiff} min later</div>`;
        }
        return `<div class="comparison-month-card ${winnerClass}">
            <div class="comparison-month-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span class="comparison-month-label">${monthLabel}</span>
                <span class="comparison-month-winner">${_esc(winnerLabel)} ${m.winner === "loc2" ? wlt(m.loc2_score, m.loc1_score, m.metric_ties) : wlt(m.loc1_score, m.loc2_score, m.metric_ties)}</span>
                <span class="comp-chevron">&#9656;</span>
            </div>
            <div class="comparison-month-body">
                ${sunsetNote}
                <table class="comp-table">
                    <thead><tr>
                        <th class="${m.winner === "loc1" ? "col-winner" : ""}">${_esc(name1)}</th>
                        <th></th>
                        <th class="${m.winner === "loc2" ? "col-winner" : ""}">${_esc(name2)}</th>
                    </tr></thead>
                    <tbody>${_renderCompRows(m.loc1, m.loc2)}</tbody>
                </table>
            </div>
        </div>`;
    };

    for (const g of groups) {
        if (g.type === "single" || g.months.length === 1) {
            // Single month (or lone sweep) — render normally
            html += renderMonthCard(g.months[0]);
        } else {
            // Consecutive sweep group
            const sweepName = g.sweeper === "loc1" ? name1 : name2;
            const earliest = g.months[g.months.length - 1];
            const latest = g.months[0];
            const [yE, moE] = earliest.month.split("-");
            const [yL, moL] = latest.month.split("-");
            const rangeLabel = yE === yL
                ? `${monthNames[parseInt(moE) - 1]} – ${monthNames[parseInt(moL) - 1]} ${yL}`
                : `${fmtMonth(earliest)} – ${fmtMonth(latest)}`;
            html += `<div class="comparison-sweep-group">
                <div class="comparison-sweep-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span class="comparison-month-label">${rangeLabel}</span>
                    <span class="comparison-month-winner">${_esc(sweepName)} sweeps ${g.months.length} months</span>
                    <span class="comp-chevron">&#9656;</span>
                </div>
                <div class="comparison-sweep-body">
                    ${g.months.map(m => renderMonthCard(m)).join("")}
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;
}

function _renderCompRows(m1, m2) {
    // higher is better: sunshine, daylight, overcast, sunset
    // lower is better: rainy, snow, freezing, hot
    const W = "\u2705";  // green check
    const row = (disp1, label, disp2, higherWins, n1, n2) => {
        let mark1 = "", mark2 = "";
        if (n1 !== n2) {
            if (higherWins) { if (n1 > n2) mark1 = W + " "; else mark2 = " " + W; }
            else { if (n1 < n2) mark1 = W + " "; else mark2 = " " + W; }
        }
        return `<tr><td>${disp1}</td><td class="comp-label">${mark1}${label}${mark2}</td><td>${disp2}</td></tr>`;
    };
    let html = "";
    html += row(m1.sunshine_hours + "h", "Sunshine", m2.sunshine_hours + "h", true, m1.sunshine_hours, m2.sunshine_hours);
    if (m1.avg_daylight_hours != null && m2.avg_daylight_hours != null) {
        html += row(m1.avg_daylight_hours + "h", "Daylight", m2.avg_daylight_hours + "h", true, m1.avg_daylight_hours, m2.avg_daylight_hours);
    }
    if (m1.avg_sunset_min != null && m2.avg_sunset_min != null) {
        // Require 10+ min difference to award a winner
        const sDiff = Math.abs(m1.avg_sunset_min - m2.avg_sunset_min);
        const sN1 = sDiff >= 10 ? m1.avg_sunset_min : 0;
        const sN2 = sDiff >= 10 ? m2.avg_sunset_min : 0;
        html += row(_minutesToTime(m1.avg_sunset_min), "Avg sunset", _minutesToTime(m2.avg_sunset_min), true, sN1, sN2);
    }
    html += row(m1.rainy_days, "Rainy days", m2.rainy_days, false, m1.rainy_days, m2.rainy_days);
    html += row(m1.overcast_days, "Overcast days", m2.overcast_days, true, m1.overcast_days, m2.overcast_days);
    if (m1.snow_days > 0 || m2.snow_days > 0) {
        html += row(m1.snow_days, "Snow days", m2.snow_days, false, m1.snow_days, m2.snow_days);
    }
    if (m1.freezing_days > 0 || m2.freezing_days > 0) {
        html += row(m1.freezing_days, "Freezing days", m2.freezing_days, false, m1.freezing_days, m2.freezing_days);
    }
    if (m1.hot_days > 0 || m2.hot_days > 0) {
        html += row(m1.hot_days, "Hot days (90+)", m2.hot_days, false, m1.hot_days, m2.hot_days);
    }
    if (m1.sticky_days > 0 || m2.sticky_days > 0) {
        html += row(m1.sticky_days, "Sticky days (100+)", m2.sticky_days, false, m1.sticky_days, m2.sticky_days);
    }
    const fmtHL = (m) => `${m.avg_high != null ? Math.round(m.avg_high) + "°" : "--"} / ${m.avg_low != null ? Math.round(m.avg_low) + "°" : "--"}`;
    html += `<tr><td>${fmtHL(m1)}</td><td class="comp-label">Avg H / L</td><td>${fmtHL(m2)}</td></tr>`;
    return html;
}

function _renderCompChart(data, name1, name2) {
    // Group net scores by calendar year
    const yearData = {};
    for (const m of data.months) {
        const [year, mo] = m.month.split("-");
        const monthIdx = parseInt(mo) - 1;
        const net = m.loc1_score - m.loc2_score;
        if (!yearData[year]) yearData[year] = new Array(12).fill(null);
        yearData[year][monthIdx] = net;
    }
    const years = Object.keys(yearData).sort();
    const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#c8d6e5"];

    // Chart geometry
    const W = 600, H = 250;
    const pad = { l: 32, r: 10, t: 20, b: 30 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    // Symmetric y range
    let yAbs = 1;
    for (const yr of years) {
        for (const v of yearData[yr]) {
            if (v !== null) yAbs = Math.max(yAbs, Math.abs(v));
        }
    }
    yAbs += 1;

    const toX = (i) => pad.l + (i / 11) * plotW;
    const toY = (v) => pad.t + plotH * (1 - (v + yAbs) / (2 * yAbs));

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="comp-chart">`;

    // Zero line
    svg += `<line x1="${pad.l}" y1="${toY(0)}" x2="${W - pad.r}" y2="${toY(0)}" stroke="#555" stroke-width="1"/>`;

    // Grid lines at even values
    for (let v = -yAbs + 1; v < yAbs; v++) {
        if (v === 0) continue;
        const y = toY(v);
        if (Math.abs(v) % 2 === 0) {
            svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#333" stroke-width="0.5" stroke-dasharray="3,3"/>`;
            svg += `<text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" fill="#666" font-size="10">${v > 0 ? "+" : ""}${v}</text>`;
        }
    }
    svg += `<text x="${pad.l - 4}" y="${toY(0) + 4}" text-anchor="end" fill="#888" font-size="10">0</text>`;

    // Month labels
    const ml = ["J","F","M","A","M","J","J","A","S","O","N","D"];
    for (let i = 0; i < 12; i++) {
        svg += `<text x="${toX(i)}" y="${H - pad.b + 16}" text-anchor="middle" fill="#888" font-size="11">${ml[i]}</text>`;
    }

    // Name indicators
    const n1Short = name1.length > 12 ? name1.slice(0, 11) + "\u2026" : name1;
    const n2Short = name2.length > 12 ? name2.slice(0, 11) + "\u2026" : name2;
    svg += `<text x="${W - pad.r}" y="${pad.t + 10}" text-anchor="end" fill="#888" font-size="10">\u25B2 ${n1Short}</text>`;
    svg += `<text x="${W - pad.r}" y="${H - pad.b - 4}" text-anchor="end" fill="#888" font-size="10">\u25BC ${n2Short}</text>`;

    // Year lines
    for (let yi = 0; yi < years.length; yi++) {
        const yr = years[yi];
        const color = colors[yi % colors.length];
        const pts = [];
        for (let i = 0; i < 12; i++) {
            if (yearData[yr][i] !== null) pts.push({ x: toX(i), y: toY(yearData[yr][i]) });
        }
        if (pts.length > 1) {
            svg += `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
        }
        for (const p of pts) {
            svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color}"/>`;
        }
    }

    svg += "</svg>";

    // Legend
    let legend = '<div class="comp-chart-legend">';
    for (let yi = 0; yi < years.length; yi++) {
        legend += `<span class="comp-chart-legend-item"><span class="comp-chart-swatch" style="background:${colors[yi % colors.length]}"></span>${years[yi]}</span>`;
    }
    legend += "</div>";

    return `<div class="comparison-chart-card">${svg}${legend}</div>`;
}

function _minutesToTime(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return m === 0 ? `${h}${ap}` : `${h}:${m.toString().padStart(2, "0")}${ap}`;
}

// ── Action Picker (+ button) ──────────────────────────────────
function _openActionPicker() {
    let el = document.getElementById("add-action-overlay");
    if (!el) {
        // Inject action picker if missing (stale cache)
        el = document.createElement("div");
        el.id = "add-action-overlay";
        el.className = "overlay hidden";
        el.innerHTML = `<div class="overlay-content">
            <div class="overlay-header"><h2>Add</h2><button class="close-btn" id="add-action-close-injected">&times;</button></div>
            <button class="add-action-btn" id="add-action-location-injected">Add Location</button>
            <button class="add-action-btn" id="add-action-comparison-injected">Add Comparison</button>
        </div>`;
        document.body.appendChild(el);
        el.querySelector("#add-action-close-injected").addEventListener("click", _closeActionPicker);
        el.querySelector("#add-action-location-injected").addEventListener("click", () => { _closeActionPicker(); _openSearch(); });
        el.querySelector("#add-action-comparison-injected").addEventListener("click", () => { _closeActionPicker(); _openAddComparison(); });
        el.addEventListener("click", (e) => { if (e.target.classList.contains("overlay")) e.target.classList.add("hidden"); });
    }
    el.classList.remove("hidden");
}

function _closeActionPicker() {
    document.getElementById("add-action-overlay")?.classList.add("hidden");
}

// ── Add Comparison Flow ────────────────────────────────────────
let _addCompLoc1 = null;  // selected loc object for slot 1
let _addCompLoc2 = null;  // selected loc object for slot 2
let _addCompSearchTimeout1 = null;
let _addCompSearchTimeout2 = null;

function _openAddComparison() {
    _addCompLoc1 = null;
    _addCompLoc2 = null;
    _populateCompSlot(1);
    _populateCompSlot(2);
    document.getElementById("add-comp-search-1").classList.add("hidden");
    document.getElementById("add-comp-search-2").classList.add("hidden");
    document.getElementById("add-comparison-overlay").classList.remove("hidden");
}

function _closeAddComparison() {
    document.getElementById("add-comparison-overlay").classList.add("hidden");
}

function _populateCompSlot(slot) {
    const sel = document.getElementById(`add-comp-sel-${slot}`);
    let html = '<option value="" disabled selected>Select location</option>';
    _locations.forEach((l, i) => {
        html += `<option value="saved-${i}">${_esc(_displayName(l))}</option>`;
    });
    html += '<option value="search">Search for new...</option>';
    sel.innerHTML = html;
}

function _onCompSelectChange(slot) {
    const sel = document.getElementById(`add-comp-sel-${slot}`);
    const val = sel.value;
    const searchDiv = document.getElementById(`add-comp-search-${slot}`);
    if (val === "search") {
        searchDiv.classList.remove("hidden");
        const input = document.getElementById(`add-comp-search-input-${slot}`);
        input.value = "";
        document.getElementById(`add-comp-search-results-${slot}`).innerHTML = "";
        setTimeout(() => input.focus(), 50);
        if (slot === 1) _addCompLoc1 = null;
        else _addCompLoc2 = null;
    } else if (val.startsWith("saved-")) {
        searchDiv.classList.add("hidden");
        const idx = parseInt(val.replace("saved-", ""));
        if (slot === 1) _addCompLoc1 = { ..._locations[idx] };
        else _addCompLoc2 = { ..._locations[idx] };
    }
}

function _onCompSearchInput(slot, query) {
    const timeoutVar = slot === 1 ? "_addCompSearchTimeout1" : "_addCompSearchTimeout2";
    clearTimeout(window[timeoutVar]);
    if (!query || query.length < 2) {
        document.getElementById(`add-comp-search-results-${slot}`).innerHTML = "";
        return;
    }
    window[timeoutVar] = setTimeout(async () => {
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
                    <div class="search-result-name">${_esc(r.name)}</div>
                    <div class="search-result-region">${_esc([r.region, r.country].filter(Boolean).join(", "))}</div>
                </div>
            `).join("");
            container.querySelectorAll(".search-result-item").forEach(el => {
                el.addEventListener("click", () => {
                    const loc = JSON.parse(el.dataset.loc);
                    _onCompSearchPick(slot, loc);
                });
            });
        } catch (e) {
            console.error("Comp search failed", e);
        }
    }, 300);
}

function _onCompSearchPick(slot, loc) {
    if (slot === 1) _addCompLoc1 = loc;
    else _addCompLoc2 = loc;
    // Add the picked location as an option in the select and select it
    const sel = document.getElementById(`add-comp-sel-${slot}`);
    // Remove any previous "new-" options
    Array.from(sel.options).forEach(o => { if (o.value.startsWith("new-")) o.remove(); });
    const opt = document.createElement("option");
    opt.value = `new-${loc.lat}-${loc.lon}`;
    opt.textContent = `${loc.name}${loc.region ? ", " + loc.region : ""}`;
    sel.insertBefore(opt, sel.querySelector('[value="search"]'));
    sel.value = opt.value;
    document.getElementById(`add-comp-search-${slot}`).classList.add("hidden");
}

async function _saveNewComparison() {
    if (!_addCompLoc1 || !_addCompLoc2) return;
    if (_addCompLoc1.lat === _addCompLoc2.lat && _addCompLoc1.lon === _addCompLoc2.lon) return;
    const newComp = { loc1: { ..._addCompLoc1 }, loc2: { ..._addCompLoc2 } };
    // Check for duplicate
    const newKey = _comparisonKey(newComp);
    if (_comparisons.some(c => _comparisonKey(c) === newKey)) {
        _closeAddComparison();
        return;
    }
    _comparisons.push(newComp);
    _cardOrder.push({ type: "comp", key: newKey });
    await Promise.all([_saveComparisons(), _saveCardOrder()]);
    _closeAddComparison();
    _renderDashboard();
}

// ── Location Search ────────────────────────────────────────────
function _openSearch() {
    document.getElementById("location-search-overlay").classList.remove("hidden");
    const input = document.getElementById("location-search-input");
    input.value = "";
    document.getElementById("search-results").innerHTML = "";
    setTimeout(() => input.focus(), 100);
}

function _closeSearch() {
    document.getElementById("location-search-overlay").classList.add("hidden");
}

async function _doSearch(query) {
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
                <div class="search-result-name">${_esc(r.name)}</div>
                <div class="search-result-region">${_esc([r.region, r.country].filter(Boolean).join(", "))}</div>
            </div>
        `).join("");

        container.querySelectorAll(".search-result-item").forEach(el => {
            el.addEventListener("click", () => {
                const loc = JSON.parse(el.dataset.loc);
                _addLocation(loc);
            });
        });
    } catch (e) {
        console.error("Search failed", e);
    }
}

async function _addLocation(loc) {
    // Check if already exists
    if (_locations.some(l => l.lat === loc.lat && l.lon === loc.lon)) {
        _closeSearch();
        return;
    }
    _locations.push(loc);
    const key = `${loc.lat},${loc.lon}`;
    _cardOrder.push({ type: "loc", key });
    await Promise.all([_saveLocations(), _saveCardOrder()]);
    _closeSearch();
    _refreshCurrent();
    _renderDashboard();
}

// ── Settings ───────────────────────────────────────────────────
function _openSettings() {
    const overlay = document.getElementById("settings-overlay");
    const container = document.getElementById("settings-cards") || document.getElementById("settings-locations");
    const len = _cardOrder.length;

    let html = "";
    for (let i = 0; i < len; i++) {
        const card = _cardOrder[i];
        if (card.type === "loc") {
            const loc = _locations.find(l => `${l.lat},${l.lon}` === card.key);
            if (!loc) continue;
            html += `
            <div class="settings-location-item" data-card-idx="${i}">
                <div class="settings-reorder-btns">
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="down" ${i === len - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
                </div>
                <input type="text" class="settings-emoji-input" data-loc-key="${card.key}" value="${_esc(loc.emoji || "")}" placeholder="+" maxlength="2" aria-label="Emoji">
                <div class="settings-loc-info">
                    <div class="settings-loc-name">${_esc(loc.name)}</div>
                    <div class="settings-loc-region">${_esc([loc.region, loc.country].filter(Boolean).join(", "))}</div>
                </div>
                <button class="settings-delete-btn" data-card-idx="${i}" data-card-type="loc" data-card-key="${card.key}" aria-label="Remove">&times;</button>
            </div>`;
        } else if (card.type === "comp") {
            const ci = _comparisons.findIndex(c => _comparisonKey(c) === card.key);
            if (ci < 0) continue;
            const locs = _getComparisonLocsForIdx(ci);
            const n1 = locs ? _displayName(locs.loc1) : "Unknown";
            const n2 = locs ? _displayName(locs.loc2) : "Unknown";
            html += `
            <div class="settings-location-item" data-card-idx="${i}">
                <div class="settings-reorder-btns">
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
                    <button class="settings-move-btn" data-card-idx="${i}" data-dir="down" ${i === len - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
                </div>
                <div class="settings-comp-icon">vs</div>
                <div class="settings-loc-info">
                    <div class="settings-loc-name">${_esc(n1)} vs ${_esc(n2)}</div>
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
            if (swap < 0 || swap >= _cardOrder.length) return;
            [_cardOrder[idx], _cardOrder[swap]] = [_cardOrder[swap], _cardOrder[idx]];
            await _saveCardOrder();
            _openSettings();
            _renderDashboard();
        });
    });

    // Delete buttons
    container.querySelectorAll(".settings-delete-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const type = btn.dataset.cardType;
            const key = btn.dataset.cardKey;
            const cardIdx = parseInt(btn.dataset.cardIdx);
            // Remove from _cardOrder
            _cardOrder.splice(cardIdx, 1);
            await _saveCardOrder();
            // Remove from underlying data
            if (type === "loc") {
                const li = _locations.findIndex(l => `${l.lat},${l.lon}` === key);
                if (li >= 0) _locations.splice(li, 1);
                await _saveLocations();
            } else if (type === "comp") {
                const ci = _comparisons.findIndex(c => _comparisonKey(c) === key);
                if (ci >= 0) _comparisons.splice(ci, 1);
                await _saveComparisons();
            }
            _openSettings();
            _renderDashboard();
        });
    });

    // Emoji inputs (only on location cards)
    container.querySelectorAll(".settings-emoji-input").forEach(input => {
        input.addEventListener("change", async () => {
            const locKey = input.dataset.locKey;
            const loc = _locations.find(l => `${l.lat},${l.lon}` === locKey);
            if (loc) {
                loc.emoji = input.value.trim() || "";
                await _saveLocations();
                _renderDashboard();
            }
        });
    });
}

function _closeSettings() {
    document.getElementById("settings-overlay").classList.add("hidden");
}

// ── Global Events ──────────────────────────────────────────────
function _bindGlobalEvents() {
    // Header buttons
    document.getElementById("back-btn").addEventListener("click", _navigateToDashboard);
    document.getElementById("add-btn").addEventListener("click", _openActionPicker);
    document.getElementById("settings-btn").addEventListener("click", _openSettings);

    // Action picker buttons
    document.getElementById("add-action-close")?.addEventListener("click", _closeActionPicker);
    document.getElementById("add-action-location")?.addEventListener("click", () => {
        _closeActionPicker();
        _openSearch();
    });
    document.getElementById("add-action-comparison")?.addEventListener("click", () => {
        _closeActionPicker();
        _openAddComparison();
    });

    // Close buttons
    document.getElementById("search-close")?.addEventListener("click", _closeSearch);
    document.getElementById("settings-close")?.addEventListener("click", _closeSettings);
    document.getElementById("history-close")?.addEventListener("click", () => {
        document.getElementById("history-overlay").classList.add("hidden");
        _historyChartMeta = null;
        const tooltip = document.getElementById("history-tooltip");
        if (tooltip) tooltip.classList.remove("visible");
    });
    document.getElementById("comparison-close")?.addEventListener("click", () => {
        document.getElementById("comparison-overlay").classList.add("hidden");
    });
    document.getElementById("add-comparison-close")?.addEventListener("click", _closeAddComparison);
    document.getElementById("add-comp-save")?.addEventListener("click", _saveNewComparison);

    // Add-comparison selects + search inputs
    document.getElementById("add-comp-sel-1")?.addEventListener("change", () => _onCompSelectChange(1));
    document.getElementById("add-comp-sel-2")?.addEventListener("change", () => _onCompSelectChange(2));
    document.getElementById("add-comp-search-input-1")?.addEventListener("input", (e) => _onCompSearchInput(1, e.target.value.trim()));
    document.getElementById("add-comp-search-input-2")?.addEventListener("input", (e) => _onCompSearchInput(2, e.target.value.trim()));

    // Search input debounce
    document.getElementById("location-search-input")?.addEventListener("input", (e) => {
        clearTimeout(_searchTimeout);
        _searchTimeout = setTimeout(() => _doSearch(e.target.value.trim()), 300);
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

        // Pull-to-refresh
        pulling = window.scrollY === 0;

        // Swipe between cards (not in horizontal-scroll areas)
        swiping = _cardOrder.length > 0
            && !e.target.closest(".hourly-scroll, .precip-strip, .history-chart, #radar-map")
            && !e.target.closest(".overlay");
    }, { passive: true });

    document.addEventListener("touchend", (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        // Pull-to-refresh
        if (pulling && dy > 80) {
            _refreshCurrent();
            if (_activeLocation && _activeWeather) {
                _fetchAndRenderDetail(_activeLocation);
            }
        }
        pulling = false;

        // Swipe cycle: Dashboard → cardOrder[0] → ... → cardOrder[n-1] → Dashboard
        if (swiping && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
            const ci = _currentCardIdx();
            if (ci === -1 && !_activeLocation && _showingComparisonIdx < 0) {
                // Dashboard
                if (dx < 0 && _cardOrder.length) _navigateToCard(0);
                else if (dx > 0 && _cardOrder.length) _navigateToCard(_cardOrder.length - 1);
            } else if (ci >= 0) {
                if (dx < 0) {
                    // Swipe left → next card, or dashboard after last
                    if (ci < _cardOrder.length - 1) _navigateToCard(ci + 1);
                    else _navigateToDashboard();
                } else {
                    // Swipe right → prev card, or dashboard before first
                    if (ci > 0) _navigateToCard(ci - 1);
                    else _navigateToDashboard();
                }
            }
        }
        swiping = false;
    }, { passive: true });

    // Visibility change — refresh on app resume
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            _refreshCurrent();
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

// ── Service Worker ─────────────────────────────────────────────
function _registerSW() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/static/sw.js").catch(err => {
            console.error("SW registration failed", err);
        });
    }
}

// ── Utilities ──────────────────────────────────────────────────
function _displayName(loc) {
    return loc.emoji ? `${loc.emoji} ${loc.name}` : loc.name;
}

function _displayNameTrailing(loc) {
    return loc.emoji ? `${loc.name} ${loc.emoji}` : loc.name;
}

function _esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function _formatTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const m = d.getMinutes();
    return m === 0 ? `${h}${ampm}` : `${h}:${m.toString().padStart(2, "0")}${ampm}`;
}

function _formatDay(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T12:00:00");
    const wday = d.toLocaleDateString("en-US", { weekday: "short" });
    return `${wday} ${d.getDate()}`;
}
