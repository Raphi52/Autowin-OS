import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readProviderStream, resolveProviderStreamPath } from './provider-stream'

function racine(): string {
  return mkdtempSync(join(tmpdir(), 'flux-brut-'))
}

describe('readProviderStream', () => {
  it('rend chaque ligne du flux brut, ENTIÈRE (aucune coupe)', () => {
    const root = racine()
    const path = join(root, 'run-1.stdout.jsonl')
    const long = 'x'.repeat(50_000)
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5' }),
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: long }] }
        })
      ].join('\n') + '\n',
      'utf8'
    )
    const lu = readProviderStream(path, { chunkBytes: 4_096 })
    expect(lu.missing).toBe(false)
    expect(lu.lines).toHaveLength(2)
    const contenu = (lu.lines[1].message as { content: Array<{ text: string }> }).content
    expect(contenu[0].text).toBe(long) // lu par tranches de 4 Ko, recollé sans perte
    expect(lu.unreadable).toBe(0)
  })

  it('ignore la ligne en cours d’écriture sans planter, et la compte', () => {
    const root = racine()
    const path = join(root, 'run-2.stdout.jsonl')
    writeFileSync(path, JSON.stringify({ type: 'system' }) + '\n{"type":"assist', 'utf8')
    const lu = readProviderStream(path)
    expect(lu.lines).toHaveLength(1)
    expect(lu.unreadable).toBe(1)
    // L'offset s'arrête DEVANT la ligne partielle : une relecture la reprendra entière.
    expect(lu.offset).toBe(Buffer.byteLength(JSON.stringify({ type: 'system' }) + '\n', 'utf8'))
  })

  it('masque les secrets SANS raccourcir le texte porteur', () => {
    const root = racine()
    const path = join(root, 'run-3.stdout.jsonl')
    const suite = ' et la suite du texte reste entière, mot pour mot.'
    writeFileSync(
      path,
      JSON.stringify({
        type: 'assistant',
        api_key: 'sk-proj-ABCDEFGH12345678',
        message: { content: [{ type: 'text', text: `voici ghp_ABCDEFGH12345678${suite}` }] }
      }) + '\n',
      'utf8'
    )
    const lu = readProviderStream(path)
    const texte = (lu.lines[0].message as { content: Array<{ text: string }> }).content[0].text
    expect(texte).not.toContain('ghp_ABCDEFGH12345678')
    expect(texte).toContain('[REDACTED]')
    expect(texte.endsWith(suite)).toBe(true)
    expect(lu.lines[0].api_key).toBe('[REDACTED]')
  })

  it('dit « absent » plutôt que d’échouer quand le flux a été purgé', () => {
    const lu = readProviderStream(join(racine(), 'jamais-ecrit.stdout.jsonl'))
    expect(lu).toMatchObject({ missing: true, lines: [], unreadable: 0 })
  })
})

describe('resolveProviderStreamPath', () => {
  it('accepte un flux brut sous la racine', () => {
    const root = racine()
    const path = join(root, 'run-1.stdout.jsonl')
    expect(resolveProviderStreamPath(root, path)).toBe(path)
  })

  it('refuse un chemin hors racine ou un fichier qui n’est pas un flux brut', () => {
    const root = racine()
    expect(() => resolveProviderStreamPath(root, join(root, '..', 'ailleurs.stdout.jsonl'))).toThrow(
      /hors de la racine/
    )
    expect(() => resolveProviderStreamPath(root, join(root, 'secrets.json'))).toThrow(/flux brut/)
    expect(() => resolveProviderStreamPath('', join(root, 'a.stdout.jsonl'))).toThrow(/racine/)
  })
})
