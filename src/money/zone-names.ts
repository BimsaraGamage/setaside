/**
 * Old time zone names some browsers still give (Chrome: "Asia/Calcutta"), and
 * the current name for each. Only for showing and comparing: saved data keeps
 * whatever name it has.
 */
const CURRENT: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** "Asia/Calcutta" → "Asia/Kolkata"; a current name stays as it is. */
export function currentZoneName(zone: string): string {
  return CURRENT[zone] ?? zone;
}

/** Zone names as current names, sorted, each once. */
export function currentZoneNames(zones: readonly string[]): string[] {
  return [...new Set(zones.map(currentZoneName))].sort();
}
