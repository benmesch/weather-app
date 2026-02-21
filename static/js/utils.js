/* BenWeather — Pure utility helpers */

export function displayName(loc) {
    const n = loc.display_name || loc.name;
    return loc.emoji ? `${loc.emoji} ${n}` : n;
}

export function displayNameTrailing(loc) {
    const n = loc.display_name || loc.name;
    return loc.emoji ? `${n} ${loc.emoji}` : n;
}

export function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

export function formatTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const m = d.getMinutes();
    return m === 0 ? `${h}${ampm}` : `${h}:${m.toString().padStart(2, "0")}${ampm}`;
}

export function formatDay(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T12:00:00");
    const wday = d.toLocaleDateString("en-US", { weekday: "short" });
    return `${wday} ${d.getDate()}`;
}

export function alertSeverityClass(alerts) {
    const severities = alerts.map(a => (a.severity || "").toLowerCase());
    if (severities.includes("extreme") || severities.includes("severe")) return "alert-badge-severe";
    if (severities.includes("moderate")) return "alert-badge-moderate";
    return "alert-badge-minor";
}
