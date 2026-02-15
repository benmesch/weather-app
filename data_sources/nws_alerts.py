"""NWS (National Weather Service) alerts and forecast text client."""

import logging

import requests

log = logging.getLogger(__name__)

_TIMEOUT = 10
_HEADERS = {
    "User-Agent": "BenWeather PWA (personal use)",
    "Accept": "application/geo+json",
}

# Cache the points → forecast URL mapping (doesn't change)
_forecast_url_cache = {}


def fetch_alerts(lat, lon):
    """Fetch active weather alerts for a location from the NWS API.

    Returns a list of alert dicts. Returns [] for non-US locations (404)
    or on any error.
    """
    url = f"https://api.weather.gov/alerts/active?point={lat},{lon}"
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.exception("Failed to fetch NWS alerts for %s,%s", lat, lon)
        return []

    alerts = []
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        alerts.append({
            "event": props.get("event", ""),
            "severity": props.get("severity", ""),
            "headline": props.get("headline", ""),
            "description": props.get("description", ""),
            "instruction": props.get("instruction", ""),
            "onset": props.get("onset", ""),
            "expires": props.get("expires", ""),
        })
    return alerts


def fetch_forecast_text(lat, lon):
    """Fetch NWS text forecast periods for a location.

    Two-step API: /points → forecast URL, then fetch forecast.
    Returns list of dicts with name, shortForecast, detailedForecast.
    Returns [] for non-US locations or on error.
    """
    cache_key = f"{lat},{lon}"

    # Step 1: Get forecast URL from points endpoint (cached)
    if cache_key not in _forecast_url_cache:
        try:
            points_url = f"https://api.weather.gov/points/{lat},{lon}"
            resp = requests.get(points_url, headers=_HEADERS, timeout=_TIMEOUT)
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            forecast_url = resp.json().get("properties", {}).get("forecast")
            if not forecast_url:
                return []
            _forecast_url_cache[cache_key] = forecast_url
        except Exception:
            log.exception("Failed to get NWS points for %s,%s", lat, lon)
            return []

    # Step 2: Fetch the actual forecast
    try:
        resp = requests.get(_forecast_url_cache[cache_key], headers=_HEADERS, timeout=_TIMEOUT)
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.exception("Failed to fetch NWS forecast for %s,%s", lat, lon)
        return []

    periods = []
    for p in data.get("properties", {}).get("periods", []):
        periods.append({
            "name": p.get("name", ""),
            "short": p.get("shortForecast", ""),
            "detailed": p.get("detailedForecast", ""),
            "isDaytime": p.get("isDaytime", True),
        })
    return periods
