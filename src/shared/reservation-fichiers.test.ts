import { describe, expect, it } from 'vitest'
import {
  BAIL_RESERVATION_MS,
  refusCommitReserve,
  reserverOuRefuser,
  type IoCommitReserve,
  type IoReservation
} from './reservation-fichiers'

/*
 * RÉSERVATION DES FICHIERS ENTRE FILS (conv-1083, 2026-10-22).
 *
 * Entrée qui ferait échouer ce banc si la garde était fausse : conv-B édite
 * `D:\AutoWinOS\src\x.ts` 10 min après conv-A, fichier encore modifié et non commité — elle doit être
 * REFUSÉE en nommant conv-A. Jumeaux acceptés à la même borne : fichier commité entre-temps, bail
 * échu, même fil.
 */
const REGISTRE = 'R:/reservations.json'
const X = 'D:/AutoWinOS/src/x.ts'
const T0 = Date.UTC(2026, 9, 22, 14, 0, 0)

function io(propre: boolean | undefined = false, initial?: string) {
  const fichiers = new Map<string, string>(initial === undefined ? [] : [[REGISTRE, initial]])
  const sondes: string[] = []
  const acces: IoReservation = {
    lire: (p) => fichiers.get(p),
    ecrire: (p, t) => void fichiers.set(p, t),
    estPropre: (c) => {
      sondes.push(c)
      return propre
    }
  }
  return { acces, fichiers, sondes, registre: () => JSON.parse(fichiers.get(REGISTRE) ?? '{}') }
}

const A = { fil: 'conv-A', registre: REGISTRE }
const B = { fil: 'conv-B', registre: REGISTRE }

describe('reserverOuRefuser', () => {
  it('un fichier libre est réservé au fil qui l’édite', () => {
    const r = io()
    expect(reserverOuRefuser(r.acces, A, X, T0, true)).toBeUndefined()
    expect(r.registre()['d:/autowinos/src/x.ts']).toEqual({ fil: 'conv-A', at: T0 })
  })

  it('un AUTRE fil est refusé tant que le travail de conv-A n’est pas commité, et le refus nomme conv-A', () => {
    const r = io(false)
    reserverOuRefuser(r.acces, A, X, T0, true)
    const motif = reserverOuRefuser(r.acces, B, 'D:\\AutoWinOS\\SRC\\x.ts', T0 + 10 * 60_000, true)
    expect(motif).toMatch(/conv-A/)
    expect(motif).toMatch(/il y a 10 min/)
    // Le registre reste à conv-A : un refus ne vole pas la réservation.
    expect(r.registre()['d:/autowinos/src/x.ts'].fil).toBe('conv-A')
    // conv-1139 : le texte d'avant reste, et le refus FINIT par le moyen d'écrire au détenteur.
    expect(motif).toContain("dis-le à l'utilisateur en nommant conv-A.")
    expect(motif).toMatch(
      /écris-lui directement avec l'outil ecrire_a_un_fil \(destinataire conv-A\)\.$/
    )
  })

  it('jumeau accepté : le fichier a été commité entre-temps → conv-B le reprend', () => {
    const r = io(true)
    reserverOuRefuser(r.acces, A, X, T0, true)
    expect(reserverOuRefuser(r.acces, B, X, T0 + 60_000, true)).toBeUndefined()
    expect(r.registre()['d:/autowinos/src/x.ts'].fil).toBe('conv-B')
  })

  it('état git inconnu (pas un dépôt, git absent) → la réservation tient', () => {
    const r = io(undefined)
    reserverOuRefuser(r.acces, A, X, T0, true)
    expect(reserverOuRefuser(r.acces, B, X, T0 + 60_000, true)).toMatch(/conv-A/)
  })

  it('borne du bail : refusé juste avant, accepté juste après', () => {
    const avant = io(false)
    reserverOuRefuser(avant.acces, A, X, T0, true)
    expect(reserverOuRefuser(avant.acces, B, X, T0 + BAIL_RESERVATION_MS - 1, true)).toMatch(
      /conv-A/
    )
    const apres = io(false)
    reserverOuRefuser(apres.acces, A, X, T0, true)
    expect(reserverOuRefuser(apres.acces, B, X, T0 + BAIL_RESERVATION_MS, true)).toBeUndefined()
  })

  it('le même fil repasse sans être refusé, et son bail repart', () => {
    const r = io(false)
    reserverOuRefuser(r.acces, A, X, T0, true)
    expect(reserverOuRefuser(r.acces, A, X, T0 + 20 * 60_000, true)).toBeUndefined()
    expect(r.registre()['d:/autowinos/src/x.ts'].at).toBe(T0 + 20 * 60_000)
    // Aucune sonde git quand rien n'est à départager.
    expect(r.sondes).toEqual([])
  })

  it('un autre fichier reste libre pour conv-B', () => {
    const r = io(false)
    reserverOuRefuser(r.acces, A, X, T0, true)
    expect(
      reserverOuRefuser(r.acces, B, 'D:/AutoWinOS/src/y.ts', T0 + 60_000, true)
    ).toBeUndefined()
  })

  it('hors Windows, la casse distingue deux fichiers', () => {
    const r = io(false)
    reserverOuRefuser(r.acces, A, '/repo/src/X.ts', T0, false)
    expect(reserverOuRefuser(r.acces, B, '/repo/src/x.ts', T0 + 60_000, false)).toBeUndefined()
  })

  it('un registre illisible repart vide au lieu de bloquer, et les réservations échues sont purgées', () => {
    expect(reserverOuRefuser(io(false, '{pas du json').acces, B, X, T0, true)).toBeUndefined()
    const r = io(
      false,
      JSON.stringify({ 'd:/vieux.ts': { fil: 'conv-Z', at: T0 - BAIL_RESERVATION_MS } })
    )
    reserverOuRefuser(r.acces, A, X, T0, true)
    expect(Object.keys(r.registre())).toEqual(['d:/autowinos/src/x.ts'])
  })
})

/*
 * LE COMMIT D'UN AGENT CONSULTE AUSSI LE REGISTRE (objection du contrôle final, 2026-10-22).
 *
 * Entrée qui ferait échouer ce banc si la garde était fausse : conv-B lance `git commit -am wip`
 * dans `D:/AutoWinOS`, où `src/x.ts` est réservé par conv-A, modifié et non commité → REFUS qui
 * nomme conv-A. Jumeaux acceptés à la même borne : conv-A elle-même, un commit qui ne nomme que
 * `src/y.ts`, un autre dépôt, un fichier commité, un bail échu.
 */
describe('refusCommitReserve', () => {
  const XK = 'd:/autowinos/src/x.ts'
  function ioCommit(opts: { propre?: boolean | undefined; indexe?: boolean; at?: number } = {}) {
    const sondes: string[] = []
    const registre = JSON.stringify({ [XK]: { fil: 'conv-A', at: opts.at ?? T0 } })
    const acces: IoCommitReserve = {
      lire: (p) => (p === REGISTRE ? registre : undefined),
      estPropre: (c) => {
        sondes.push(`propre ${c}`)
        return 'propre' in opts ? opts.propre : false
      },
      estIndexe: (c) => {
        sondes.push(`indexe ${c}`)
        return opts.indexe ?? false
      },
      racineDepot: (d) => {
        const n = d.replace(/\\/g, '/').toLowerCase()
        if (n.startsWith('d:/autowinos')) return 'D:/AutoWinOS'
        if (n.startsWith('d:/autre')) return 'D:/Autre'
        return undefined
      }
    }
    return { acces, sondes }
  }
  const T = T0 + 5 * 60_000
  const commit = (
    fil: typeof A,
    commande: string,
    o?: Parameters<typeof ioCommit>[0],
    cwd = 'D:\\AutoWinOS'
  ) => refusCommitReserve(ioCommit(o).acces, fil, commande, cwd, T, true)

  it('`git commit -am` de conv-B emporterait src/x.ts de conv-A → refus qui nomme conv-A et le fichier', () => {
    const motif = commit(B, 'git commit -am "wip"')
    expect(motif).toMatch(/conv-A/)
    expect(motif).toMatch(/src\/x\.ts/)
    expect(commit(B, 'git commit --all -m wip')).toMatch(/conv-A/)
  })

  it('jumeau accepté : conv-A commite son propre fichier', () => {
    expect(commit(A, 'git commit -am "wip"')).toBeUndefined()
  })

  it('les balayages de l’index sont refusés : git add -A, git add ., git add -u', () => {
    expect(commit(B, 'git add -A && git commit -m wip')).toMatch(/conv-A/)
    expect(commit(B, 'git add . && git commit -m wip')).toMatch(/conv-A/)
    expect(commit(B, 'git add -u; git commit -m wip')).toMatch(/conv-A/)
  })

  it('le fichier réservé NOMMÉ dans la commande est refusé ; un autre fichier nommé passe', () => {
    expect(commit(B, 'git add src/x.ts && git commit -m wip')).toMatch(/conv-A/)
    expect(commit(B, 'git commit -m wip -- "D:\\AutoWinOS\\src\\x.ts"')).toMatch(/conv-A/)
    expect(commit(B, 'git add src/y.ts && git commit -m wip -- src/y.ts')).toBeUndefined()
    expect(commit(B, 'git commit -m wip -- src/x.tsx')).toBeUndefined()
  })

  it('déjà dans l’index partagé : un commit sans chemins l’emporte (refus), un commit `-- chemins` non', () => {
    expect(commit(B, 'git commit -m wip', { indexe: true })).toMatch(/conv-A/)
    expect(commit(B, 'git commit -m wip -- src/y.ts', { indexe: true })).toBeUndefined()
    expect(commit(B, 'git commit -m wip', { indexe: false })).toBeUndefined()
  })

  it('« -a » dans un message de commit n’est pas une option ; --amend non plus', () => {
    expect(commit(B, 'git commit -m "corrige -a et --all"')).toBeUndefined()
    expect(commit(B, 'git commit --amend --no-edit')).toBeUndefined()
  })

  it('le dépôt visé compte : autre dossier courant → libre ; cd ou git -C vers le dépôt → refus', () => {
    expect(commit(B, 'git commit -am wip', {}, 'D:/Autre')).toBeUndefined()
    expect(commit(B, 'cd "D:/AutoWinOS" && git commit -am wip', {}, 'D:/Autre')).toMatch(/conv-A/)
    expect(commit(B, 'git -C D:/AutoWinOS commit -am wip', {}, 'D:/Autre')).toMatch(/conv-A/)
  })

  it('fichier commité entre-temps, ou bail échu → libre', () => {
    expect(commit(B, 'git commit -am wip', { propre: true })).toBeUndefined()
    expect(commit(B, 'git commit -am wip', { at: T - BAIL_RESERVATION_MS })).toBeUndefined()
  })

  it('pas un commit → aucune sonde git', () => {
    const r = ioCommit()
    expect(
      refusCommitReserve(r.acces, B, 'git status && git log --grep commit', 'D:/AutoWinOS', T, true)
    ).toBeUndefined()
    expect(r.sondes).toEqual([])
  })
})
