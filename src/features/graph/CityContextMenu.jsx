import { useEffect, useRef, useState } from 'react'
import { CITY_CONTEXTS, cityContextLabel } from '@shared/cityContext.js'

export default function CityContextMenu({
  cityContext = 'normal_day',
  locked = false,
  onSelect,
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = cityContextLabel(cityContext)

  function pick(value) {
    setOpen(false)
    onSelect?.(value)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        className="max-w-[10rem] truncate rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700/80 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-800/60 sm:text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="City context"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {locked ? '' : ' · auto'}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <button
            type="button"
            role="menuitem"
            className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 ${
              !locked ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-200'
            }`}
            onClick={() => pick(null)}
          >
            Auto (clock)
          </button>
          {CITY_CONTEXTS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 ${
                locked && cityContext === id
                  ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
              onClick={() => pick(id)}
            >
              {cityContextLabel(id)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
