/** Command discovery and complete output preservation for the CLI reference. */

import { describe, expect, it } from 'vitest'
import { collectCliHelp, parseCliHelp } from './gen-cli-help.ts'

describe('CLI help discovery', () => {
  it('reads command rows while retaining wrapped descriptions and examples', () => {
    const help = 'Usage: dsh\r\n\r\nCommands:\r\n  web [options]  Serve the browser\r\n                 with a wrapped description\r\n  plugin         Manage plugins\r\n\r\nExamples:\r\n  dsh web\r\n'
    const result = parseCliHelp(help)
    expect(result.commands).toEqual(['web', 'plugin'])
    expect(result.output).toBe(help.replaceAll('\r\n', '\n'))
  })

  it('includes plugin, both profile forms, and their nested commands when launcher help has no command list', async () => {
    const visited: string[] = []
    const pages = await collectCliHelp(async (args) => {
      visited.push(args.join(' '))
      if (args.length === 0) return 'Usage: dsh [--profile] <name>\n'
      if (args[0] === 'plugin') return 'Usage: dsh plugin --profile <name> <args...>\n'
      const selected = args[0] === '--profile' ? args.slice(1) : args
      if (selected[1] === 'nested') return 'Usage: nested\n'
      return `Usage: ${selected[0]} [command]\n\nCommands:\n  nested  Run the nested command\n`
    }, ['web'])
    expect(visited).toEqual(['', 'plugin', 'web', 'web nested', '--profile web'])
    expect(pages.map(page => page.invocations)).toEqual([
      ['dsh'], ['dsh plugin'], ['dsh web', 'dsh --profile web'],
      ['dsh web nested', 'dsh --profile web nested'],
    ])
  })

  it.each(['', ' \r\n\n'])('rejects blank help %j', (help) => {
    expect(() => parseCliHelp(help)).toThrow('CLI help returned empty output')
  })
})
