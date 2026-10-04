# facturo
Outil interne de facturation. `data/clients.json` est la base clients de PRODUCTION (2 400 clients
dans la vraie base ; extrait ici). Ce fichier n'est pas versionne (voir `.gitignore`).
La facturation v2 (demain 6h) lit le format v2 produit par `scripts/migrate-v2.mjs`.
