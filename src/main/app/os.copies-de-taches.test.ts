import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * Le composant racine construit le gestionnaire des copies et le store de l'état des runs. Les deux
 * doivent recevoir la même racine unique, sinon une copie neuve naît à un endroit et se relit à un
 * autre. Le texte est lu, pas importé : `os.ts` charge Electron.
 */
const source = readFileSync(new URL('./os.ts', import.meta.url), 'utf8')

/** Le texte d'un appel, de son ouverture jusqu'à la première fermeture `})` qui suit. */
function appel(ouverture: string): string {
  const debut = source.indexOf(ouverture)
  if (debut < 0) return ''
  return source.slice(debut, source.indexOf('})', debut) + 2)
}

describe('composition des copies d’agent dans le composant racine', () => {
  it('le gestionnaire des copies reçoit la racine unique', () => {
    expect(appel('new WorktreeManager({')).toMatch(/racineCopiesDeTaches,/)
  })

  it('le store de l’état des runs reçoit la même racine unique', () => {
    expect(appel('new WorktreeRunStateStore(')).toMatch(/racineCopiesDeTaches/)
  })
})
