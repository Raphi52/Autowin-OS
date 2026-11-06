import { describe, expect, it } from 'vitest'
import { systemeDuTour } from '../agent-pilot/systeme-du-tour'
import { outilsDuChat } from '../chat/chat-mcp'
import { CATALOG } from '../commands/commands'
import { PHASE_BRIEFS, phaseBrief } from './phase-briefs'
import { outilsPublies } from '../skills/skill-node-mcp'
import type { PipelinePhase } from '../skills/skill-pipeline'

/**
 * PLAFOND DE TAILLE DES CONSIGNES DU CHAT (conv-1649, lot 1 du plan « Alléger les consignes du
 * chat, avec un plafond qui baisse », 2026-11-06).
 *
 * POURQUOI. Les règles envoyées au modèle à CHAQUE message du chat sont passées de 14 Ko en août à
 * 92 Ko de sources en novembre, sans que rien ne s'y oppose : chaque correctif ajoutait sa phrase.
 * Ce fichier mesure le TEXTE ENVOYÉ, pas les fichiers sources : `chat-pilotage-prompt.ts` fait 91 Ko
 * mais ~38 Ko sont des commentaires qui ne partent jamais.
 *
 * CE QUI EST MESURÉ — le système d'un tour NORMAL du chat, assemblé par `systemeDuTour`
 * (agent-pilot/systeme-du-tour.ts) AVEC les outils directs servis (`systemeAvecOutilsDirects`,
 * le cas courant : modèle Claude, serveur d'outils démarré). Ce sont les mêmes `systemBlocks` que
 * ceux écrits dans `prompt-observability/<conv>.jsonl`. Contrôle du 2026-11-06 sur le dernier
 * envoi de conv-1648 : pilotage 36 938, constitution 18 207, style 9 193 — retrouvés au caractère
 * près. La version SANS outils directs (repli `<cmd>`) fait 66 814 pour le pilotage : la mesurer
 * par erreur ferait rougir ce fichier, elle n'est donc jamais confondue avec celle-ci.
 *
 * Les descriptions des outils directs comptent AUSSI, arguments compris (tout `description` du
 * schéma publié par `outilsPublies`) : déplacer une règle de la consigne vers un outil n'est pas un
 * gain, le modèle la reçoit toujours à chaque envoi.
 *
 * Les consignes d'étape (`phase-briefs.ts`) ne partent pas dans le chat : elles ont un plafond seul,
 * sans réduction prévue, pour qu'elles ne regrossissent pas non plus.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER : un plafond abaissé sous sa mesure ; du texte ajouté
 * au-delà d'un plafond ; une mesure prise sur la consigne sans outils directs (66 814 > 37 000) ; un
 * bloc renommé ou vidé dans `systemeDuTour` (il ne doit pas passer pour 0 caractère, donc pour vert).
 */

/*
 * LES PLAFONDS — mesure du 2026-11-06 arrondie au 500 supérieur. Chaque lot qui réduit le texte les
 * ABAISSE à sa nouvelle mesure arrondie au 500 supérieur. Ne jamais en monter un : un test rouge ici
 * se règle en retirant du texte ailleurs.
 */
// Plafond conv-1649 (2026-11-06) — on ne le monte JAMAIS. Mesure : 36 938 car. ; lot 2 (redites
// de la constitution et règles déjà tenues par le code retirées) : 33 304 car.
const PLAFOND_PILOTAGE = 33_500
// Plafond conv-1649 (2026-11-06) — on ne le monte JAMAIS. Mesure : 18 207 car. ; lot 2 : 18 484
// (cinq parts que seules les copies portaient, reportées en une phrase chacune, payées par des
// redites internes retirées). Marge : 16 car. — un report de plus se paie par un retrait ici même.
const PLAFOND_CONSTITUTION = 18_500
// Plafond conv-1649 (2026-11-06) — on ne le monte JAMAIS. Mesure : 9 193 car. ; lot 2 : 7 275 car.
// « Dire vrai » y reste en une phrase : les deux appels du juge reçoivent ce ton sans la constitution.
const PLAFOND_STYLE = 7_500
// Plafond conv-1649 (2026-11-06) — on ne le monte JAMAIS. Mesure : 39 158 car. (56 outils :
// 23 988 de descriptions, 15 170 de descriptions d'arguments).
const PLAFOND_DESCRIPTIONS_OUTILS_DIRECTS = 39_500
// Plafond conv-1649 (2026-11-06) — on ne le monte JAMAIS. Mesure : 25 954 car. (8 étapes, garde
// de tâche et bilan compris). Plafond seul : aucune réduction n'est prévue sur ces consignes.
// Le déménagement vers des sous-dossiers a allongé les chemins des leviers de Kaizen (+77, exigés
// par phase-briefs.kaizen-leviers.test.ts), payé par une redite de la constitution retirée : 25 969.
const PLAFOND_CONSIGNES_D_ETAPE = 26_000

/** Le système d'un tour normal, avec les commandes servies en outils directs. */
function blocsEnvoyes(): Map<string, number> {
  const tour = systemeDuTour({
    sendLimits: undefined,
    conversationId: 'conv-plafond',
    catalog: CATALOG,
    // Message sans mot visuel : seule la queue d'écran toujours servie suit le pilotage.
    latestUserMessage: 'bonjour',
    history: [],
    executionWorkspace: () => '',
    projectContext: () => ''
  })
  const { systemBlocks } = tour.systemeAvecOutilsDirects(outilsDuChat(CATALOG))
  return new Map(systemBlocks.map((b) => [b.name, b.chars]))
}

/** Tout le texte `description` d'un outil publié : le sien, puis ceux de ses arguments. */
function caracteresDeDescription(valeur: unknown): number {
  if (Array.isArray(valeur))
    return valeur.reduce((n: number, v) => n + caracteresDeDescription(v), 0)
  if (!valeur || typeof valeur !== 'object') return 0
  return Object.entries(valeur).reduce(
    (n, [cle, v]) =>
      n + (cle === 'description' && typeof v === 'string' ? v.length : caracteresDeDescription(v)),
    0
  )
}

function descriptionsDesOutilsDirects(): number {
  const servies = outilsDuChat(CATALOG)
  const outils = outilsPublies(
    { catalogue: () => CATALOG, exec: async () => ({ ok: true }) },
    { outils: servies, refus: () => '' }
  )
  expect(outils.map((o) => o.name).sort()).toEqual([...servies].sort())
  return outils.reduce(
    (n, o) =>
      n + caracteresDeDescription({ description: o.description, inputSchema: o.inputSchema }),
    0
  )
}

function consignesDEtape(): number {
  return (Object.keys(PHASE_BRIEFS) as PipelinePhase[]).reduce(
    (n, phase) => n + phaseBrief(phase).length,
    0
  )
}

/** Le message d'échec dit QUOI FAIRE : retirer du texte, pas monter le plafond. */
function sousLePlafond(nom: string, mesure: number, plafond: number, ou: string): void {
  expect(
    mesure,
    `${nom} : ${mesure} caractères envoyés pour un plafond de ${plafond} (dépassement de ` +
      `${mesure - plafond}). Retire au moins ${mesure - plafond} caractères dans ${ou} — redite déjà ` +
      `dans la constitution, règle déjà tenue par le code, exemple superflu. Ne monte PAS ` +
      `le plafond (conv-1649) : il ne fait que baisser.`
  ).toBeLessThanOrEqual(plafond)
}

describe('plafond des consignes envoyées au modèle (conv-1649)', () => {
  const blocs = blocsEnvoyes()
  const bloc = (nom: string): number => {
    const chars = blocs.get(nom) ?? 0
    // Un bloc absent ou vide n'est pas « sous le plafond » : c'est la mesure qui ne voit plus rien.
    expect(
      chars,
      `bloc « ${nom} » absent ou vide dans systemeDuTour : la mesure est aveugle`
    ).toBeGreaterThan(0)
    return chars
  }

  it('consigne du chat (bloc pilotage, outils directs servis)', () => {
    sousLePlafond(
      'Consigne du chat',
      bloc('pilotage'),
      PLAFOND_PILOTAGE,
      'src/main/consignes/chat-pilotage-prompt.ts (texte envoyé, pas les commentaires)'
    )
  })

  it('constitution', () => {
    sousLePlafond(
      'Constitution',
      bloc('constitution'),
      PLAFOND_CONSTITUTION,
      'src/main/consignes/constitution.ts'
    )
  })

  it('bloc style', () => {
    sousLePlafond('Bloc style', bloc('style'), PLAFOND_STYLE, 'src/main/consignes/response-style.ts')
  })

  it('descriptions des commandes servies en outils directs, arguments compris', () => {
    sousLePlafond(
      'Descriptions des outils directs',
      descriptionsDesOutilsDirects(),
      PLAFOND_DESCRIPTIONS_OUTILS_DIRECTS,
      'src/main/commands/catalogue*.ts (description et arguments)'
    )
  })

  it('consignes d’étape (plafond seul)', () => {
    sousLePlafond(
      'Consignes d’étape',
      consignesDEtape(),
      PLAFOND_CONSIGNES_D_ETAPE,
      'src/main/consignes/phase-briefs.ts'
    )
  })
})
