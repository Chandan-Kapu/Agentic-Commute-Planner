// Station lists for the "Your stations" dropdowns.
// BART: abbreviations used by api.bart.gov.
export const BART = [
  ["12TH", "12th St. Oakland City Center"], ["16TH", "16th St. Mission"], ["19TH", "19th St. Oakland"], ["24TH", "24th St. Mission"],
  ["ANTC", "Antioch"], ["ASHB", "Ashby"], ["BALB", "Balboa Park"], ["BAYF", "Bay Fair"], ["BERY", "Berryessa/North San José"],
  ["CAST", "Castro Valley"], ["CIVC", "Civic Center/UN Plaza"], ["COLM", "Colma"], ["COLS", "Coliseum"], ["CONC", "Concord"],
  ["DALY", "Daly City"], ["DBRK", "Downtown Berkeley"], ["DELN", "El Cerrito del Norte"], ["DUBL", "Dublin/Pleasanton"],
  ["EMBR", "Embarcadero"], ["FRMT", "Fremont"], ["FTVL", "Fruitvale"], ["GLEN", "Glen Park"], ["HAYW", "Hayward"],
  ["LAFY", "Lafayette"], ["LAKE", "Lake Merritt"], ["MCAR", "MacArthur"], ["MLBR", "Millbrae"], ["MLPT", "Milpitas"],
  ["MONT", "Montgomery St."], ["NBRK", "North Berkeley"], ["NCON", "North Concord/Martinez"], ["OAKL", "Oakland Int'l Airport"],
  ["ORIN", "Orinda"], ["PCTR", "Pittsburg Center"], ["PHIL", "Pleasant Hill/Contra Costa Centre"], ["PITT", "Pittsburg/Bay Point"],
  ["PLZA", "El Cerrito Plaza"], ["POWL", "Powell St."], ["RICH", "Richmond"], ["ROCK", "Rockridge"], ["SANL", "San Leandro"],
  ["SBRN", "San Bruno"], ["SFIA", "SF Int'l Airport"], ["SHAY", "South Hayward"], ["SSAN", "South San Francisco"],
  ["UCTY", "Union City"], ["WARM", "Warm Springs/South Fremont"], ["WCRK", "Walnut Creek"], ["WDUB", "West Dublin/Pleasanton"],
  ["WOAK", "West Oakland"],
];

// Caltrain, north → south: [name, approx. milepost from SF, 511 stop code base].
// 511/GTFS stop codes: base+1 = northbound platform, base+2 = southbound (verify at 511.org if a stop returns nothing).
export const CALTRAIN = [
  ["San Francisco", 0.2, 70010], ["22nd Street", 1.9, 70020], ["Bayshore", 5.2, 70030], ["South San Francisco", 9.3, 70040],
  ["San Bruno", 11.6, 70050], ["Millbrae", 13.7, 70060], ["Burlingame", 16.3, 70080], ["San Mateo", 17.9, 70090],
  ["Hayward Park", 19.1, 70100], ["Hillsdale", 20.3, 70110], ["Belmont", 21.9, 70120], ["San Carlos", 23.2, 70130],
  ["Redwood City", 25.4, 70140], ["Menlo Park", 28.9, 70160], ["Palo Alto", 30.1, 70170], ["California Ave", 31.8, 70190],
  ["San Antonio", 34.1, 70200], ["Mountain View", 36.1, 70210], ["Sunnyvale", 38.8, 70220], ["Lawrence", 40.8, 70230],
  ["Santa Clara", 44.0, 70240], ["College Park", 45.0, 70250], ["San Jose Diridon", 46.9, 70260], ["Tamien", 48.9, 70270],
  ["Capitol", 52.4, 70280], ["Blossom Hill", 55.8, 70290], ["Morgan Hill", 67.5, 70300], ["San Martin", 71.2, 70310],
  ["Gilroy", 77.4, 70320],
];

/** Caltrain trip from two station names → stop code for the right platform, direction and a rough ride time. */
export function caltrainTrip(fromName, toName) {
  const a = CALTRAIN.find((s) => s[0] === fromName), b = CALTRAIN.find((s) => s[0] === toName);
  if (!a || !b || a === b) return null;
  const north = b[1] < a[1];
  const miles = Math.abs(b[1] - a[1]);
  return {
    originStation: String(a[2] + (north ? 1 : 2)),
    destStation: String(b[2] + (north ? 1 : 2)),
    direction: north ? "N" : "S",
    rideMin: Math.round(miles * 1.4 + 4), // between Baby Bullet (~1.2 min/mi) and local (~1.8)
  };
}

export const bartName = (abbr) => (BART.find((s) => s[0] === abbr) ?? [abbr, abbr])[1];

// ACE (Altamont Corridor Express), east → west, with approximate minutes from Stockton (for ride-time estimates only).
export const ACE = [
  ["Stockton", 0], ["Lathrop/Manteca", 20], ["Tracy", 37], ["Vasco Road", 60], ["Livermore", 66], ["Pleasanton", 75],
  ["Fremont-Centerville", 102], ["Great America", 122], ["Santa Clara", 132], ["San Jose", 142],
];
export function aceRideMin(fromName, toName) {
  const a = ACE.find((s) => s[0] === fromName), b = ACE.find((s) => s[0] === toName);
  return a && b && b[1] > a[1] ? b[1] - a[1] : null;
}
