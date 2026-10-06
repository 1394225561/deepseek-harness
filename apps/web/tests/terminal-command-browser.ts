import type { Locator, Page } from 'playwright'
import { expect } from 'vitest'

/**
 * Scroll and select an overflowing command in its rendered terminal card.
 * @param page - Browser page that owns the card.
 * @param card - Terminal card rendered by the application.
 * @param expected - Complete single-line command.
 * @param width - Narrow card width that leaves part of the command offscreen.
 * @returns Resolves when the tail is reachable and native copying retains the full command.
 */
export async function expectSelectableTerminalCommand(page: Page, card: Locator, expected: string, width: number): Promise<void> {
  const originalWidth = await card.evaluate(element => element.style.width)
  const command = card.locator('[class*="_command"]').first()
  try {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
      expect(await command.textContent()).toBe(expected)
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await command.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      })).toBe(1)
      await card.evaluate((element, value) => { element.style.width = `${value}px` }, width)
      await command.scrollIntoViewIfNeeded()
      const controls = card.locator('[class*="_cwd"], [class*="_runState"]:not([class*="Label"]), [class*="_status"], [class*="_copyButton"]')
      expect(await controls.count()).toBeGreaterThanOrEqual(3)
      const before = await controls.evaluateAll(elements => elements.map((element) => {
        const { x, y, width: w, height } = element.getBoundingClientRect()
        return { x, y, width: w, height }
      }))
      await expectSelectableCommandText(page, command, expected)
      expect(await controls.evaluateAll(elements => elements.map((element) => {
        const { x, y, width: w, height } = element.getBoundingClientRect()
        return { x, y, width: w, height }
      }))).toEqual(before)
      await card.evaluate((element, value) => { element.style.width = value }, originalWidth)
    }
  } finally {
    await card.evaluate((element, value) => { element.style.width = value }, originalWidth)
    await page.emulateMedia({ colorScheme: null })
  }
}

/**
 * Verify native command selection within a text scrollport.
 * @param page - Browser page that owns the text.
 * @param command - Text scrollport containing the command, optionally within argument JSON.
 * @param expected - Complete command, including its offscreen suffix.
 * @returns Resolves after horizontal navigation and native selection/copy succeed.
 */
export async function expectSelectableCommandText(page: Page, command: Locator, expected: string): Promise<void> {
  const geometry = async () => command.evaluate((element, value) => {
    const text = element.firstChild
    if (!(text instanceof Text) || text.length === 0) throw new Error('Command has no text node')
    const offset = text.data.indexOf(value)
    if (offset < 0) throw new Error('Command text does not contain the expected command')
    const first = document.createRange()
    first.setStart(text, offset)
    first.setEnd(text, offset + 1)
    const last = document.createRange()
    last.setStart(text, offset + value.length - 1)
    last.setEnd(text, offset + value.length)
    const head = first.getBoundingClientRect()
    const tail = last.getBoundingClientRect()
    const viewport = element.getBoundingClientRect()
    return {
      head: { x: head.left, y: head.top, height: head.height },
      tail: { x: tail.right, y: tail.top },
      left: viewport.left,
      right: viewport.right,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
    }
  }, expected)
  expect(await command.textContent()).toContain(expected)
  const start = await geometry()
  expect(start.scrollWidth).toBeGreaterThan(start.clientWidth)
  expect(start.tail.y).toBeCloseTo(start.head.y, 1)
  expect(start.tail.x).toBeGreaterThan(start.right)
  await command.hover()
  await page.mouse.wheel(start.scrollWidth, 0)
  await expect.poll(async () => {
    const end = await geometry()
    return end.tail.x <= end.right + 1 && end.tail.x >= end.left && end.scrollLeft > 0
  }).toBe(true)
  await page.mouse.wheel(-start.scrollWidth, 0)
  await expect.poll(() => command.evaluate(element => element.scrollLeft)).toBe(0)
  const head = await geometry()
  await page.mouse.move(head.head.x + 0.1, head.head.y + head.head.height / 2)
  await page.mouse.down()
  try {
    await page.mouse.move(head.right - 1, head.head.y + head.head.height / 2, { steps: 5 })
    await page.mouse.wheel(start.scrollWidth, 0)
    await expect.poll(async () => {
      const value = await geometry()
      return value.tail.x <= head.right + 1 ? 'visible' : JSON.stringify({ before: head, after: value })
    }).toBe('visible')
    const end = await geometry()
    await page.mouse.move(end.tail.x - 0.1, head.head.y + head.head.height / 2)
  } finally {
    await page.mouse.up()
  }
  try {
    await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(expected)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
  } finally {
    await command.evaluate((element) => {
      element.scrollLeft = 0
      document.getSelection()?.removeAllRanges()
    })
  }
}
