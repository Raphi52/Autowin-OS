import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ApprovedBehaviourWorkspaces,
  isSceneFrameUrl,
  isTrustedRendererUrl
} from './behaviour-access'

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

  // conv-299 : la page des scenes 3D du fil est le SEUL document de l'app qu'un cadre peut charger.
  it('ne laisse un cadre charger que la page des scenes 3D de l app, a son adresse exacte', () => {
    const dev = { devRendererUrl: 'http://localhost:5173/' }
    expect(isSceneFrameUrl('http://localhost:5173/scene-3d.html', dev)).toBe(true)
    expect(isSceneFrameUrl('http://localhost:5173/index.html', dev)).toBe(false)
    expect(isSceneFrameUrl('http://localhost:5174/scene-3d.html', dev)).toBe(false)
    expect(isSceneFrameUrl('https://attacker.test/scene-3d.html', dev)).toBe(false)
    expect(isSceneFrameUrl('http://localhost:5173/x/scene-3d.html', dev)).toBe(false)

    const installee = { rendererHtmlPath: 'C:\\app\\renderer\\index.html' }
    expect(isSceneFrameUrl('file:///C:/app/renderer/scene-3d.html', installee)).toBe(true)
    expect(isSceneFrameUrl('file:///C:/app/renderer/index.html', installee)).toBe(false)
    expect(isSceneFrameUrl('file:///C:/autre/scene-3d.html', installee)).toBe(false)
    expect(isSceneFrameUrl('file://attacker/C:/app/renderer/scene-3d.html', installee)).toBe(false)
    expect(isSceneFrameUrl('http://localhost:5173/scene-3d.html', installee)).toBe(false)
    expect(isSceneFrameUrl('pas une adresse', installee)).toBe(false)
  })
})
