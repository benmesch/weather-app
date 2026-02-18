"""NWS forecast and observation client — overlays onto Open-Meteo base data."""

import logging
import re

import requests

from config import degree_to_compass

log = logging.getLogger(__name__)

_TIMEOUT = 10
_HEADERS = {
    "User-Agent": "BenWeather PWA (personal use)",
    "Accept": "application/geo+json",
}

# Permanent cache: (lat,lon) -> dict with forecast/forecastHourly/observationStations/station_id
_points_cache = {}


# ── Points resolution ─────────────────────────────────────────────

def _resolve_nws_points(lat, lon):
    """Resolve lat/lon to NWS API endpoints. Returns None for non-US locations."""
    cache_key = f"{lat},{lon}"
    if cache_key in _points_cache:
        return _points_cache[cache_key]

    try:
        url = f"https://api.weather.gov/points/{lat},{lon}"
        resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        if resp.status_code == 404:
            _points_cache[cache_key] = None
            return None
        resp.raise_for_status()
        props = resp.json().get("properties", {})
        result = {
            "forecast": props.get("forecast"),
            "forecastHourly": props.get("forecastHourly"),
            "observationStations": props.get("observationStations"),
        }
        _points_cache[cache_key] = result
        return result
    except Exception:
        log.exception("Failed to resolve NWS points for %s,%s", lat, lon)
        return None


def _find_nearest_station(stations_url):
    """Get the nearest observation station ID."""
    try:
        resp = requests.get(stations_url, headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        features = resp.json().get("features", [])
        if features:
            return features[0].get("properties", {}).get("stationIdentifier")
    except Exception:
        log.exception("Failed to fetch NWS stations from %s", stations_url)
    return None


# ── Fetch functions ───────────────────────────────────────────────

def fetch_nws_observation(lat, lon):
    """Fetch latest observation from nearest NWS station.

    Returns dict with temp (°F), humidity, wind (mph), visibility (m),
    description, emoji icon — or None.
    """
    points = _resolve_nws_points(lat, lon)
    if not points or not points.get("observationStations"):
        return None

    # Resolve and cache station ID
    if "station_id" not in points:
        station_id = _find_nearest_station(points["observationStations"])
        if not station_id:
            return None
        points["station_id"] = station_id

    station_id = points["station_id"]

    try:
        url = f"https://api.weather.gov/stations/{station_id}/observations/latest"
        resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        props = resp.json().get("properties", {})
    except Exception:
        log.exception("Failed to fetch NWS observation for station %s", station_id)
        return None

    temp_c = _nws_value(props.get("temperature"))
    humidity = _nws_value(props.get("relativeHumidity"))
    wind_kmh = _nws_value(props.get("windSpeed"))
    wind_deg = _nws_value(props.get("windDirection"))
    vis_m = _nws_value(props.get("visibility"))
    desc = props.get("textDescription", "")

    # Determine day/night from NWS icon URL
    icon_url = props.get("icon", "") or ""
    is_day = "/day/" in icon_url if icon_url else True

    result = {}
    if temp_c is not None:
        result["temperature"] = round(temp_c * 9 / 5 + 32, 1)
    if humidity is not None:
        result["humidity"] = round(humidity)
    if wind_kmh is not None:
        result["wind_speed"] = round(wind_kmh * 0.621371, 1)
    if wind_deg is not None:
        result["wind_direction"] = degree_to_compass(wind_deg)
    if vis_m is not None:
        result["visibility"] = round(vis_m)
    if desc:
        result["weather_desc"] = desc
        result["weather_icon"] = _nws_desc_to_icon(desc, is_day)
        result["is_day"] = is_day

    return result if result else None


def fetch_nws_hourly(lat, lon):
    """Fetch NWS hourly forecast.

    Returns list of dicts with time_key, temperature (°F), wind_speed (mph),
    wind_direction (compass), precip_prob, humidity, desc, icon, is_day.
    """
    points = _resolve_nws_points(lat, lon)
    if not points or not points.get("forecastHourly"):
        return None

    try:
        resp = requests.get(points["forecastHourly"], headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.exception("Failed to fetch NWS hourly forecast for %s,%s", lat, lon)
        return None

    periods = data.get("properties", {}).get("periods", [])
    hourly = []
    for p in periods:
        start = p.get("startTime", "")
        is_day = p.get("isDaytime", True)
        short = p.get("shortForecast", "")
        precip_val = (p.get("probabilityOfPrecipitation") or {}).get("value")
        humidity_val = (p.get("relativeHumidity") or {}).get("value")
        hourly.append({
            "time_key": _hour_key(start),
            "temperature": p.get("temperature"),
            "wind_speed": _parse_nws_wind(p.get("windSpeed", "")),
            "wind_direction": p.get("windDirection", ""),
            "precipitation_prob": precip_val if precip_val is not None else 0,
            "humidity": humidity_val,
            "weather_desc": short,
            "weather_icon": _nws_desc_to_icon(short, is_day),
            "is_day": is_day,
        })
    return hourly


def fetch_nws_daily(lat, lon):
    """Fetch NWS daily forecast — pair day/night periods by date.

    Returns list of dicts with date, temp_max, temp_min, desc, icon,
    wind_speed_max, precipitation_prob_max.
    """
    points = _resolve_nws_points(lat, lon)
    if not points or not points.get("forecast"):
        return None

    try:
        resp = requests.get(points["forecast"], headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.exception("Failed to fetch NWS daily forecast for %s,%s", lat, lon)
        return None

    periods = data.get("properties", {}).get("periods", [])

    # Group periods by date
    by_date = {}
    for p in periods:
        start = p.get("startTime", "")
        date = start[:10] if len(start) >= 10 else ""
        if not date:
            continue
        if date not in by_date:
            by_date[date] = {}
        if p.get("isDaytime"):
            by_date[date]["day"] = p
        else:
            by_date[date]["night"] = p

    daily = []
    for date in sorted(by_date):
        entry = by_date[date]
        day_p = entry.get("day")
        night_p = entry.get("night")

        result = {"date": date}
        if day_p:
            result["temp_max"] = day_p.get("temperature")
            result["weather_desc"] = day_p.get("shortForecast", "")
            result["weather_icon"] = _nws_desc_to_icon(
                day_p.get("shortForecast", ""), True
            )
            result["wind_speed_max"] = _parse_nws_wind(
                day_p.get("windSpeed", "")
            )
            prob = (day_p.get("probabilityOfPrecipitation") or {}).get("value")
            if prob is not None:
                result["precipitation_prob_max"] = prob
        if night_p:
            result["temp_min"] = night_p.get("temperature")
            # If no daytime period (first day is night-only), use night desc
            if "weather_desc" not in result:
                result["weather_desc"] = night_p.get("shortForecast", "")
                result["weather_icon"] = _nws_desc_to_icon(
                    night_p.get("shortForecast", ""), False
                )

        daily.append(result)

    return daily


# ── Helpers ───────────────────────────────────────────────────────

def _nws_value(measurement):
    """Extract numeric value from NWS measurement dict {unitCode, value}."""
    if measurement is None:
        return None
    if isinstance(measurement, dict):
        return measurement.get("value")
    return measurement


def _hour_key(ts):
    """Extract 'YYYY-MM-DDTHH' from an ISO timestamp for matching.

    Works with both Open-Meteo local ('2026-02-15T14:00') and
    NWS offset ('2026-02-15T14:00:00-06:00') formats.
    """
    return ts[:13] if ts else ""


def _parse_nws_wind(wind_str):
    """Parse NWS wind speed string like '10 mph' or '10 to 15 mph'.

    Returns the maximum value as float, or 0.
    """
    if not wind_str:
        return 0.0
    nums = re.findall(r"(\d+)", wind_str)
    if nums:
        return float(nums[-1])
    return 0.0


def _nws_desc_to_icon(desc, is_day):
    """Map NWS short forecast description to emoji icon."""
    if not desc:
        return "\u2753"
    d = desc.lower()

    if "thunder" in d:
        return "\u26c8\ufe0f"
    if "snow" in d or "blizzard" in d or "flurr" in d:
        return "\ud83c\udf28\ufe0f"
    if "ice" in d or "sleet" in d or "freezing" in d:
        return "\ud83c\udf28\ufe0f"
    if "rain" in d or "shower" in d or "drizzle" in d:
        if "slight" in d or "light" in d or "chance" in d:
            return "\ud83c\udf26\ufe0f" if is_day else "\ud83c\udf27\ufe0f"
        return "\ud83c\udf27\ufe0f"
    if "fog" in d or "mist" in d or "haze" in d:
        return "\ud83c\udf2b\ufe0f"
    if "overcast" in d:
        return "\u2601\ufe0f"
    if "mostly cloudy" in d or "considerable" in d:
        return "\u2601\ufe0f"
    if "partly" in d:
        return "\u26c5" if is_day else "\u2601\ufe0f"
    if "mostly clear" in d or "mostly sunny" in d:
        return "\ud83c\udf24\ufe0f" if is_day else "\ud83c\udf11"
    if "clear" in d or "sunny" in d:
        return "\u2600\ufe0f" if is_day else "\ud83c\udf11"

    return "\u2600\ufe0f" if is_day else "\ud83c\udf11"


# ── Overlay functions ─────────────────────────────────────────────

def overlay_nws_current(weather_data, nws_obs):
    """Overlay NWS observation onto WeatherData.current (in-place).

    Overwrites: temp, humidity, wind, visibility, desc, icon, is_day.
    Preserves: feels_like, uv_index, cloud_cover, precipitation, weather_code.
    """
    if not nws_obs or not weather_data.current:
        return
    cur = weather_data.current
    if "temperature" in nws_obs:
        cur.temperature = nws_obs["temperature"]
    if "humidity" in nws_obs:
        cur.humidity = nws_obs["humidity"]
    if "wind_speed" in nws_obs:
        cur.wind_speed = nws_obs["wind_speed"]
    if "wind_direction" in nws_obs:
        cur.wind_direction = nws_obs["wind_direction"]
    if "visibility" in nws_obs:
        cur.visibility = nws_obs["visibility"]
    if "weather_desc" in nws_obs:
        cur.weather_desc = nws_obs["weather_desc"]
    if "weather_icon" in nws_obs:
        cur.weather_icon = nws_obs["weather_icon"]
    if "is_day" in nws_obs:
        cur.is_day = nws_obs["is_day"]


def overlay_nws_hourly(weather_data, nws_hourly):
    """Overlay NWS hourly forecast onto WeatherData.hourly (in-place).

    Overwrites: temp, wind, precip_prob, humidity, desc, icon, is_day.
    Preserves: feels_like, uv_index, cloud_cover, precipitation, weather_code.
    """
    if not nws_hourly or not weather_data.hourly:
        return

    nws_by_hour = {}
    for h in nws_hourly:
        key = h.get("time_key", "")
        if key:
            nws_by_hour[key] = h

    for entry in weather_data.hourly:
        key = _hour_key(entry.time)
        nws = nws_by_hour.get(key)
        if not nws:
            continue
        if nws.get("temperature") is not None:
            entry.temperature = nws["temperature"]
        if nws.get("wind_speed") is not None:
            entry.wind_speed = nws["wind_speed"]
        if nws.get("wind_direction"):
            entry.wind_direction = nws["wind_direction"]
        if nws.get("precipitation_prob") is not None:
            entry.precipitation_prob = nws["precipitation_prob"]
        if nws.get("humidity") is not None:
            entry.humidity = nws["humidity"]
        if nws.get("weather_desc"):
            entry.weather_desc = nws["weather_desc"]
        if nws.get("weather_icon"):
            entry.weather_icon = nws["weather_icon"]
        if "is_day" in nws:
            entry.is_day = nws["is_day"]


def overlay_nws_daily(weather_data, nws_daily):
    """Overlay NWS daily forecast onto WeatherData.daily (in-place).

    Overwrites: high/low, desc, icon, wind, precip_prob.
    Preserves: sunrise, sunset, uv_index_max, precipitation_sum, weather_code.
    """
    if not nws_daily or not weather_data.daily:
        return

    nws_by_date = {}
    for d in nws_daily:
        date = d.get("date", "")
        if date:
            nws_by_date[date] = d

    for entry in weather_data.daily:
        nws = nws_by_date.get(entry.date)
        if not nws:
            continue
        if nws.get("temp_max") is not None:
            entry.temp_max = nws["temp_max"]
        if nws.get("temp_min") is not None:
            entry.temp_min = nws["temp_min"]
        if nws.get("weather_desc"):
            entry.weather_desc = nws["weather_desc"]
        if nws.get("weather_icon"):
            entry.weather_icon = nws["weather_icon"]
        if nws.get("wind_speed_max") is not None:
            entry.wind_speed_max = nws["wind_speed_max"]
        if nws.get("precipitation_prob_max") is not None:
            entry.precipitation_prob_max = nws["precipitation_prob_max"]


def overlay_nws_current_dict(current_dict, nws_obs):
    """Overlay NWS observation onto a current-conditions dict (on-demand refresh path)."""
    if not nws_obs or not current_dict:
        return
    for key in ("temperature", "humidity", "wind_speed", "wind_direction",
                "visibility", "weather_desc", "weather_icon", "is_day"):
        if key in nws_obs:
            current_dict[key] = nws_obs[key]
