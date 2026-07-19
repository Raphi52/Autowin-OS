import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export class ApprovedBehaviourWorkspaces {
  private readonly roots = new Set<string>()

  constructor(defaultRoot: string) {
    this.approve(defaultRoot)
  }

  approve(path: string): string {
    const canonical = realpathSync(resolve(path))
    if (!statSync(canonical).isDirectory()) throw new Error('Le workspace doit être un dossier')
    this.roots.add(canonical.toLowerCase())
    return canonical
  }

  require(path: string): string {
    const canonical = realpathSync(resolve(path))
    if (!this.roots.has(canonical.toLowerCase()))
      throw new Error('Workspace Behaviour non approuvé par le sélecteur natif')
    return canonical
  }
}

export function isTrustedRendererUrl(
  senderUrl: string,
  options: { devRendererUrl?: string; rendererHtmlPath?: string }
): boolean {
  try {
    const sender = new URL(senderUrl)
    if (options.devRendererUrl) return sender.origin === new URL(options.devRendererUrl).origin
    if (!options.rendererHtmlPath || sender.protocol !== 'file:') return false
    const expected = pathToFileURL(resolve(options.rendererHtmlPath))
    return (
      sender.host.toLowerCase() === expected.host.toLowerCase() &&
      decodeURIComponent(sender.pathname).toLowerCase() ===
        decodeURIComponent(expected.pathname).toLowerCase()
    )
  } catch {
    return false
  }
}
