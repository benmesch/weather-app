"""USNO (US Naval Observatory) API client for sun/moon data."""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

log = logging.getLogger(__name__)

_TIMEOUT = 10


def fetch_sun_moon(lat, lon, timezone_name=None):
    """Fetch sun and moon rise/set/phase data from USNO API.

    Returns dict with sun and moon data, or {} on error.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    url = "https://aa.usno.navy.mil/api/rstt/oneday"
    params = {
        "date": today,
        "coords": f"{lat},{lon}",
    }
    # Compute UTC offset from timezone name
    if timezone_name:
        try:
            tz = ZoneInfo(timezone_name)
            offset_sec = datetime.now(tz).utcoffset().total_seconds()
            params["tz"] = offset_sec / 3600
        except Exception:
            pass

    try:
        resp = requests.get(url, params=params, timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.exception("Failed to fetch USNO data for %s,%s", lat, lon)
        return {}

    props = data.get("properties", {}).get("data", {})

    # Parse sun data
    sun = {}
    for entry in props.get("sundata", []):
        phen = entry.get("phen", "")
        time = entry.get("time", "")
        if phen == "Rise":
            sun["rise"] = time
        elif phen == "Set":
            sun["set"] = time
        elif phen == "Begin Civil Twilight":
            sun["dawn"] = time
        elif phen == "End Civil Twilight":
            sun["dusk"] = time

    # Parse moon data
    moon = {}
    for entry in props.get("moondata", []):
        phen = entry.get("phen", "")
        time = entry.get("time", "")
        if phen == "Rise":
            moon["rise"] = time
        elif phen == "Set":
            moon["set"] = time

    moon["phase"] = props.get("curphase", "")
    moon["illumination"] = props.get("fracillum", "")

    # Closest phase info
    closest = props.get("closestphase", {})
    if closest:
        moon["next_phase"] = closest.get("phase", "")
        moon["next_phase_date"] = f"{closest.get('year', '')}-{closest.get('month', ''):02d}-{closest.get('day', ''):02d}"

    return {"sun": sun, "moon": moon}
