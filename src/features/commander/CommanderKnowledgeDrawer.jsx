import { ChevronLeft, ChevronRight } from 'lucide-react'

const DRAWER_ID = 'commander-knowledge-drawer'

/**
 * Layout-only collapsible right panel. Open/closed is presentation state.
 * Children (knowledge, chat) keep their existing behavior.
 */
export default function CommanderKnowledgeDrawer({
  open = false,
  onToggle,
  onClose,
  children,
}) {
  return (
    <>
      {open ? (
        <button
          type="button"
          className="absolute inset-0 z-10 bg-black/40 lg:hidden"
          aria-label="Close chat"
          onClick={onClose ?? onToggle}
        />
      ) : null}
      <aside
        className={[
          'relative z-20 flex h-full min-w-0 shrink-0 flex-col overflow-visible',
          'max-lg:absolute max-lg:inset-y-0 max-lg:right-0',
          'transition-[width] duration-200 ease-in-out',
          open ? 'w-1/2 max-lg:w-[90vw]' : 'w-0',
        ].join(' ')}
      >
        <button
          type="button"
          className="absolute top-20 left-0 z-30 flex -translate-x-full flex-col items-center rounded-l-md border border-r-0 border-[var(--tn-line)] bg-[var(--tn-surface)] px-1.5 py-2.5 text-[var(--tn-muted)]"
          aria-expanded={open}
          aria-controls={DRAWER_ID}
          aria-label={
            open ? 'Close chat' : 'Open chat'
          }
          onClick={onToggle}
        >
          {open ? (
            <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
          )}
          <span
            className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em]"
            style={{ writingMode: 'vertical-rl' }}
          >
            Chat
          </span>
        </button>
        <div className="h-full w-full min-w-0 overflow-hidden">
          <div
            id={DRAWER_ID}
            className="flex h-full w-full min-w-0 flex-col border-l border-[var(--tn-line)] bg-[var(--tn-canvas)]"
            inert={!open ? true : undefined}
            aria-hidden={!open}
          >
            {children}
          </div>
        </div>
      </aside>
    </>
  )
}
