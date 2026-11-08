import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { estUnDossier, listerRecursif } from './dossiers'
import { memeContenu } from './meme-contenu'
import { cancelBody } from '../compute-fabric/corps-de-reponse'
import { comparablePath } from '../dashboards/runs-scan'
import { hasOwn } from '../task-manager/task-store'
import { memeNom } from '../app/coffre-cles'
import { nonEmptyString } from '../profil/role-store'
import { promptDuFil } from '../providers/prompt-du-fil'
import type { Message } from '../providers/types'

/*
 * Des fonctions du processus principal copiées à l'identique dans deux fichiers n'en font plus
 * qu'une (`scripts/fonctions-en-double.mjs`). Chaque test fixe la réponse que les deux copies
 * donnaient, pour que la version unique ne change rien pour leurs appelants.
 */
const racine = mkdtempSync(join(tmpdir(), 'copies-regroupees-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))

describe('fichiers', () => {
  it('listerRecursif : chemins relatifs en `/`, sous-dossiers compris ; dossier absent = rien', () => {
    mkdirSync(join(racine, 'modele', 'voix'), { recursive: true })
    writeFileSync(join(racine, 'modele', 'a.onnx'), '')
    writeFileSync(join(racine, 'modele', 'voix', 'b.json'), '')
    expect(listerRecursif(join(racine, 'modele')).sort()).toEqual(['a.onnx', 'voix/b.json'])
    expect(listerRecursif(join(racine, 'absent'))).toEqual([])
  })

  it('estUnDossier : vrai pour un dossier, faux pour un fichier ou un chemin absent', async () => {
    writeFileSync(join(racine, 'f.txt'), 'x')
    expect(await estUnDossier(racine)).toBe(true)
    expect(await estUnDossier(join(racine, 'f.txt'))).toBe(false)
    expect(await estUnDossier(join(racine, 'absent'))).toBe(false)
  })

  it('memeContenu : égalité octet par octet', () => {
    expect(memeContenu(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(memeContenu(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(memeContenu(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
    expect(memeContenu(new Uint8Array([]), new Uint8Array([]))).toBe(true)
  })

  it('comparablePath : chemin résolu, en minuscules sous Windows seulement', () => {
    const attendu = resolve('Dossier/Sous')
    expect(comparablePath('Dossier/Sous')).toBe(
      process.platform === 'win32' ? attendu.toLocaleLowerCase('en-US') : attendu
    )
  })
})

describe('petites aides', () => {
  it('hasOwn : propriété propre seulement, jamais héritée', () => {
    expect(hasOwn({ a: undefined }, 'a')).toBe(true)
    expect(hasOwn({}, 'toString')).toBe(false)
    expect(hasOwn(Object.create({ a: 1 }), 'a')).toBe(false)
  })

  it('memeNom : noms égaux sans tenir compte de la casse', () => {
    expect(memeNom('groq_api_key', 'GROQ_API_KEY')).toBe(true)
    expect(memeNom('GROQ', 'GROQ_API_KEY')).toBe(false)
  })

  it('nonEmptyString : une chaîne qui garde au moins un caractère hors blancs', () => {
    expect(nonEmptyString('claude')).toBe(true)
    for (const v of ['', '   ', undefined, null, 3, {}]) expect(nonEmptyString(v)).toBe(false)
  })

  it('cancelBody : annule le corps de la réponse, et avale l’échec de l’annulation', async () => {
    const raisons: unknown[] = []
    const ok = {
      body: { cancel: async (r: unknown) => void raisons.push(r) }
    } as unknown as Response
    await cancelBody(ok, 'trop gros')
    expect(raisons).toEqual(['trop gros'])
    const casse = {
      body: {
        cancel: async () => {
          throw new Error('déjà fermé')
        }
      }
    } as unknown as Response
    await expect(cancelBody(casse, 'x')).resolves.toBeUndefined()
    await expect(cancelBody({ body: null } as unknown as Response, 'x')).resolves.toBeUndefined()
  })
})

describe('promptDuFil : le fil mis à plat pour un fournisseur sans historique', () => {
  const m = (
    role: Message['role'],
    content: string,
    attachments?: Message['attachments']
  ): Message => ({ role, content, ...(attachments ? { attachments } : {}) }) as Message

  it('un seul message : son texte nu, après la consigne système', () => {
    expect(promptDuFil([m('user', 'bonjour')], 'Tu es utile.')).toBe('Tu es utile.\n\nbonjour')
  })

  it('plusieurs messages : chacun sous son rôle, pièces jointes texte comprises', () => {
    const fil = [
      m('user', 'lis ça', [
        { kind: 'text', name: 'a.txt', content: 'contenu' }
      ] as Message['attachments']),
      m('assistant', 'lu')
    ]
    expect(promptDuFil(fil)).toBe(
      '[user]\nlis ça\n\n[Pièce jointe a.txt]\ncontenu\n\n[assistant]\nlu'
    )
  })
})
