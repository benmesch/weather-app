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
    fetch_historical,
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
