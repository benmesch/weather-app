"""Dataclasses for weather data."""

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Location:
    name: str
    lat: float
    lon: float
    timezone: str
    region: str = ""
    country: str = ""

    @property
    def key(self):
        return f"{self.lat},{self.lon}"

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return cls(
            name=d["name"],
            lat=d["lat"],
            lon=d["lon"],
            timezone=d.get("timezone", "America/Chicago"),
            region=d.get("region", ""),
            country=d.get("country", ""),
        )


@dataclass
class CurrentWeather:
    temperature: float
    feels_like: float
    humidity: float
    wind_speed: float
    wind_direction: str
    precipitation: float
    weather_code: int
    weather_desc: str
    weather_icon: str
    is_day: bool
    uv_index: float
    visibility: Optional[float] = None
    cloud_cover: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class HourlyForecast:
    time: str
    temperature: float
    feels_like: float
    precipitation_prob: float
    precipitation: float
    weather_code: int
    weather_desc: str
    weather_icon: str
    wind_speed: float
    wind_direction: str
    humidity: float
    uv_index: float
    is_day: bool
    cloud_cover: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class DailyForecast:
    date: str
    temp_max: float
    temp_min: float
    weather_code: int
    weather_desc: str
    weather_icon: str
    precipitation_sum: float
    precipitation_prob_max: float
    sunrise: str
    sunset: str
    uv_index_max: float
    wind_speed_max: float

    def to_dict(self):
        return asdict(self)


@dataclass
class AirQuality:
    time: str
    us_aqi: Optional[int]
    aqi_label: str
    aqi_color: str
    pm2_5: Optional[float] = None
    pm10: Optional[float] = None
    ozone: Optional[float] = None
    no2: Optional[float] = None
    so2: Optional[float] = None
    co: Optional[float] = None

    def to_dict(self):
        return asdict(self)


@dataclass
class MinutelyPrecip:
    time: str
    precipitation: float
    rain: float
    snowfall: float

    def to_dict(self):
        return asdict(self)


@dataclass
class WeatherData:
    location: Location
    current: Optional[CurrentWeather] = None
    hourly: list = field(default_factory=list)
    daily: list = field(default_factory=list)
    minutely: list = field(default_factory=list)
    air_quality: list = field(default_factory=list)
    alerts: list = field(default_factory=list)
    forecast_text: list = field(default_factory=list)
    sun_moon: dict = field(default_factory=dict)
    fetched_at: str = ""

    def to_dict(self):
        return {
            "location": self.location.to_dict(),
            "current": self.current.to_dict() if self.current else None,
            "hourly": [h.to_dict() for h in self.hourly],
            "daily": [d.to_dict() for d in self.daily],
            "minutely": [m.to_dict() for m in self.minutely],
            "air_quality": [a.to_dict() for a in self.air_quality],
            "alerts": self.alerts,
            "forecast_text": self.forecast_text,
            "sun_moon": self.sun_moon,
            "fetched_at": self.fetched_at,
        }
