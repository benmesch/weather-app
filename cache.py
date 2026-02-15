"""Thread-safe in-memory cache for weather data."""

import threading
from datetime import datetime

from config import CURRENT_TTL, GEOCODE_TTL


class WeatherCache:
    def __init__(self):
        self._lock = threading.Lock()
        # Full forecast data (refreshed by scheduler)
        self._forecast = {}       # location_key -> WeatherData
        self._forecast_ts = {}    # location_key -> datetime
        # Current conditions (on-demand, 10-min TTL)
        self._current = {}        # location_key -> dict
        self._current_ts = {}     # location_key -> datetime
        # Geocoding results
        self._geocode = {}        # query -> list[dict]
        self._geocode_ts = {}     # query -> datetime

    def get_forecast(self, location_key):
        with self._lock:
            return self._forecast.get(location_key)

    def set_forecast(self, location_key, data):
        with self._lock:
            self._forecast[location_key] = data
            self._forecast_ts[location_key] = datetime.now()

    def get_current(self, location_key):
        with self._lock:
            ts = self._current_ts.get(location_key)
            if ts and (datetime.now() - ts).total_seconds() < CURRENT_TTL:
                return self._current.get(location_key)
            return None

    def set_current(self, location_key, data):
        with self._lock:
            self._current[location_key] = data
            self._current_ts[location_key] = datetime.now()

    def current_age(self, location_key):
        """Return seconds since last current fetch, or None if no data."""
        with self._lock:
            ts = self._current_ts.get(location_key)
            if ts:
                return (datetime.now() - ts).total_seconds()
            return None

    def get_geocode(self, query):
        with self._lock:
            ts = self._geocode_ts.get(query)
            if ts and (datetime.now() - ts).total_seconds() < GEOCODE_TTL:
                return self._geocode.get(query)
            return None

    def set_geocode(self, query, results):
        with self._lock:
            self._geocode[query] = results
            self._geocode_ts[query] = datetime.now()

    def clear_forecast(self, location_key=None):
        with self._lock:
            if location_key:
                self._forecast.pop(location_key, None)
                self._forecast_ts.pop(location_key, None)
            else:
                self._forecast.clear()
                self._forecast_ts.clear()

    def clear_current(self, location_key=None):
        with self._lock:
            if location_key:
                self._current.pop(location_key, None)
                self._current_ts.pop(location_key, None)
            else:
                self._current.clear()
                self._current_ts.clear()
