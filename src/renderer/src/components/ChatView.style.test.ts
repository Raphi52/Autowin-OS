import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('chat wallpaper', () => {
  it('keeps the root layout free of backdrop blur', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const layout = css.match(/\.chat-layout\s*{([^}]*)}/s)?.[1]
    expect(layout).toBeDefined()
    expect(layout).not.toContain('backdrop-filter')
  })
})

describe('chat top bar surface', () => {
  it('uses the page surface through a transparent header while keeping its separator', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.cosmic-outline \.chat-head\s*{[^}]*border-bottom:\s*1px solid rgba\(212, 225, 239, 0\.18\)[^}]*background:\s*transparent/s
    )
  })
})

describe('minimal conversation status lights', () => {
  it('keeps the Native-style dot compact and reserves animation for running work', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    expect(css).toMatch(
      /\.conversation-state\s*{[^}]*width:\s*7px;[^}]*height:\s*7px;[^}]*background:\s*currentColor;[^}]*color:\s*#38bdf8;[^}]*box-shadow:/s
    )
    expect(css).toMatch(
      /\.conversation-state\.is-running\s*{[^}]*animation:\s*conversation-state-pulse/s
    )
    expect(css).toMatch(/\.conversation-state\.is-failed\s*{[^}]*color:\s*#ff4057/s)
    expect(css).toMatch(
      /\.conversation-state\.is-interrupted,[^}]*\.conversation-state\.is-cancelled\s*{[^}]*color:\s*#ffb020/s
    )
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^{]*{[^}]*\.conversation-state\.is-running,[^}]*animation:\s*none/s
    )
  })
})

describe('model final summary', () => {
  it('uses a scoped gold frame without backdrop blur', () => {
    const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
    const summary = css.match(/\.md-final-summary\s*{([^}]*)}/s)?.[1]

    expect(summary).toBeDefined()
    expect(summary).toMatch(/border:\s*1px solid rgba\(229, 184, 91,/)
    expect(summary).toContain('background: linear-gradient(')
    expect(summary).not.toContain('backdrop-filter')
  })
})
