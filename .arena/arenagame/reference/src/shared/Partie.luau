-- IMPLEMENTATION DE REFERENCE du banc arenagame : prouve que les tests caches sont atteignables.
-- Ne JAMAIS la copier dans une copie de bras.

local Partie = {}
Partie.__index = Partie

Partie.CARTES = {
	chevalier = { cout = 3, type = "unite", image = "rbxassetid://1800000001", pv = 1550, degats = 175, cadence = 1.2, portee = 1.2, vitesse = 1.0 },
	geant = { cout = 5, type = "unite", image = "rbxassetid://1800000002", pv = 3000, degats = 210, cadence = 1.5, portee = 1.2, vitesse = 0.8, batiments = true },
	mousquetaire = { cout = 4, type = "unite", image = "rbxassetid://1800000003", pv = 700, degats = 180, cadence = 1.1, portee = 6, vitesse = 1.0 },
	minipekka = { cout = 4, type = "unite", image = "rbxassetid://1800000004", pv = 1100, degats = 360, cadence = 1.6, portee = 0.8, vitesse = 1.5 },
	archere = { cout = 3, type = "unite", image = "rbxassetid://1800000005", pv = 380, degats = 100, cadence = 0.9, portee = 5, vitesse = 1.0 },
	gobelin = { cout = 2, type = "unite", image = "rbxassetid://1800000006", pv = 240, degats = 115, cadence = 1.1, portee = 0.5, vitesse = 1.5 },
	valkyrie = { cout = 4, type = "unite", image = "rbxassetid://1800000007", pv = 1600, degats = 220, cadence = 1.5, portee = 1.2, vitesse = 1.0 },
	bouledefeu = { cout = 3, type = "sort", image = "rbxassetid://1800000008", degats = 800, rayon = 3 },
}
local DECK = { "chevalier", "geant", "mousquetaire", "minipekka", "archere", "gobelin", "valkyrie", "bouledefeu" }

local TOURS = {
	[1] = { roi = { 9, 3 }, gauche = { 3.5, 6.5 }, droite = { 14.5, 6.5 } },
	[2] = { roi = { 9, 29 }, gauche = { 3.5, 25.5 }, droite = { 14.5, 25.5 } },
}
local PV_TOUR = { roi = 4000, gauche = 2500, droite = 2500 }
local TIR_TOUR = { degats = 60, cadence = 0.8, portee = 7.5 }
local VUE = 5.5

local function lcg(graine: number)
	local s = math.floor(math.abs(graine)) % 2147483648
	return function(): number
		s = (s * 1103515245 + 12345) % 2147483648
		return s / 2147483648
	end
end

local function dist(ax, ay, bx, by)
	return math.sqrt((ax - bx) ^ 2 + (ay - by) ^ 2)
end

function Partie.nouvelle(graine: number)
	local self = setmetatable({}, Partie)
	local r = lcg(graine)
	self.temps = 0
	self.phase = "normal"
	self.vainqueur = nil
	self.unites = {}
	self.prochainId = 1
	self.joueurs = {}
	for j = 1, 2 do
		local deck = table.clone(DECK)
		for i = #deck, 2, -1 do
			local k = 1 + math.floor(r() * i)
			deck[i], deck[k] = deck[k], deck[i]
		end
		local tours = {}
		for nom, pos in TOURS[j] do
			tours[nom] = { pv = PV_TOUR[nom], x = pos[1], y = pos[2], recharge = 0 }
		end
		self.joueurs[j] = {
			elixir = 5,
			main = { deck[1], deck[2], deck[3], deck[4] },
			file = { deck[5], deck[6], deck[7], deck[8] },
			couronnes = 0,
			tours = tours,
		}
	end
	return self
end

local function poseAutorisee(self, j: number, x: number, y: number): boolean
	if x < 0 or x > 18 then
		return false
	end
	-- Emprise des tours vivantes (roi 4x4, princesses 3x3) : on ne pose pas sur une tour.
	for jj = 1, 2 do
		for nom, t in self.joueurs[jj].tours do
			local demi = nom == "roi" and 2 or 1.5
			if t.pv > 0 and math.abs(x - t.x) < demi and math.abs(y - t.y) < demi then
				return false
			end
		end
	end
	if j == 1 then
		if y >= 0 and y < 15 then
			return true
		end
		local adv = self.joueurs[2].tours
		-- poche : moitie de terrain adverse, jusqu'a 4 cases apres la riviere
		if y > 17 and y <= 21 then
			return (x < 9 and adv.gauche.pv <= 0) or (x >= 9 and adv.droite.pv <= 0)
		end
		return false
	else
		if y > 17 and y <= 32 then
			return true
		end
		local adv = self.joueurs[1].tours
		if y < 15 and y >= 11 then
			return (x < 9 and adv.gauche.pv <= 0) or (x >= 9 and adv.droite.pv <= 0)
		end
		return false
	end
end

function Partie:jouer(j: number, i: number, x: number, y: number): (boolean, string?)
	if self.phase == "terminee" then
		return false, "partie terminee"
	end
	if j ~= 1 and j ~= 2 then
		return false, "joueur invalide"
	end
	if type(i) ~= "number" or i ~= math.floor(i) or i < 1 or i > 4 then
		return false, "index invalide"
	end
	if type(x) ~= "number" or type(y) ~= "number" or x ~= x or y ~= y then
		return false, "position invalide"
	end
	local J = self.joueurs[j]
	local id = J.main[i]
	local c = Partie.CARTES[id]
	if J.elixir < c.cout then
		return false, "elixir insuffisant"
	end
	if c.type == "sort" then
		if x < 0 or x > 18 or y < 0 or y > 32 then
			return false, "hors arene"
		end
		local adv = 3 - j
		for _, u in self.unites do
			if u.joueur == adv and dist(u.x, u.y, x, y) <= c.rayon then
				u.pv -= c.degats
			end
		end
		for _, t in self.joueurs[adv].tours do
			if t.pv > 0 and dist(t.x, t.y, x, y) <= c.rayon + 1 then
				t.pv = math.max(0, t.pv - c.degats * 0.8)
			end
		end
	else
		if not poseAutorisee(self, j, x, y) then
			return false, "pose interdite"
		end
		table.insert(self.unites, { id = self.prochainId, joueur = j, carte = id, pv = c.pv, x = x, y = y, recharge = 0, deploiement = 1 })
		self.prochainId += 1
	end
	J.elixir -= c.cout
	J.main[i] = table.remove(J.file, 1)
	table.insert(J.file, id)
	self:_nettoyer()
	return true
end

function Partie:_nettoyer()
	for k = #self.unites, 1, -1 do
		if self.unites[k].pv <= 0 then
			table.remove(self.unites, k)
		end
	end
	for j = 1, 2 do
		local adv = self.joueurs[3 - j]
		local J = self.joueurs[j]
		local t = J.tours
		local c = 0
		if t.gauche.pv <= 0 then
			t.gauche.pv = 0
			c += 1
		end
		if t.droite.pv <= 0 then
			t.droite.pv = 0
			c += 1
		end
		if t.roi.pv <= 0 then
			t.roi.pv = 0
			c = 3
		end
		adv.couronnes = c
	end
	if self.phase ~= "terminee" then
		local c1, c2 = self.joueurs[1].couronnes, self.joueurs[2].couronnes
		if c1 == 3 or c2 == 3 or (self.phase == "prolongation" and c1 ~= c2) then
			self:_finir(c1 > c2 and 1 or 2)
		end
	end
end

function Partie:_finir(v: number)
	self.phase = "terminee"
	self.vainqueur = v
end

local function cible(self, u, c)
	local adv = 3 - u.joueur
	local meilleure, d0 = nil, math.huge
	if not c.batiments then
		for _, v in self.unites do
			if v.joueur == adv and v.pv > 0 then
				local d = dist(u.x, u.y, v.x, v.y)
				if d < VUE and d < d0 then
					meilleure, d0 = v, d
				end
			end
		end
	end
	if meilleure then
		return meilleure, d0
	end
	local T = self.joueurs[adv].tours
	local cote = u.x < 9 and T.gauche or T.droite
	local t = cote.pv > 0 and cote or T.roi
	return t, dist(u.x, u.y, t.x, t.y)
end

function Partie:_pas(dt: number)
	-- elixir
	local double = self.temps >= 120
	for j = 1, 2 do
		local J = self.joueurs[j]
		J.elixir = math.min(10, J.elixir + dt / 2.8 * (double and 2 or 1))
	end
	-- unites
	for _, u in self.unites do
		-- Temps de deploiement (1 s) : l'unite est posee mais n'agit pas encore.
		if (u.deploiement or 0) > 0 then
			u.deploiement -= dt
			continue
		end
		local c = Partie.CARTES[u.carte]
		local t, d = cible(self, u, c)
		u.recharge = math.max(0, u.recharge - dt)
		local portee = c.portee + (t.recharge ~= nil and t.id == nil and 1 or 0)
		if d <= portee then
			if u.recharge <= 0 then
				t.pv = math.max(t.id and -math.huge or 0, t.pv - c.degats)
				u.recharge = c.cadence
			end
		else
			local sens = u.joueur == 1 and 1 or -1
			local pont = (u.joueur == 1 and u.y < 17) or (u.joueur == 2 and u.y > 15)
			local vx, vy
			if pont then
				local voie = u.x < 9 and 3.5 or 14.5
				vx, vy = voie - u.x, sens * 1
			else
				vx, vy = t.x - u.x, t.y - u.y
			end
			local n = math.sqrt(vx * vx + vy * vy)
			if n > 0 then
				local pasMax = c.vitesse * dt
				u.x += vx / n * math.min(pasMax, n)
				u.y += vy / n * pasMax
			end
		end
	end
	-- tours
	for j = 1, 2 do
		for _, t in self.joueurs[j].tours do
			if t.pv > 0 then
				t.recharge = math.max(0, t.recharge - dt)
				if t.recharge <= 0 then
					local best, d0 = nil, TIR_TOUR.portee
					for _, u in self.unites do
						if u.joueur ~= j then
							local d = dist(t.x, t.y, u.x, u.y)
							if d <= d0 then
								best, d0 = u, d
							end
						end
					end
					if best then
						best.pv -= TIR_TOUR.degats
						t.recharge = TIR_TOUR.cadence
					end
				end
			end
		end
	end
	self:_nettoyer()
	self.temps += dt
	if self.phase == "normal" and self.temps >= 180 then
		local c1, c2 = self.joueurs[1].couronnes, self.joueurs[2].couronnes
		if c1 ~= c2 then
			self:_finir(c1 > c2 and 1 or 2)
		else
			self.phase = "prolongation"
		end
	elseif self.phase == "prolongation" and self.temps >= 300 then
		local function plusFaible(j)
			local m = math.huge
			for _, t in self.joueurs[j].tours do
				m = math.min(m, t.pv)
			end
			return m
		end
		local f1, f2 = plusFaible(1), plusFaible(2)
		self:_finir(f1 == f2 and 0 or (f1 > f2 and 1 or 2))
	end
end

function Partie:avancer(dt: number)
	if type(dt) ~= "number" or dt ~= dt or dt <= 0 or self.phase == "terminee" then
		return
	end
	while dt > 1e-9 and self.phase ~= "terminee" do
		local d = math.min(dt, 0.1)
		self:_pas(d)
		dt -= d
	end
end

function Partie:etat()
	local joueurs = {}
	for j = 1, 2 do
		local J = self.joueurs[j]
		local tours = {}
		for nom, t in J.tours do
			tours[nom] = { pv = t.pv, x = t.x, y = t.y }
		end
		joueurs[j] = {
			elixir = J.elixir,
			main = table.clone(J.main),
			prochaine = J.file[1],
			couronnes = J.couronnes,
			tours = tours,
		}
	end
	local unites = {}
	for _, u in self.unites do
		table.insert(unites, { id = u.id, joueur = u.joueur, carte = u.carte, pv = u.pv, x = u.x, y = u.y })
	end
	return { temps = self.temps, phase = self.phase, vainqueur = self.vainqueur, joueurs = joueurs, unites = unites }
end

return Partie
