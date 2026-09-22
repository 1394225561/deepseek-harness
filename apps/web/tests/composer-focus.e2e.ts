/** Browser selection and focus after presses in the composer's unused space. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/composer-focus', import.meta.url))
const EXPECTED = join(SNAPSHOT_DIR, 'focus.expected.md')

/**
 * Observe focus and both ends of the browser selection, including its direction.
 * @param page - Page containing the active composer.
 * @returns The editor's focus, draft and DOM selection.
 */
async function selectionState(page: Page) {
  return await page.locator('[data-composer-input]').evaluate((input) => {
    const selection = window.getSelection()
    return {
      focused: document.activeElement === input,
      draft: input.textContent,
      text: selection?.toString(),
      anchor: selection?.anchorOffset,
      focus: selection?.focusOffset,
    }
  })
}

/**
 * Exercise the card's top, inter-row gap, toolbar gap and bottom padding.
 * @param page - Page containing an editable composer.
 * @returns Stable behavior observations for the expected-output file.
 */
async function exerciseComposer(page: Page): Promise<string[]> {
  const input = page.locator('[data-composer-input][contenteditable="true"]')
  await input.click()
  await page.keyboard.insertText('alpha beta gamma')
  await page.keyboard.press('Home')
  for (let index = 0; index < 10; index++) await page.keyboard.press('ArrowRight')
  for (let index = 0; index < 4; index++) await page.keyboard.press('Shift+ArrowLeft')
  const selected = { focused: true, draft: 'alpha beta gamma', text: 'beta', anchor: 10, focus: 6 }
  await expect.poll(() => selectionState(page)).toEqual(selected)

  const points = await page.locator('[data-composer-card]').evaluate((card) => {
    const box = card.getBoundingClientRect()
    const scroll = card.querySelector('[data-input-scroll]')!.getBoundingClientRect()
    const row = card.querySelector('[data-input-scroll]')!.nextElementSibling!.getBoundingClientRect()
    return [
      { name: 'top padding', x: box.x + box.width / 2, y: (box.top + scroll.top) / 2 },
      { name: 'row gap', x: box.x + box.width / 2, y: (scroll.bottom + row.top) / 2 },
      { name: 'toolbar gap', x: box.x + box.width / 2, y: row.top + row.height / 2 },
      { name: 'bottom padding', x: box.x + box.width / 2, y: box.bottom - 2 },
    ]
  })
  const observations: string[] = []
  for (const point of points) {
    await page.mouse.click(point.x, point.y)
    await expect.poll(() => selectionState(page)).toEqual(selected)
    observations.push(`- ${point.name}: focused; selection "beta" (10 → 6)`)
  }

  const top = points[0]!
  const cardBox = await page.locator('[data-composer-card]').boundingBox()
  await page.mouse.click(cardBox!.x - 12, top.y)
  await expect.poll(async () => (await selectionState(page)).focused).toBe(false)
  await page.mouse.click(top.x, top.y)
  await expect.poll(() => selectionState(page)).toEqual(selected)
  observations.push('- return from outside: previous selection restored (10 → 6)')

  await page.keyboard.insertText('BETA')
  await expect.poll(() => input.textContent()).toBe('alpha BETA gamma')
  await page.keyboard.press('ArrowLeft')
  const caret = { focused: true, draft: 'alpha BETA gamma', text: '', anchor: 9, focus: 9 }
  await expect.poll(() => selectionState(page)).toEqual(caret)
  await page.mouse.click(top.x, top.y)
  await expect.poll(() => selectionState(page)).toEqual(caret)
  await page.keyboard.insertText('!')
  await expect.poll(() => input.textContent()).toBe('alpha BET!A gamma')
  observations.push('- typing replaces the restored selection and resumes at the restored caret: alpha BET!A gamma')
  return observations
}

it('restores the previous caret or selection in fresh and existing sessions', async () => {
  const scaffold = await launchWebScaffold({})
  const browserPromise = chromium.launch()
  onTestFinished(async () => {
    try { await (await browserPromise).close() }
    finally { await scaffold.close() }
  })
  const browser = await browserPromise
  const fixture = createChatScrollFixture({ markerPrefix: 'COMPOSER_FOCUS', title: 'Composer focus', turns: 1 })
  await seedSession(scaffold, fixture.log, 'composer-focus-web-e2e')
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd, 'composer-focus')
  const hero = await exerciseComposer(page)

  await page.getByRole('button', { name: 'Search sessions' }).click()
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(fixture.markers.user(1))
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => result.count(), { timeout: 60_000 }).toBe(1)
  await result.click()
  await page.getByText(fixture.markers.assistant(1), { exact: false }).last().waitFor()
  const docked = await exerciseComposer(page)

  await compareOrRefreshGolden(EXPECTED, [
    '# Composer whitespace focus', '', '## Fresh session', '', ...hero,
    '', '## Existing session', '', ...docked,
  ].join('\n'), webSnapshotMode())
  await assertFixtureInventory(SNAPSHOT_DIR, ['focus.expected.md'])
  expect(tripwire.warnings).toEqual([])
  expect(tripwire.pageErrors).toEqual([])
}, 180_000)
