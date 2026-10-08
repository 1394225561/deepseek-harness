// @vitest-environment jsdom
/** Recorded layout arithmetic supplements browser geometry; no browser layout is asserted here. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatViewport } from '../src/client/chat/use-chat-viewport.ts'
import { ChatReading } from '../src/client/chat/use-chat-reading.ts'
import { ScrollFollow } from '../src/client/chat/use-scroll-follow.ts'

const disposers = new Set<() => void>()
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(async () => {
  try {
    for (const dispose of disposers) dispose()
    disposers.clear()
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

function fixture() {
  const list = document.createElement('div')
  const column = document.createElement('div')
  const row = document.createElement('div')
  const spacer = document.createElement('div')
  spacer.dataset.chatTurnSpacer = ''
  column.append(row)
  list.append(column, spacer)
  document.body.append(list)
  let contentHeight = 2_400
  let top = 2_000
  const room = () => Number.parseFloat(spacer.style.height) || 0
  const floor = () => Math.max(0, contentHeight + room() - 400)
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    if (options.behavior === 'instant') list.scrollTop = options.top ?? list.scrollTop
  })
  Object.defineProperties(list, {
    clientHeight: { configurable: true, get: () => 400 },
    scrollHeight: { configurable: true, get: () => Math.max(400, contentHeight + room()) },
    scrollTop: {
      configurable: true,
      get: () => { top = Math.min(top, floor()); return top },
      set: (value: number) => { top = Math.max(0, Math.min(value, floor())) },
    },
    scrollTo: { value: scrollTo },
  })
  Object.defineProperty(row, 'offsetHeight', { value: 1_800 })
  const viewport = new ChatViewport()
  viewport.attach(list, column)
  const follow = new ScrollFollow(true, 25)
  const reading = new ChatReading(viewport, { read: () => null, save: vi.fn() }, {
    initialized: true, followingTail: true, activeTurn: 1,
  }, vi.fn(), follow)
  viewport.connect({
    scroll: reading.onScroll,
    scrollEnd: reading.onScrollEnd,
    resize: () => { reading.onResize() },
    interact: () => {},
    intent: () => { reading.interruptFollow() },
  })
  disposers.add(() => {
    reading.dispose()
    viewport.detach()
    list.remove()
  })
  return {
    list, spacer, row, viewport, follow, reading, scrollTo,
    close: async () => {
      viewport.motion.collapse(row, () => { row.hidden = true })
      await Promise.resolve()
      contentHeight -= 1_800
      expect(list.scrollTop).toBe(2_000)
      const event = new Event('transitionend')
      Object.defineProperty(event, 'propertyName', { value: 'height' })
      row.dispatchEvent(event)
    },
    scroll: (value: number) => {
      list.scrollTop = value
      list.dispatchEvent(new Event('scroll'))
    },
  }
}

it('follows the real content floor after a large close without dropping reserved space ahead of motion', async () => {
  const h = fixture()
  await h.close()
  h.viewport.reclaimBelow()
  expect(h.list.scrollTop).toBe(2_000)
  h.reading.followTail('smooth')
  expect(h.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 200, behavior: 'smooth' })
  expect(h.list.scrollTop).toBe(2_000)
  h.scroll(1_000)
  expect(h.reading.followingTail).toBe(true)
  h.scroll(200)
  h.list.dispatchEvent(new Event('scrollend'))
  expect(h.spacer.style.height).toBe('')
  expect(h.list.scrollTop).toBe(200)
  expect(h.follow.animating).toBe(false)
})

it('keeps manual off-bottom ownership and reclaims only space below the reader', async () => {
  const h = fixture()
  await h.close()
  h.reading.followTail('smooth')
  h.scroll(1_000)
  h.list.dispatchEvent(new Event('wheel'))
  h.scroll(900)
  vi.advanceTimersByTime(500)
  expect(h.reading.followingTail).toBe(false)
  expect(h.spacer.style.height).toBe('700px')
  h.viewport.reclaimBelow()
  h.reading.onResize()
  expect(h.list.scrollTop).toBe(900)
  expect(h.spacer.style.height).toBe('700px')
  expect(h.follow.animating).toBe(false)
})

it('releases fold room immediately for reduced-motion following', async () => {
  const h = fixture()
  await h.close()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  h.reading.followTail('smooth')
  expect(h.list.scrollTop).toBe(200)
  expect(h.spacer.style.height).toBe('')
  expect(h.follow.animating).toBe(false)
})

it('does not measure geometry to interrupt an idle follow controller', () => {
  const h = fixture()
  const reads = (['clientHeight', 'scrollHeight', 'scrollTop'] as const).map(property =>
    vi.spyOn(h.list, property, 'get'))
  h.viewport.interruptFollow(h.follow)
  for (const read of reads) expect(read).not.toHaveBeenCalled()
})
