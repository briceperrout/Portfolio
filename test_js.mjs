// Tests du routage multi-modèles côté JavaScript : worker.js (miroir de serveur.py) et assistant.js.
// Sans dépendance : `node test_js.mjs` (Node ≥ 18), ou import dynamique depuis un navigateur (retourne `resultats`).
// Aucun appel réseau : le `fetch` vers OpenAI est remplacé par un faux amont.

import worker, { MODEL_FAST, MODEL_REASONING, choisirModele, choixRepli, corpsOpenAI, questionComplexe, tokensDuJour } from "./worker.js";
import { CONSIGNE_VOCALE, DELAI_SILENCE_MS, choisirVoixFr, decouperPhrases, extraireBalises, libelleModele, preparerRequeteCloud, texteParle } from "./assistant.js";

import { comparerFrais, FRAIS_CHARGE, FRAIS_OPTIMISE, RENDEMENT_BRUT_FRAIS } from "./projection.js";

export const resultats = { ok: 0, echecs: [] };
function verifier(condition, message) {
  if (condition) resultats.ok++;
  else resultats.echecs.push(message);
}
const egal = (a, b, message) => verifier(JSON.stringify(a) === JSON.stringify(b), `${message} — obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`);

const ENV = { OPENAI_API_KEY: "sk-" + "a".repeat(32) };
const demande = (question, extra = {}) => ({
  systeme: "Consigne.", profil: "", messages: [{ role: "user", content: question }], stream: true, ...extra,
});
const valider = (question, extra = {}) => ({ ...demande(question, extra), approfondi: extra.modeApprofondi === true, question });

// ---------------------------------------------------------------- worker.js : routage et payload
for (const q of ["Une SASU ou une EURL ?", "Quelle holding", "Démembrement", "Nue-propriété et usufruit", "Ma SUCCESSION", "Des donations", "Suis-je soumis à l'IFI ?", "Ma décumulation", "Fais un audit complet"]) {
  verifier(questionComplexe(q), `mot-clé non détecté : ${q}`);
  egal(choisirModele(valider(q), ENV).modele, "o3", `routage de « ${q} »`);
}
for (const q of ["Quel bénéfice espérer ?", "Combien de PEA ?", "audit simple"]) verifier(!questionComplexe(q), `faux positif : ${q}`);
egal(choisirModele(valider("Bonjour"), ENV).modele, "gpt-5.4-mini", "question simple → modèle rapide");
egal(choisirModele(valider("Bonjour", { modeApprofondi: true }), ENV).modele, "o3", "mode approfondi → raisonnement");
egal(choisirModele(valider("Bonjour", { modeApprofondi: true }), { ...ENV, OPENAI_ENABLE_REASONING: "0" }).modele, "gpt-5.4-mini", "coupe-circuit");
egal([MODEL_FAST, MODEL_REASONING], ["gpt-5.4-mini", "o3"], "constantes");
egal(choisirModele(valider("Bonjour"), ENV).effort, "low", "modèle rapide : effort low");
egal(choisirModele(valider("IFI"), { ...ENV, OPENAI_MODEL_REASONING: "o3-pro" }).modele, "o3-pro", "modèle de raisonnement configurable");
egal(choisirModele(valider("IFI"), ENV, { raisonnement: 224999 }).modele, "o3", "pool o3 juste sous le plafond");
{
  const repli = choisirModele(valider("IFI"), ENV, { raisonnement: 225000 });
  egal([repli.modele, repli.effort, repli.maxCompletion, repli.pool], ["gpt-5.4-mini", "high", 2500, "rapide"], "pool o3 épuisé → gpt-5.4-mini effort high");
  egal(repli.libelle, "gpt-5.4-mini (raisonnement élevé · quota o3 préservé)", "libellé du repli");
  egal(choisirModele(valider("Bonjour"), ENV, { raisonnement: 300000 }).libelle, "gpt-5.4-mini", "question simple : libellé normal");
  egal(choisirModele(valider("IFI"), ENV, { rapide: 2400000, raisonnement: 10 }).modele, "o3", "pools indépendants");
  for (const [demande, tokens] of [[valider("Bonjour"), { rapide: 2350000 }], [valider("IFI"), { rapide: 2350000, raisonnement: 225000 }]]) {
    let erreur = null;
    try { choisirModele(demande, ENV, tokens); } catch (e) { erreur = e; }
    egal([erreur?.statut, erreur?.code], [429, "quota_journalier"], "plafond du pool rapide : refus 429");
  }
}

{
  const d = valider("Parle-moi de la succession");
  const [corps, modele] = corpsOpenAI(d, ENV);
  egal(modele, "o3", "modèle du payload");
  egal(corps.messages[0].role, "developer", "rôle developer");
  verifier(!("temperature" in corps) && !("max_tokens" in corps), "ni temperature ni max_tokens pour o3");
  egal(corps.reasoning_effort, "medium", "reasoning_effort");
  egal(corps.max_completion_tokens, 2500, "max_completion_tokens");
  egal(corps.stream_options, { include_usage: true }, "stream_options");
  const [rapide] = corpsOpenAI(valider("Bonjour"), ENV);
  verifier(!("temperature" in rapide) && !("max_tokens" in rapide), "gpt-5.4-mini : paramètres refusés absents");
  egal([rapide.reasoning_effort, rapide.max_completion_tokens], ["low", 1500], "gpt-5.4-mini : effort et plafond");
  const [eleve] = corpsOpenAI(d, ENV, choisirModele(d, ENV, { raisonnement: 225000 }));
  egal([eleve.model, eleve.messages[0].role, eleve.reasoning_effort, eleve.max_completion_tokens], ["gpt-5.4-mini", "developer", "high", 2500], "repli : payload effort high");
  verifier(!("temperature" in eleve) && !("max_tokens" in eleve), "repli : paramètres refusés absents");
}

{
  const o3 = choisirModele(valider("IFI"), ENV);
  for (const statut of [400, 403, 404, 429]) {
    const r = choixRepli(o3, statut, ENV);
    egal([r?.modele, r?.effort, r?.maxCompletion, r?.pool, r?.libelle], ["gpt-5.4-mini", "high", 2500, "rapide", "gpt-5.4-mini (raisonnement élevé · o3 indisponible)"], `repli après un refus ${statut}`);
  }
  egal(choixRepli(o3, 401, ENV), null, "pas de repli sur 401");
  egal(choixRepli(o3, 500, ENV), null, "pas de repli sur 500");
  egal(choixRepli(o3, 404, ENV, { rapide: 2350000 }), null, "pas de repli si le pool rapide est plein");
  egal(choixRepli(choisirModele(valider("Bonjour"), ENV), 404, ENV), null, "pas de repli pour le modèle rapide");
}

// ---------------------------------------------------------------- worker.js : de bout en bout avec un faux amont
const fetchReel = globalThis.fetch;
let recu = null;
let appels = [];
function fauxAmont(usage, refus = {}) { // refus : { modèle: statut HTTP } renvoyé à la place d'une réponse normale
  appels = [];
  globalThis.fetch = async (url, init) => {
    recu = JSON.parse(init.body);
    appels.push(recu.model);
    if (refus[recu.model]) return new Response(JSON.stringify({ error: { message: "refus simulé", code: "model_not_found" } }), { status: refus[recu.model], headers: { "Content-Type": "application/json" } });
    const enc = new TextEncoder();
    const morceaux = [
      { choices: [{ delta: { content: "Voici " } }] },
      { choices: [{ delta: { content: "{M1} [[SUGGESTION:Et ensuite ?]]" } }] },
      { choices: [], usage },
    ];
    const corps = morceaux.map((m) => `data: ${JSON.stringify(m)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(corps)); c.close(); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}
async function appeler(charge) {
  const rep = await worker.fetch(new Request("https://exemple.test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(demande("Bonjour", charge)) }), ENV);
  const texte = await rep.text();
  return { rep, evenements: texte.split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5))) };
}
try {
  fauxAmont({ prompt_tokens: 1000, completion_tokens: 700, completion_tokens_details: { reasoning_tokens: 500 } });
  let { rep, evenements } = await appeler({ messages: [{ role: "user", content: "La succession" }] });
  egal(recu.model, "o3", "e2e : succession → o3");
  egal(recu.messages[0].role, "developer", "e2e : rôle developer");
  verifier(!("temperature" in recu), "e2e : pas de temperature");
  egal([recu.reasoning_effort, recu.max_completion_tokens], ["medium", 2500], "e2e : effort et plafond");
  egal(rep.headers.get("X-Model-Used"), "o3", "e2e : en-tête X-Model-Used");
  egal(evenements[0], { modele: "o3" }, "e2e : premier événement SSE");
  egal(evenements.filter((e) => e.delta).map((e) => e.delta).join(""), "Voici {M1} [[SUGGESTION:Et ensuite ?]]", "e2e : deltas intacts (jetons et balises)");
  egal(evenements.at(-1).fin, true, "e2e : événement fin");
  egal(evenements.at(-1).modele, "o3", "e2e : modèle dans fin");
  egal(tokensDuJour(), { rapide: 0, raisonnement: 1700 }, "e2e : prompt + completion crédités au pool raisonnement");

  ({ rep, evenements } = await appeler({ modeApprofondi: true }));
  egal(recu.model, "o3", "e2e : modeApprofondi → o3");
  ({ rep, evenements } = await appeler({}));
  egal([recu.model, rep.headers.get("X-Model-Used"), evenements[0]], ["gpt-5.4-mini", "gpt-5.4-mini", { modele: "gpt-5.4-mini" }], "e2e : question simple");
  egal(tokensDuJour(), { rapide: 1700, raisonnement: 3400 }, "e2e : pools comptés séparément");

  // o3 introuvable (404 déprécié) : une seule relance sur gpt-5.4-mini en effort « high », flux complet et pool rapide crédité.
  fauxAmont({ prompt_tokens: 1000, completion_tokens: 700 }, { o3: 404 });
  const avant = tokensDuJour();
  ({ rep, evenements } = await appeler({ modeApprofondi: true }));
  egal(appels, ["o3", "gpt-5.4-mini"], "e2e : o3 refusé puis une relance");
  egal([recu.reasoning_effort, recu.max_completion_tokens, recu.messages[0].role], ["high", 2500, "developer"], "e2e : payload du repli (404)");
  verifier(!("temperature" in recu), "e2e : repli sans temperature");
  egal([rep.headers.get("X-Model-Used"), evenements[0], evenements.at(-1).modele], ["gpt-5.4-mini", { modele: "gpt-5.4-mini (raisonnement élevé · o3 indisponible)" }, "gpt-5.4-mini (raisonnement élevé · o3 indisponible)"], "e2e : annonce du repli (404)");
  egal(evenements.filter((e) => e.delta).map((e) => e.delta).join(""), "Voici {M1} [[SUGGESTION:Et ensuite ?]]", "e2e : flux du repli intact");
  egal(tokensDuJour(), { rapide: avant.rapide + 1700, raisonnement: avant.raisonnement }, "e2e : le repli consomme le pool rapide");
  fauxAmont({ prompt_tokens: 1, completion_tokens: 1 }, { o3: 403 });
  ({ evenements } = await appeler({ messages: [{ role: "user", content: "Ma succession ?" }] }));
  egal([appels, evenements[0].modele], [["o3", "gpt-5.4-mini"], "gpt-5.4-mini (raisonnement élevé · o3 indisponible)"], "e2e : repli après un 403");
  for (const [refus, attendu, appelsAttendus, nom] of [
    [{ o3: 401, "gpt-5.4-mini": 401 }, "openai_401", ["o3"], "clé refusée : aucune relance"],
    [{ o3: 404, "gpt-5.4-mini": 404 }, "openai_404", ["o3", "gpt-5.4-mini"], "repli refusé aussi : une seule relance"],
    [{ "gpt-5.4-mini": 404 }, "openai_404", ["gpt-5.4-mini"], "modèle rapide refusé : aucune relance"],
  ]) {
    fauxAmont({ prompt_tokens: 1, completion_tokens: 1 }, refus);
    const r = await worker.fetch(new Request("https://exemple.test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(demande("Bonjour", appelsAttendus[0] === "o3" ? { modeApprofondi: true } : {})) }), ENV);
    egal([r.status, (await r.json()).erreur, appels], [502, attendu, appelsAttendus], `e2e : ${nom}`);
  }

  // Pool o3 (250 k gratuits) : une réponse de 230 000 tokens dépasse le plafond de 225 000 → repli gpt-5.4-mini en effort « high ».
  fauxAmont({ prompt_tokens: 200_000, completion_tokens: 30_000 });
  await appeler({ modeApprofondi: true });
  egal(tokensDuJour("raisonnement"), 233_400, "e2e : pool raisonnement au-delà du plafond");
  ({ rep, evenements } = await appeler({ modeApprofondi: true }));
  egal([recu.model, recu.reasoning_effort, recu.max_completion_tokens], ["gpt-5.4-mini", "high", 2500], "e2e : repli effort élevé");
  egal(rep.headers.get("X-Model-Used"), "gpt-5.4-mini", "e2e : en-tête du repli");
  egal(evenements[0], { modele: "gpt-5.4-mini (raisonnement élevé · quota o3 préservé)" }, "e2e : libellé du repli");

  // Pool rapide (2,5 M gratuits) : au-delà de 2 350 000, l'appel est refusé (429) et OpenAI n'est pas contacté.
  fauxAmont({ prompt_tokens: 2_000_000, completion_tokens: 400_000 });
  await appeler({});
  recu = null;
  const refus = await worker.fetch(new Request("https://exemple.test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(demande("Bonjour")) }), ENV);
  egal([refus.status, await refus.json(), recu], [429, { erreur: "quota_journalier" }, null], "e2e : plafond du pool rapide");
} finally {
  globalThis.fetch = fetchReel;
}

// ---------------------------------------------------------------- assistant.js : requête, libellé, balises
{
  const { requete, montants } = preparerRequeteCloud("Si j'épargne 500 € par mois ?", [], { plan: {} }, { approfondi: true });
  egal(requete.modeApprofondi, true, "requête : modeApprofondi true");
  verifier(!("raisonnement" in requete), "requête : ancien champ `raisonnement` supprimé");
  verifier(!requete.messages.at(-1).content.includes("500"), "requête : montant tokenisé");
  verifier(requete.messages.at(-1).content.includes("{M1}"), "requête : jeton {M1} présent");
  egal(montants.M1, 500, "requête : table des montants gardée en local");
  egal(preparerRequeteCloud("Bonjour", [], { plan: {} }).requete.modeApprofondi, false, "requête : modeApprofondi false par défaut");
}
egal(libelleModele("o3"), "o3 · raisonnement", "libellé o3");
egal(libelleModele("o4-mini"), "o4-mini · raisonnement", "libellé famille o");
egal(libelleModele("gpt-5.4-mini"), "gpt-5.4-mini", "libellé gpt-5.4-mini");
egal(libelleModele("gpt-5.4-mini (raisonnement élevé · quota o3 préservé)"), "gpt-5.4-mini (raisonnement élevé · quota o3 préservé)", "libellé du repli");
egal(libelleModele(undefined), "", "libellé absent");
{
  const brut = 'Épargner {M1} par mois aide.\n[[ACTION:{"label":"Épargner {M1}/mois","patch":{"epargneMensuelle":"{M1}"}}]]\n[[SUGGESTION:Et après ?]]\n[[SUGGESTION:Autre piste ?]]';
  const b = extraireBalises(brut, { M1: 500 });
  verifier(b.texte.includes("500") && !b.texte.includes("{M1}") && !b.texte.includes("[["), "balises : texte propre, jeton restauré");
  egal(b.actions[0]?.patch, { epargneMensuelle: 500 }, "balises : [[ACTION]] validée");
  egal(b.suggestions, ["Et après ?", "Autre piste ?"], "balises : [[SUGGESTION]]");
}

// ---------------------------------------------------------------- assistant.js : mode vocal
{
  const md = "## Titre\n- **PEA** : 17,2 % de prélèvements, voir [Le PEA](#fiche-pea).\n- Plafond de 150 000 €\n[[ACTION:{\"label\":\"x\",\"patch\":{}}]]\nTexte `code` et _italique_.";
  const t = texteParle(md);
  verifier(!/[#*_`\[\]|]/.test(t), `voix : aucun symbole Markdown restant — ${t}`);
  verifier(t.includes("Le PEA") && !t.includes("#fiche"), "voix : lien réduit à son titre");
  verifier(!t.includes("ACTION") && !t.includes("patch"), "voix : balise [[ACTION]] supprimée");
  verifier(t.includes("17,2 pour cent") && t.includes("150 000 euros"), "voix : % et € prononçables");
  verifier(!texteParle("Début [[ACTION:{\"label\":\"coupé").includes("ACTION"), "voix : balise ouverte (flux) supprimée");
  const phrases = decouperPhrases("Première phrase. Deuxième phrase ! " + "mot ".repeat(120));
  verifier(phrases.length >= 3 && phrases.every((p) => p.length <= 220), "voix : phrases découpées (≤ 220 caractères)");
  const voix = [
    { name: "Voix EN", lang: "en-US", localService: true },
    { name: "Voix FR basique", lang: "fr-FR", localService: false },
    { name: "Amélie (Premium)", lang: "fr-CA", localService: true },
    { name: "Thomas", lang: "fr-FR", localService: true },
  ];
  egal(choisirVoixFr(voix)?.name, "Thomas", "voix : fr-FR naturelle et locale choisie");
  egal(choisirVoixFr([{ name: "EN", lang: "en-GB" }]), null, "voix : aucune voix française");
  const normal = preparerRequeteCloud("Bonjour", [], { plan: {} }).requete;
  const vocal = preparerRequeteCloud("Bonjour", [], { plan: {} }, { estVocal: true }).requete;
  verifier(!normal.systeme.includes("MODE VOCAL"), "vocal : consigne absente à l'écrit");
  verifier(vocal.systeme.includes(CONSIGNE_VOCALE) && vocal.systeme.length < 24000, "vocal : consigne présente, sous la limite serveur");
  verifier(!vocal.systeme.includes("120 à 200 mots") && normal.systeme.includes("120 à 200 mots"), "vocal : règle 5 remplacée en vocal seulement");
  verifier(vocal.messages.at(-1).content.includes("voix haute") && !normal.messages.at(-1).content.includes("voix haute"), "vocal : rappel sur la dernière question seulement");
  verifier(!/pour cent|en toutes lettres/i.test(CONSIGNE_VOCALE + vocal.messages.at(-1).content), "vocal : le modèle n'écrit pas « pour cent » (conversion faite par texteParle)");
  verifier(CONSIGNE_VOCALE.includes("18,6 %") && CONSIGNE_VOCALE.includes("150 000 €"), "vocal : symboles % et € conservés à l'écran");
  verifier(CONSIGNE_VOCALE.includes("exactement 2 balises [[SUGGESTION:") && vocal.messages.at(-1).content.includes("exactement 2 balises [[SUGGESTION:"), "vocal : 2 balises [[SUGGESTION]] exigées (consigne et rappel)");
  egal(DELAI_SILENCE_MS, 2500, "vocal : délai de silence de 2,5 s");
  verifier(CONSIGNE_VOCALE.includes("[[ACTION") && CONSIGNE_VOCALE.includes("[Titre](#fiche-id)"), "vocal : balises et citation conservées");
}

// ---------------------------------------------------------------- projection.js : comparerFrais (simulateur « Impact des frais »)
{
  const arrondi = (x) => Math.round(x);
  // Cas de référence de la fiche « Les frais » : 100 € par mois pendant 30 ans, 6 % brut, sans capital de départ
  const ref = comparerFrais({ capital: 0, mensuel: 100, annees: 30, fraisCharge: 2, fraisOptimise: 0 });
  egal(arrondi(ref.capitalOptimise), 100452, "frais : 0 % de frais, 100 €/mois, 30 ans (fiche : 100 500 €)");
  egal(arrondi(ref.capitalCharge), 69405, "frais : 2 % de frais, 100 €/mois, 30 ans (fiche : 69 400 €)");
  egal(arrondi(ref.ecart), 31047, "frais : écart 0 % / 2 % (fiche : 31 100 €)");
  egal(ref.verse, 36000, "frais : total versé");
  // Valeurs par défaut du simulateur : 2,0 % contre 0,2 %
  egal([FRAIS_CHARGE, FRAIS_OPTIMISE, RENDEMENT_BRUT_FRAIS], [2, 0.2, 6], "frais : constantes du simulateur");
  const d = comparerFrais({ capital: 40000, mensuel: 700, annees: 30, depensesMensuelles: 2300 });
  verifier(d.capitalOptimise > d.capitalCharge && d.ecart > 0, "frais : l'enveloppe optimisée finit au-dessus du contrat chargé");
  verifier(Math.abs(d.ecart - (d.capitalOptimise - d.capitalCharge)) < 1e-6, "frais : écart = différence des capitaux finaux");
  egal(arrondi(d.capitalOptimise), 903794, "frais : capital optimisé (40 000 € + 700 €/mois, 30 ans)");
  egal(arrondi(d.capitalCharge), 618375, "frais : capital chargé (40 000 € + 700 €/mois, 30 ans)");
  egal(Math.round(d.anneesDepenses * 10) / 10, 10.3, "frais : années de dépenses équivalentes à l'écart");
  egal(arrondi(d.renteMensuelle4pct), 951, "frais : rente mensuelle perdue (règle des 4 %)");
  egal([d.charge.length, d.optimise.length, d.charge[0], d.optimise[0]], [31, 31, 40000, 40000], "frais : séries annuelles de 0 à N, départ = capital");
  // Cas limites
  egal(comparerFrais({ capital: 5000, mensuel: 100, annees: 10, fraisCharge: 1, fraisOptimise: 1 }).ecart, 0, "frais : mêmes frais, aucun écart");
  const zero = comparerFrais({ capital: 0, mensuel: 0, annees: 20 });
  egal([zero.ecart, zero.ecartPct, zero.capitalOptimise], [0, 0, 0], "frais : rien placé, rien perdu");
  egal(comparerFrais({ capital: 1000, mensuel: 0, annees: 5 }).anneesDepenses, null, "frais : sans dépenses connues, pas d'équivalent en années");
  const borne = comparerFrais({ capital: -500, mensuel: -10, annees: 999 });
  egal([borne.annees, borne.verse], [60, 0], "frais : entrées négatives ramenées à 0, horizon plafonné à 60 ans");
  egal(comparerFrais({ capital: 1000, mensuel: 0, annees: 0 }).annees, 1, "frais : horizon minimal d'un an");
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("test_js.mjs")) {
  console.log(`${resultats.ok} vérifications réussies, ${resultats.echecs.length} échec(s)`);
  for (const e of resultats.echecs) console.error(" ✗", e);
  if (resultats.echecs.length) process.exitCode = 1;
}
