# Relancer un explorateur quand la moisson est tiède

Texte prêt à envoyer tel quel. Aucun trou à remplir.

---

**Fresh vision sur `skills/scout/` et `src/main/scout-cible.ts` (la consigne de l'explorateur et la lecture machine de sa sortie).** La piste retenue au tour précédent est déjà prise : ne la repropose pas.

Je veux surtout des réinventions, pas des correctifs sûrs. Si aucune piste à fort impact ne survit au premier balayage, refais un tour de lentilles ambitieuses avant de rendre — pas de tableau tout-🔧.

Inclus ce qui est sorti ailleurs ces 30 à 90 jours, avec la source citée et le point précis du code où ça se brancherait.

Chaque piste « correctif » doit citer un `fichier:ligne` (`file:line`) que tu as réellement OUVERT ; une piste déduite d'un grep reste plafonnée à 50.

Termine par une seule ligne `CIBLE: … — POURQUOI: …`.

---

Si la cible n'est pas la bonne, remplace uniquement les deux chemins de la première phrase ; le reste ne bouge pas.

## Pourquoi ces phrases

| Phrase | Effet réel | Où c'est écrit |
|---|---|---|
| « fresh vision » | fait passer le quota de pistes ambitieuses de ~30 % à ≥50 % | `SKILL.md`, « Coverage dial » |
| « refais un tour si rien de fort ne survit » | déclenche l'élargissement — le remède direct à « pas convaincant » | `SKILL.md`, règle 2b |
| « 30 à 90 jours, avec la source » | active la lentille prior-art, sinon optionnelle | `SKILL.md`, lentille web |
| « `fichier:ligne` réellement ouvert » | supprime les pistes déduites, plafonnées à 50 | `SKILL.md`, plafond de preuve |
| « une seule ligne `CIBLE:` » | la machine ne lit que la première ; sans elle rien n'est repris | `src/main/scout-cible.ts` |
