import { describe, expect, it } from 'vitest'
import { compactageDuFil, lignesDuCarnet } from './carnet-du-fil'
import { depuisDerniereCompaction } from '../../../main/chat-turn-messages'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import type { Msg } from './chat-view-types'

/**
 * « COMPACTER MONTRE CE QUI EST GARDÉ » (conv-1038, 2026-10-21 — idée 5 du scout). Le bouton
 * Compacter était opaque : il envoie `COMPACT_REQUEST`, l'agent écrit un résumé, et dès lors le
 * processus principal ne renvoie plus que ce résumé et la suite (`depuisDerniereCompaction`,
 * `chat-turn-messages.ts`). Rien ne disait à l'utilisateur ce que l'agent garde ni ce qu'il ne
 * relit plus.
 *
 * Le carnet applique la MÊME règle que la coupe côté principal — sinon il montrerait un résumé que
 * l'agent ne relit pas, ou en cacherait un qu'il relit. Les entrées qui font échouer une version
 * fausse :
 *  - un résumé ENCORE EN COURS d'écriture : rien n'est gardé tant qu'il n'est pas fini ;
 *  - DEUX compactages : seul le dernier compte, et le compte des messages laissés part de lui ;
 *  - la demande suivie d'espaces (le principal compare après `trim`) : c'est bien un compactage ;
 *  - un message qui CITE la demande au milieu d'autre texte : ce n'en est pas un ;
 *  - une réponse ratée (status `failed`) : le principal coupe quand même — le carnet le dit,
 *    au lieu de prétendre qu'il ne s'est rien passé.
 */

const user = (content: string, ts: number): Msg => ({ role: 'user', content, ts }) as Msg

const asst = (text: string, extra: Record<string, unknown> = {}): Msg =>
  ({
    role: 'assistant',
    status: 'completed',
    done: true,
    parts: text ? [{ kind: 'text', text }] : [],
    ...extra
  }) as unknown as Msg

const RESUME = [
  '## Objectif',
  'Construire les 7 idées du chat.',
  '',
  '## Décisions',
  '- **retour au code** dans une copie séparée, jamais dans le dossier partagé',
  '- idée 3 en attente de ta décision',
  '---',
  '## Reste à faire',
  '1. la carte de comparaison'
].join('\n')

/** Ce que le principal renverrait à l'agent au tour suivant, pour comparer avec le carnet. */
function vuDuPrincipal(fil: readonly Msg[]): Array<{ role: string; content: string }> {
  const plat = fil.map((message): { role: 'user' | 'assistant'; content: string } =>
    message.role === 'user'
      ? { role: 'user', content: (message as { content: string }).content }
      : {
          role: 'assistant',
          content: ((message as { parts?: Array<{ kind: string; text?: string }> }).parts ?? [])
            .map((part) => part.text ?? '')
            .join('\n')
        }
  )
  return depuisDerniereCompaction(plat)
}

describe('compactageDuFil — ce que l’agent garde après « Compacter »', () => {
  it('compactage fini : le résumé est gardé, et les messages d’avant sont comptés', () => {
    const fil = [
      user('construis les 7 idées', 1),
      asst('Fait : idée 1.'),
      user(COMPACT_REQUEST, 2),
      asst(RESUME)
    ]
    const etat = compactageDuFil(fil)
    expect(etat).toEqual({
      etat: 'fait',
      laisses: 2,
      garde: [
        'Objectif',
        'Construire les 7 idées du chat.',
        'Décisions',
        'retour au code dans une copie séparée, jamais dans le dossier partagé',
        'idée 3 en attente de ta décision',
        'Reste à faire',
        'la carte de comparaison'
      ],
      restantes: 0,
      repondu: true
    })
    // Même coupe que le principal : il renvoie la demande et le résumé, rien d'avant.
    expect(vuDuPrincipal(fil)).toHaveLength(fil.length - 2)
  })

  it('résumé encore en cours : rien n’est gardé, le compactage est dit en cours', () => {
    const fil = [
      user('construis', 1),
      asst('ok'),
      user(COMPACT_REQUEST, 2),
      asst('## Objectif\nConstr', { status: 'streaming', done: false })
    ]
    expect(compactageDuFil(fil)).toEqual({ etat: 'en-cours' })
    expect(lignesDuCarnet({ fil }).filter((ligne) => ligne.rubrique === 'garde')).toEqual([])
  })

  it('demande envoyée, pas encore de réponse : compactage en cours', () => {
    expect(compactageDuFil([user('a', 1), asst('b'), user(COMPACT_REQUEST, 2)])).toEqual({
      etat: 'en-cours'
    })
  })

  it('deux compactages : seul le dernier compte, et les tours d’après ne l’effacent pas', () => {
    const fil = [
      user('a', 1),
      asst('b'),
      user(COMPACT_REQUEST, 2),
      asst('ancien résumé'),
      user('continue', 3),
      asst('c'),
      user(COMPACT_REQUEST, 4),
      asst('nouveau résumé'),
      user('et maintenant ?', 5),
      asst('d')
    ]
    const etat = compactageDuFil(fil)
    expect(etat).toMatchObject({ etat: 'fait', laisses: 6, garde: ['nouveau résumé'] })
    expect(vuDuPrincipal(fil)).toHaveLength(fil.length - 6)
  })

  it('la demande suivie d’espaces est un compactage ; une demande citée n’en est pas un', () => {
    const avecEspaces = [user('a', 1), asst('b'), user(`  ${COMPACT_REQUEST}\n`, 2), asst('résumé')]
    expect(compactageDuFil(avecEspaces)).toMatchObject({ etat: 'fait', laisses: 2 })
    const citee = [user(`Que fait ce texte ? ${COMPACT_REQUEST}`, 1), asst('il résume')]
    expect(compactageDuFil(citee)).toBeNull()
    expect(vuDuPrincipal(citee)).toHaveLength(2)
  })

  it('réponse ratée : le principal coupe quand même, le carnet dit qu’aucun résumé n’est gardé', () => {
    const fil = [user('a', 1), asst('b'), user(COMPACT_REQUEST, 2), asst('', { status: 'failed' })]
    expect(compactageDuFil(fil)).toEqual({
      etat: 'fait',
      laisses: 2,
      garde: [],
      restantes: 0,
      repondu: false
    })
    expect(vuDuPrincipal(fil)).toHaveLength(2)
  })

  it('un long résumé est montré en tête, et le reste est COMPTÉ, jamais tu', () => {
    const long = Array.from({ length: 20 }, (_, rang) => `- point ${rang + 1}`).join('\n')
    const etat = compactageDuFil([user('a', 1), asst('b'), user(COMPACT_REQUEST, 2), asst(long)])
    expect(etat).toMatchObject({ etat: 'fait', restantes: 8 })
    expect(etat && etat.etat === 'fait' ? etat.garde : []).toHaveLength(12)
  })

  it('sans compactage : rien, et aucune ligne « gardé » dans le carnet', () => {
    const fil = [user('a', 1), asst('b')]
    expect(compactageDuFil(fil)).toBeNull()
    expect(lignesDuCarnet({ fil }).some((ligne) => ligne.rubrique === 'garde')).toBe(false)
  })

  it('le résumé gardé devient des lignes du carnet, barrables comme les autres', () => {
    const fil = [user('a', 1), asst('b'), user(COMPACT_REQUEST, 2), asst(RESUME)]
    const gardees = lignesDuCarnet({ fil }).filter((ligne) => ligne.rubrique === 'garde')
    expect(gardees.map((ligne) => ligne.texte)).toContain('idée 3 en attente de ta décision')
    expect(new Set(gardees.map((ligne) => ligne.cle)).size).toBe(gardees.length)
  })

  // check: défaut vu sur la capture réelle du 2026-10-21 (cap-facons.png, instance cachée, code
  // construit) — après « Compacter », l'Objectif du carnet affichait « Compacte ce fil : … ».
  it('après un compactage, l’objectif reste la demande de l’utilisateur, pas « Compacte ce fil »', () => {
    const fil = [
      user('valide les montants saisis', 1),
      asst('b'),
      user(COMPACT_REQUEST, 2),
      asst(RESUME)
    ]
    const objectif = lignesDuCarnet({ fil }).filter((ligne) => ligne.rubrique === 'objectif')
    expect(objectif.map((ligne) => ligne.texte)).toEqual(['valide les montants saisis'])
  })
})
