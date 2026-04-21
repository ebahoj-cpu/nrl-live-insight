// Free public weather via Open-Meteo (no API key required).
// Returns conditions at venue at kickoff, plus a derived ground condition.

export type WeatherSnapshot = {
  tempC: number;
  condition: string;        // short label, e.g. "Clear", "Light rain"
  groundCondition: string;  // derived: Firm / Soft / Heavy / Wet
  windKph: number;
  precipMm: number;
};

// Lat/lon for every NRL home venue (and a few common neutrals).
// Match keys are NRL.com venue names lowercased.
const VENUES: Record<string, [number, number]> = {
  "suncorp stadium":               [-27.4648, 153.0095],
  "gio stadium":                   [-35.2710, 149.1242],
  "accor stadium":                 [-33.8474, 151.0635],
  "stadium australia":             [-33.8474, 151.0635],
  "allianz stadium":               [-33.8896, 151.2253],
  "sydney football stadium":       [-33.8896, 151.2253],
  "cbus super stadium":            [-28.0094, 153.3700],
  "people first stadium":          [-28.0094, 153.3700],
  "4 pines park":                  [-33.7900, 151.2840],
  "brookvale oval":                [-33.7900, 151.2840],
  "aami park":                     [-37.8249, 144.9836],
  "mcdonald jones stadium":        [-32.9221, 151.7332],
  "go media stadium":              [-36.9020, 174.8170],
  "mt smart stadium":              [-36.9020, 174.8170],
  "queensland country bank stadium": [-19.2580, 146.8198],
  "commbank stadium":              [-33.8074, 151.0125],
  "bluebet stadium":               [-33.7531, 150.7166],
  "penrith stadium":               [-33.7531, 150.7166],
  "industree group stadium":       [-33.4322, 151.3445],
  "kayo stadium":                  [-27.2230, 153.1097],
  "moreton daily stadium":         [-27.2230, 153.1097],
  "magic round":                   [-27.4648, 153.0095],
  "campbelltown stadium":          [-34.0560, 150.8050],
  "leichhardt oval":               [-33.8853, 151.1568],
};

function venueCoords(venue: string, city: string): [number, number] | null {
  const v = (venue || "").trim().toLowerCase();
  if (VENUES[v]) return VENUES[v];
  // partial match
  for (const [k, c] of Object.entries(VENUES)) {
    if (v && (v.includes(k) || k.includes(v))) return c;
  }
  // city fallbacks
  const cityCoords: Record<string, [number, number]> = {
    "brisbane": [-27.4698, 153.0251],
    "sydney": [-33.8688, 151.2093],
    "melbourne": [-37.8136, 144.9631],
    "auckland": [-36.8485, 174.7633],
    "newcastle": [-32.9283, 151.7817],
    "canberra": [-35.2809, 149.1300],
    "gold coast": [-28.0167, 153.4000],
    "townsville": [-19.2589, 146.8169],
    "perth": [-31.9523, 115.8613],
    "adelaide": [-34.9285, 138.6007],
  };
  const c = (city || "").trim().toLowerCase();
  return cityCoords[c] ?? null;
}

// Open-Meteo WMO weather code -> short label
function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return "—";
}

function groundFrom(precip24h: number, code: number): string {
  if (code >= 95) return "Heavy / wet";
  if (precip24h >= 15) return "Heavy";
  if (precip24h >= 5) return "Soft";
  if (precip24h >= 1) return "Slightly soft";
  return "Firm";
}

export async function fetchVenueWeather(
  venue: string,
  city: string,
  kickoffUtc: string,
): Promise<WeatherSnapshot | null> {
  const coords = venueCoords(venue, city);
  if (!coords) return null;
  const [lat, lon] = coords;

  const kickoff = new Date(kickoffUtc);
  if (Number.isNaN(kickoff.getTime())) return null;

  // Open-Meteo serves up to ~16 days ahead. Skip if too far.
  const ahead = (kickoff.getTime() - Date.now()) / 86_400_000;
  if (ahead > 14 || ahead < -1) return null;

  const dateStr = kickoff.toISOString().slice(0, 10);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "temperature_2m,precipitation,weathercode,wind_speed_10m");
  url.searchParams.set("daily", "precipitation_sum");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);
  url.searchParams.set("wind_speed_unit", "kmh");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const j = await res.json() as any;

    const hours: string[] = j.hourly?.time ?? [];
    const targetIso = kickoff.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    let idx = hours.findIndex((t) => t.startsWith(targetIso));
    if (idx === -1) idx = Math.max(0, Math.min(hours.length - 1, kickoff.getUTCHours()));

    const temp = j.hourly?.temperature_2m?.[idx];
    const code = j.hourly?.weathercode?.[idx] ?? 0;
    const wind = j.hourly?.wind_speed_10m?.[idx] ?? 0;
    const precip = j.hourly?.precipitation?.[idx] ?? 0;
    const dailyPrecip = j.daily?.precipitation_sum?.[0] ?? precip;

    if (typeof temp !== "number") return null;

    return {
      tempC: Math.round(temp),
      condition: describe(code),
      groundCondition: groundFrom(dailyPrecip, code),
      windKph: Math.round(wind),
      precipMm: Number(dailyPrecip.toFixed(1)),
    };
  } catch {
    return null;
  }
}
