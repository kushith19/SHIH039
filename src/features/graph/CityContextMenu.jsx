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
        className="tn-btn max-w-[10rem] truncate disabled:opacity-50"
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
          className="absolute right-0 z-50 mt-1 min-w-[11rem] border border-[var(--tn-line)] bg-[var(--tn-surface)] py-1"
        >
          <button
            type="button"
            role="menuitem"
            className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--tn-elevated)] ${
              !locked ? 'font-medium' : 'text-[var(--tn-muted)]'
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
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--tn-elevated)] ${
                locked && cityContext === id ? 'font-medium' : 'text-[var(--tn-muted)]'
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
