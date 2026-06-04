/**
 * Fuente: c.1inf54.26.1.v1.Aeropuerto.husos.v1.20250818__estudiantes.txt
 * Coordenadas convertidas de DMS a decimal. Identificador primario: código ICAO (4 letras).
 * Alineado con planes_vuelo.txt que usa los mismos códigos ICAO.
 *
 * Formato coordinates: [longitude, latitude]  (orden requerido por react-simple-maps / D3-geo)
 */

export const AIRPORTS = [
  // ── América del Sur ─────────────────────────────────────────────────────────
  {
    icao: "SKBO",
    city: "Bogotá",
    country: "Colombia",
    continent: "america",
    gmtOffset: -5,
    warehouseCapacity: 430,
    coordinates: [-74.147, 4.702],
  },
  {
    icao: "SEQM",
    city: "Quito",
    country: "Ecuador",
    continent: "america",
    gmtOffset: -5,
    warehouseCapacity: 410,
    coordinates: [-78.359, 0.113],
  },
  {
    icao: "SVMI",
    city: "Caracas",
    country: "Venezuela",
    continent: "america",
    gmtOffset: -4,
    warehouseCapacity: 400,
    coordinates: [-66.991, 10.603],
  },
  {
    icao: "SBBR",
    city: "Brasilia",
    country: "Brasil",
    continent: "america",
    gmtOffset: -3,
    warehouseCapacity: 480,
    coordinates: [-47.918, -15.865],
  },
  {
    icao: "SPIM",
    city: "Lima",
    country: "Perú",
    continent: "america",
    gmtOffset: -5,
    warehouseCapacity: 440,
    coordinates: [-77.114, -12.022],
  },
  {
    icao: "SLLP",
    city: "La Paz",
    country: "Bolivia",
    continent: "america",
    gmtOffset: -4,
    warehouseCapacity: 420,
    coordinates: [-68.192, -16.513],
  },
  {
    icao: "SCEL",
    city: "Santiago",
    country: "Chile",
    continent: "america",
    gmtOffset: -3,
    warehouseCapacity: 460,
    coordinates: [-70.794, -33.396],
  },
  {
    icao: "SABE",
    city: "Buenos Aires",
    country: "Argentina",
    continent: "america",
    gmtOffset: -3,
    warehouseCapacity: 460,
    coordinates: [-58.416, -34.559],
  },
  {
    icao: "SGAS",
    city: "Asunción",
    country: "Paraguay",
    continent: "america",
    gmtOffset: -4,
    warehouseCapacity: 400,
    coordinates: [-57.520, -25.240],
  },
  {
    icao: "SUAA",
    city: "Montevideo",
    country: "Uruguay",
    continent: "america",
    gmtOffset: -3,
    warehouseCapacity: 400,
    coordinates: [-56.265, -34.789],
  },

  // ── Europa ───────────────────────────────────────────────────────────────────
  {
    icao: "LATI",
    city: "Tirana",
    country: "Albania",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 410,
    coordinates: [19.721, 41.415],
  },
  {
    icao: "EDDI",
    city: "Berlín",
    country: "Alemania",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 480,
    coordinates: [13.402, 52.474],
  },
  {
    icao: "LOWW",
    city: "Viena",
    country: "Austria",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 430,
    coordinates: [16.571, 48.111],
  },
  {
    icao: "EBCI",
    city: "Bruselas",
    country: "Bélgica",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 440,
    coordinates: [4.454, 50.459],
  },
  {
    icao: "UMMS",
    city: "Minsk",
    country: "Bielorrusia",
    continent: "europe",
    gmtOffset: +3,
    warehouseCapacity: 400,
    coordinates: [28.033, 53.883],
  },
  {
    icao: "LBSF",
    city: "Sofía",
    country: "Bulgaria",
    continent: "europe",
    gmtOffset: +3,
    warehouseCapacity: 400,
    coordinates: [23.405, 42.690],
  },
  {
    icao: "LKPR",
    city: "Praga",
    country: "Rep. Checa",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 400,
    coordinates: [14.266, 50.101],
  },
  {
    icao: "LDZA",
    city: "Zagreb",
    country: "Croacia",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 420,
    coordinates: [16.069, 45.743],
  },
  {
    icao: "EKCH",
    city: "Copenhague",
    country: "Dinamarca",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 480,
    coordinates: [12.656, 55.618],
  },
  {
    icao: "EHAM",
    city: "Amsterdam",
    country: "Holanda",
    continent: "europe",
    gmtOffset: +2,
    warehouseCapacity: 480,
    coordinates: [4.765, 52.300],
  },

  // ── Asia ─────────────────────────────────────────────────────────────────────
  {
    icao: "VIDP",
    city: "Delhi",
    country: "India",
    continent: "asia",
    gmtOffset: +5,
    warehouseCapacity: 480,
    coordinates: [77.103, 28.567],
  },
  {
    icao: "OSDI",
    city: "Damasco",
    country: "Siria",
    continent: "asia",
    gmtOffset: +3,
    warehouseCapacity: 400,
    coordinates: [36.516, 33.411],
  },
  {
    icao: "OERK",
    city: "Riad",
    country: "Arabia Saudita",
    continent: "asia",
    gmtOffset: +3,
    warehouseCapacity: 420,
    coordinates: [46.699, 24.958],
  },
  {
    icao: "OMDB",
    city: "Dubai",
    country: "Emiratos Árabes",
    continent: "asia",
    gmtOffset: +4,
    warehouseCapacity: 420,
    coordinates: [55.364, 25.253],
  },
  {
    icao: "OAKB",
    city: "Kabul",
    country: "Afganistán",
    continent: "asia",
    gmtOffset: +4,
    warehouseCapacity: 480,
    coordinates: [69.211, 34.566],
  },
  {
    icao: "OOMS",
    city: "Mascate",
    country: "Omán",
    continent: "asia",
    gmtOffset: +4,
    warehouseCapacity: 460,
    coordinates: [58.284, 23.593],
  },
  {
    icao: "OYSN",
    city: "Saná",
    country: "Yemen",
    continent: "asia",
    gmtOffset: +3,
    warehouseCapacity: 420,
    coordinates: [44.220, 15.476],
  },
  {
    icao: "OPKC",
    city: "Karachi",
    country: "Pakistán",
    continent: "asia",
    gmtOffset: +5,
    warehouseCapacity: 410,
    coordinates: [67.150, 24.900],
  },
  {
    icao: "UBBB",
    city: "Bakú",
    country: "Azerbaiyán",
    continent: "asia",
    gmtOffset: +2,
    warehouseCapacity: 400,
    coordinates: [50.047, 40.467],
  },
  {
    icao: "OJAI",
    city: "Amán",
    country: "Jordania",
    continent: "asia",
    gmtOffset: +3,
    warehouseCapacity: 400,
    coordinates: [35.993, 31.723],
  },
];

/** Lookup rápido por código ICAO */
export const AIRPORT_BY_ICAO = AIRPORTS.reduce((acc, ap) => {
  acc[ap.icao] = ap;
  return acc;
}, {});

/** Umbrales de capacidad (parámetros configurables) */
export const CAPACITY_THRESHOLDS = {
  amber: 70,
  red: 90,
};

/** Devuelve nivel semáforo según ocupación */
export const getCapacityLevel = (occupancy = 0) => {
  if (occupancy >= CAPACITY_THRESHOLDS.red) return "red";
  if (occupancy >= CAPACITY_THRESHOLDS.amber) return "amber";
  return "green";
};

/** Devuelve etiqueta de estado según nivel */
export const getCapacityLabel = (level = "green") => {
  if (level === "red") return "Crítico";
  if (level === "amber") return "Carga alta";
  return "Operación estable";
};

/** Construye métricas de aeropuerto para un escenario dado */
export const buildAirportMetrics = (airports = [], occupancyMap = null) =>
  airports.reduce((acc, airport, index) => {
    const data = occupancyMap != null ? occupancyMap[airport.icao] : null;
    
    // Si hay datos reales del BE { bags, occupancy }, usarlos. 
    // Si no, fallback a 0 o valores iniciales.
    const occupancy = data ? (data.occupancy ?? 0) : 0;
    const storedBags = data ? (data.bags ?? 0) : 0;
    
    const level = getCapacityLevel(occupancy);
    acc[airport.icao] = {
      warehouseId: `ALM-${airport.icao}`,
      warehouseCapacity: airport.warehouseCapacity,
      storedBags,
      occupancy,
      level,
      status: occupancy >= 100 ? "SATURADO" : getCapacityLabel(level),
      isSaturated: occupancy >= 100,
    };
    return acc;
  }, {});

/** Interpola posición [lng, lat] entre dos aeropuertos para animación de vuelo */
export const interpolateCoordinates = (fromAirport = {}, toAirport = {}, progress = 0) => {
  const [fromLng, fromLat] = fromAirport.coordinates ?? [0, 0];
  const [toLng, toLat] = toAirport.coordinates ?? [0, 0];
  return [
    fromLng + (toLng - fromLng) * progress,
    fromLat + (toLat - fromLat) * progress,
  ];
};
