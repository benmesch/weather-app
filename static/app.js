/* BenWeather — Frontend */

// ── State ──────────────────────────────────────────────────────
let _locations = [];
let _allCurrent = {};        // key -> current conditions dict
let _activeLocation = null;  // Location obj or null (null = dashboard)
let _activeWeather = null;   // full WeatherData for active location
let _searchTimeout = null;

// ── Init ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await _loadSettings();
    _renderView();
    _refreshCurrent();
    _bindGlobalEvents();
    _registerSW();
});

// ── Settings / Data ────────────────────────────────────────────
async function _loadSettings() {
    try {
        const resp = await fetch("/api/settings");
        const data = await resp.json();
        _locations = data.locations || [];
    } catch (e) {
        console.error("Failed to load settings", e);
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
    if (_activeLocation) {
        _renderDetail();
    } else {
        _renderDashboard();
    }
}

function _navigateToDetail(loc) {
    _activeLocation = loc;
    _activeWeather = null;
    _renderView();
    _fetchAndRenderDetail(loc);
}

function _navigateToDashboard() {
    _activeLocation = null;
    _activeWeather = null;
    document.getElementById("header-title").textContent = "BenWeather";
    document.getElementById("back-btn").classList.add("hidden");
    document.getElementById("add-btn").classList.remove("hidden");
    _renderView();
}

// ── Dashboard ──────────────────────────────────────────────────
function _renderDashboard() {
    const container = document.getElementById("weather-container");
    document.getElementById("back-btn").classList.add("hidden");
    document.getElementById("add-btn").classList.remove("hidden");
    document.getElementById("header-title").textContent = "BenWeather";

    if (!_locations.length) {
        container.innerHTML = `<div class="loading">No locations added. Tap + to add one.</div>`;
        return;
    }

    let html = "";
    for (const loc of _locations) {
        const key = `${loc.lat},${loc.lon}`;
        const cur = _allCurrent[key];
        if (cur) {
            const temp = Math.round(cur.temperature || 0);
            const hi = cur.today_high != null ? Math.round(cur.today_high) : "--";
            const lo = cur.today_low != null ? Math.round(cur.today_low) : "--";
            html += `
            <div class="location-card" data-lat="${loc.lat}" data-lon="${loc.lon}">
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
    }
    container.innerHTML = html;

    // Bind card taps
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

    // Current conditions
    html += _renderCurrent(w);

    // 15-min precipitation
    html += _renderPrecipStrip(w);

    // Hourly
    html += _renderHourly(w);

    // Daily
    html += _renderDaily(w);

    // Air quality
    html += _renderAQI(w);

    // History button
    html += `<button class="history-btn" id="history-btn">
        <span>60-Day History</span>
        <span class="history-btn-arrow">&rsaquo;</span>
    </button>`;

    container.innerHTML = html;

    // Scroll hourly to "now"
    const nowEl = container.querySelector(".hourly-item.now");
    if (nowEl) nowEl.scrollIntoView({ inline: "start", block: "nearest" });

    // History button
    document.getElementById("history-btn")?.addEventListener("click", () => _openHistory(loc));
}

function _renderCurrent(w) {
    const c = w.current;
    if (!c) return "";

    const temp = Math.round(c.temperature || 0);
    const feels = Math.round(c.feels_like || 0);
    const icon = c.weather_icon || "";
    const desc = c.weather_desc || "";

    // Sunrise/sunset from daily
    let sunrise = "", sunset = "";
    if (w.daily && w.daily.length) {
        sunrise = _formatTime(w.daily[0].sunrise);
        sunset = _formatTime(w.daily[0].sunset);
    }

    return `
    <div class="current-card">
        <div class="current-icon">${icon}</div>
        <div class="current-temp">${temp}°</div>
        <div class="current-desc">${_esc(desc)}</div>
        <div class="current-feels">Feels like ${feels}°</div>
        ${sunrise ? `<div class="sun-times"><span>Sunrise ${sunrise}</span><span>Sunset ${sunset}</span></div>` : ""}
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
        </div>
    </div>`;
}

function _renderPrecipStrip(w) {
    if (!w.minutely || !w.minutely.length) return "";

    // Find current 15-min slot and show next 2 hours (8 slots)
    const now = new Date();
    let startIdx = 0;
    for (let i = 0; i < w.minutely.length; i++) {
        if (new Date(w.minutely[i].time) > now) {
            startIdx = Math.max(0, i - 1);
            break;
        }
    }

    const slots = w.minutely.slice(startIdx, startIdx + 8);
    const maxPrecip = Math.max(...slots.map(s => s.precipitation || 0), 0.01);
    const hasPrecip = slots.some(s => (s.precipitation || 0) > 0);

    let inner;
    if (!hasPrecip) {
        inner = `<div class="precip-none">No precipitation expected</div>`;
    } else {
        inner = `<div class="precip-strip">`;
        for (const s of slots) {
            const pct = Math.max(4, ((s.precipitation || 0) / maxPrecip) * 50);
            const t = _formatTime(s.time);
            inner += `<div class="precip-bar-wrap">
                <div class="precip-bar" style="height:${pct}px"></div>
                <div class="precip-bar-time">${t}</div>
            </div>`;
        }
        inner += `</div>`;
    }

    return `
    <div class="section-title">Next 2 Hours</div>
    <div class="precip-strip-card">${inner}</div>`;
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
    for (let i = 0; i < hours.length; i++) {
        const h = hours[i];
        const isNow = i === 0;
        const time = isNow ? "Now" : _formatTime(h.time);
        const temp = Math.round(h.temperature || 0);
        const feels = Math.round(h.feels_like || 0);
        const precip = Math.round(h.precipitation_prob || 0);
        const showFeels = feels !== temp;
        items += `
        <div class="hourly-item${isNow ? " now" : ""}">
            <span class="hourly-time">${time}</span>
            <span class="hourly-icon">${h.weather_icon || ""}</span>
            <span class="hourly-temp">${temp}°</span>
            ${showFeels ? `<span class="hourly-feels">${feels}°</span>` : ""}
            ${precip > 0 ? `<span class="hourly-precip">${precip}%</span>` : ""}
            ${h.wind_speed >= 10 ? `<span class="hourly-wind">${Math.round(h.wind_speed)}mph</span>` : ""}
        </div>`;
    }

    return `
    <div class="section-title">Hourly Forecast</div>
    <div class="hourly-card"><div class="hourly-scroll">${items}</div></div>`;
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
        const dayName = i === 0 ? "Today" : _formatDay(d.date);
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
    <div class="section-title">3-Day Forecast</div>
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
    const chartHeight = 160;
    const precipHeight = 40;

    let html = `
    <div class="history-chart">
        <canvas id="history-canvas" width="${chartWidth}" height="${chartHeight + precipHeight + 20}"></canvas>
    </div>
    <div class="history-stats">
        <div class="history-stat"><div class="history-stat-value">${avgHigh}°</div><div class="history-stat-label">Avg High</div></div>
        <div class="history-stat"><div class="history-stat-value">${avgLow}°</div><div class="history-stat-label">Avg Low</div></div>
        <div class="history-stat"><div class="history-stat-value">${totalPrecip}"</div><div class="history-stat-label">Total Precip</div></div>
        <div class="history-stat"><div class="history-stat-value">${rainyDays}</div><div class="history-stat-label">Rainy Days</div></div>
    </div>`;

    container.innerHTML = html;

    // Draw chart on next frame
    requestAnimationFrame(() => _drawHistoryChart(data, chartWidth, chartHeight, precipHeight));
}

function _drawHistoryChart(data, chartWidth, chartHeight, precipHeight) {
    const canvas = document.getElementById("history-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
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

    // Labels
    ctx.fillStyle = textColor;
    ctx.font = "10px sans-serif";
    // First and last date
    if (data.length) {
        ctx.textAlign = "left";
        ctx.fillText(data[0].date.slice(5), pad.left, precipTop + precipHeight + 12);
        ctx.textAlign = "right";
        ctx.fillText(data[data.length - 1].date.slice(5), chartWidth - pad.right, precipTop + precipHeight + 12);
    }
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
    await _saveLocations();
    _closeSearch();
    _refreshCurrent();
    _renderDashboard();
}

// ── Settings ───────────────────────────────────────────────────
function _openSettings() {
    const overlay = document.getElementById("settings-overlay");
    const container = document.getElementById("settings-locations");
    const len = _locations.length;

    let html = "";
    for (let i = 0; i < len; i++) {
        const loc = _locations[i];
        html += `
        <div class="settings-location-item">
            <div class="settings-reorder-btns">
                <button class="settings-move-btn" data-idx="${i}" data-dir="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
                <button class="settings-move-btn" data-idx="${i}" data-dir="down" ${i === len - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
            </div>
            <input type="text" class="settings-emoji-input" data-idx="${i}" value="${_esc(loc.emoji || "")}" placeholder="+" maxlength="2" aria-label="Emoji">
            <div class="settings-loc-info">
                <div class="settings-loc-name">${_esc(loc.name)}</div>
                <div class="settings-loc-region">${_esc([loc.region, loc.country].filter(Boolean).join(", "))}</div>
            </div>
            <button class="settings-delete-btn" data-idx="${i}" aria-label="Remove">&times;</button>
        </div>`;
    }

    container.innerHTML = html;
    overlay.classList.remove("hidden");

    container.querySelectorAll(".settings-move-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const idx = parseInt(btn.dataset.idx);
            const dir = btn.dataset.dir;
            const swap = dir === "up" ? idx - 1 : idx + 1;
            if (swap < 0 || swap >= _locations.length) return;
            [_locations[idx], _locations[swap]] = [_locations[swap], _locations[idx]];
            await _saveLocations();
            _openSettings(); // Re-render
            _renderDashboard();
        });
    });

    container.querySelectorAll(".settings-delete-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const idx = parseInt(btn.dataset.idx);
            _locations.splice(idx, 1);
            await _saveLocations();
            _openSettings(); // Re-render
            _renderDashboard();
        });
    });

    container.querySelectorAll(".settings-emoji-input").forEach(input => {
        input.addEventListener("change", async () => {
            const idx = parseInt(input.dataset.idx);
            _locations[idx].emoji = input.value.trim() || "";
            await _saveLocations();
            _renderDashboard();
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
    document.getElementById("add-btn").addEventListener("click", _openSearch);
    document.getElementById("settings-btn").addEventListener("click", _openSettings);

    // Close buttons
    document.getElementById("search-close").addEventListener("click", _closeSearch);
    document.getElementById("settings-close").addEventListener("click", _closeSettings);
    document.getElementById("history-close").addEventListener("click", () => {
        document.getElementById("history-overlay").classList.add("hidden");
    });

    // Search input debounce
    document.getElementById("location-search-input").addEventListener("input", (e) => {
        clearTimeout(_searchTimeout);
        _searchTimeout = setTimeout(() => _doSearch(e.target.value.trim()), 300);
    });

    // Close overlays on backdrop tap
    for (const id of ["location-search-overlay", "settings-overlay", "history-overlay"]) {
        document.getElementById(id).addEventListener("click", (e) => {
            if (e.target.classList.contains("overlay")) {
                e.target.classList.add("hidden");
            }
        });
    }

    // Pull-to-refresh
    let touchStartY = 0;
    let pulling = false;

    document.addEventListener("touchstart", (e) => {
        if (window.scrollY === 0) {
            touchStartY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });

    document.addEventListener("touchend", (e) => {
        if (!pulling) return;
        const dy = e.changedTouches[0].clientY - touchStartY;
        pulling = false;
        if (dy > 80) {
            _refreshCurrent();
            if (_activeLocation && _activeWeather) {
                _fetchAndRenderDetail(_activeLocation);
            }
        }
    }, { passive: true });

    // Visibility change — refresh on app resume
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            _refreshCurrent();
        }
    });
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
    return d.toLocaleDateString("en-US", { weekday: "short" });
}
