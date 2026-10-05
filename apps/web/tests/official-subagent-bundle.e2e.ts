/** Official bundle activation reaches the real Claude SDK/CLI; only both model responses are scripted. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-tools'
import {
  assertFinalWorkspaceSnapshot, assertFixtureInventory, captureExpandedTurnProcessAria, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, selectedSessionFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const DIR = fileURLToPath(new URL('../../../snapshots/web/official-subagent-bundle', import.meta.url))
const FIXTURE = join(DIR, 'session.v4.jsonl')
const PACKAGE = fileURLToPath(new URL('../../../packages/subagent/subagent-claude-code', import.meta.url))
const BUNDLE = '@deepseek-ai/dsh-subagent-claude-code'
const RESPONSE = 'OFFICIAL_SUBAGENT_OK'
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web snapshot: Official native subagent bundle', () => {
  let root: string
  let server: MockLlmServer
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-official-subagent-'))
    const config = join(root, 'claude-config')
    const xdg = join(root, 'xdg')
    await Promise.all([mkdir(config), mkdir(xdg)])
    server = await startMockLlmServer({ sequence: ['success'], successText: RESPONSE, apiKey: 'snapshot-fake-key' })
    const overlay = join(root, 'native-provider.patch.json')
    // This environment belongs only to the SDK-spawned product; host credentials and homes remain untouched.
    await writeFile(overlay, JSON.stringify([{ id: 'subagent-claude-code', config: {
      model: 'fixture-model',
      env: {
        ANTHROPIC_API_KEY: 'snapshot-fake-key', ANTHROPIC_BASE_URL: server.baseURL,
        CLAUDE_CONFIG_DIR: config, HOME: root, XDG_CONFIG_HOME: xdg,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
        DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
        HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost',
      },
    } }]))
    scaffold = await launchWebScaffold({
      developerTools: true, profile: { packages: [{ dir: PACKAGE }] },
      extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay],
      replayFixture: FIXTURE, compareReplaySession: true,
    })
    expect((await scaffold.ctx.pluginManager.listBundles()).find(bundle => bundle.name === BUNDLE))
      .toMatchObject({ official: true, availability: 'profile', enabled: false })
    expect((await scaffold.ctx.agentPresets.compositionInventory()).find(preset => preset.id === 'ptc')?.rows
      .some(row => row.entryId === 'optional-tool-subagent-claude-code')).toBe(false)
    expect(await scaffold.ctx.pluginManager.setBundleEnabled(BUNDLE, true))
      .toMatchObject({ application: 'applied', changed: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Standard mode', exact: true }).click()
    await page.getByRole('menuitem', { name: /^PTC mode/ }).click()
    await page.getByRole('button', { name: 'PTC mode', exact: true }).waitFor({ state: 'visible' })
  })

  afterAll(async () => {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally {
        try { await server?.close() } finally { if (root !== undefined) await rm(root, { recursive: true, force: true }) }
      }
    }
  })

  it('persists the SDK delegation, actual native result, and unchanged workspace', async () => {
    onTestFailed(() => saveFailureShot(page, 'official-subagent-bundle'))
    const prompts = fixtureUserPrompts(await readFile(await selectedSessionFixture(FIXTURE), 'utf8'))
    expect(prompts).toHaveLength(1)
    const settled = scaffold.whenTurnSettled(120_000)
    const input = page.locator('[data-composer-input]').first()
    await input.fill(prompts[0]!)
    await input.press('Enter')
    const sessionId = await settled
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Native delegation Session has no live Agent')
    expect(scaffold.ctx.agentPresets.composedPreset(agent.ctx)).toBe('ptc')
    expect(agent.session.requestHeader()?.tools?.map(tool => tool.name)).toEqual(['run_code'])
    const system = agent.session.deriveMessages().filter(message => message.role === 'system')
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
    expect(system).toContain('subagent_claude_code')
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['run_code'])
    const dispatches = events.filter(event => event.type === 'tool/ptc-dispatch').map(event => event.data)
    expect(dispatches).toMatchObject([{ name: 'subagent_claude_code', isError: false }])
    expect(dispatches[0]?.content).toEqual([{ type: 'text', text: RESPONSE }])
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.body).toMatchObject({ model: 'fixture-model' })
    expect(JSON.stringify(server.requests[0]?.body)).toContain(RESPONSE)
    expect(server.requests[0]?.headers['x-api-key']).toBe('snapshot-fake-key')
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new Error('Native delegation Session has no working directory')
    await assertFinalWorkspaceSnapshot(DIR, cwd)
    await expect.poll(() => page.getByText('DONE', { exact: true }).count()).toBeGreaterThanOrEqual(1)
    await compareOrRefreshGolden(join(DIR, 'ui.expected.md'),
      await captureExpandedTurnProcessAria(page, '[data-chat-flow]', scaffold.workspaceCwd), MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it.skipIf(MODE !== 'replay')('keeps the owned fixture artifacts closed', async () => {
    await assertFixtureInventory(DIR, [
      'session.v4.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json', 'ui.expected.md', 'workspace.expected',
    ])
  })
})
