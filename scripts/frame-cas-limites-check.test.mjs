/**
 * Garde-fou `frame` — l'enonce livre doit ENUMERER les cas limites d'entree.
 *
 * Mesure hors modele qui justifie ce garde-fou (banc `arena-bench-ax3`, 2026-09-07, 3 repliques) :
 * meme tache, meme critere comportemental de 30 assertions, une seule vague de 6 agents.
 *   - bras `a` (enonce SANS cas limites enumeres) : 0 vert sur 3. Defauts REELS, pas lexicaux —
 *     les 3 repliques acceptent `--jours 7 --jours 0` en silence (code 0), et 2 sur 3 jettent une
 *     pile Node sur `--jours 200000000`.
 *   - bras `x` (memes mots + la LISTE des cas limites en prose) : 3 verts sur 3 (30/30).
 * Separation parfaite, p = 0,10 (plancher a n=3). C'est le seul facteur du kit dont l'effet est
 * mesure HORS du bruit : la dispersion de cout intra-bras (+45 % / +20 %) reste tres au-dessous de
 * l'ecart inter-bras (x3,12).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifierCasLimites, verifierFichier } from './frame-cas-limites-check.mjs'

const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

const BESOIN_AVEC_ENTREE = `## Besoin
Rendre sure la fenetre d'observation de \`scripts/dogfood-veille.mjs\`.
Le drapeau \`--jours\` accepte aujourd'hui n'importe quoi.

- [ ] toute valeur refusee sort en code non nul — preuve : node check.mjs
`

const CAS_LIMITES = `
### Cas limites d'entree
- \`--jours\` absent : valeur par defaut 7, code 0.
- \`--jours\` sans valeur : refus, code 2, aucune pile Node.
- \`--jours abc\` (non numerique) : refus, code 2.
- \`--jours 0\` et \`--jours -3\` : refus, jamais un rapport vert silencieux.
- \`--jours 200000000\` (hors plage) : refus, aucune pile Node.
- \`--jours 7 --jours 0\` (drapeau repete) : refus, jamais un choix silencieux.
`

describe('garde-fou frame — enumeration des cas limites', () => {
  it('REFUSE un cadrage qui decrit une entree utilisateur sans aucun cas limite', () => {
    const r = verifierCasLimites(BESOIN_AVEC_ENTREE)
    expect(r.tenu).toBe(false)
    expect(r.motif).toMatch(/cas limite/i)
  })

  it('ACCEPTE le meme cadrage des que les cas limites sont enumeres', () => {
    const r = verifierCasLimites(BESOIN_AVEC_ENTREE + CAS_LIMITES)
    expect(r.tenu).toBe(true)
    expect(r.cas.length).toBeGreaterThanOrEqual(3)
  })

  it('REFUSE une rubrique de cas limites qui existe mais reste trop maigre (moins de 3)', () => {
    const maigre = `${BESOIN_AVEC_ENTREE}
### Cas limites d'entree
- \`--jours abc\` : refus.
- \`--jours 0\` : refus.
`
    const r = verifierCasLimites(maigre)
    expect(r.tenu).toBe(false)
    expect(r.motif).toMatch(/3/)
  })

  it('REFUSE une rubrique presente mais VIDE — un titre n est pas une enumeration', () => {
    const r = verifierCasLimites(`${BESOIN_AVEC_ENTREE}\n### Cas limites d'entree\n`)
    expect(r.tenu).toBe(false)
    expect(r.cas.length).toBe(0)
  })

  it('ACCEPTE un besoin SANS entree utilisateur (rien a enumerer)', () => {
    const r = verifierCasLimites(`## Besoin
Renommer le dossier de sortie du graphe pour qu'il suive le nom du depot.
- [ ] le dossier porte le nouveau nom — preuve : ls
`)
    expect(r.tenu).toBe(true)
    expect(r.motif).toMatch(/aucune entree/i)
  })

  it('ACCEPTE une dispense EXPLICITE et motivee, jamais un simple silence', () => {
    const r = verifierCasLimites(`${BESOIN_AVEC_ENTREE}
Cas limites : sans objet — le drapeau est produit par le script appelant, jamais saisi a la main.
`)
    expect(r.tenu).toBe(true)
    expect(r.motif).toMatch(/dispense/i)
  })

  it('lit un RUN.md sur disque et rend le meme verdict', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'frame-caslim-'))
    aNettoyer.push(dossier)
    const run = join(dossier, 'RUN.md')
    writeFileSync(
      run,
      `# RUN\nregime: standard\n${BESOIN_AVEC_ENTREE}\n## Contraintes\n- HARD : rien\n`
    )
    expect(verifierFichier(run).tenu).toBe(false)
    writeFileSync(
      run,
      `# RUN\n${BESOIN_AVEC_ENTREE}${CAS_LIMITES}\n## Contraintes\n- HARD : rien\n`
    )
    expect(verifierFichier(run).tenu).toBe(true)
  })

  it('ne regarde QUE la section ## Besoin — des cas limites ecrits ailleurs ne comptent pas', () => {
    const ailleurs = `${BESOIN_AVEC_ENTREE}
## Contraintes
${CAS_LIMITES}
`
    expect(verifierCasLimites(ailleurs).tenu).toBe(false)
  })
})
