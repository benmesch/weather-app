"""Open-Meteo API client for weather, air quality, geocoding, and historical data."""

import logging
from datetime import datetime, timedelta

import requests

from config import get_wmo_info, degree_to_compass, get_aqi_info
from models import (
    Location, CurrentWeather, HourlyForecast, DailyForecast,
    AirQuality, MinutelyPrecip, WeatherData,
)

log = logging.getLogger(__name__)

_TIMEOUT = 15  # seconds


def fetch_weather(location):
    """Fetch forecast + current conditions from Open-Meteo."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": location.lat,
        "longitude": location.lon,
        "timezone": location.timezone,
        "temperature_unit": "fahrenheit",
        "windspeed_unit": "mph",
        "precipitation_unit": "inch",
        "forecast_days": 14,
        "forecast_hours": 72,
        "current": ",".join([
            "temperature_2m", "apparent_temperature", "relative_humidity_2m",
            "wind_speed_10m", "wind_direction_10m", "precipitation",
            "weather_code", "is_day", "uv_index", "visibility", "cloud_cover",
        ]),
        "hourly": ",".join([
            "temperature_2m", "apparent_temperature", "precipitation_probability",
            "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m",
            "relative_humidity_2m", "uv_index", "is_day", "cloud_cover",
        ]),
        "daily": ",".join([
            "temperature_2m_max", "temperature_2m_min", "weather_code",
            "precipitation_sum", "precipitation_probability_max",
            "sunrise", "sunset", "uv_index_max", "wind_speed_10m_max",
        ]),
        "minutely_15": ",".join([
            "precipitation", "rain", "snowfall",
        ]),
    }
    resp = requests.get(url, params=params, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_current_only(location):
    """Fetch only current conditions (lightweight call for on-demand refresh)."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": location.lat,
        "longitude": location.lon,
        "timezone": location.timezone,
        "temperature_unit": "fahrenheit",
        "windspeed_unit": "mph",
        "precipitation_unit": "inch",
        "current": ",".join([
            "temperature_2m", "apparent_temperature", "relative_humidity_2m",
            "wind_speed_10m", "wind_direction_10m", "precipitation",
            "weather_code", "is_day", "uv_index", "visibility", "cloud_cover",
        ]),
        "daily": "temperature_2m_max,temperature_2m_min",
        "forecast_days": 1,
    }
    resp = requests.get(url, params=params, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_air_quality(location):
    """Fetch air quality data from Open-Meteo."""
    url = "https://air-quality-api.open-meteo.com/v1/air-quality"
    params = {
        "latitude": location.lat,
        "longitude": location.lon,
        "hourly": ",".join([
            "us_aqi", "pm10", "pm2_5", "ozone",
            "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide",
        ]),
    }
    resp = requests.get(url, params=params, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def search_locations(query):
    """Search for locations via Open-Meteo geocoding API."""
    url = "https://geocoding-api.open-meteo.com/v1/search"
    params = {"name": query, "count": 5, "language": "en"}
    resp = requests.get(url, params=params, timeout=_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    results = []
    for r in data.get("results", []):
        results.append({
            "name": r.get("name", ""),
            "lat": r["latitude"],
            "lon": r["longitude"],
            "timezone": r.get("timezone", "UTC"),
            "region": r.get("admin1", ""),
            "country": r.get("country", ""),
        })
    return results


def fetch_comparison_historical(location, start_date, end_date):
    """Fetch expanded historical daily data for weather comparison."""
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": location.lat,
        "longitude": location.lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": ",".join([
            "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
            "sunshine_duration", "snowfall_sum", "weather_code", "sunrise", "sunset",
            "apparent_temperature_max",
        ]),
        "temperature_unit": "fahrenheit",
        "precipitation_unit": "inch",
        "timezone": location.timezone,
    }
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    daily = data.get("daily", {})
    dates = daily.get("time", [])
    highs = daily.get("temperature_2m_max", [])
    lows = daily.get("temperature_2m_min", [])
    precips = daily.get("precipitation_sum", [])
    sunshine = daily.get("sunshine_duration", [])
    snowfall = daily.get("snowfall_sum", [])
    codes = daily.get("weather_code", [])
    sunrises = daily.get("sunrise", [])
    sunsets = daily.get("sunset", [])
    apparent_highs = daily.get("apparent_temperature_max", [])
    results = []
    for i, d in enumerate(dates):
        results.append({
            "date": d,
            "high": highs[i] if i < len(highs) else None,
            "low": lows[i] if i < len(lows) else None,
            "precip": precips[i] if i < len(precips) else None,
            "sunshine_sec": sunshine[i] if i < len(sunshine) else None,
            "snowfall": snowfall[i] if i < len(snowfall) else None,
            "weather_code": codes[i] if i < len(codes) else None,
            "sunrise": sunrises[i] if i < len(sunrises) else None,
            "sunset": sunsets[i] if i < len(sunsets) else None,
            "apparent_high": apparent_highs[i] if i < len(apparent_highs) else None,
        })
    return results


def fetch_historical(location, start_date, end_date):
    """Fetch historical daily data from Open-Meteo archive API."""
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": location.lat,
        "longitude": location.lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "temperature_unit": "fahrenheit",
        "precipitation_unit": "inch",
        "timezone": location.timezone,
    }
    resp = requests.get(url, params=params, timeout=_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    daily = data.get("daily", {})
    dates = daily.get("time", [])
    highs = daily.get("temperature_2m_max", [])
    lows = daily.get("temperature_2m_min", [])
    precips = daily.get("precipitation_sum", [])
    results = []
    for i, d in enumerate(dates):
        results.append({
            "date": d,
            "high": highs[i] if i < len(highs) else None,
            "low": lows[i] if i < len(lows) else None,
            "precip": precips[i] if i < len(precips) else None,
        })
    return results


def parse_current(raw):
    """Parse current conditions from Open-Meteo response."""
    c = raw.get("current", {})
    if not c:
        return None
    code = c.get("weather_code", 0)
    is_day = bool(c.get("is_day", 1))
    desc, icon = get_wmo_info(code, is_day)
    return CurrentWeather(
        temperature=c.get("temperature_2m", 0),
        feels_like=c.get("apparent_temperature", 0),
        humidity=c.get("relative_humidity_2m", 0),
        wind_speed=c.get("wind_speed_10m", 0),
        wind_direction=degree_to_compass(c.get("wind_direction_10m")),
        precipitation=c.get("precipitation", 0),
        weather_code=code,
        weather_desc=desc,
        weather_icon=icon,
        is_day=is_day,
        uv_index=c.get("uv_index", 0),
        visibility=c.get("visibility"),
        cloud_cover=c.get("cloud_cover"),
    )


def parse_current_with_daily(raw):
    """Parse current conditions + today's high/low from lightweight current call."""
    current = parse_current(raw)
    daily = raw.get("daily", {})
    today_high = None
    today_low = None
    if daily:
        highs = daily.get("temperature_2m_max", [])
        lows = daily.get("temperature_2m_min", [])
        if highs:
            today_high = highs[0]
        if lows:
            today_low = lows[0]
    result = current.to_dict() if current else {}
    result["today_high"] = today_high
    result["today_low"] = today_low
    return result


def parse_weather(raw, aqi_raw, location):
    """Parse full weather + AQI response into WeatherData."""
    now = datetime.now().isoformat()

    # Current
    current = parse_current(raw)

    # Hourly
    hourly_data = raw.get("hourly", {})
    times = hourly_data.get("time", [])
    hourly = []
    for i, t in enumerate(times):
        code = hourly_data.get("weather_code", [])[i] if i < len(hourly_data.get("weather_code", [])) else 0
        is_day = bool(hourly_data.get("is_day", [])[i]) if i < len(hourly_data.get("is_day", [])) else True
        desc, icon = get_wmo_info(code, is_day)
        hourly.append(HourlyForecast(
            time=t,
            temperature=_safe_get(hourly_data, "temperature_2m", i, 0),
            feels_like=_safe_get(hourly_data, "apparent_temperature", i, 0),
            precipitation_prob=_safe_get(hourly_data, "precipitation_probability", i, 0),
            precipitation=_safe_get(hourly_data, "precipitation", i, 0),
            weather_code=code,
            weather_desc=desc,
            weather_icon=icon,
            wind_speed=_safe_get(hourly_data, "wind_speed_10m", i, 0),
            wind_direction=degree_to_compass(_safe_get(hourly_data, "wind_direction_10m", i, None)),
            humidity=_safe_get(hourly_data, "relative_humidity_2m", i, 0),
            uv_index=_safe_get(hourly_data, "uv_index", i, 0),
            is_day=is_day,
            cloud_cover=_safe_get(hourly_data, "cloud_cover", i, None),
        ))

    # Daily
    daily_data = raw.get("daily", {})
    dates = daily_data.get("time", [])
    daily = []
    for i, d in enumerate(dates):
        code = _safe_get(daily_data, "weather_code", i, 0)
        desc, icon = get_wmo_info(code, True)
        daily.append(DailyForecast(
            date=d,
            temp_max=_safe_get(daily_data, "temperature_2m_max", i, 0),
            temp_min=_safe_get(daily_data, "temperature_2m_min", i, 0),
            weather_code=code,
            weather_desc=desc,
            weather_icon=icon,
            precipitation_sum=_safe_get(daily_data, "precipitation_sum", i, 0),
            precipitation_prob_max=_safe_get(daily_data, "precipitation_probability_max", i, 0),
            sunrise=_safe_get(daily_data, "sunrise", i, ""),
            sunset=_safe_get(daily_data, "sunset", i, ""),
            uv_index_max=_safe_get(daily_data, "uv_index_max", i, 0),
            wind_speed_max=_safe_get(daily_data, "wind_speed_10m_max", i, 0),
        ))

    # Minutely (15-min intervals)
    min_data = raw.get("minutely_15", {})
    min_times = min_data.get("time", [])
    minutely = []
    for i, t in enumerate(min_times):
        minutely.append(MinutelyPrecip(
            time=t,
            precipitation=_safe_get(min_data, "precipitation", i, 0),
            rain=_safe_get(min_data, "rain", i, 0),
            snowfall=_safe_get(min_data, "snowfall", i, 0),
        ))

    # Air quality
    aqi_hourly = aqi_raw.get("hourly", {}) if aqi_raw else {}
    aqi_times = aqi_hourly.get("time", [])
    air_quality = []
    for i, t in enumerate(aqi_times):
        aqi_val = _safe_get(aqi_hourly, "us_aqi", i, None)
        label, color = get_aqi_info(aqi_val)
        air_quality.append(AirQuality(
            time=t,
            us_aqi=aqi_val,
            aqi_label=label,
            aqi_color=color,
            pm2_5=_safe_get(aqi_hourly, "pm2_5", i, None),
            pm10=_safe_get(aqi_hourly, "pm10", i, None),
            ozone=_safe_get(aqi_hourly, "ozone", i, None),
            no2=_safe_get(aqi_hourly, "nitrogen_dioxide", i, None),
            so2=_safe_get(aqi_hourly, "sulphur_dioxide", i, None),
            co=_safe_get(aqi_hourly, "carbon_monoxide", i, None),
        ))

    return WeatherData(
        location=location,
        current=current,
        hourly=hourly,
        daily=daily,
        minutely=minutely,
        air_quality=air_quality,
        fetched_at=now,
    )


def _safe_get(data, key, index, default):
    """Safely get a value from an Open-Meteo array response."""
    arr = data.get(key, [])
    if index < len(arr) and arr[index] is not None:
        return arr[index]
    return default
