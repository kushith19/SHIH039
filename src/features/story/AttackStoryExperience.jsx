import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react'
import Banner from '../../ui/Banner'
import StatusBadge from '../../ui/StatusBadge'
import {
  STORY_ACT_DURATIONS_MS,
  STORY_ACT_META,
  STORY_ACT_IDS,
  buildStoryExperience,
} from '@shared/storyExperience.js'
import StoryStatusStrip from './StoryStatusStrip'
import StoryActView from './StoryActView'
import StoryBriefing from './StoryBriefing'

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const LAST_ACT = STORY_ACT_IDS.length - 1

export default function AttackStoryExperience({
  story,
  nodes = [],
  commanderBriefing = null,
  onSelectEndpoint,
}) {
  const view = useMemo(
    () => buildStoryExperience({ attackStory: story, nodes, commanderBriefing }),
    [story, nodes, commanderBriefing]
  )
  const [actIndex, setActIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const playGen = useRef(0)

  const stopPlay = useCallback(() => {
    playGen.current += 1
    setPlaying(false)
  }, [])

  const seek = useCallback(
    (index) => {
      stopPlay()
      setActIndex(Math.max(0, Math.min(LAST_ACT, index)))
    },
    [stopPlay]
  )

  const playFrom = useCallback(
    (startIndex = 0) => {
      if (prefersReducedMotion()) {
        setActIndex(LAST_ACT)
        setPlaying(false)
        return
      }
      playGen.current += 1
      const gen = playGen.current
      setPlaying(true)
      setActIndex(startIndex)
      const t0 = performance.now()
      const starts = []
      let acc = 0
      for (const d of STORY_ACT_DURATIONS_MS) {
        starts.push(acc)
        acc += d
      }
      const total = acc

      const tick = (now) => {
        if (gen !== playGen.current) return
        const elapsed = now - t0
        if (elapsed >= total) {
          setActIndex(LAST_ACT)
          setPlaying(false)
          return
        }
        let idx = 0
        for (let i = starts.length - 1; i >= 0; i -= 1) {
          if (elapsed >= starts[i]) {
            idx = i
            break
          }
        }
        setActIndex(idx)
        window.requestAnimationFrame(tick)
      }
      window.requestAnimationFrame(tick)
    },
    []
  )

  useEffect(() => () => { playGen.current += 1 }, [])

  const act = view.acts[actIndex]
  const showBriefing = actIndex === LAST_ACT

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto lg:overflow-hidden">
      {view.banner ? <Banner>{view.banner}</Banner> : null}

      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={view.source === 'live' ? 'warn' : 'muted'}>
              {view.source === 'live' ? view.status : 'Walkthrough'}
            </StatusBadge>
            <span className="text-sm font-medium">{view.title}</span>
          </div>
          <p className="tn-meta mt-2 max-w-xl">{view.logline}</p>
          <StoryStatusStrip
            severity={view.severity}
            residualPct={view.residualPct}
            trust={view.trust}
            source={view.source}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
            {String(actIndex + 1).padStart(2, '0')} / {String(STORY_ACT_IDS.length).padStart(2, '0')}
          </span>
          <button type="button" className="tn-btn h-9 w-9 p-0" aria-label="Previous act" onClick={() => seek(actIndex - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="tn-btn-primary"
            onClick={() => (playing ? stopPlay() : playFrom(actIndex === LAST_ACT ? 0 : actIndex))}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? 'Pause' : 'Play attack story'}
          </button>
          <button type="button" className="tn-btn h-9 w-9 p-0" aria-label="Next act" onClick={() => seek(actIndex + 1)}>
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="tn-btn"
            onClick={() => playFrom(0)}
            title="Replay from origin"
          >
            <RotateCcw className="h-4 w-4" />
            Replay
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 lg:flex-row lg:overflow-hidden">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto lg:w-44 lg:flex-col lg:overflow-visible"
          aria-label="Story acts"
        >
          {STORY_ACT_IDS.map((id, i) => {
            const meta = STORY_ACT_META[id]
            const current = i === actIndex
            const done = i < actIndex
            return (
              <button
                key={id}
                type="button"
                onClick={() => seek(i)}
                className={[
                  'flex min-w-[8.5rem] items-start gap-2 rounded-md px-2 py-2 text-left lg:min-w-0',
                  current ? 'bg-[var(--tn-select-bg)]' : 'hover:bg-[var(--tn-elevated)]',
                ].join(' ')}
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: current
                      ? 'var(--tn-text)'
                      : done
                        ? 'var(--tn-muted)'
                        : 'var(--tn-line)',
                  }}
                />
                <span>
                  <span className="block font-mono text-xs text-[var(--tn-muted)]">{meta.n}</span>
                  <span className={current ? 'text-sm font-medium' : 'text-sm text-[var(--tn-muted)]'}>
                    {meta.title}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 lg:overflow-hidden">
          <StoryActView act={act} onSelectEndpoint={onSelectEndpoint} />
          {showBriefing ? (
            <div className="shrink-0 pb-2">
              <StoryBriefing
                briefing={act.briefing}
                commanderStatus={act.commanderStatus}
                source={view.source}
              />
            </div>
          ) : (
            <p className="tn-meta shrink-0 pb-1">
              Commander briefing appears in act {String(STORY_ACT_IDS.length).padStart(2, '0')}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
