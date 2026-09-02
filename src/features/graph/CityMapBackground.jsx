import { useEffect, useMemo, useState } from 'react'
import { ViewportPortal } from '@xyflow/react'
import {
  CITY_MAP_HEIGHT,
  CITY_MAP_WIDTH,
  DISTRICT_ANCHORS,
  MAP_ZOOM,
  TILE_COLS,
  TILE_ROWS,
  TILE_SIZE,
  TILE_X0,
  TILE_Y0,
  tileUrl,
} from './cityMap'

function usePrefersDark() {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return dark
}

export default function CityMapBackground() {
  const dark = usePrefersDark()

  const tiles = useMemo(() => {
    const list = []
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        list.push({
          key: `${col}-${row}`,
          left: col * TILE_SIZE,
          top: row * TILE_SIZE,
          src: tileUrl(MAP_ZOOM, TILE_X0 + col, TILE_Y0 + row, dark),
        })
      }
    }
    return list
  }, [dark])

  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute left-0 top-0 overflow-hidden"
        style={{ width: CITY_MAP_WIDTH, height: CITY_MAP_HEIGHT, zIndex: -1 }}
        aria-hidden="true"
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            alt=""
            draggable={false}
            src={tile.src}
            className="absolute block"
            style={{
              left: tile.left,
              top: tile.top,
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
          />
        ))}
        <div
          className={[
            'absolute inset-0',
            dark
              ? 'bg-slate-950/25'
              : 'bg-emerald-950/[0.04]',
          ].join(' ')}
        />
        {Object.values(DISTRICT_ANCHORS).map((d) => (
          <div
            key={d.label}
            className="absolute -translate-x-1/2 border border-white/30 bg-black/55 px-2 py-0.5 text-xs font-medium text-white"
            style={{ left: d.x, top: Math.max(24, d.y - 56) }}
          >
            {d.label}
          </div>
        ))}
      </div>
    </ViewportPortal>
  )
}
