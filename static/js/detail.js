/* BenWeather — Weather detail view */

import state from './state.js';
import nav from './nav.js';
import { displayName, esc, formatTime, formatDay } from './utils.js';

export async function fetchAndRenderDetail(loc) {
    const data = await nav.loadWeather(loc);
    if (!data) {
        document.getElementById("weather-container").innerHTML =
            `<div class="loading">Unable to load weather data.</div>`;
        return;
    }
    state.activeWeather = data;

    const key = `${loc.lat},${loc.lon}`;
    if (state.allCurrent[key]) {
        state.activeWeather.current = state.allCurrent[key];
    }

    renderDetail();
}

export function renderDetail() {
    const container = document.getElementById("weather-container");
    const loc = state.activeLocation;
    if (!loc) return;

    document.getElementById("header-title").textContent = displayName(loc);
    document.getElementById("back-btn").classList.remove("hidden");
    document.getElementById("add-btn").classList.add("hidden");

    if (!state.activeWeather) {
        container.innerHTML = `<div class="loading"><div class="loading-spinner"></div><br>Loading...</div>`;
        return;
    }

    const w = state.activeWeather;
    let html = "";

    html += renderAlerts(w);
    html += renderCurrent(w);
    html += renderPrecipStrip(w);
    html += renderHourly(w);
    html += renderSunMoon(w);
    html += renderRadarHTML();
    html += renderDaily(w);
    html += renderAQI(w);

    html += `<button class="history-btn" id="history-btn">
        <span>60-Day History</span>
        <span class="history-btn-arrow">&rsaquo;</span>
    </button>`;

    cleanupRadar();
    container.innerHTML = html;
    initRadar(loc);

    window.scrollTo(0, 0);
    const nowEl = container.querySelector(".hourly-item.now");
    if (nowEl) {
        const scroll = nowEl.closest(".hourly-scroll");
        if (scroll) scroll.scrollLeft = nowEl.offsetLeft - scroll.offsetLeft;
    }

    document.getElementById("history-btn")?.addEventListener("click", () => nav.openHistory(loc));
}

function renderAlerts(w) {
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
                <span class="alert-event">${esc(a.event)}</span>
                <span class="alert-severity">${esc(a.severity)}</span>
            </div>
            ${a.headline ? `<div class="alert-headline">${esc(a.headline)}</div>` : ""}
            ${onset || expires ? `<div class="alert-times">${onset ? `From: ${onset}` : ""}${onset && expires ? " &mdash; " : ""}${expires ? `Until: ${expires}` : ""}</div>` : ""}
            ${a.description ? `<details class="alert-details"><summary>Details</summary><p>${esc(a.description)}</p>${a.instruction ? `<p><strong>Instructions:</strong> ${esc(a.instruction)}</p>` : ""}</details>` : ""}
        </div>`;
    }
    return html;
}

function renderCurrent(w) {
    const c = w.current;
    if (!c) return "";

    const temp = Math.round(c.temperature || 0);
    const feels = Math.round(c.feels_like || 0);
    const icon = c.weather_icon || "";
    const desc = c.weather_desc || "";

    let forecastHtml = "";
    if (w.forecast_text && w.forecast_text.length) {
        const count = Math.min(w.forecast_text.length, 3);
        for (let fi = 0; fi < count; fi++) {
            const p = w.forecast_text[fi];
            forecastHtml += `<div class="current-forecast-text"><strong>${esc(p.name)}:</strong> ${esc(p.detailed)}</div>`;
        }
    }

    let visStr = "--";
    if (c.visibility != null) {
        const visMi = c.visibility / 1609.34;
        visStr = visMi >= 10 ? "10+ mi" : visMi.toFixed(1) + " mi";
    }

    const precipVal = c.precipitation || 0;

    let sunrise = "", sunset = "", daylight = "";
    if (w.daily && w.daily.length) {
        sunrise = formatTime(w.daily[0].sunrise);
        sunset = formatTime(w.daily[0].sunset);
        const riseMs = new Date(w.daily[0].sunrise).getTime();
        const setMs = new Date(w.daily[0].sunset).getTime();
        if (riseMs && setMs) {
            const diffMin = Math.round((setMs - riseMs) / 60000);
            daylight = `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
        }
    }

    const fetchedTime = formatTime(c.fetched_at || w.fetched_at || "");

    return `
    <div class="current-card">
        ${fetchedTime ? `<div class="current-fetched-at">${fetchedTime}</div>` : ""}
        <div class="current-icon">${icon}</div>
        <div class="current-temp">${temp}°</div>
        <div class="current-desc">${esc(desc)}</div>
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

function precipSummary(slots) {
    const hasPrecip = slots.some(s => (s.precipitation || 0) > 0);
    if (!hasPrecip) return "No precipitation expected in the next 6 hours";

    const totalRain = slots.reduce((a, s) => a + (s.rain || 0), 0);
    const totalSnow = slots.reduce((a, s) => a + (s.snowfall || 0), 0);
    const type = totalSnow > totalRain ? "snow" : "rain";

    const peak = Math.max(...slots.map(s => s.precipitation || 0));
    const intensity = peak > 0.12 ? "Heavy" : peak > 0.04 ? "Moderate" : "Light";

    const firstPrecipIdx = slots.findIndex(s => (s.precipitation || 0) > 0);
    const lastPrecipIdx = slots.length - 1 - [...slots].reverse().findIndex(s => (s.precipitation || 0) > 0);
    const currentlyPrecip = firstPrecipIdx === 0;

    if (currentlyPrecip) {
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

function renderPrecipStrip(w) {
    if (!w.minutely || !w.minutely.length) return "";

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

    const totalRain = slots.reduce((a, s) => a + (s.rain || 0), 0);
    const totalSnow = slots.reduce((a, s) => a + (s.snowfall || 0), 0);

    let totalStr = "0 mm";
    if (totalSnow > 0 || totalRain > 0) {
        const parts = [];
        if (totalSnow > 0) {
            parts.push("\u2744\uFE0F " + (totalSnow < 0.1 ? "Tr" : totalSnow.toFixed(1) + '"'));
        }
        if (totalRain > 0) {
            const rainMm = totalRain * 25.4;
            parts.push("\uD83C\uDF27\uFE0F " + (rainMm >= 10 ? (rainMm / 10).toFixed(1) + " cm" : rainMm.toFixed(1) + " mm"));
        }
        totalStr = parts.join(" + ");
    }

    const summary = precipSummary(slots);

    let inner = `<div class="precip-header"><span>Next 6 Hours</span><span class="precip-total">${totalStr} total</span></div>`;
    inner += `<div class="precip-summary">${summary}</div>`;

    if (hasPrecip) {
        inner += `<div class="precip-strip">`;
        for (const s of slots) {
            const amt = s.precipitation || 0;
            const pct = Math.max(4, (amt / maxPrecip) * 50);
            const t = formatTime(s.time);

            const rain = s.rain || 0;
            const snow = s.snowfall || 0;
            let barClass = "precip-bar";
            if (snow > 0 && rain > 0) barClass += " mixed";
            else if (snow > rain) barClass += " snow";

            let amtLabel = "";
            if (amt > 0) {
                if (snow > rain) {
                    // Snow: display in inches
                    amtLabel = snow < 0.1 ? "Tr" : snow.toFixed(1) + '"';
                } else {
                    // Rain: display in mm
                    const mm = rain * 25.4;
                    amtLabel = mm < 0.1 ? "Tr" : mm.toFixed(1);
                }
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

function renderHourly(w) {
    if (!w.hourly || !w.hourly.length) return "";

    const now = new Date();
    let startIdx = 0;
    for (let i = 0; i < w.hourly.length; i++) {
        if (new Date(w.hourly[i].time) >= now) {
            startIdx = Math.max(0, i - 1);
            break;
        }
    }

    const hours = w.hourly.slice(startIdx, startIdx + 48);
    let items = "";
    let prevDateStr = "";
    for (let i = 0; i < hours.length; i++) {
        const h = hours[i];
        const hDate = new Date(h.time);
        const dateStr = hDate.toDateString();
        const isNow = i === 0;

        if (dateStr !== prevDateStr && !isNow) {
            const dayLabel = hDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            items += `<div class="hourly-day-sep"><span>${dayLabel}</span></div>`;
        }
        prevDateStr = dateStr;

        const time = isNow ? "Now" : formatTime(h.time);
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
            ${h.cloud_cover != null && h.cloud_cover >= 50 ? `<span class="hourly-cloud">${Math.round(h.cloud_cover)}%\u2601</span>` : ""}
        </div>`;
    }

    return `
    <div class="section-title">Hourly Forecast</div>
    <div class="hourly-card"><div class="hourly-scroll">${items}</div></div>`;
}

function renderSunMoon(w) {
    const sm = w.sun_moon || {};
    const sun = sm.sun || {};
    const moon = sm.moon || {};

    let sunRise = sun.rise || "";
    let sunSet = sun.set || "";
    if (!sunRise && w.daily && w.daily.length) {
        sunRise = formatTime(w.daily[0].sunrise);
        sunSet = formatTime(w.daily[0].sunset);
    }

    let daylight = "";
    if (sunRise && sunSet) {
        const toMin = (t) => {
            const parts = t.match(/(\d+):(\d+)/);
            if (!parts) return 0;
            let h = parseInt(parts[1]);
            let m = parseInt(parts[2]);
            if (/PM/i.test(t) && h < 12) h += 12;
            if (/AM/i.test(t) && h === 12) h = 0;
            return h * 60 + m;
        };
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

    const phaseEmoji = moonPhaseEmoji(moon.phase);

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
                <div class="sun-moon-phase-name">${esc(moon.phase || "")}</div>
                ${moon.illumination ? `<div class="sun-moon-illum">${esc(moon.illumination)} illuminated</div>` : ""}
            </div>
            <div class="sun-moon-col">
                <div class="sun-moon-label">Moonset</div>
                <div class="sun-moon-value">${moonSetFmt}</div>
            </div>
        </div>
        ${moon.next_phase ? `<div class="sun-moon-next">Next: ${esc(moon.next_phase)} on ${formatDay(moon.next_phase_date)}</div>` : ""}
    </div>`;
}

function moonPhaseEmoji(phase) {
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

function renderRadarHTML() {
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

function initRadar(loc) {
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

    state.radarMap = map;

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
                    clearInterval(state.radarInterval);
                    state.radarInterval = null;
                    playing = false;
                    playBtn.innerHTML = "&#9654;";
                } else {
                    playing = true;
                    playBtn.innerHTML = "&#9646;&#9646;";
                    state.radarInterval = setInterval(() => {
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

export function cleanupRadar() {
    if (state.radarInterval) { clearInterval(state.radarInterval); state.radarInterval = null; }
    if (state.radarMap) { state.radarMap.remove(); state.radarMap = null; }
}

function renderDaily(w) {
    if (!w.daily || !w.daily.length) return "";

    let globalMin = Infinity, globalMax = -Infinity;
    for (const d of w.daily) {
        if (d.temp_min < globalMin) globalMin = d.temp_min;
        if (d.temp_max > globalMax) globalMax = d.temp_max;
    }
    const range = globalMax - globalMin || 1;

    let rows = "";
    for (let i = 0; i < w.daily.length; i++) {
        const d = w.daily[i];
        const dayName = i === 0 ? "Today" : i === 1 ? "Tmrw" : formatDay(d.date);
        const lo = Math.round(d.temp_min);
        const hi = Math.round(d.temp_max);
        const precip = Math.round(d.precipitation_prob_max || 0);

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

function renderAQI(w) {
    if (!w.air_quality || !w.air_quality.length) return "";

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
                <div class="aqi-label">${esc(aqi.aqi_label)}</div>
                <div class="aqi-sublabel">US AQI</div>
            </div>
        </div>
        <div class="aqi-pollutants">${pollutantHtml}</div>
    </div>`;
}
