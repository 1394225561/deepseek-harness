// @vitest-environment jsdom
/** Menu-only capture, selected input routing, and late permissions use real audio ownership. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MicrophonePicker } from '../src/client/MicrophonePicker.tsx'
import { createMicrophoneDeviceStore } from '../src/client/microphone-device.ts'
import { Recording } from '../src/client/audio.ts'
import { zh } from '../src/client/locales.ts'
import { captureFixture } from './audio-fixture.client.ts'

const t = makeTranslate(zh, commonZh)
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function fixture() {
  const audio = captureFixture(), selection = createMicrophoneDeviceStore()
  const enumerateDevices = vi.fn(async () => [
    { kind: 'audioinput', deviceId: 'default', label: 'Default' },
    { kind: 'audioinput', deviceId: 'usb', label: 'USB microphone' },
    { kind: 'audioinput', deviceId: 'internal', label: 'Built-in microphone' },
    { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
  ])
  const media = Object.assign(new EventTarget(), { getUserMedia: audio.getUserMedia, enumerateDevices })
  vi.stubGlobal('navigator', { mediaDevices: media })
  const recordings: Recording[] = []
  const props = { t, useMicrophoneDevice: bindSnapshotSelector(selection),
    selectMicrophone: (device: { id: string; label: string }) => { selection.set(device) },
    createRecording: () => {
      const capture = new Recording(() => {}, selection.getSnapshot().id)
      recordings.push(capture)
      return capture
    } }
  const view = render(<MicrophonePicker {...props} />)
  return { ...audio, ...view, media, enumerateDevices, recordings, props, selection }
}
async function open(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
  await screen.findByRole('menuitem', { name: 'USB microphone' })
}

it('captures only while open, moves the meter to the selected input, and remembers it for recording', async () => {
  const b = fixture()
  try {
    expect(b.getUserMedia).not.toHaveBeenCalled()
    await open()
    expect(screen.queryByRole('menuitem', { name: 'Speakers' })).toBeNull()
    expect(within(screen.getByRole('menuitem', { name: new RegExp(zh.systemMicrophone) })).getByRole('img', { name: zh.inputLevel })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'USB microphone' }))
    await waitFor(() => { expect(b.getUserMedia).toHaveBeenLastCalledWith({ audio: {
      echoCancellation: true, noiseSuppression: true, deviceId: { exact: 'usb' },
    }, video: false }) })
    expect(b.trackStop).toHaveBeenCalledOnce()
    await waitFor(() => { expect(within(screen.getByRole('menuitem', { name: /USB microphone/ })).getByRole('img', { name: zh.inputLevel })).toBeTruthy() })
    expect(screen.getAllByRole('img', { name: zh.inputLevel })).toHaveLength(1)
    expect(document.querySelectorAll('[data-active="true"]').length).toBeGreaterThan(0)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /USB microphone/ }), { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    expect(b.trackStop).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull()
    expect(createMicrophoneDeviceStore().getSnapshot()).toEqual({ id: 'usb', label: 'USB microphone' })
    const recording = b.props.createRecording()
    await recording.start()
    expect(b.getUserMedia.mock.calls.at(-1)?.[0].audio).toMatchObject({ deviceId: { exact: 'usb' } })
  } finally { b.unmount(); await Promise.all(b.recordings.map(recording => recording.dispose())) }
})

it('releases a permission grant arriving after the menu closes', async () => {
  const b = fixture(), granted = Promise.withResolvers<typeof b.stream>()
  b.getUserMedia.mockReturnValueOnce(granted.promise)
  try {
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    await act(async () => { granted.resolve(b.stream) })
    expect(b.trackStop).toHaveBeenCalledOnce()
    expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull()
  } finally { b.unmount(); await Promise.all(b.recordings.map(recording => recording.dispose())) }
})

it('keeps device choices available after permission denial and refreshes hot-plugged inputs', async () => {
  const b = fixture()
  b.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
  try {
    await open()
    expect(screen.getByText(zh.permission)).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'USB microphone' }))
    await screen.findByRole('img', { name: zh.inputLevel })
    b.enumerateDevices.mockResolvedValueOnce([{ kind: 'audioinput', deviceId: 'new', label: 'New microphone' }])
    b.getUserMedia.mockRejectedValueOnce(new DOMException('unplugged', 'NotFoundError'))
    act(() => { b.media.dispatchEvent(new Event('devicechange')) })
    await screen.findByRole('menuitem', { name: 'New microphone' })
    expect(screen.getByText(zh.deviceMissing)).toBeTruthy()
    expect(b.trackStop).toHaveBeenCalledOnce()
    expect(screen.queryByRole('img', { name: zh.inputLevel })).toBeNull()
  } finally { b.unmount(); await Promise.all(b.recordings.map(recording => recording.dispose())) }
})

it.each([null, 'usb', { id: 3, label: 'USB' }, { id: 'usb' }])('ignores invalid persisted microphone fields: %j', (saved) => {
  localStorage.setItem('dsh.voice-input.microphone', JSON.stringify(saved))
  expect(createMicrophoneDeviceStore().getSnapshot()).toEqual({ id: '', label: '' })
})

it('closes on page hiding and releases tracks even when AudioContext closure fails', async () => {
  const b = fixture()
  const hidden = vi.spyOn(document, 'hidden', 'get')
  try {
    await open()
    hidden.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByRole('menu')).toBeTruthy()
    b.close.mockRejectedValueOnce(new Error('device closed'))
    hidden.mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    expect(b.trackStop).toHaveBeenCalledOnce()
  } finally {
    hidden.mockRestore(); b.unmount()
    await Promise.allSettled(b.recordings.map(recording => recording.dispose()))
  }
})

it.each([new Error('device busy'), 'device busy'])('shows capture failures without preventing another device choice: %s', async (failure) => {
  const b = fixture()
  b.getUserMedia.mockRejectedValueOnce(failure)
  b.enumerateDevices.mockResolvedValueOnce([{ kind: 'audioinput', deviceId: 'unnamed', label: '' }])
  try {
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    await screen.findByRole('menuitem', { name: '麦克风 1' })
    expect(screen.getByText('语音识别失败：device busy')).toBeTruthy()
  } finally { b.unmount(); await Promise.all(b.recordings.map(recording => recording.dispose())) }
})

it('reports unavailable browser capture and enumeration failures inside the menu', async () => {
  const b = fixture()
  try {
    vi.stubGlobal('navigator', {})
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    await screen.findByText(zh.unavailable)
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    vi.stubGlobal('navigator', { mediaDevices: b.media })
    b.enumerateDevices.mockRejectedValueOnce(new Error('enumeration failed'))
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    await screen.findByText('语音识别失败：enumeration failed')
  } finally { b.unmount(); await Promise.all(b.recordings.map(recording => recording.dispose())) }
})

it('ignores device enumeration that settles after the menu closes', async () => {
  const b = fixture(), result = Promise.withResolvers<Awaited<ReturnType<typeof b.enumerateDevices>>>()
  b.enumerateDevices.mockReturnValueOnce(result.promise)
  try {
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    await waitFor(() => { expect(b.enumerateDevices).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    await act(async () => { result.resolve([{ kind: 'audioinput', deviceId: 'late', label: 'Late microphone' }]) })
    expect(screen.queryByText('Late microphone')).toBeNull()
    expect(b.trackStop).toHaveBeenCalledOnce()
  } finally { b.unmount(); await Promise.all(b.recordings.map(recording => recording.dispose())) }
})

it('does not publish a preview when the component unmounts at acquisition completion', async () => {
  const b = fixture(), acquired = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const createRecording = b.props.createRecording
  b.props.createRecording = () => {
    const capture = createRecording(), preview = capture.preview.bind(capture)
    vi.spyOn(capture, 'preview').mockImplementation(async (onError) => { await preview(onError); acquired.resolve(undefined); await release.promise })
    return capture
  }
  b.rerender(<MicrophonePicker {...b.props} />)
  try {
    fireEvent.click(screen.getByRole('button', { name: zh.inputDevice }))
    await act(async () => { await acquired.promise })
    b.unmount()
    await act(async () => { release.resolve(undefined) })
    expect(b.trackStop).toHaveBeenCalledOnce()
    expect(b.enumerateDevices).not.toHaveBeenCalled()
  } finally { release.resolve(undefined); await Promise.all(b.recordings.map(recording => recording.dispose())) }
})
