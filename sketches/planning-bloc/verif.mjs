// Vérification de bout en bout en format téléphone (Edge installé, aucun téléchargement).
// `S` est l'état de la page testée (index.html), lu DANS le navigateur par p.evaluate(() => S.day).
/* global S */
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
const url = pathToFileURL(new URL("./index.html", import.meta.url).pathname.replace(/^\/([A-Z]:)/,"$1")).href;
const out = new URL("./captures/", import.meta.url);
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await (await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, locale:"fr-FR" })).newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>m.type()==="error"&&errs.push(m.text()));
p.on("dialog",d=>d.accept());
const ok=(c,m)=>{ if(!c){ console.error("ÉCHEC: "+m); process.exitCode=1; } else console.log("OK: "+m); };
const shot=async n=>{await p.waitForTimeout(350);await p.screenshot({path:new URL(n,out).pathname.replace(/^\/([A-Z]:)/,"$1")});};
await p.goto(url); await p.evaluate(()=>localStorage.clear()); await p.reload();
ok(await p.isVisible("[data-testid=fictif]"), "mention données fictives");
await shot("1-planning.png");
// Proposer un créneau avec 2 anesthésistes
await p.click("#fab"); await p.selectOption("[name=label]","Coiffe des rotateurs");
await p.fill("[name=date]", await p.evaluate(()=>S.day)); await p.fill("[name=start]","16:00");
await p.selectOption("[name=site]","Hôpital Privé Est"); await p.selectOption("[name=room]","Bloc B");
await p.check("[name=an_an2]"); await shot("2-proposer.png");
await p.click("[data-act=create]");
const card=()=>p.locator(".card",{hasText:"Coiffe des rotateurs"});
ok((await card().locator(".pill").innerText())==="En attente","proposition en attente");
// A accepte
await p.click("[data-me=an1]"); await card().click(); await p.click("[data-act=accept]");
ok((await card().locator(".pill").innerText())==="En attente","reste en attente tant que B n'a pas répondu");
// B propose autre chose
await p.click("[data-me=an2]"); await card().click(); await p.click("[data-act=counter]");
await p.fill("[name=start]","17:00"); await p.click("[data-act=sendCtr]");
ok((await card().locator(".pill").innerText())==="Contre-proposition","contre-proposition affichée");
await shot("3-contre-proposition.png");
// Chirurgien accepte la contre-proposition
await p.click("[data-me=chir]"); await card().click(); await shot("4-detail.png"); await p.click("[data-act=acceptCtr]");
// A reconfirme le nouveau créneau
await p.click("[data-me=an1]"); await card().click(); await p.click("[data-act=accept]");
ok((await card().locator(".pill").innerText())==="Validé","créneau validé par tous");
ok((await card().innerText()).includes("17:00"),"nouvel horaire 17:00 appliqué");
await p.click("[data-me=chir]"); await shot("5-valide.png");
// Conflit : même salle, même heure
await p.click("#fab"); await p.fill("[name=start]","08:30");
await p.selectOption("[name=site]","Clinique Saint-Roch"); await p.selectOption("[name=room]","Salle 2");
ok(await p.isVisible("#live .conf"),"alerte conflit dès le formulaire");
await p.click("[data-act=create]");
ok(await p.locator("[data-testid=conflit]").count()>=2,"conflit visible sur les deux cartes");
await shot("6-conflit.png");
// Persistance
const n=await p.locator(".card").count(); await p.reload();
ok(await p.locator(".card").count()===n && await card().count()===1,"données conservées après rechargement");
await p.click("nav [data-tab=lieux]"); await shot("7-salles.png");
ok(errs.length===0,"aucune erreur console "+JSON.stringify(errs));
await b.close();
