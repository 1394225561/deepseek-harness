// @vitest-environment jsdom
/** Chat scroll composition over the real viewport, reading owner, and fold lifecycle. */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowMotionRows } from '../src/client/chat/flow-motion.ts'
import { useChatScroll, type ChatScrollInput } from '../src/client/chat/use-chat-scroll.ts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  try {
    cleanup()
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

function ScrollHarness({ input, onMotion }: {
  readonly input: ChatScrollInput
  readonly onMotion: (motion: FlowMotionRows) => void
}) {
  const state = useChatScroll(input)
  useLayoutEffect(() => { onMotion(state.motion) }, [onMotion, state.motion])
  return <>
    <div ref={state.listRef} data-testid="scrollport">
      <div ref={state.columnRef} data-testid="column" data-chat-flow="" />
      <div data-chat-turn-spacer="" />
    </div>
    <button type="button" onClick={state.returnToBottom}>Return to bottom</button>
  </>
}

function mountScroll(deferCompletedTurns = true) {
  let input: ChatScrollInput = {
    ready: true,
    order: [],
    firstSeq: null,
    lastKey: null,
    lastIsUser: false,
    steeringId: null,
    submissionId: null,
    running: false,
    deferCompletedTurns,
    loadedTurns: [],
    hasMore: false,
    loadingOlder: false,
    loadOlder: vi.fn(),
    loadThrough: vi.fn(async () => {}),
    chatScroll: { read: () => null, save: vi.fn() },
  }
  const callbacks: { motion?: FlowMotionRows } = {}
  const onMotion = (motion: FlowMotionRows): void => { callbacks.motion = motion }
  const view = render(<ScrollHarness input={input} onMotion={onMotion} />)
  const scroller = within(view.container).getByTestId('scrollport')
  let height = 1_000
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    if (options.behavior === 'instant') scroller.scrollTop = options.top ?? scroller.scrollTop
  })
  Object.defineProperties(scroller, {
    clientHeight: { value: 400 },
    scrollHeight: { get: () => height },
    scrollTo: { value: scrollTo },
  })
  const row = document.createElement('div')
  Object.defineProperty(row, 'offsetHeight', { value: 80 })
  within(view.container).getByTestId('column').append(row)
  return {
    view, scroller, scrollTo,
    grow: (next: number) => { height = next },
    update: (patch: Partial<ChatScrollInput>) => {
      input = { ...input, ...patch }
      view.rerender(<ScrollHarness input={input} onMotion={onMotion} />)
    },
    startFold: () => {
      const motion = callbacks.motion
      if (motion === undefined) throw new Error('Viewport motion callbacks are not bound')
      act(() => { motion.collapse(row, () => { row.hidden = true }) })
    },
    finishFold: () => {
      const event = new Event('transitionend', { bubbles: true })
      Object.defineProperty(event, 'propertyName', { value: 'height' })
      act(() => { row.dispatchEvent(event) })
    },
  }
}

describe('Chat scroll collapse timing', () => {
  it('does not defer one viewport\'s submitted input behind another viewport\'s fold', () => {
    const first = mountScroll()
    const second = mountScroll()
    first.startFold()
    second.update({ submissionId: 'second-view-input' })
    expect(second.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'smooth' })
    expect(second.scroller.style.overflowAnchor).toBe('')
    first.finishFold()
    expect(second.scrollTo).toHaveBeenCalledTimes(1)
    expect(first.scrollTo).not.toHaveBeenCalled()
  })

  it.each([false, true])('follows submitted input with deferCompletedTurns=%s', (deferred) => {
    const h = mountScroll(deferred)
    h.update({ submissionId: 'first' })
    if (deferred) {
      expect(h.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'smooth' })
      expect(h.scroller.scrollTop).toBe(0)
    } else {
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(h.scroller.scrollTop).toBe(600)
    }
  })

  it('coalesces submitted inputs into one follow after the last row closes', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    h.update({ submissionId: 'second' })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scroller.scrollTop).toBe(0)
    h.finishFold()
    expect(h.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'smooth' })
    expect(h.scroller.style.overflowAnchor).toBe('')
  })

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'] as const)(
    'cancels queued follow when the reader sends %s input', async (intent) => {
      const h = mountScroll()
      h.startFold()
      h.update({ submissionId: 'first' })
      await act(async () => { await Promise.resolve() })
      if (intent === 'wheel') fireEvent.wheel(h.scroller, { deltaY: -80 })
      else if (intent === 'touchstart') fireEvent.touchStart(h.scroller)
      else if (intent === 'pointerdown') fireEvent.pointerDown(h.scroller, { button: 0 })
      else fireEvent.keyDown(h.scroller, { key: 'ArrowUp' })
      h.finishFold()
      act(() => { vi.runAllTimers() })
      expect(h.scrollTo).not.toHaveBeenCalled()
      expect(h.scroller.scrollTop).toBe(0)
    },
  )

  it('cancels queued follow when the Chat view unmounts', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    h.view.unmount()
    h.finishFold()
    act(() => { vi.runAllTimers() })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scroller.scrollTop).toBe(0)
    expect(h.scroller.style.overflowAnchor).toBe('')
  })

  it('does not revive a cancelled follow when delayed timing is re-enabled before the fold ends', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    h.update({ deferCompletedTurns: false })
    h.update({ deferCompletedTurns: true })
    h.finishFold()
    act(() => { vi.runAllTimers() })
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scroller.scrollTop).toBe(0)
    h.update({ deferCompletedTurns: false, submissionId: 'second' })
    expect(h.scroller.scrollTop).toBe(600)
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  it('returns to bottom immediately and cancels an older fold waiter', () => {
    const h = mountScroll()
    h.startFold()
    h.update({ submissionId: 'first' })
    fireEvent.click(h.view.getByRole('button', { name: 'Return to bottom' }))
    expect(h.scroller.scrollTop).toBe(600)
    h.grow(1_200)
    h.finishFold()
    expect(h.scroller.scrollTop).toBe(600)
    expect(h.scrollTo).not.toHaveBeenCalled()
  })

  it('interrupts an active smooth follow when completion timing is restored', () => {
    const h = mountScroll()
    h.update({ submissionId: 'first' })
    h.scroller.scrollTop = 150
    h.update({ deferCompletedTurns: false })
    expect(h.scrollTo).toHaveBeenLastCalledWith({ top: 150, behavior: 'instant' })
    expect(h.scroller.scrollTop).toBe(150)
    h.update({ submissionId: 'second' })
    expect(h.scroller.scrollTop).toBe(600)
    expect(h.scrollTo).toHaveBeenCalledTimes(2)
  })
})
