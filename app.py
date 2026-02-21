"""Weather PWA — Flask backend with APScheduler."""

import json
import logging
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from apscheduler.schedulers.background import BackgroundScheduler

from cache import WeatherCache
from config import DEFAULT_LOCATION, CURRENT_TTL, FORECAST_TEXT_TTL
from models import Location, WeatherData
from data_sources.open_meteo import (
    fetch_weather, fetch_current_only, fetch_air_quality,
    search_locations, parse_weather, parse_current_with_daily,
    fetch_historical, fetch_comparison_historical,
)
from data_sources.nws_alerts import fetch_alerts, fetch_forecast_text
from data_sources.nws_forecast import (
    fetch_nws_observation, fetch_nws_hourly, fetch_nws_daily,
    overlay_nws_current, overlay_nws_hourly, overlay_nws_daily,
    overlay_nws_current_dict,
)
from data_sources.usno import fetch_sun_moon

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

app = Flask(__name__)
cache = WeatherCache()

_BASE_DIR = Path(__file__).parent
_SETTINGS_FILE = _BASE_DIR / "settings.json"
_HISTORY_FILE = _BASE_DIR / "history.json"
_HISTORY_DAYS = 60
_COMPARISON_FILE = _BASE_DIR / "comparison_cache.json"
_comparison_lock = threading.Lock()


# ── Settings ──────────────────────────────────────────────────────────

def _load_settings():
    if _SETTINGS_FILE.exists():
        with open(_SETTINGS_FILE) as f:
            return json.load(f)
    return {"locations": [DEFAULT_LOCATION], "units": "imperial"}


def _save_settings(data):
    with open(_SETTINGS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _get_locations():
    settings = _load_settings()
    return [Location.from_dict(d) for d in settings.get("locations", [DEFAULT_LOCATION])]


# ── History ───────────────────────────────────────────────────────────

def _load_history():
    if _HISTORY_FILE.exists():
        with open(_HISTORY_FILE) as f:
            return json.load(f)
    return {}


def _save_history(data):
    with open(_HISTORY_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _append_history(location_key, records):
    """Add new daily records, prune entries older than 60 days."""
    history = _load_history()
    existing = history.get(location_key, [])
    existing_dates = {r["date"] for r in existing}
    for rec in records:
        if rec["date"] not in existing_dates:
            existing.append(rec)
    cutoff = (datetime.now() - timedelta(days=_HISTORY_DAYS)).strftime("%Y-%m-%d")
    existing = [r for r in existing if r["date"] >= cutoff]
    existing.sort(key=lambda r: r["date"])
    history[location_key] = existing
    _save_history(history)


def _backfill_history(location):
    """Fetch 60 days of historical data for a new location."""
    end = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=_HISTORY_DAYS)).strftime("%Y-%m-%d")
    try:
        records = fetch_historical(location, start, end)
        _append_history(location.key, records)
        log.info("Backfilled %d days of history for %s", len(records), location.name)
    except Exception:
        log.exception("Failed to backfill history for %s", location.name)


# ── Comparison ────────────────────────────────────────────────────────

def _load_comparison():
    if _COMPARISON_FILE.exists():
        with open(_COMPARISON_FILE) as f:
            return json.load(f)
    return {}


def _save_comparison(data):
    tmp = _COMPARISON_FILE.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f)
    tmp.replace(_COMPARISON_FILE)


def _comparison_loc_key(lat, lon):
    return f"{lat},{lon}"


def _comparison_cache_key(lat1, lon1, lat2, lon2):
    k1 = _comparison_loc_key(lat1, lon1)
    k2 = _comparison_loc_key(lat2, lon2)
    return "|".join(sorted([k1, k2]))


def _aggregate_monthly(daily_records):
    """Group daily records by YYYY-MM and compute per-month metrics."""
    months = {}
    for rec in daily_records:
        ym = rec["date"][:7]  # YYYY-MM
        months.setdefault(ym, []).append(rec)

    result = []
    for ym in sorted(months):
        days = months[ym]
        n = len(days)
        sunshine_sec = sum((d.get("sunshine_sec") or 0) for d in days)
        rainy = sum(1 for d in days if (d.get("precip") or 0) > 0.01)
        snowy = sum(1 for d in days if (d.get("snowfall") or 0) > 0)
        # Overcast: weather_code 3 AND not rainy/snowy
        overcast = sum(
            1 for d in days
            if d.get("weather_code") == 3
            and (d.get("precip") or 0) <= 0.01
            and (d.get("snowfall") or 0) <= 0
        )
        highs = [d["high"] for d in days if d.get("high") is not None]
        lows = [d["low"] for d in days if d.get("low") is not None]
        avg_high = round(sum(highs) / len(highs), 1) if highs else None
        avg_low = round(sum(lows) / len(lows), 1) if lows else None
        freezing = sum(1 for d in days if d.get("low") is not None and d["low"] <= 32)
        hot = sum(1 for d in days if d.get("high") is not None and d["high"] >= 90)
        sticky = sum(1 for d in days if d.get("apparent_high") is not None and d["apparent_high"] >= 100)
        # Cozy overcast: overcast + high > 50 + feels-like high < 90
        cozy_overcast = sum(
            1 for d in days
            if d.get("weather_code") == 3
            and (d.get("precip") or 0) <= 0.01
            and (d.get("snowfall") or 0) <= 0
            and d.get("high") is not None and d["high"] > 50
            and (d.get("apparent_high") is None or d["apparent_high"] < 90)
        )

        # Average sunset time and daylight hours
        sunset_mins = []
        daylight_mins = []
        for d in days:
            sr = d.get("sunrise")
            st = d.get("sunset")
            try:
                if st:
                    t = datetime.fromisoformat(st)
                    sunset_mins.append(t.hour * 60 + t.minute)
                if sr and st:
                    rise = datetime.fromisoformat(sr)
                    sset = datetime.fromisoformat(st)
                    diff = (sset - rise).total_seconds() / 60
                    if diff > 0:
                        daylight_mins.append(diff)
            except (ValueError, TypeError):
                pass
        avg_sunset_min = round(sum(sunset_mins) / len(sunset_mins)) if sunset_mins else None
        avg_daylight_hours = round(sum(daylight_mins) / len(daylight_mins) / 60, 1) if daylight_mins else None

        result.append({
            "month": ym,
            "days_in_data": n,
            "sunshine_hours": round(sunshine_sec / 3600, 1),
            "rainy_days": rainy,
            "snow_days": snowy,
            "overcast_days": overcast,
            "avg_high": avg_high,
            "avg_low": avg_low,
            "freezing_days": freezing,
            "hot_days": hot,
            "sticky_days": sticky,
            "cozy_overcast_days": cozy_overcast,
            "avg_sunset_min": avg_sunset_min,
            "avg_daylight_hours": avg_daylight_hours,
        })
    return result


def _score_month(m1, m2, hidden=None):
    """Score two monthly metric dicts. Returns (loc1_pts, loc2_pts, ties).

    ``hidden`` is an optional set of metric keys to skip when scoring.
    """
    s1, s2, ties = 0, 0, 0
    hidden = hidden or set()

    def _tally(better1):
        """better1: True=loc1 wins, False=loc2 wins, None=tie."""
        nonlocal s1, s2, ties
        if better1 is True:
            s1 += 1
        elif better1 is False:
            s2 += 1
        else:
            ties += 1

    # More sunshine is better
    if "sunshine_hours" not in hidden:
        _tally(True if m1["sunshine_hours"] > m2["sunshine_hours"]
               else False if m2["sunshine_hours"] > m1["sunshine_hours"] else None)

    # Fewer rainy days is better
    if "rainy_days" not in hidden:
        _tally(True if m1["rainy_days"] < m2["rainy_days"]
               else False if m2["rainy_days"] < m1["rainy_days"] else None)

    # More overcast days (dry overcast) is better
    if "overcast_days" not in hidden:
        _tally(True if m1["overcast_days"] > m2["overcast_days"]
               else False if m2["overcast_days"] > m1["overcast_days"] else None)

    # More cozy overcast days (skip if both 0)
    if "cozy_overcast_days" not in hidden:
        if m1.get("cozy_overcast_days", 0) + m2.get("cozy_overcast_days", 0) > 0:
            _tally(True if m1.get("cozy_overcast_days", 0) > m2.get("cozy_overcast_days", 0)
                   else False if m2.get("cozy_overcast_days", 0) > m1.get("cozy_overcast_days", 0) else None)

    # Fewer snow days (skip if both 0)
    if "snow_days" not in hidden:
        if m1["snow_days"] + m2["snow_days"] > 0:
            _tally(True if m1["snow_days"] < m2["snow_days"]
                   else False if m2["snow_days"] < m1["snow_days"] else None)

    # Fewer freezing days (skip if both 0)
    if "freezing_days" not in hidden:
        if m1["freezing_days"] + m2["freezing_days"] > 0:
            _tally(True if m1["freezing_days"] < m2["freezing_days"]
                   else False if m2["freezing_days"] < m1["freezing_days"] else None)

    # Fewer hot days (skip if both 0)
    if "hot_days" not in hidden:
        if m1["hot_days"] + m2["hot_days"] > 0:
            _tally(True if m1["hot_days"] < m2["hot_days"]
                   else False if m2["hot_days"] < m1["hot_days"] else None)

    # Fewer sticky days — feels-like 100°F+ (skip if both 0)
    if "sticky_days" not in hidden:
        if m1["sticky_days"] + m2["sticky_days"] > 0:
            _tally(True if m1["sticky_days"] < m2["sticky_days"]
                   else False if m2["sticky_days"] < m1["sticky_days"] else None)

    # More daylight hours (skip if either missing)
    if "avg_daylight_hours" not in hidden:
        if m1.get("avg_daylight_hours") is not None and m2.get("avg_daylight_hours") is not None:
            _tally(True if m1["avg_daylight_hours"] > m2["avg_daylight_hours"]
                   else False if m2["avg_daylight_hours"] > m1["avg_daylight_hours"] else None)

    # Later sunset (need 10+ min difference to count)
    if "avg_sunset_min" not in hidden:
        if m1.get("avg_sunset_min") is not None and m2.get("avg_sunset_min") is not None:
            diff = m1["avg_sunset_min"] - m2["avg_sunset_min"]
            _tally(True if diff > 10 else False if diff < -10 else None)

    return s1, s2, ties


def _get_all_known_locations():
    """Get saved locations + locations referenced by comparisons."""
    settings = _load_settings()
    locs = [Location.from_dict(d) for d in settings.get("locations", [DEFAULT_LOCATION])]
    seen_keys = {l.key for l in locs}
    for comp in settings.get("comparisons", []):
        for loc_data in [comp.get("loc1"), comp.get("loc2")]:
            if loc_data and "name" in loc_data:
                loc = Location.from_dict(loc_data)
                if loc.key not in seen_keys:
                    locs.append(loc)
                    seen_keys.add(loc.key)
    return locs


def _build_comparison(lat1, lon1, lat2, lon2, hidden=None):
    """Orchestrate incremental fetch, aggregate, and score for two locations."""
    cache_key = _comparison_cache_key(lat1, lon1, lat2, lon2)
    comp_cache = _load_comparison()
    entry = comp_cache.get(cache_key, {})

    loc1_key = _comparison_loc_key(lat1, lon1)
    loc2_key = _comparison_loc_key(lat2, lon2)

    # Find locations from saved + comparison locations
    locations = _get_all_known_locations()
    loc1_obj = next((l for l in locations if l.key == loc1_key), None)
    loc2_obj = next((l for l in locations if l.key == loc2_key), None)
    if not loc1_obj or not loc2_obj:
        return None

    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    # Window: 5 full calendar years back + current year through last complete month
    now = datetime.now()
    end_month = now.replace(day=1) - timedelta(days=1)  # last day of prev month
    start_month = datetime(now.year - 5, 1, 1)           # Jan 1, five years ago
    window_start = start_month.strftime("%Y-%m-%d")
    window_end = end_month.strftime("%Y-%m-%d")

    # Incremental fetch for each location
    for loc_key, loc_obj, days_field in [
        (loc1_key, loc1_obj, "loc1_days"),
        (loc2_key, loc2_obj, "loc2_days"),
    ]:
        existing_days = entry.get(days_field, [])
        # If cached records lack apparent_high, re-fetch everything
        if existing_days and "apparent_high" not in existing_days[0]:
            existing_days = []
            entry[days_field] = []

        existing_dates = {d["date"] for d in existing_days}

        # Backfill: fetch earlier dates if window expanded
        if existing_days:
            earliest = min(d["date"] for d in existing_days)
            if window_start < earliest:
                backfill_end = (datetime.strptime(earliest, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
                try:
                    backfill = fetch_comparison_historical(loc_obj, window_start, backfill_end)
                    for rec in backfill:
                        if rec["date"] not in existing_dates:
                            existing_days.append(rec)
                            existing_dates.add(rec["date"])
                    log.info("Backfilled %d comparison days for %s (%s to %s)",
                             len(backfill), loc_obj.name, window_start, backfill_end)
                except Exception:
                    log.exception("Failed to backfill comparison data for %s", loc_obj.name)

        # Forward fill: fetch new dates since last cached
        if existing_days:
            last_date = max(d["date"] for d in existing_days)
            fetch_start = (datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            fetch_start = window_start

        if fetch_start <= yesterday:
            try:
                new_records = fetch_comparison_historical(loc_obj, fetch_start, yesterday)
                for rec in new_records:
                    if rec["date"] not in existing_dates:
                        existing_days.append(rec)
                log.info("Fetched %d comparison days for %s (%s to %s)",
                         len(new_records), loc_obj.name, fetch_start, yesterday)
            except Exception:
                log.exception("Failed to fetch comparison data for %s", loc_obj.name)

        existing_days.sort(key=lambda r: r["date"])
        entry[days_field] = existing_days

    entry["loc1_key"] = loc1_key
    entry["loc2_key"] = loc2_key
    with _comparison_lock:
        comp_cache = _load_comparison()
        comp_cache[cache_key] = entry
        _save_comparison(comp_cache)

    # Filter to 12-month window and aggregate
    loc1_window = [d for d in entry.get("loc1_days", []) if window_start <= d["date"] <= window_end]
    loc2_window = [d for d in entry.get("loc2_days", []) if window_start <= d["date"] <= window_end]

    months1 = _aggregate_monthly(loc1_window)
    months2 = _aggregate_monthly(loc2_window)

    # Build month-by-month comparison
    months1_map = {m["month"]: m for m in months1}
    months2_map = {m["month"]: m for m in months2}
    all_months = sorted(set(list(months1_map.keys()) + list(months2_map.keys())))

    loc1_wins = 0
    loc2_wins = 0
    month_results = []

    for ym in all_months:
        m1 = months1_map.get(ym)
        m2 = months2_map.get(ym)
        if not m1 or not m2:
            continue
        s1, s2, metric_ties = _score_month(m1, m2, hidden=hidden)
        winner = "loc1" if s1 > s2 else "loc2" if s2 > s1 else "tie"
        if winner == "loc1":
            loc1_wins += 1
        elif winner == "loc2":
            loc2_wins += 1

        # Sunset difference (positive = loc1 later)
        sunset_diff = None
        if m1.get("avg_sunset_min") is not None and m2.get("avg_sunset_min") is not None:
            sunset_diff = m1["avg_sunset_min"] - m2["avg_sunset_min"]

        month_results.append({
            "month": ym,
            "loc1": m1,
            "loc2": m2,
            "loc1_score": s1,
            "loc2_score": s2,
            "metric_ties": metric_ties,
            "winner": winner,
            "sunset_diff": sunset_diff,
        })

    overall_winner = "loc1" if loc1_wins > loc2_wins else "loc2" if loc2_wins > loc1_wins else "tie"

    return {
        "loc1_name": loc1_obj.name,
        "loc2_name": loc2_obj.name,
        "loc1_key": loc1_key,
        "loc2_key": loc2_key,
        "loc1_wins": loc1_wins,
        "loc2_wins": loc2_wins,
        "overall_winner": overall_winner,
        "months": month_results,
        "window_start": window_start,
        "window_end": window_end,
    }


# ── NWS Overlay ───────────────────────────────────────────────────────

def _apply_nws_overlay(data, lat, lon, name):
    """Apply NWS data overlay to WeatherData. Each piece fails independently."""
    try:
        nws_obs = fetch_nws_observation(lat, lon)
        overlay_nws_current(data, nws_obs)
    except Exception:
        log.warning("NWS observation overlay failed for %s", name)

    try:
        nws_hourly = fetch_nws_hourly(lat, lon)
        overlay_nws_hourly(data, nws_hourly)
    except Exception:
        log.warning("NWS hourly overlay failed for %s", name)

    try:
        nws_daily = fetch_nws_daily(lat, lon)
        overlay_nws_daily(data, nws_daily)
    except Exception:
        log.warning("NWS daily overlay failed for %s", name)


# ── Scheduled Jobs ────────────────────────────────────────────────────

def _refresh_all_forecasts():
    """Fetch full forecast + AQI for all saved locations."""
    locations = _get_locations()
    log.info("Refreshing forecasts for %d locations", len(locations))
    for loc in locations:
        try:
            raw = fetch_weather(loc)
            aqi_raw = fetch_air_quality(loc)
            data = parse_weather(raw, aqi_raw, loc)
            _apply_nws_overlay(data, loc.lat, loc.lon, loc.name)
            data.alerts = fetch_alerts(loc.lat, loc.lon)
            data.forecast_text = fetch_forecast_text(loc.lat, loc.lon)
            data.sun_moon = fetch_sun_moon(loc.lat, loc.lon, loc.timezone)
            cache.set_forecast(loc.key, data)
            log.info("Forecast updated for %s", loc.name)
        except Exception:
            log.exception("Failed to refresh forecast for %s", loc.name)


def _daily_history_append():
    """Fetch yesterday's actual data and append to history."""
    locations = _get_locations()
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    for loc in locations:
        try:
            records = fetch_historical(loc, yesterday, yesterday)
            _append_history(loc.key, records)
        except Exception:
            log.exception("Failed to append history for %s", loc.name)


def _scheduled_5am():
    """5 AM job: refresh forecasts + append yesterday's history."""
    _refresh_all_forecasts()
    _daily_history_append()


def _scheduled_5pm():
    """5 PM job: refresh forecasts with updated afternoon models."""
    _refresh_all_forecasts()


# ── Routes ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/weather")
def api_weather():
    """Full weather for one location: forecast from cache + current from cache."""
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon required"}), 400

    key = f"{lat},{lon}"
    forecast = cache.get_forecast(key)
    current = cache.get_current(key)

    result = {}
    if forecast:
        d = forecast.to_dict()
        result = d
    if current:
        result["current"] = current

    if not result:
        return jsonify({"error": "No data available yet"}), 503

    return jsonify(result)


@app.route("/api/refresh-current", methods=["POST"])
def api_refresh_current():
    """Fetch fresh current conditions for ALL saved locations."""
    locations = _get_locations()
    results = {}
    for loc in locations:
        age = cache.current_age(loc.key)
        if age is not None and age < CURRENT_TTL:
            results[loc.key] = cache.get_current(loc.key)
            continue
        try:
            raw = fetch_current_only(loc)
            parsed = parse_current_with_daily(raw)
            try:
                nws_obs = fetch_nws_observation(loc.lat, loc.lon)
                overlay_nws_current_dict(parsed, nws_obs)
            except Exception:
                log.warning("NWS observation overlay failed for %s", loc.name)
            parsed["fetched_at"] = datetime.now().isoformat()
            cache.set_current(loc.key, parsed)
            results[loc.key] = parsed
            log.info("Current conditions refreshed for %s", loc.name)
        except Exception:
            log.exception("Failed to refresh current for %s", loc.name)
            existing = cache.get_current(loc.key)
            if existing:
                results[loc.key] = existing
    # Also refresh NWS forecast text if stale (separate 1-hr TTL)
    for loc in locations:
        ft_age = cache.forecast_text_age(loc.key)
        if ft_age is None or ft_age >= FORECAST_TEXT_TTL:
            try:
                forecast_text = fetch_forecast_text(loc.lat, loc.lon)
                if forecast_text:
                    cache.update_forecast_text(loc.key, forecast_text)
                    log.info("Forecast text refreshed for %s", loc.name)
            except Exception:
                log.exception("Failed to refresh forecast text for %s", loc.name)

    return jsonify(results)


@app.route("/api/locations/search")
def api_search():
    """Geocoding search for locations."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])

    cached = cache.get_geocode(q)
    if cached is not None:
        return jsonify(cached)

    try:
        results = search_locations(q)
        cache.set_geocode(q, results)
        return jsonify(results)
    except Exception:
        log.exception("Geocoding search failed for: %s", q)
        return jsonify([])


@app.route("/api/settings")
def api_settings():
    return jsonify(_load_settings())


@app.route("/api/settings/locations", methods=["POST"])
def api_save_locations():
    """Save location list. Triggers backfill for newly added locations."""
    data = request.get_json()
    if not data or "locations" not in data:
        return jsonify({"error": "locations required"}), 400

    settings = _load_settings()
    old_keys = {f"{l['lat']},{l['lon']}" for l in settings.get("locations", [])}
    settings["locations"] = data["locations"]
    _save_settings(settings)

    # Backfill history and fetch forecast for new locations
    for loc_dict in data["locations"]:
        loc = Location.from_dict(loc_dict)
        if loc.key not in old_keys:
            _backfill_history(loc)
            try:
                raw = fetch_weather(loc)
                aqi_raw = fetch_air_quality(loc)
                weather_data = parse_weather(raw, aqi_raw, loc)
                _apply_nws_overlay(weather_data, loc.lat, loc.lon, loc.name)
                cache.set_forecast(loc.key, weather_data)
            except Exception:
                log.exception("Failed to fetch forecast for new location %s", loc.name)

    return jsonify({"ok": True})


@app.route("/api/settings/units", methods=["POST"])
def api_save_units():
    data = request.get_json()
    if not data or "units" not in data:
        return jsonify({"error": "units required"}), 400
    settings = _load_settings()
    settings["units"] = data["units"]
    _save_settings(settings)
    return jsonify({"ok": True})


@app.route("/api/history")
def api_history():
    """Daily high/low/precip history for one location."""
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon required"}), 400
    key = f"{lat},{lon}"
    history = _load_history()
    return jsonify(history.get(key, []))


@app.route("/api/alerts")
def api_alerts():
    """Fetch active NWS weather alerts for a location."""
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon required"}), 400
    alerts = fetch_alerts(lat, lon)
    return jsonify(alerts)


@app.route("/api/comparison")
def api_comparison():
    """12-month weather comparison between two locations."""
    lat1 = request.args.get("lat1", type=float)
    lon1 = request.args.get("lon1", type=float)
    lat2 = request.args.get("lat2", type=float)
    lon2 = request.args.get("lon2", type=float)
    if None in (lat1, lon1, lat2, lon2):
        return jsonify({"error": "lat1, lon1, lat2, lon2 required"}), 400

    hidden_raw = request.args.get("hidden", "")
    hidden = set(h.strip() for h in hidden_raw.split(",") if h.strip()) if hidden_raw else None

    result = _build_comparison(lat1, lon1, lat2, lon2, hidden=hidden)
    if result is None:
        return jsonify({"error": "Locations not found in settings"}), 404
    return jsonify(result)


@app.route("/api/comparison/settings", methods=["POST"])
def api_comparison_settings():
    """Save comparison location preferences."""
    data = request.get_json()
    if not data or "loc1" not in data or "loc2" not in data:
        return jsonify({"error": "loc1 and loc2 required"}), 400
    settings = _load_settings()
    settings["comparison"] = {"loc1": data["loc1"], "loc2": data["loc2"]}
    _save_settings(settings)
    return jsonify({"ok": True})


@app.route("/api/settings/comparisons", methods=["POST"])
def api_save_comparisons():
    """Save comparisons list."""
    data = request.get_json()
    if not data or "comparisons" not in data:
        return jsonify({"error": "comparisons required"}), 400
    settings = _load_settings()
    settings["comparisons"] = data["comparisons"]
    _save_settings(settings)
    return jsonify({"ok": True})


@app.route("/api/settings/card-order", methods=["POST"])
def api_save_card_order():
    """Save dashboard card display order."""
    data = request.get_json()
    if not data or "card_order" not in data:
        return jsonify({"error": "card_order required"}), 400
    settings = _load_settings()
    settings["card_order"] = data["card_order"]
    _save_settings(settings)
    return jsonify({"ok": True})


# ── Startup ───────────────────────────────────────────────────────────

def _startup():
    """Run initial data fetches in a background thread so Flask starts immediately."""
    log.info("Running startup forecast fetch (background)...")
    _refresh_all_forecasts()
    # Backfill history for any locations missing it
    history = _load_history()
    for loc in _get_locations():
        if loc.key not in history or not history[loc.key]:
            log.info("Backfilling history for %s", loc.name)
            _backfill_history(loc)
    log.info("Startup fetch complete.")


if __name__ == "__main__":
    threading.Thread(target=_startup, daemon=True).start()

    scheduler = BackgroundScheduler()
    scheduler.add_job(_scheduled_5am, "cron", hour=5, minute=0)
    scheduler.add_job(_scheduled_5pm, "cron", hour=17, minute=0)
    scheduler.start()

    log.info("Starting Weather PWA on port 5051")
    app.run(host="0.0.0.0", port=5051, debug=False)
