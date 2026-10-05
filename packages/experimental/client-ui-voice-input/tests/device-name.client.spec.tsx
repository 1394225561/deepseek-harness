// @vitest-environment jsdom
/** Hover motion is bounded by the label width and stops with its owning element. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DeviceName } from '../src/client/DeviceName.tsx'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function fixture(width = 220) {
  const view = render(<DeviceName label="Long microphone name" />)
  const inner = screen.getByText('Long microphone name'), outer = inner.parentElement!
  vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, 20))
  Object.defineProperty(outer, 'clientWidth', { value: 100 })
  const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }))
  Object.defineProperty(inner, 'animate', { value: animate })
  return { ...view, outer, inner, cancel, animate }
}

it('waits 100ms and reveals only the overflow at a fixed speed with pauses at both ends', () => {
  const b = fixture()
  fireEvent.pointerEnter(b.outer)
  act(() => { vi.advanceTimersByTime(99) })
  expect(b.animate).not.toHaveBeenCalled()
  act(() => { vi.advanceTimersByTime(1) })
  expect(b.animate).toHaveBeenCalledWith([
    { transform: 'translateX(0)', offset: 0 },
    { transform: 'translateX(-120px)', offset: 4000 / 9200 },
    { transform: 'translateX(-120px)', offset: 4600 / 9200 },
    { transform: 'translateX(0)', offset: 8600 / 9200 },
    { transform: 'translateX(0)', offset: 1 },
  ], { duration: 9200, iterations: Infinity, easing: 'linear' })
  expect(b.outer.dataset.scrolling).toBe('true')
  fireEvent.pointerLeave(b.outer)
  expect(b.cancel).toHaveBeenCalledOnce()
  expect(b.outer.dataset.scrolling).toBeUndefined()
})

it('does not start after an early pointer exit or for a name that fits', () => {
  const b = fixture(80)
  fireEvent.pointerEnter(b.outer)
  fireEvent.pointerLeave(b.outer)
  act(() => { vi.advanceTimersByTime(100) })
  expect(b.animate).not.toHaveBeenCalled()
  fireEvent.pointerEnter(b.outer)
  act(() => { vi.advanceTimersByTime(100) })
  expect(b.animate).not.toHaveBeenCalled()
})

it('keeps reduced-motion labels static', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const b = fixture()
  fireEvent.pointerEnter(b.outer)
  act(() => { vi.advanceTimersByTime(100) })
  expect(b.animate).not.toHaveBeenCalled()
})

it('cancels motion when the device name changes and cancels pending work on unmount', () => {
  const b = fixture()
  fireEvent.pointerEnter(b.outer)
  act(() => { vi.advanceTimersByTime(100) })
  b.rerender(<DeviceName label="Renamed microphone" />)
  expect(b.cancel).toHaveBeenCalledOnce()
  expect(b.outer.dataset.scrolling).toBeUndefined()
  fireEvent.pointerEnter(b.outer)
  b.unmount()
  act(() => { vi.advanceTimersByTime(100) })
  expect(b.animate).toHaveBeenCalledOnce()
})
