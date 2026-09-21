-- TESTS CACHES DE LA BOUTIQUE : imprime « CAS ok|ko <nom> [motif] » puis « SCORE <ok>/<total> ».
local NB_CAS = 13
local ok0, Boutique = pcall(require, "./shared/Boutique")
local total, reussis = 0, 0
local function cas(nom, f)
	total += 1
	local ok, err = pcall(f)
	if ok then
		reussis += 1
		print("CAS ok " .. nom)
	else
		print("CAS ko " .. nom .. " : " .. tostring(err))
	end
end
local function exiger(c, m)
	if not c then
		error(m, 0)
	end
end
local function copie(t)
	if type(t) ~= "table" then
		return t
	end
	local r = {}
	for k, v in t do
		r[k] = copie(v)
	end
	return r
end
local function egal(a, b)
	if type(a) ~= type(b) then
		return false
	end
	if type(a) ~= "table" then
		return a == b
	end
	for k, v in a do
		if not egal(v, b[k]) then
			return false
		end
	end
	for k in b do
		if a[k] == nil then
			return false
		end
	end
	return true
end

if not ok0 or type(Boutique) ~= "table" or type(Boutique.CATALOGUE) ~= "table" then
	for _ = 1, NB_CAS do
		print("CAS ko module Boutique absent ou incomplet")
	end
	print(string.format("SCORE 0/%d", NB_CAS))
	return
end

local function offreAbordable(p)
	for id, o in Boutique.CATALOGUE do
		if (p[o.monnaie] or 0) >= o.prix then
			return id, o
		end
	end
	return nil, nil
end
local function riche()
	local p = Boutique.nouveauProfil()
	p["or"] = 100000
	p.gemmes = 100000
	return p
end
local function unProduit()
	for id, pr in Boutique.PRODUITS or {} do
		return id, pr
	end
	return nil, nil
end

cas("profil neuf coherent", function()
	local p = Boutique.nouveauProfil()
	exiger(type(p["or"]) == "number" and p["or"] >= 0, "or")
	exiger(type(p.gemmes) == "number" and p.gemmes >= 0, "gemmes")
	exiger(type(p.inventaire) == "table", "inventaire")
end)
cas("catalogue d'au moins 3 offres valides", function()
	local n = 0
	for _, o in Boutique.CATALOGUE do
		n += 1
		exiger(type(o.prix) == "number" and o.prix > 0, "prix")
		exiger(o.monnaie == "or" or o.monnaie == "gemmes", "monnaie")
		exiger(type(o.objet) == "string", "objet")
	end
	exiger(n >= 3, "moins de 3 offres")
end)
cas("un achat debite la bonne monnaie", function()
	local p = riche()
	local id, o = offreAbordable(p)
	local avant = p[o.monnaie]
	exiger(Boutique.acheter(p, id), "achat refuse")
	exiger(p[o.monnaie] == avant - o.prix, "debit faux")
end)
cas("un achat credite l'objet", function()
	local p = riche()
	local id, o = offreAbordable(p)
	local avant = p.inventaire[o.objet] or 0
	Boutique.acheter(p, id)
	exiger((p.inventaire[o.objet] or 0) == avant + 1, "objet non credite")
end)
cas("solde insuffisant : refus et profil inchange", function()
	local p = Boutique.nouveauProfil()
	p["or"] = 0
	p.gemmes = 0
	local av = copie(p)
	for id in Boutique.CATALOGUE do
		exiger(not Boutique.acheter(p, id), "achat accepte sans argent")
	end
	exiger(egal(av, p), "profil modifie par un refus")
end)
cas("offre inconnue : refus et profil inchange", function()
	local p = riche()
	local av = copie(p)
	exiger(not Boutique.acheter(p, "offre-qui-n-existe-pas"), "offre inconnue acceptee")
	exiger(egal(av, p), "profil modifie")
end)
cas("achats repetes jusqu'a epuisement exact", function()
	local id, o = next(Boutique.CATALOGUE)
	local p = Boutique.nouveauProfil()
	p["or"] = 0
	p.gemmes = 0
	p[o.monnaie] = o.prix * 3 + math.max(0, o.prix - 1)
	local n = 0
	while Boutique.acheter(p, id) do
		n += 1
		exiger(n < 100, "boucle")
	end
	exiger(n == 3, "attendu 3 achats, obtenu " .. n)
	exiger(p[o.monnaie] >= 0, "solde negatif")
end)
cas("le catalogue n'est pas modifie par un achat", function()
	local av = copie(Boutique.CATALOGUE)
	local p = riche()
	Boutique.acheter(p, (offreAbordable(p)))
	exiger(egal(av, Boutique.CATALOGUE), "catalogue modifie")
end)
cas("recu Robux connu : gemmes creditees", function()
	local pid, pr = unProduit()
	exiger(pid ~= nil, "aucun produit Robux")
	local p = Boutique.nouveauProfil()
	local g = p.gemmes
	exiger(Boutique.traiterRecu(p, { PurchaseId = "a1", ProductId = pid }) == "PurchaseGranted", "non accorde")
	exiger(p.gemmes == g + pr.gemmes, "gemmes fausses")
end)
cas("recu rejoue : aucun double credit", function()
	local pid, pr = unProduit()
	exiger(pid ~= nil, "aucun produit Robux")
	local p = Boutique.nouveauProfil()
	local g = p.gemmes
	Boutique.traiterRecu(p, { PurchaseId = "b1", ProductId = pid })
	exiger(
		Boutique.traiterRecu(p, { PurchaseId = "b1", ProductId = pid }) == "PurchaseGranted",
		"rejeu doit rendre PurchaseGranted"
	)
	exiger(p.gemmes == g + pr.gemmes, "double credit")
end)
cas("recu inconnu : NotProcessedYet, profil inchange", function()
	local p = Boutique.nouveauProfil()
	local av = copie(p)
	exiger(
		Boutique.traiterRecu(p, { PurchaseId = "c1", ProductId = -42 }) == "NotProcessedYet",
		"produit inconnu accorde"
	)
	exiger(egal(av, p), "profil modifie")
end)
cas("sauvegarde puis chargement : meme profil, recus compris", function()
	local pid = unProduit()
	exiger(pid ~= nil, "aucun produit Robux")
	local p = riche()
	Boutique.acheter(p, (offreAbordable(p)))
	Boutique.traiterRecu(p, { PurchaseId = "d1", ProductId = pid })
	local d = Boutique.serialiser(p)
	local function pur(t)
		for k, v in t do
			exiger(type(k) == "string" or type(k) == "number", "cle non sauvegardable")
			local ty = type(v)
			exiger(ty == "string" or ty == "number" or ty == "boolean" or ty == "table", "valeur non sauvegardable")
			if ty == "table" then
				pur(v)
			end
		end
	end
	pur(d)
	local q = Boutique.charger(copie(d))
	exiger(q["or"] == p["or"] and q.gemmes == p.gemmes and egal(q.inventaire, p.inventaire), "profil different")
	local g = q.gemmes
	Boutique.traiterRecu(q, { PurchaseId = "d1", ProductId = pid })
	exiger(q.gemmes == g, "recu deja traite recredite apres rechargement")
end)
cas("chargement sans donnees : nouveau joueur", function()
	local q = Boutique.charger(nil)
	exiger(type(q) == "table" and type(q.gemmes) == "number" and type(q.inventaire) == "table", "profil invalide")
end)
print(string.format("SCORE %d/%d", reussis, total))
