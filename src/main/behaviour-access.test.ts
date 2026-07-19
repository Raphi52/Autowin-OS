import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApprovedBehaviourWorkspaces, isTrustedRendererUrl } from './behaviour-access'

const sandboxes: string[] = []

function directory(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

afterEach(() => {
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('behaviour IPC authority', () => {
  it('accepts only the default workspace and roots approved by the native chooser', () => {
    const root = mkdtempSync(join(tmpdir(), 'behaviour-access-'))
    sandboxes.push(root)
    const defaultRoot = directory(root, 'default')
    const chosenRoot = directory(root, 'chosen')
    const arbitraryRoot = directory(root, 'arbitrary')
    const access = new ApprovedBehaviourWorkspaces(defaultRoot)

    expect(access.require(defaultRoot)).toBe(defaultRoot)
    expect(() => access.require(arbitraryRoot)).toThrow(/approuv|autoris/i)
    expect(access.approve(chosenRoot)).toBe(chosenRoot)
    expect(access.require(chosenRoot)).toBe(chosenRoot)
  })

  it('accepts only the configured renderer origin in dev and the packaged file in production', () => {
    expect(
      isTrustedRendererUrl('http://localhost:5173/behaviour', {
        devRendererUrl: 'http://localhost:5173/'
      })
    ).toBe(true)
    expect(
      isTrustedRendererUrl('http://attacker.test/behaviour', {
        devRendererUrl: 'http://localhost:5173/'
      })
    ).toBe(false)
    expect(
      isTrustedRendererUrl('file:///C:/app/renderer/index.html#behaviour', {
        rendererHtmlPath: 'C:\\app\\renderer\\index.html'
      })
    ).toBe(true)
    expect(
      isTrustedRendererUrl('file:///C:/app/renderer/other.html', {
        rendererHtmlPath: 'C:\\app\\renderer\\index.html'
      })
    ).toBe(false)
    expect(
      isTrustedRendererUrl('file://attacker/C:/app/renderer/index.html', {
        rendererHtmlPath: 'C:\\app\\renderer\\index.html'
      })
    ).toBe(false)
  })
})
