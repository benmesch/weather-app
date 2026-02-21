/* BenWeather — Comparison view */

import state from './state.js';
import nav from './nav.js';
import { displayName, esc } from './utils.js';

export async function loadAllComparisonSummaries() {
    for (let ci = 0; ci < state.comparisons.length; ci++) {
        loadComparisonSummaryForIdx(ci);
    }
}

function compCacheKey(comp) {
    const base = nav.comparisonKey(comp);
    const notScored = [...(comp.hidden_metrics || []), ...(comp.display_metrics || [])].sort().join(",");
    return notScored ? `${base}#${notScored}` : base;
}

function hiddenParam(comp) {
    const h = [...(comp.hidden_metrics || []), ...(comp.display_metrics || [])];
    return h.length ? `&hidden=${h.join(",")}` : "";
}

async function loadComparisonSummaryForIdx(ci) {
    const locs = nav.getComparisonLocsForIdx(ci);
    if (!locs) return;
    const comp = state.comparisons[ci];
    const cacheKey = compCacheKey(comp);
    let data = state.comparisonDataMap.get(cacheKey);
    if (!data) {
        try {
            const resp = await fetch(`/api/comparison?lat1=${locs.loc1.lat}&lon1=${locs.loc1.lon}&lat2=${locs.loc2.lat}&lon2=${locs.loc2.lon}${hiddenParam(comp)}`);
            if (!resp.ok) { setCompSub(ci, "Unable to load"); return; }
            data = await resp.json();
            state.comparisonDataMap.set(cacheKey, data);
        } catch (e) {
            console.error("Failed to load comparison", e);
            setCompSub(ci, "Unable to load");
            return;
        }
    }
    const name1 = displayName(locs.loc1);
    const name2 = displayName(locs.loc2);
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
        setCompSub(ci, `${esc(streakName)} ${streakCount} month streak`);
    } else if (streakName) {
        setCompSub(ci, `${esc(streakName)} won last month`);
    } else {
        setCompSub(ci, "Tied last month");
    }
}

function setCompSub(ci, html) {
    const el = document.getElementById(`comp-card-sub-${ci}`);
    if (el) el.innerHTML = html;
}

export async function renderComparisonView(idx) {
    const container = document.getElementById("weather-container");
    document.getElementById("back-btn").classList.remove("hidden");
    document.getElementById("add-btn").classList.add("hidden");

    const locs = nav.getComparisonLocsForIdx(idx);
    if (!locs) { container.innerHTML = `<div class="loading">Need at least 2 locations.</div>`; return; }
    const e1 = locs.loc1.emoji || "";
    const e2 = locs.loc2.emoji || "";
    document.getElementById("header-title").textContent = `${e1} vs ${e2}`;

    const comp = state.comparisons[idx];
    const cacheKey = compCacheKey(comp);
    const cached = state.comparisonDataMap.get(cacheKey);

    if (cached) {
        renderComparisonContent(container, cached, locs, idx);
        return;
    }

    container.innerHTML = `<div class="loading"><div class="loading-spinner"></div><br>Loading comparison...</div>`;
    try {
        const resp = await fetch(`/api/comparison?lat1=${locs.loc1.lat}&lon1=${locs.loc1.lon}&lat2=${locs.loc2.lat}&lon2=${locs.loc2.lon}${hiddenParam(comp)}`);
        if (!resp.ok) { container.innerHTML = `<div class="loading">Failed to load comparison.</div>`; return; }
        const data = await resp.json();
        state.comparisonDataMap.set(cacheKey, data);
        if (state.showingComparisonIdx === idx) renderComparisonContent(container, data, locs, idx);
    } catch (e) {
        console.error("Comparison fetch failed", e);
        container.innerHTML = `<div class="loading">Failed to load comparison.</div>`;
    }
}

function renderComparisonContent(container, data, locs, compIdx) {
    renderComparison(data, container, locs, compIdx);
    window.scrollTo(0, 0);
}

function renderComparison(data, container, locs, compIdx) {
    const name1 = displayName(locs.loc1);
    const name2 = displayName(locs.loc2);
    const comp = (compIdx != null && state.comparisons[compIdx]) ? state.comparisons[compIdx] : {};
    const hidden = new Set(comp.hidden_metrics || []);
    const displayOnly = new Set(comp.display_metrics || []);

    const winnerName = data.overall_winner === "loc1" ? name1 : data.overall_winner === "loc2" ? name2 : null;
    const totalMonths = data.months.length;
    const ties = totalMonths - data.loc1_wins - data.loc2_wins;
    let summaryText;
    if (winnerName) {
        const record = data.overall_winner === "loc1" ? wlt(data.loc1_wins, data.loc2_wins, ties) : wlt(data.loc2_wins, data.loc1_wins, ties);
        summaryText = `${esc(winnerName)} ${record}`;
    } else {
        summaryText = `Tied ${wlt(data.loc1_wins, data.loc2_wins, ties)}`;
    }

    const viewStyle = (compIdx != null && state.comparisons[compIdx]) ? (state.comparisons[compIdx].view_style || "chrono") : "chrono";

    let html = "";
    html += `<div class="comparison-overall">
        <div class="comparison-overall-title">${summaryText}</div>
        <div class="comparison-overall-sub">${esc(name1)} vs ${esc(name2)} &middot; ${data.window_start.slice(0, 4)} to ${data.window_end.slice(0, 4)}</div>
    </div>`;

    html += renderCompChart(data, name1, name2);

    html += `<div class="comp-view-toggle">
        <button class="comp-view-btn${viewStyle === "chrono" ? " active" : ""}" data-style="chrono">Chronologic</button>
        <button class="comp-view-btn${viewStyle === "monthly" ? " active" : ""}" data-style="monthly">By Month</button>
    </div>`;

    if (viewStyle === "monthly") {
        html += renderMonthlyGroups(data, name1, name2, hidden, displayOnly);
    } else {
        html += renderChronoMonths(data, name1, name2, hidden, displayOnly);
    }

    container.innerHTML = html;

    if (compIdx != null) {
        container.querySelectorAll(".comp-view-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const style = btn.dataset.style;
                if (state.comparisons[compIdx]) {
                    state.comparisons[compIdx].view_style = style;
                    nav.saveComparisons();
                }
                const curLocs = nav.getComparisonLocsForIdx(compIdx);
                if (curLocs) renderComparisonContent(container, data, curLocs, compIdx);
            });
        });
    }
}

function wlt(w, l, t) {
    return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function renderMonthCard(m, name1, name2, hidden, displayOnly) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [y, mo] = m.month.split("-");
    const monthLabel = `${monthNames[parseInt(mo) - 1]} ${y}`;
    const winnerLabel = m.winner === "loc1" ? name1 : m.winner === "loc2" ? name2 : "Tie";
    const winnerClass = m.winner !== "tie" ? `winner-${m.winner}` : "";
    let sunsetNote = "";
    if (m.sunset_diff != null && m.sunset_diff !== 0 && !(hidden && hidden.has("avg_sunset_min"))) {
        const absDiff = Math.abs(m.sunset_diff);
        const laterName = m.sunset_diff > 0 ? name1 : name2;
        sunsetNote = `<div class="comparison-month-sunset">${esc(laterName)} sunsets avg ${absDiff} min later</div>`;
    }
    return `<div class="comparison-month-card ${winnerClass}">
        <div class="comparison-month-header" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="comparison-month-label">${monthLabel}</span>
            <span class="comparison-month-winner">${esc(winnerLabel)} ${m.winner === "loc2" ? wlt(m.loc2_score, m.loc1_score, m.metric_ties) : wlt(m.loc1_score, m.loc2_score, m.metric_ties)}</span>
            <span class="comp-chevron">&#9656;</span>
        </div>
        <div class="comparison-month-body">
            ${sunsetNote}
            <table class="comp-table">
                <thead><tr>
                    <th class="${m.winner === "loc1" ? "col-winner" : ""}">${esc(name1)}</th>
                    <th></th>
                    <th class="${m.winner === "loc2" ? "col-winner" : ""}">${esc(name2)}</th>
                </tr></thead>
                <tbody>${renderCompRows(m.loc1, m.loc2, hidden, displayOnly)}</tbody>
            </table>
        </div>
    </div>`;
}

function renderChronoMonths(data, name1, name2, hidden, displayOnly) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthsDesc = [...data.months].reverse();
    const fmtMonth = (m) => { const [y, mo] = m.month.split("-"); return `${monthNames[parseInt(mo) - 1]} ${y}`; };
    const isSweep = (m) => m.winner !== "tie" && !m.metric_ties && (m.loc1_score === 0 || m.loc2_score === 0);

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

    let html = "";
    for (const g of groups) {
        if (g.type === "single" || g.months.length === 1) {
            html += renderMonthCard(g.months[0], name1, name2, hidden, displayOnly);
        } else {
            const sweepName = g.sweeper === "loc1" ? name1 : name2;
            const earliest = g.months[g.months.length - 1];
            const latest = g.months[0];
            const [yE, moE] = earliest.month.split("-");
            const [yL, moL] = latest.month.split("-");
            const rangeLabel = yE === yL
                ? `${monthNames[parseInt(moE) - 1]} \u2013 ${monthNames[parseInt(moL) - 1]} ${yL}`
                : `${fmtMonth(earliest)} \u2013 ${fmtMonth(latest)}`;
            html += `<div class="comparison-sweep-group">
                <div class="comparison-sweep-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span class="comparison-month-label">${rangeLabel}</span>
                    <span class="comparison-month-winner">${esc(sweepName)} sweeps ${g.months.length} months</span>
                    <span class="comp-chevron">&#9656;</span>
                </div>
                <div class="comparison-sweep-body">
                    ${g.months.map(m => renderMonthCard(m, name1, name2, hidden, displayOnly)).join("")}
                </div>
            </div>`;
        }
    }
    return html;
}

function renderMonthlyGroups(data, name1, name2, hidden, displayOnly) {
    const monthNames = ["January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"];
    const buckets = Array.from({ length: 12 }, () => []);
    for (const m of data.months) {
        const moIdx = parseInt(m.month.split("-")[1]) - 1;
        buckets[moIdx].push(m);
    }

    const curMonth = new Date().getMonth();
    let html = "";
    for (let i = 0; i < 12; i++) {
        const moIdx = (curMonth + i) % 12;
        const entries = buckets[moIdx];
        if (!entries.length) continue;

        entries.sort((a, b) => b.month.localeCompare(a.month));

        let loc1w = 0, loc2w = 0, tieCount = 0, sweepCount = 0;
        for (const m of entries) {
            if (m.winner === "loc1") loc1w++;
            else if (m.winner === "loc2") loc2w++;
            else tieCount++;
            if (m.winner !== "tie" && !m.metric_ties && (m.loc1_score === 0 || m.loc2_score === 0)) sweepCount++;
        }
        let recordLabel;
        if (loc1w > loc2w) {
            recordLabel = `${esc(name1)} ${wlt(loc1w, loc2w, tieCount)}`;
        } else if (loc2w > loc1w) {
            recordLabel = `${esc(name2)} ${wlt(loc2w, loc1w, tieCount)}`;
        } else {
            recordLabel = `Tied ${wlt(loc1w, loc2w, tieCount)}`;
        }
        if (sweepCount) recordLabel += ` &middot; ${sweepCount} sweep${sweepCount > 1 ? "s" : ""}`;

        html += `<div class="comparison-month-group">
            <div class="comparison-month-group-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span class="comparison-month-group-label">${monthNames[moIdx]}</span>
                <span class="comparison-month-group-record">${recordLabel}</span>
                <span class="comp-chevron">&#9656;</span>
            </div>
            <div class="comparison-month-group-body">
                ${entries.map(m => renderMonthCard(m, name1, name2, hidden, displayOnly)).join("")}
            </div>
        </div>`;
    }
    return html;
}

function renderCompRows(m1, m2, hidden, displayOnly) {
    const h = hidden || new Set();
    const d = displayOnly || new Set();
    const W = "\u2705";
    const row = (disp1, label, disp2, higherWins, n1, n2, noMarks) => {
        let mark1 = "", mark2 = "";
        if (!noMarks && n1 !== n2) {
            if (higherWins) { if (n1 > n2) mark1 = W + " "; else mark2 = " " + W; }
            else { if (n1 < n2) mark1 = W + " "; else mark2 = " " + W; }
        }
        return `<tr><td>${disp1}</td><td class="comp-label">${mark1}${label}${mark2}</td><td>${disp2}</td></tr>`;
    };
    let html = "";
    if (!h.has("sunshine_hours")) {
        html += row(m1.sunshine_hours + "h", "Sunshine", m2.sunshine_hours + "h", true, m1.sunshine_hours, m2.sunshine_hours, d.has("sunshine_hours"));
    }
    if (!h.has("avg_daylight_hours") && m1.avg_daylight_hours != null && m2.avg_daylight_hours != null) {
        html += row(m1.avg_daylight_hours + "h", "Daylight", m2.avg_daylight_hours + "h", true, m1.avg_daylight_hours, m2.avg_daylight_hours, d.has("avg_daylight_hours"));
    }
    if (!h.has("avg_sunset_min") && m1.avg_sunset_min != null && m2.avg_sunset_min != null) {
        const sDiff = Math.abs(m1.avg_sunset_min - m2.avg_sunset_min);
        const sN1 = sDiff > 10 ? m1.avg_sunset_min : 0;
        const sN2 = sDiff > 10 ? m2.avg_sunset_min : 0;
        html += row(minutesToTime(m1.avg_sunset_min), "Avg sunset", minutesToTime(m2.avg_sunset_min), true, sN1, sN2, d.has("avg_sunset_min"));
    }
    if (!h.has("rainy_days")) {
        html += row(m1.rainy_days, "Rainy days", m2.rainy_days, false, m1.rainy_days, m2.rainy_days, d.has("rainy_days"));
    }
    if (!h.has("overcast_days")) {
        html += row(m1.overcast_days, "Overcast days", m2.overcast_days, true, m1.overcast_days, m2.overcast_days, d.has("overcast_days"));
    }
    if (!h.has("cozy_overcast_days") && ((m1.cozy_overcast_days || 0) > 0 || (m2.cozy_overcast_days || 0) > 0)) {
        html += row(m1.cozy_overcast_days || 0, "Cozy overcast", m2.cozy_overcast_days || 0, true, m1.cozy_overcast_days || 0, m2.cozy_overcast_days || 0, d.has("cozy_overcast_days"));
    }
    if (!h.has("snow_days") && (m1.snow_days > 0 || m2.snow_days > 0)) {
        html += row(m1.snow_days, "Snow days", m2.snow_days, false, m1.snow_days, m2.snow_days, d.has("snow_days"));
    }
    if (!h.has("freezing_days") && (m1.freezing_days > 0 || m2.freezing_days > 0)) {
        html += row(m1.freezing_days, "Freezing days", m2.freezing_days, false, m1.freezing_days, m2.freezing_days, d.has("freezing_days"));
    }
    if (!h.has("hot_days") && (m1.hot_days > 0 || m2.hot_days > 0)) {
        html += row(m1.hot_days, "Hot days (90+)", m2.hot_days, false, m1.hot_days, m2.hot_days, d.has("hot_days"));
    }
    if (!h.has("sticky_days") && (m1.sticky_days > 0 || m2.sticky_days > 0)) {
        html += row(m1.sticky_days, "Sticky days (100+)", m2.sticky_days, false, m1.sticky_days, m2.sticky_days, d.has("sticky_days"));
    }
    const fmtHL = (m) => `${m.avg_high != null ? Math.round(m.avg_high) + "\u00B0" : "--"} / ${m.avg_low != null ? Math.round(m.avg_low) + "\u00B0" : "--"}`;
    html += `<tr><td>${fmtHL(m1)}</td><td class="comp-label">Avg H / L</td><td>${fmtHL(m2)}</td></tr>`;
    return html;
}

function renderCompChart(data, name1, name2) {
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

    const W = 600, H = 250;
    const pad = { l: 32, r: 10, t: 20, b: 30 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

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

    svg += `<line x1="${pad.l}" y1="${toY(0)}" x2="${W - pad.r}" y2="${toY(0)}" stroke="#555" stroke-width="1"/>`;

    for (let v = -yAbs + 1; v < yAbs; v++) {
        if (v === 0) continue;
        const y = toY(v);
        if (Math.abs(v) % 2 === 0) {
            svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#333" stroke-width="0.5" stroke-dasharray="3,3"/>`;
            svg += `<text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" fill="#666" font-size="10">${v > 0 ? "+" : ""}${v}</text>`;
        }
    }
    svg += `<text x="${pad.l - 4}" y="${toY(0) + 4}" text-anchor="end" fill="#888" font-size="10">0</text>`;

    const ml = ["J","F","M","A","M","J","J","A","S","O","N","D"];
    for (let i = 0; i < 12; i++) {
        svg += `<text x="${toX(i)}" y="${H - pad.b + 16}" text-anchor="middle" fill="#888" font-size="11">${ml[i]}</text>`;
    }

    const n1Short = name1.length > 12 ? name1.slice(0, 11) + "\u2026" : name1;
    const n2Short = name2.length > 12 ? name2.slice(0, 11) + "\u2026" : name2;
    svg += `<text x="${W - pad.r}" y="${pad.t + 10}" text-anchor="end" fill="#888" font-size="10">\u25B2 ${n1Short}</text>`;
    svg += `<text x="${W - pad.r}" y="${H - pad.b - 4}" text-anchor="end" fill="#888" font-size="10">\u25BC ${n2Short}</text>`;

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

    let legend = '<div class="comp-chart-legend">';
    for (let yi = 0; yi < years.length; yi++) {
        legend += `<span class="comp-chart-legend-item"><span class="comp-chart-swatch" style="background:${colors[yi % colors.length]}"></span>${years[yi]}</span>`;
    }
    legend += "</div>";

    return `<div class="comparison-chart-card">${svg}${legend}</div>`;
}

function minutesToTime(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return m === 0 ? `${h}${ap}` : `${h}:${m.toString().padStart(2, "0")}${ap}`;
}
