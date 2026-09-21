-- EQUILIBRAGE CACHE : bots contre bots, hasard du simulateur seulement (independant du jeu).
-- 1. Par carte : un bot qui PRIVILEGIE cette carte affronte un bot uniforme, 150 parties de chaque
--    cote. Taux de victoire (egalite = 0,5) dans [45 %, 55 %] = 1, lineaire jusqu'a 0 a 35 % / 65 %.
-- 2. 2000 parties uniforme contre uniforme : ecart de victoire J1/J2 (< 4 points = 1, 0 a 15 points)
--    et duree mediane (dans [120, 240] s = 1, 0 hors [60, 360] s).
-- Imprime « EQUI carte <id> <taux> », « EQUI ecart <pts> », « EQUI duree <s> », puis
-- « EQUI SCORE <cartes 0-1> <ecart 0-1> <duree 0-1> ».

local Partie = require("./shared/Partie")

local DT = 0.25
local LIMITE = 400

local function lcg(s: number)
	local etat = s % 2147483648
	return function(): number
		etat = (etat * 1103515245 + 12345) % 2147483648
		return etat / 2147483648
	end
end

local function cout(id: string): number
	local c = Partie.CARTES[id]
	return c and c.cout or 99
end

-- Pose : unite/batiment dans son camp sur une voie, sort sur une tour princesse adverse.
local function poser(p, j: number, i: number, id: string, r)
	local c = Partie.CARTES[id]
	local gauche = r() < 0.5
	local x = gauche and 3.5 or 14.5
	if c and c.type == "sort" then
		-- vise l'unite adverse la plus avancee vers son camp, sinon une tour princesse
		local cible, meilleur = nil, math.huge
		for _, u in p:etat().unites do
			local d = j == 1 and u.y or (32 - u.y)
			if u.joueur ~= j and d < meilleur then
				cible, meilleur = u, d
			end
		end
		if cible then
			return p:jouer(j, i, cible.x, cible.y)
		end
		return p:jouer(j, i, x, j == 1 and 25.5 or 6.5)
	end
	return p:jouer(j, i, x + (r() - 0.5), j == 1 and 11 or 21)
end

local function jouerBot(p, j: number, r, prefere: string?)
	local e = p:etat().joueurs[j]
	if not e or not e.main then
		return
	end
	if prefere then
		for i, id in e.main do
			if id == prefere then
				if e.elixir >= cout(id) then
					poser(p, j, i, id, r)
					return
				end
			end
		end
	end
	if r() < 0.3 then
		local i = 1 + math.floor(r() * 4)
		local id = e.main[i]
		if id and e.elixir >= cout(id) then
			poser(p, j, i, id, r)
		end
	end
end

-- Rend (vainqueur 0/1/2 ou nil si non terminee, duree)
local function partie(graine: number, prefere: { [number]: string? }): (number?, number)
	local r = lcg(graine * 104729 + 17)
	local ok, p = pcall(Partie.nouvelle, graine)
	if not ok then
		return nil, LIMITE
	end
	local t = 0
	while t < LIMITE do
		for j = 1, 2 do
			pcall(jouerBot, p, j, r, prefere[j])
		end
		local okA = pcall(p.avancer, p, DT)
		if not okA then
			return nil, t
		end
		t += DT
		local e = p:etat()
		if e.phase == "terminee" then
			return e.vainqueur, t
		end
	end
	return nil, t
end

local function note(taux: number, bas: number, haut: number, zeroBas: number, zeroHaut: number): number
	if taux >= bas and taux <= haut then
		return 1
	elseif taux < bas then
		return math.max(0, (taux - zeroBas) / (bas - zeroBas))
	end
	return math.max(0, (zeroHaut - taux) / (zeroHaut - haut))
end

-- Cartes reellement distribuees : vues en main ou en prochaine sur quelques parties.
local vues, liste = {}, {}
for g = 1, 20 do
	local ok, p = pcall(Partie.nouvelle, g)
	if ok then
		for j = 1, 2 do
			local e = p:etat().joueurs[j]
			for _, id in (e and e.main) or {} do
				if not vues[id] then
					vues[id] = true
					table.insert(liste, id)
				end
			end
			if e and e.prochaine and not vues[e.prochaine] then
				vues[e.prochaine] = true
				table.insert(liste, e.prochaine)
			end
		end
	end
end
table.sort(liste)

local N = 150
local somme = 0
for k, id in liste do
	local points = 0
	for g = 1, N do
		for cote = 1, 2 do
			local pref = {}
			pref[cote] = id
			local v = partie(k * 100000 + g * 2 + cote, pref)
			if v == cote then
				points += 1
			elseif v == 0 then
				points += 0.5
			end
		end
	end
	local taux = points / (2 * N)
	print(string.format("EQUI carte %s %.3f", id, taux))
	somme += note(taux, 0.45, 0.55, 0.35, 0.65)
end
local sCartes = #liste > 0 and somme / #liste or 0

local v1, v2, durees, finies = 0, 0, {}, 0
for g = 1, 2000 do
	local v, d = partie(900000 + g, {})
	if v ~= nil then
		finies += 1
		table.insert(durees, d)
		if v == 1 then
			v1 += 1
		elseif v == 2 then
			v2 += 1
		end
	end
end
table.sort(durees)
local ecart = finies > 0 and math.abs(v1 - v2) / finies * 100 or 100
local mediane = #durees > 0 and durees[math.ceil(#durees / 2)] or 0
print(string.format("EQUI ecart %.1f", ecart))
print(string.format("EQUI duree %.1f", mediane))
local sEcart = ecart < 4 and 1 or math.max(0, (15 - ecart) / 11)
local sDuree = finies == 0 and 0 or note(mediane, 120, 240, 60, 360)
if #liste == 0 then
	sEcart, sDuree = 0, 0
end
print(string.format("EQUI SCORE %.3f %.3f %.3f", sCartes, sEcart, sDuree))
