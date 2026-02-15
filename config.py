"""Constants and lookup tables for weather app."""

# Cache TTLs (seconds)
CURRENT_TTL = 600       # 10 min for on-demand current weather
GEOCODE_TTL = 86400     # 24 hr for geocoding results

# Default location
DEFAULT_LOCATION = {
    "name": "Houston",
    "lat": 29.76,
    "lon": -95.37,
    "timezone": "America/Chicago",
    "region": "Texas",
    "country": "United States",
}

# WMO Weather interpretation codes
# https://open-meteo.com/en/docs
WMO_CODES = {
    0:  {"description": "Clear sky",            "icon_day": "\u2600\ufe0f",  "icon_night": "\ud83c\udf11"},
    1:  {"description": "Mainly clear",         "icon_day": "\ud83c\udf24\ufe0f",  "icon_night": "\ud83c\udf11"},
    2:  {"description": "Partly cloudy",        "icon_day": "\u26c5",       "icon_night": "\u2601\ufe0f"},
    3:  {"description": "Overcast",             "icon_day": "\u2601\ufe0f",  "icon_night": "\u2601\ufe0f"},
    45: {"description": "Fog",                  "icon_day": "\ud83c\udf2b\ufe0f",  "icon_night": "\ud83c\udf2b\ufe0f"},
    48: {"description": "Depositing rime fog",  "icon_day": "\ud83c\udf2b\ufe0f",  "icon_night": "\ud83c\udf2b\ufe0f"},
    51: {"description": "Light drizzle",        "icon_day": "\ud83c\udf26\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    53: {"description": "Moderate drizzle",     "icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    55: {"description": "Dense drizzle",        "icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    56: {"description": "Light freezing drizzle","icon_day": "\ud83c\udf27\ufe0f", "icon_night": "\ud83c\udf27\ufe0f"},
    57: {"description": "Dense freezing drizzle","icon_day": "\ud83c\udf27\ufe0f", "icon_night": "\ud83c\udf27\ufe0f"},
    61: {"description": "Slight rain",          "icon_day": "\ud83c\udf26\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    63: {"description": "Moderate rain",        "icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    65: {"description": "Heavy rain",           "icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    66: {"description": "Light freezing rain",  "icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    67: {"description": "Heavy freezing rain",  "icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    71: {"description": "Slight snow",          "icon_day": "\ud83c\udf28\ufe0f",  "icon_night": "\ud83c\udf28\ufe0f"},
    73: {"description": "Moderate snow",        "icon_day": "\ud83c\udf28\ufe0f",  "icon_night": "\ud83c\udf28\ufe0f"},
    75: {"description": "Heavy snow",           "icon_day": "\ud83c\udf28\ufe0f",  "icon_night": "\ud83c\udf28\ufe0f"},
    77: {"description": "Snow grains",          "icon_day": "\ud83c\udf28\ufe0f",  "icon_night": "\ud83c\udf28\ufe0f"},
    80: {"description": "Slight rain showers",  "icon_day": "\ud83c\udf26\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    81: {"description": "Moderate rain showers","icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    82: {"description": "Violent rain showers", "icon_day": "\ud83c\udf27\ufe0f",  "icon_night": "\ud83c\udf27\ufe0f"},
    85: {"description": "Slight snow showers",  "icon_day": "\ud83c\udf28\ufe0f",  "icon_night": "\ud83c\udf28\ufe0f"},
    86: {"description": "Heavy snow showers",   "icon_day": "\ud83c\udf28\ufe0f",  "icon_night": "\ud83c\udf28\ufe0f"},
    95: {"description": "Thunderstorm",         "icon_day": "\u26c8\ufe0f",  "icon_night": "\u26c8\ufe0f"},
    96: {"description": "Thunderstorm with slight hail", "icon_day": "\u26c8\ufe0f", "icon_night": "\u26c8\ufe0f"},
    99: {"description": "Thunderstorm with heavy hail",  "icon_day": "\u26c8\ufe0f", "icon_night": "\u26c8\ufe0f"},
}

# AQI levels: (max_value, label, css_color)
AQI_LEVELS = [
    (50,  "Good",                        "#4caf50"),
    (100, "Moderate",                     "#ffeb3b"),
    (150, "Unhealthy for Sensitive Groups","#ff9800"),
    (200, "Unhealthy",                    "#f44336"),
    (300, "Very Unhealthy",               "#9c27b0"),
    (500, "Hazardous",                    "#800000"),
]

# 16-point compass directions
WIND_DIRECTIONS = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]


def degree_to_compass(deg):
    """Convert wind direction in degrees to compass string."""
    if deg is None:
        return "N/A"
    idx = round(deg / 22.5) % 16
    return WIND_DIRECTIONS[idx]


def get_aqi_info(aqi_value):
    """Return (label, color) for a given AQI value."""
    if aqi_value is None:
        return ("Unknown", "#999")
    for max_val, label, color in AQI_LEVELS:
        if aqi_value <= max_val:
            return (label, color)
    return ("Hazardous", "#800000")


def get_wmo_info(code, is_day=True):
    """Return (description, icon) for a WMO weather code."""
    info = WMO_CODES.get(code, {"description": "Unknown", "icon_day": "\u2753", "icon_night": "\u2753"})
    icon = info["icon_day"] if is_day else info["icon_night"]
    return (info["description"], icon)
