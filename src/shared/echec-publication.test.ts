import { describe, expect, it } from 'vitest'
import { PublicationARejouer, phraseDuRefus, refusDePublication } from './echec-publication'

/** Le texte que `git push` rend quand le garde-fou de noms internes refuse (`scripts/separation-avant-push.mjs`). */
const REFUS_DU_GARDE_FOU =
  'Command failed: git push origin 1234abcd:refs/heads/main\n' +
  '  ⛔ Push refuse vers le depot public (origin) : ce qui part porte un nom ou un terme\n' +
  "  d'entreprise (profils de D:\\AutoWinOS\\entreprise/).\n" +
  '    src/x.ts (chemin) — terme\n'

describe('refusDePublication', () => {
  it('un envoi réussi, ou rien à envoyer, n’est pas un refus', () => {
    for (const rendu of [
      { status: 'pushed', branch: 'main', files: 1 },
      { status: 'committed', files: 2 },
      { status: 'skipped', reason: 'no-changes' },
      { status: 'skipped', reason: 'no-remote' },
      { status: 'skipped', reason: 'unattributed' },
      { status: 'skipped', reason: 'brain-sans-depot' },
      { status: 'skipped', reason: 'recovery-baseline-missing' },
      undefined,
      null,
      'failed'
    ]) {
      expect(refusDePublication(rendu)).toBeUndefined()
    }
  })

  it('le garde-fou de noms internes : dit la nature du refus et quoi faire, sans chemin interne', () => {
    const refus = refusDePublication({ status: 'failed', error: REFUS_DU_GARDE_FOU })
    expect(refus?.titre).toBe('Envoi refusé')
    const phrase = phraseDuRefus(refus!)
    expect(phrase).toContain("élément réservé à l'entreprise")
    expect(phrase).toContain('/git')
    expect(phrase).not.toContain('profils de')
    expect(phrase).not.toContain('D:\\')
    expect(phrase).not.toContain('Command failed')
  })

  it('ne propose jamais de réécrire l’historique : le retrait passe par un commit, la réécriture demande l’accord', () => {
    const nomInterne = refusDePublication({ status: 'failed', error: REFUS_DU_GARDE_FOU })
    const secret = refusDePublication({
      status: 'skipped',
      reason: 'secret-detected',
      detail: 'clé API'
    })
    for (const refus of [nomInterne, secret]) {
      expect(refus?.action).not.toMatch(/refais le commit/i)
      expect(refus?.action).toContain('accord')
    }
  })

  it('node introuvable : dit que le contrôle ne peut pas tourner et quoi installer', () => {
    const refus = refusDePublication({
      status: 'failed',
      error:
        'Command failed: git push origin x\n  ⛔ Push refusé vers le dépôt public (origin) : node est introuvable, la recherche des\n'
    })
    const phrase = phraseDuRefus(refus!)
    expect(phrase).toContain('node est introuvable')
    expect(phrase).toContain('Installe Node')
  })

  it('chaque motif de refus connu a sa raison et son action', () => {
    const motifs = [
      'protected-branch',
      'invalid-publication-range',
      'concurrent-commits',
      'tests-rouges',
      'typage-rouge'
    ]
    for (const reason of motifs) {
      const refus = refusDePublication({ status: 'skipped', reason })
      expect(refus?.titre).toBe('Envoi refusé')
      expect(refus?.raison.length).toBeGreaterThan(10)
      expect(refus?.action).toContain('/git')
    }
  })

  it('un secret : nomme sa nature (le motif), jamais la valeur', () => {
    const refus = refusDePublication({
      status: 'skipped',
      reason: 'secret-detected',
      detail: 'clé privée'
    })
    expect(phraseDuRefus(refus!)).toContain('clé privée')
  })

  it('une erreur inconnue est nommée par sa première ligne utile, sans la ligne de commande git', () => {
    const refus = refusDePublication({
      status: 'failed',
      error:
        'Command failed: git push origin abc:refs/heads/main\nfatal: unable to access the remote'
    })
    expect(refus?.titre).toBe('Envoi échoué')
    const phrase = phraseDuRefus(refus!)
    expect(phrase).toContain('fatal: unable to access the remote')
    expect(phrase).not.toContain('Command failed')
  })

  it('une erreur très longue est coupée : le panneau et le fil restent lisibles', () => {
    const refus = refusDePublication({ status: 'failed', error: 'x'.repeat(5000) })
    expect(refus?.raison.length).toBeLessThanOrEqual(240)
  })
})

describe('PublicationARejouer', () => {
  it('garde le compte rendu de la publication : le fil peut dire pourquoi elle a échoué', () => {
    const erreur = new PublicationARejouer({ status: 'failed', error: 'x' })
    expect(erreur).toBeInstanceOf(Error)
    expect(erreur.project).toEqual({ status: 'failed', error: 'x' })
    expect(erreur.message).toContain('Publication projet distante a rejouer')
  })
})

describe('porte d’un fil en copie (tour de chat)', () => {
  it('une porte qui refuse (conflit ou base absente) : une raison et une action avec /git', () => {
    const refus = refusDePublication({
      status: 'skipped',
      reason: 'porte-refusee',
      detail: 'Publication refusée : conflit avec la base sur a.ts.'
    })
    expect(refus?.titre).toBe('Envoi refusé')
    expect(refus?.raison).toContain('conflit avec la base')
    expect(refus?.action).toContain('/git')
    expect(phraseDuRefus(refus!)).not.toContain('a.ts')
  })

  it('une porte qui attend (fichier non commité ailleurs) n’est pas un refus', () => {
    expect(
      refusDePublication({ status: 'skipped', reason: 'porte-en-attente', detail: 'a.ts' })
    ).toBeUndefined()
  })
})
