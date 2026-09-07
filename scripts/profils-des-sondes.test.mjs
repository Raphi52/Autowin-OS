import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * UN PROFIL CITE PAR UNE SONDE DOIT EXISTER — ET C'EST LE CODE QUI LE TIENT.
 *
 * Defaut mesure le 2026-09-06 : `cdp-skill-node-brain-proof` selectionnait le profil
 * `memoire-depot`, disparu du catalogue. La selection ne pouvait qu'echouer, donc la sonde tournait
 * sur un profil qu'elle n'avait pas choisi -- et son verdict portait sur autre chose que son sujet.
 * Personne ne l'a vu pendant des semaines : la sonde est payante, donc jamais jouee.
 *
 * Ecrire la correction en commentaire ne protege de rien. Cette garde la rend VERIFIABLE SANS
 * PAYER : elle confronte chaque identifiant cite par une sonde au catalogue reel. Le prochain
 * renommage de profil fait rougir ici, en quelques millisecondes, au lieu de dormir dans une sonde
 * qu'on ne joue jamais.
 *
 * Elle lit les DEUX sources en texte, a dessein : `workflow-defaults.ts` est du TypeScript que ce
 * test ne peut pas importer, et les sondes sont des scripts autonomes. Une comparaison de chaines
 * sur des identifiants litteraux est ici l'oracle le plus direct -- pas une approximation.
 */
const dossierScripts = join(process.cwd(), 'scripts')
const SOURCE_CATALOGUE = join(process.cwd(), 'src', 'main', 'workflow-defaults.ts')

/** Les identifiants de profil que le catalogue par defaut declare. */
function profilsDuCatalogue() {
  const source = readFileSync(SOURCE_CATALOGUE, 'utf8')
  /*
   * Les identifiants de PROFIL, et non ceux des NOEUDS. Le meme fichier declare `id: 'build-1'`,
   * `id: 'judge-1'`, etc. : les compter comme profils rendrait la garde permissive -- elle
   * accepterait `workflowProfileSelect('build-1')`, qui n'existe pas. On ne garde donc que les
   * identifiants suivis d'un `name:`, qui est la forme d'un profil.
   */
  return new Set([...source.matchAll(/id:\s*'([^']+)',\s*\n\s*name:/g)].map((trouve) => trouve[1]))
}

/** Chaque sonde, avec les profils qu'elle selectionne reellement. */
function profilsCitesParLesSondes() {
  const cites = []
  for (const nom of readdirSync(dossierScripts)) {
    if (!nom.startsWith('cdp-') || !nom.endsWith('.mjs') || nom.endsWith('.test.mjs')) continue
    const source = readFileSync(join(dossierScripts, nom), 'utf8')
    for (const trouve of source.matchAll(/workflowProfileSelect\('([^']+)'\)/g))
      cites.push({ sonde: nom, profil: trouve[1] })
  }
  return cites
}

describe('profils selectionnes par les sondes', () => {
  it('chaque profil cite par une sonde existe dans le catalogue', () => {
    const catalogue = profilsDuCatalogue()
    const inconnus = profilsCitesParLesSondes()
      .filter(({ profil }) => !catalogue.has(profil))
      .map(({ sonde, profil }) => `${sonde} -> « ${profil} »`)
    expect(inconnus, `profils inexistants cites par des sondes : ${inconnus.join(' | ')}`).toEqual(
      []
    )
  })

  /*
   * La garde doit avoir de la MATIERE. Si aucune sonde ne selectionnait de profil, ou si le
   * catalogue etait lu a vide, le test ci-dessus passerait au vert sans rien verifier : le piege de
   * l'echantillon vide, deja paye dans ce depot.
   */
  it('le catalogue et les sondes sont reellement lus', () => {
    expect(profilsDuCatalogue().size).toBeGreaterThanOrEqual(5)
    expect(profilsCitesParLesSondes().length).toBeGreaterThanOrEqual(2)
  })
})
