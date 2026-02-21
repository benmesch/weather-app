/* BenWeather — History overlay with chart & tap-to-inspect */

import state from './state.js';
import { displayName } from './utils.js';

export async function openHistory(loc) {
    const overlay = document.getElementById("history-overlay");
    const content = document.getElementById("history-content");
    const title = document.getElementById("history-title");

    title.textContent = `${displayName(loc)} — 60-Day History`;
    content.innerHTML = `<div class="loading"><div class="loading-spinner"></div></div>`;
    overlay.classList.remove("hidden");

    try {
        const resp = await fetch(`/api/history?lat=${loc.lat}&lon=${loc.lon}`);
        const data = await resp.json();
        if (!data || !data.length) {
            content.innerHTML = `<div class="loading">No history available yet.</div>`;
            return;
        }
        renderHistory(data, content);
    } catch (e) {
        content.innerHTML = `<div class="loading">Failed to load history.</div>`;
    }
}

function renderHistory(data, container) {
    const highs = data.map(d => d.high).filter(v => v != null);
    const lows = data.map(d => d.low).filter(v => v != null);
    const precips = data.map(d => d.precip).filter(v => v != null);
    const avgHigh = highs.length ? (highs.reduce((a, b) => a + b, 0) / highs.length).toFixed(1) : "--";
    const avgLow = lows.length ? (lows.reduce((a, b) => a + b, 0) / lows.length).toFixed(1) : "--";
    const totalPrecip = precips.reduce((a, b) => a + b, 0).toFixed(2);
    const rainyDays = precips.filter(p => p > 0.01).length;

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

    requestAnimationFrame(() => {
        drawHistoryChart(data, chartWidth, chartHeight, precipHeight);
        const canvas = document.getElementById("history-canvas");
        if (canvas) {
            canvas.addEventListener("click", handleHistoryTap);
            canvas.addEventListener("touchend", handleHistoryTap);
        }
    });
}

function drawHistoryChart(data, chartWidth, chartHeight, precipHeight) {
    const canvas = document.getElementById("history-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

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

    // Month boundaries
    ctx.font = "11px sans-serif";
    ctx.fillStyle = textColor;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let prevMonth = -1;
    for (let i = 0; i < data.length; i++) {
        const d = new Date(data[i].date + "T12:00:00");
        const mo = d.getMonth();
        if (mo !== prevMonth) {
            const x = pad.left + i * dx;
            if (prevMonth !== -1) {
                ctx.strokeStyle = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)";
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(x, pad.top);
                ctx.lineTo(x, precipTop + precipHeight);
                ctx.stroke();
            }
            ctx.fillStyle = textColor;
            ctx.textAlign = i === 0 ? "left" : "center";
            ctx.fillText(monthNames[mo], x, precipTop + precipHeight + 12);
            prevMonth = mo;
        }
    }

    // Temp scale labels
    ctx.fillStyle = textColor;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
        const temp = Math.round(maxTemp - (tempRange / 4) * i);
        const y = pad.top + (plotH / 4) * i;
        ctx.fillText(temp + "\u00B0", chartWidth - pad.right - 2, y - 3);
    }

    // Save geometry for tap-to-inspect
    state.historyChartMeta = { data, dx, pad, minTemp, maxTemp, tempRange, plotH, chartWidth, chartHeight, precipHeight, highColor, lowColor };
}

function handleHistoryTap(e) {
    e.preventDefault();
    if (!state.historyChartMeta) return;
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

    const m = state.historyChartMeta;
    const idx = Math.round((canvasX - m.pad.left) / m.dx);
    if (idx < 0 || idx >= m.data.length) return;

    const record = m.data[idx];

    drawHistoryChart(m.data, m.chartWidth, m.chartHeight, m.precipHeight);
    drawHistoryHighlight(idx);
    showHistoryTooltip(record, clientX, clientY);
}

function drawHistoryHighlight(idx) {
    const canvas = document.getElementById("history-canvas");
    if (!canvas || !state.historyChartMeta) return;
    const ctx = canvas.getContext("2d");
    const m = state.historyChartMeta;
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

function showHistoryTooltip(record, clientX, clientY) {
    let tooltip = document.getElementById("history-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "history-tooltip";
        tooltip.className = "history-tooltip";
        document.body.appendChild(tooltip);
    }

    const dateStr = new Date(record.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const hi = record.high != null ? Math.round(record.high) + "\u00B0" : "--";
    const lo = record.low != null ? Math.round(record.low) + "\u00B0" : "--";
    const precip = record.precip != null ? record.precip.toFixed(2) + '"' : "--";

    tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px">${dateStr}</div>
        <div>High: <span style="color:#ff7043">${hi}</span></div>
        <div>Low: <span style="color:#42a5f5">${lo}</span></div>
        <div>Precip: ${precip}</div>
    `;

    const vw = window.innerWidth;
    let left = clientX + 12;
    let top = clientY - 60;
    if (left + 140 > vw) left = clientX - 152;
    if (top < 10) top = clientY + 12;
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";

    tooltip.classList.add("visible");

    clearTimeout(tooltip._hideTimer);
    tooltip._hideTimer = setTimeout(() => {
        tooltip.classList.remove("visible");
    }, 3000);
}
