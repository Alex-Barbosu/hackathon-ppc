import { useQuery } from "@tanstack/react-query";
import { FLIGHT } from "./findings";

export interface SiteWeather { tempC: number; windMs: number; gustMs: number; humidity: number; sky: string; flyable: boolean }

// WMO weather codes from Open-Meteo, reduced to the words a field team uses.
function sky(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Thunderstorm";
}

interface OpenMeteo { current: { temperature_2m: number; wind_speed_10m: number; wind_gusts_10m: number; relative_humidity_2m: number; weather_code: number } }

/** Live conditions at the inspected line from Open-Meteo (free, no key), refreshed every 10 minutes. */
export function useSiteWeather() {
  return useQuery({
    queryKey: ["site-weather", FLIGHT.site.lat, FLIGHT.site.lon],
    refetchInterval: 600_000,
    queryFn: async (): Promise<SiteWeather> => {
      const q = new URLSearchParams({ latitude: String(FLIGHT.site.lat), longitude: String(FLIGHT.site.lon), current: "temperature_2m,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,weather_code", wind_speed_unit: "ms", timezone: "Europe/Bucharest" });
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
      if (!res.ok) throw new Error(`weather ${res.status}`);
      const c = ((await res.json()) as OpenMeteo).current;
      const s = sky(c.weather_code);
      // Typical inspection-drone limits: sustained wind under 10 m/s, gusts under 12 m/s, no precipitation.
      const flyable = c.wind_speed_10m < 10 && c.wind_gusts_10m < 12 && !["Rain", "Snow", "Showers", "Thunderstorm"].includes(s);
      return { tempC: c.temperature_2m, windMs: c.wind_speed_10m, gustMs: c.wind_gusts_10m, humidity: c.relative_humidity_2m, sky: s, flyable };
    },
  });
}
