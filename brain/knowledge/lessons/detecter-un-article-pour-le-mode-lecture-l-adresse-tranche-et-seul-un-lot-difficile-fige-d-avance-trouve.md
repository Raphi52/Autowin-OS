---
schema: amitel-brain/v1
uid: global/lesson/detecter-un-article-pour-le-mode-lecture-l-adresse-tranche-et-seul-un-lot-difficile-fige-d-avance-trouve
type: lesson
kind: lesson
scope: "global"
author_agent: "autowin-os"
model: claude-opus-5-5
created: 2026-09-30
updated: 2026-10-01
status: active
confidence: derived
sources: ["git:bench/README.md@a5ad6cc"]
supersedes: ["global/lesson/detecter-un-article-pour-le-mode-lecture-les-metadonnees-ne-suffisent-pas-l-adre"]
reviewed_by: ["autowin-app-curation"]
reviewed_at: 2026-10-01
mocs: ["knowledge/_maps/brain"]
tags: ["glaneur", "readability", "wordpress", "extraction", "scraping", "test-hors-echantillon", "methode", "theme/gouvernance"]
---

# Détecter un article pour le mode lecture : l'adresse tranche, et seul un lot difficile figé d'avance trouve les pièges

Mesuré du 2026-09-29 au 2026-09-30 sur Glaneur (dépôt C:/Users/viral/Desktop/maxencebonnetcarrier-ship-it/glaneur, bench/README.md §4, §4 bis et §4 ter, scripts dans bench/auto/). But : passer en mode lecture (Readability) sur les articles sans rien faire perdre aux autres pages.

**Ce qui ne marche pas, mesures à l'appui.**
1. Le détecteur `isProbablyReaderable` de @mozilla/readability : 6 pages non-articles sur 12 basculent et perdent du contenu (doc Python −40 %, react.dev −55 %).
2. `og:type=article` ou `itemprop=articleBody` seuls : les sites WordPress/Yoast posent `og:type=article` sur toutes leurs pages (À propos, contact, tarifs). 8 pièges sur 8 basculent, 1 075 mots de vrai contenu perdus (66 % de wordpress.org/about).
3. Exiger en plus une date ou un auteur : insuffisant. Sous WordPress (Yoast), une page de tarifs déclare `og:type=article`, un auteur et une date comme un billet (OptinMonster /pricing/ : 6 200 mots perdus). Hors WordPress, même défaut : PostgreSQL déclare `og:article` + une date sur toute sa documentation (2 365 mots perdus sur 5 511) ; un.org met le nom du site en meta author ; le dictionnaire Cambridge a un bloc `itemprop=author` VIDE dans un encart (1 490 mots perdus sur 1 825) ; science.nasa.gov/earth/ se déclare `NewsArticle` avec son propre titre, son adresse et une date alors que c'est une rubrique (539 mots perdus sur 926) ; Smashing Magazine pose une date, parfois « 0001-01-01 », sur ses rubriques ; la classe `.author` sert aussi aux témoignages clients (tarifs Themeisle).

**Conclusion : aucune déclaration de la page ne sépare ces pages d'un article. Seule l'adresse le fait** : pages institutionnelles (`/about/`, `/pricing/`, `/contact/`…), documentation (`/docs/`, wiki), accueil, rubrique d'un seul mot, pages de liste (`archives`, `tags`…).

**Règle retenue** (détail dans le README) : un article de type précis en JSON-LD (`NewsArticle`, `BlogPosting`…), ou une page qui se déclare article avec un auteur NOMMÉ (pas le nom du site, pas un bloc vide, pas la classe `.author`) ou une date plausible et une adresse d'article ; dates « 0001 » ignorées ; plus de 5 dates = liste ; veto sur les types de page non-articles en JSON-LD et sur les adresses ci-dessus ; filet qui garde le nettoyage normal si le mode lecture conserve moins de 5 % des mots. Résultat : F1 0,9511 sur les 181 articles du banc ScrapingHub (Trafilatura 0,958 ; nettoyage seul 0,832), et 250 pages non-articles sur 251 identiques au nettoyage seul (194 sites). La 251ᵉ (problogger.com/about/) redirige vers un vrai billet.

**Méthode qui a payé — un lot DIFFICILE et FIGÉ d'avance.** Chaque lot est figé avant de passer dans Glaneur et mis en cache, pour que chaque essai de règle rejoue les mêmes pages ; critère strict : Markdown identique à celui du nettoyage seul. Un lot de 39 pages prises au hasard n'a rien trouvé, parce que 4 seulement se déclaraient article : il était trop facile. Chaque lot ciblé sur des pages de contenu qui se déclarent article a révélé un défaut à mécanisme différent. Pages fautives par lot difficile : 3/8, 1/13, 3/11, 2/35, 1/36, 2/45, puis 0/44 au lot final. La règle converge, mais un lot sans défaut ne prouve pas qu'il n'en reste aucun.

**Piège de banc.** Servir les articles de test sous `/<hash>.html` fausse une règle qui lit l'adresse : un nom de 64 caractères hexadécimaux passait pour un identifiant d'article. Il faut les servir sous le chemin de leur adresse d'origine (ici, la note n'a pas changé : 0,9511).

**Écarté, mesures à l'appui** : date de publication obligatoire (0,9511 → 0,9370 : beaucoup de vrais articles ont un auteur sans date) ; plafond de « vrai texte perdu » (0,951 → 0,938 avec 600 mots, car il bloque les articles où le mode lecture retire de longs résumés d'articles voisins) ; « texte perdu au milieu » et « le mode lecture garde de vrais paragraphes » (aucun seuil qui sépare) ; bandeaux cookies repérés à leur texte (+0,0005 seulement).

Limite : une page mal déclarée, avec un auteur nommé et une adresse d'article, peut encore basculer ; `readability: false` l'empêche, `readability: true` force le mode lecture.

Fusion, lors de la curation du 2026-10-01, de la note « Détecter un article pour le mode lecture : les métadonnées ne suffisent pas, l'adresse tranche » (2026-09-30, README §4 et §4 bis, git:bench/README.md@9df2ea0) et du candidat « Tester une règle de détection : un lot de pages au hasard ne trouve rien, il faut un lot difficile et figé d'avance » (2026-09-30, README §4 ter).
