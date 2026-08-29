/** City map in flow coordinates: OSM/Carto tiles + district anchors. */

export const TILE_SIZE = 256
export const MAP_ZOOM = 14
export const TILE_COLS = 12
export const TILE_ROWS = 8

export const CITY_MAP_WIDTH = TILE_COLS * TILE_SIZE
export const CITY_MAP_HEIGHT = TILE_ROWS * TILE_SIZE

/** Central Bengaluru near Cubbon Park / Vidhana Soudha. */
export const MAP_CENTER = { lat: 12.9716, lng: 77.5946 }

export function latLngToWorldPixel(lat, lng, zoom = MAP_ZOOM) {
  const n = 2 ** zoom
  const x = ((lng + 180) / 360) * n * TILE_SIZE
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    n *
    TILE_SIZE
  return { x, y }
}

const centerWorld = latLngToWorldPixel(MAP_CENTER.lat, MAP_CENTER.lng)

export const MAP_ORIGIN_WORLD = {
  x: centerWorld.x - CITY_MAP_WIDTH / 2,
  y: centerWorld.y - CITY_MAP_HEIGHT / 2,
}

export const TILE_X0 = Math.floor(MAP_ORIGIN_WORLD.x / TILE_SIZE)
export const TILE_Y0 = Math.floor(MAP_ORIGIN_WORLD.y / TILE_SIZE)

export const MAP_TRANSLATE_EXTENT = [
  [-120, -120],
  [CITY_MAP_WIDTH + 120, CITY_MAP_HEIGHT + 120],
]

/** Flow-pixel anchors for Bengaluru districts (map is 3072×2048, center ~1536,1024). */
export const DISTRICT_ANCHORS = {
  energy: { x: 420, y: 360, label: 'Energy' },
  water: { x: 2460, y: 1480, label: 'Water' },
  transport: { x: 580, y: 1020, label: 'Transport' },
  telecom: { x: 2520, y: 820, label: 'Telecom' },
  government: { x: 1540, y: 980, label: 'Government' },
  education: { x: 1280, y: 720, label: 'Education' },
  healthcare: { x: 1680, y: 480, label: 'Healthcare' },
  emergency: { x: 1760, y: 1480, label: 'Emergency' },
  safety: { x: 1500, y: 1560, label: 'Safety' },
  environment: { x: 1380, y: 1720, label: 'Environment' },
  finance: { x: 1960, y: 1040, label: 'Finance' },
  urban: { x: 1220, y: 860, label: 'Urban' },
}

export function tileUrl(z, x, y, dark) {
  const style = dark ? 'dark_all' : 'light_all'
  return `https://basemaps.cartocdn.com/${style}/${z}/${x}/${y}.png`
}
