import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAP_ITERATIONS_TOUR } from './agent-pilot'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

/**
 * LE CAP D'ITÉRATIONS RELEVÉ N'ATTEIGNAIT JAMAIS L'APPLICATION.
 *
 * Mesuré en pilotant l'app le 2026-08-19 : un scout lancé dans le chat a rendu
 * « ⚠️ Le tour a échoué — Cap d'itérations (6) atteint sans réponse finale » et AUCUN tableau de
 * candidats. Or `AgentPilot.chat` documente son cap par défaut à 12, relevé de 6 le 2026-07-29 avec
 * un motif explicite : « la règle anti-abandon lui demande de CHERCHER, ESSAYER puis NETTOYER : il
 * faut de quoi le faire ».
 *
 * Le seul chemin de chat interactif passait `policy?.maxIterations ?? 6` : la police est absente
 * quand un humain tape dans le composer, donc le repli s'appliquait toujours et annulait
 * silencieusement le relèvement. Un défaut par valeur par défaut concurrente — la signature disait
 * 12, la production faisait 6, et le commentaire qui justifiait 12 décrivait un monde inexistant.
 */
describe('cap d’itérations — une seule valeur par défaut, celle qui est documentée', () => {
  const source = (relatif: string): string => readFileSync(join(__dirname, relatif), 'utf8')

  /*
   * L'ASSERTION VERROUILLAIT UN CHIFFRE, PLUS UN COMPORTEMENT. Demande utilisateur du 2026-09-04 :
   * « ENLEVE CE PUTAIN DE BLOQUAGE DE BUDGET » — le compteur d'appels coupait des tours engagés
   * sans rien mesurer du coût réel. Ce qui reste exigé : le cap par défaut n'est JAMAIS plus serré
   * que les 12 documentés (il vaut 40 depuis l'integration du 2026-09-04, la depense reelle prenant
   * le relais du comptage d'appels).
   */
  it('le cap par défaut n’est jamais plus serré que les 12 documentés', () => {
    expect(CAP_ITERATIONS_TOUR).toBeGreaterThanOrEqual(12)
  })

  /*
   * ZONE, PAS FICHIER : le tour pilote a quitte `index.ts` pour `src/main/chat/` le 2026-09-02, et
   * ce controle rougissait alors que le repli etait INTACT. Le cap appartient au process principal.
   */
  it('le chat interactif n’a plus de repli codé en dur', () => {
    expect(sourceProcessPrincipal()).not.toContain('policy?.maxIterations ?? 6')
  })

  it('il se replie sur la constante partagée', () => {
    expect(sourceProcessPrincipal()).toContain('policy?.maxIterations ?? CAP_ITERATIONS_TOUR')
  })

  it('la signature de `chat` utilise la même constante, pas un littéral concurrent', () => {
    expect(source('agent-pilot.ts')).toContain('maxIter = CAP_ITERATIONS_TOUR')
  })
})

/**
 * LE MESSAGE DE CAP MENTAIT SUR LE CHIFFRE QU'IL DONNE À DIAGNOSTIQUER.
 *
 * `grantRecoveryIteration` incrémente `iterationLimit` (jusqu'à huit motifs distincts : directive
 * tardive, tour muet, chiffre non vérifié, conclusion absente, échec taisé…). Mais l'erreur terminale
 * rapportait `maxIter`, la valeur INITIALE. Un tour qui avait réellement tourné neuf fois annonçait
 * donc « Cap d'itérations (6) » — et le seul nombre que l'utilisateur peut utiliser pour comprendre
 * ce qui s'est passé était faux.
 */
describe('message de cap — il rapporte le cap EFFECTIF', () => {
  it('l’erreur cite `iterationLimit`, pas le cap initial', () => {
    const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
    expect(source).toContain("Cap d'itérations (${iterationLimit})")
    expect(source).not.toContain("Cap d'itérations (${maxIter})")
  })
})

/**
 * LE BUDGET DU TOUR N'ÉTAIT ANNONCÉ QU'AU DERNIER APPEL — trop tard pour changer de méthode.
 *
 * Mesuré le 2026-09-03 (conv-10) : douze itérations dépensées une par une en lecture, la seule
 * écriture tentée au douzième appel, et refusée. Le modèle n'a appris l'existence de son cap qu'en
 * 12/12, quand il ne pouvait plus que constater ce qu'il n'avait pas fait. Le manque n'est pas un
 * oubli du modèle : le moteur CONNAISSAIT le compte et ne le disait pas. L'annonce de mi-parcours
 * donne le reste ET le levier qui change quelque chose.
 */
describe('budget du tour — annoncé à mi-parcours, pas seulement au dernier appel', () => {
  const pilote = (): string => readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')

  it('une annonce de budget existe, distincte de la consigne de clôture', () => {
    expect(pilote()).toContain('SYSTÈME — BUDGET DU TOUR')
  })

  it('elle tombe à mi-parcours et jamais sur la dernière itération', () => {
    expect(pilote()).toContain('i < iterationLimit - 1 && i === Math.floor(iterationLimit / 2)')
  })

  it('elle nomme le levier concret plutôt que de réclamer de la prudence', () => {
    expect(pilote()).toContain('UN SEUL message')
  })
})
