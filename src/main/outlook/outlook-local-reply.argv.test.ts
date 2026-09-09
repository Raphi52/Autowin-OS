import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ce que la passerelle passe REELLEMENT a PowerShell pour une reponse.
 *
 * Ce fichier existe a cause d'un defaut trouve pendant la construction du 2026-09-09 : les pieces
 * jointes de la reponse traversaient toute la chaine, la suite etait verte... et le lanceur par
 * defaut (le seul qui appelle vraiment PowerShell) ne posait PAS l'argument `-PiecesFichier`. Tous
 * les autres tests injectent un `replier` factice, donc aucun ne regardait ce fil-la. C'est
 * exactement la forme « ca a l'air branche, ca ne l'est pas ».
 *
 * On mocke donc `execFile` et on construit la passerelle SANS injection : c'est le seul moyen de
 * lire les arguments que recevrait le script sur le poste.
 */
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

const { OutlookLocalGateway } = await import('./outlook-local')

const ID = 'A'.repeat(32)

/** Repond comme un script qui a reussi : dernier argument = le rappel d'`execFile`. */
function repondSucces(): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const rappel = args[args.length - 1] as (erreur: null) => void
    rappel(null)
  })
}

/** Les arguments de la ligne de commande du dernier appel a `execFile`. */
function argumentsDuDernierAppel(): string[] {
  const appel = execFileMock.mock.calls.at(-1)
  return (appel?.[1] ?? []) as string[]
}

beforeEach(() => {
  execFileMock.mockReset()
  repondSucces()
})

async function passerelle() {
  return new OutlookLocalGateway({ appRoot: await mkdtemp(join(tmpdir(), 'autowin-argv-')) })
}

describe('reponse : les arguments passes a PowerShell', () => {
  it('POSE -PiecesFichier quand la reponse porte une piece jointe', async () => {
    const octets = Buffer.from('PDF-1', 'utf8')
    const resultat = await (
      await passerelle()
    ).replyToItem(ID, 'Ci-joint', [
      { nom: 'devis.pdf', taille: octets.length, contenuBase64: octets.toString('base64') }
    ])
    expect(resultat.ok).toBe(true)
    const argv = argumentsDuDernierAppel()
    expect(argv).toContain('-PiecesFichier')
    // Le corps ET la liste voyagent par des FICHIERS : le texte n'apparait jamais en argument.
    expect(argv).toContain('-CorpsFichier')
    expect(argv).not.toContain('Ci-joint')
    // La valeur qui suit le drapeau est le chemin du fichier de liste, pas un nom de piece.
    const chemin = argv[argv.indexOf('-PiecesFichier') + 1]
    expect(chemin.endsWith('pieces.txt')).toBe(true)
  })

  it('ne POSE PAS -PiecesFichier quand la reponse n a aucune piece', async () => {
    // Une reponse sans piece part exactement comme avant : le script n'a pas de fichier vide a
    // interpreter, et son parametre reste optionnel.
    const resultat = await (await passerelle()).replyToItem(ID, 'Merci')
    expect(resultat.ok).toBe(true)
    expect(argumentsDuDernierAppel()).not.toContain('-PiecesFichier')
  })

  it('appelle le script de REPONSE, pas celui du message neuf', async () => {
    await (await passerelle()).replyToItem(ID, 'Merci')
    const argv = argumentsDuDernierAppel()
    const script = argv[argv.indexOf('-File') + 1]
    expect(script.endsWith('outlook-local-reply.ps1')).toBe(true)
  })
})
