import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'

/*
 * BANC PERMANENT DES REGLES D'ARRET (conv-787, 2026-09-22).
 *
 * POURQUOI. Les portes du mode auto sont des expressions de recherche sur du texte ECRIT PAR UN
 * MODELE. Un test ecrit a la main ne sonde que les phrases qu'on a imaginees : c'est ainsi que
 * « Voici le message du bandeau… » et « Rien de plus sur ce sujet… » sont passees en production et
 * ont coute des tours reels. Ce banc rejoue au contraire des CLOTURES REELLEMENT PRODUITES.
 *
 * CE QUE C'EST. `__corpus__/clotures-reelles.json` : 2685 clotures distinctes extraites des
 * conversations de ce poste, reduites a ce que les portes LISENT VRAIMENT — les rubriques « Fait »,
 * « Reste a faire », « Recommande » et la ligne de prompt suivant, coupees a 100 caracteres. La
 * rubrique « Maintenant » n'est jamais lue : elle n'y est pas.
 *
 * COMMENT IL PROTEGE. Il fige la REPARTITION des decisions. Une regle elargie fait monter les
 * arrets, une regle cassee les fait tomber : dans les deux cas ce test rougit et exige une
 * re-mesure CONSCIENTE plutot qu'une decouverte a l'usage. Les bornes sont volontairement etroites.
 *
 * SI TU LE FAIS ROUGIR : ne rattrape pas le chiffre, VERIFIE d'abord un echantillon des clotures
 * dont la decision a change, puis ajuste la borne en expliquant pourquoi dans le meme commit.
 */
const CORPUS: string[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__corpus__', 'clotures-reelles.json'), 'utf8')
)

const humain = { role: 'user', content: 'go' } as Msg
const decisionsDuCorpus = (): { envoi: number; raisons: Record<string, number> } => {
  const raisons: Record<string, number> = {}
  let envoi = 0
  for (const bloc of CORPUS) {
    const fil = [
      humain,
      { role: 'assistant', content: bloc, parts: [{ kind: 'text', text: bloc }] } as unknown as Msg
    ]
    const d = deciderRelanceAuto({
      actif: true,
      occupe: false,
      dernierTourTraite: null,
      dernierPromptEnvoye: null,
      brouillonPresent: false,
      fil
    })
    if (d.action === 'arreter') raisons[d.raison] = (raisons[d.raison] ?? 0) + 1
    // conv-826 : une suite différée est programmée au lieu d'arrêter — même règle, même compte.
    if (d.action === 'programmer') raisons['suite-differee'] = (raisons['suite-differee'] ?? 0) + 1
    if (d.action === 'envoyer') envoi++
  }
  return { envoi, raisons }
}

describe('banc — les règles d’arrêt rejouées sur des clôtures réelles', () => {
  it('le corpus est bien là et n’a pas fondu', () => {
    expect(CORPUS.length).toBeGreaterThan(2500)
  })

  it('garde la répartition mesurée des décisions', () => {
    const { envoi, raisons } = decisionsDuCorpus()
    /*
     * BORNES ETROITES, ET C'EST LE BUT. Mesure du 2026-09-22 apres correction des 5 regles trop
     * larges : recommandation-rien 81, reste-rien 37, suite-differee 14, fait-rien 1.
     * Verification du garde-fou lui-meme : en elargissant l'ouverture de fin a « tout ce qui commence
     * par rien/aucun », le compte passe a 91 — avec des bornes a ±5 ce test ROUGIT, avec ±30 il ne
     * voyait rien. Une borne large est un banc qui dort.
     */
    expect(raisons['recommandation-rien']).toBeGreaterThanOrEqual(76)
    expect(raisons['recommandation-rien']).toBeLessThanOrEqual(86)
    expect(raisons['reste-rien']).toBeGreaterThanOrEqual(32)
    expect(raisons['reste-rien']).toBeLessThanOrEqual(42)
    expect(raisons['suite-differee']).toBeGreaterThanOrEqual(9)
    expect(raisons['suite-differee']).toBeLessThanOrEqual(19)
    // La porte « Fait » est volontairement muette : ses lignes sont des constats, pas des fins.
    expect(raisons['fait-rien'] ?? 0).toBeLessThanOrEqual(5)
    // Le mode auto doit rester un ENCHAINEUR : la grande majorite des clotures relance un tour.
    expect(envoi).toBeGreaterThan(CORPUS.length * 0.75)
  })

  it('la pause « donnée que toi seul possèdes » reste rarissime', () => {
    // Elle exige un secret nomme. Si elle grimpe, c'est qu'elle mord sur des phrases ordinaires —
    // exactement le defaut vecu le 2026-09-22 avec « Voici le message du bandeau… ».
    const { raisons } = decisionsDuCorpus()
    expect(raisons['suite-attend-utilisateur'] ?? 0).toBeLessThanOrEqual(5)
  })
})
