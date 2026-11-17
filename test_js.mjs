// Tests du routage multi-modèles côté JavaScript : worker.js (miroir de serveur.py) et assistant.js.
// Sans dépendance : `node test_js.mjs` (Node ≥ 18), ou import dynamique depuis un navigateur (retourne `resultats`).
// Aucun appel réseau : le `fetch` vers OpenAI est remplacé par un faux amont.

import worker, { MODEL_FAST, MODEL_REASONING, choisirModele, choixRepli, corpsOpenAI, questionComplexe, tokensDuJour } from "./worker.js";
import { CONSIGNE_VOCALE, CONSIGNES_NIVEAU, DELAI_SILENCE_MS, choisirVoixFr, decouperPhrases, extraireBalises, libelleModele, preparerRequeteCloud, texteParle } from "./assistant.js";

import { PLAN } from "./plan.js";
import { planifierRetraits, impotsAuDeces, STRATEGIES_DECUMULATION } from "./pension.js";
import { impotBaremeIndexe, margeTranche } from "./fiscal.js";
import { FICHES, PARCOURS_DEBUTANT } from "./fiches.js";
import { FAMILLES_ALLOCATION, grouperAllocation, GROUPES_PLACEMENTS, totalGroupe, groupePersonnalise, repartirGroupe, contratsApresRepartition, repartirCapitalPrudent } from "./moteur.js";
import { comparerFrais, FRAIS_CHARGE, FRAIS_OPTIMISE, RENDEMENT_BRUT_FRAIS, projeter, projeterCentral, libertePatrimoine, moisPrecaution, capitalNecessaire } from "./projection.js";

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

// ---------------------------------------------------------------- assistant.js : consigne selon le niveau de lecture
{
  const longue = "Explique-moi le PEA, l'assurance-vie, le PER, les livrets, les frais, l'impôt sur les plus-values, la succession et la retraite publique";
  const prompt = (niveau, opts = {}, q = "Bonjour") => preparerRequeteCloud(q, [], { plan: {}, niveau }, opts).requete.systeme;
  const sans = prompt(undefined), deb = prompt("debutant"), inter = prompt("intermediaire"), av = prompt("avance");
  verifier(deb.includes(CONSIGNES_NIVEAU.debutant) && !sans.includes("NIVEAU DÉBUTANT") && !inter.includes("NIVEAU DÉBUTANT") && !av.includes("NIVEAU DÉBUTANT"), "niveau : consigne débutant présente uniquement en débutant");
  verifier(av.includes(CONSIGNES_NIVEAU.avance) && !deb.includes("NIVEAU AVANCÉ") && !inter.includes("NIVEAU AVANCÉ") && !sans.includes("NIVEAU AVANCÉ"), "niveau : consigne avancé présente uniquement en avancé");
  egal(inter, sans, "niveau : intermédiaire = comportement historique (prompt identique)");
  egal(prompt("n'importe quoi"), sans, "niveau : niveau inconnu = comportement historique");
  verifier(!deb.includes("120 à 200 mots") && sans.includes("120 à 200 mots"), "niveau : règle 5 remplacée (et non contredite) en débutant seulement");
  verifier(CONSIGNES_NIVEAU.debutant.includes("120 mots maximum") && CONSIGNES_NIVEAU.debutant.includes("[Titre](#fiche-id)") && /sigle/.test(CONSIGNES_NIVEAU.debutant) && /une seule action/i.test(CONSIGNES_NIVEAU.debutant), "niveau : consigne débutant complète (120 mots, une action, sigles, lien fiche)");
  verifier(/CGI/.test(CONSIGNES_NIVEAU.avance), "niveau : consigne avancé autorise les articles du CGI");
  verifier(Object.values(CONSIGNES_NIVEAU).every((c) => c.length < 700 && !/@|\d{5,}|€|IBAN/.test(c)), "niveau : consignes courtes, sans donnée personnelle ni montant");
  for (const niveau of [undefined, "debutant", "intermediaire", "avance"]) for (const estVocal of [false, true]) for (const q of ["Bonjour", longue]) {
    const r = preparerRequeteCloud(q, [], { plan: {}, niveau }, { estVocal }).requete;
    verifier(r.systeme.length < 24000, `niveau ${niveau} vocal=${estVocal} : systeme sous la limite serveur (${r.systeme.length})`);
    verifier(r.systeme.includes(CONSIGNE_VOCALE) === estVocal && r.messages.at(-1).content.includes("voix haute") === estVocal, `niveau ${niveau} vocal=${estVocal} : mode vocal inchangé`);
    if (estVocal) verifier(!r.systeme.includes("120 à 200 mots") && r.systeme.includes("MODE VOCAL"), `niveau ${niveau} : en vocal, la règle vocale remplace la règle 5`);
  }
}

// ---------------------------------------------------------------- fiches.js : parcours « Par où commencer » (débutant)
{
  egal(PARCOURS_DEBUTANT.map((e) => e.id), ["mode-emploi", "livrets", "frais", "pea", "assurance-vie", "retraite-publique"], "parcours débutant : 6 fiches dans l'ordre");
  verifier(PARCOURS_DEBUTANT.every((e) => FICHES.some((f) => f.id === e.id) && typeof e.phrase === "string" && e.phrase.length > 20), "parcours débutant : ids existants, une phrase par fiche");
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

// ---------------------------------------------------------------- projection.js : scénario central seul (niveau Débutant)
{
  const profils = [
    { age: 35, salaireNet: 3000, epargneMensuelle: 500, depensesMensuelles: 2000, placements: { livretA: 10000, pea: 20000 } },
    { age: 30, salaireNet: 2500, epargneMensuelle: 300, depensesMensuelles: 1800, placements: { livretA: 5000 }, projetRP: { actif: true, prix: 250000 } },
    { age: 55, salaireNet: 4000, epargneMensuelle: 800, depensesMensuelles: 2500, placements: { livretA: 20000, pea: 100000, assuranceVie: 80000 } },
  ];
  for (const p of profils) for (const inclureAchat of [true, false]) {
    const complet = projeter(PLAN, p, { inclureAchat }), central = projeterCentral(PLAN, p, { inclureAchat });
    const nom = `central ${p.age} ans, achat ${inclureAchat}`;
    egal(central.central, complet.central, `${nom} : même scénario central avec ou sans tirages`);
    egal(central.achat, complet.achat, `${nom} : même achat`);
    egal([central.retraite?.age, central.retraite?.revenu, central.retraite?.pension, central.retraite?.agePension], [complet.retraite?.age, complet.retraite?.revenu, complet.retraite?.pension, complet.retraite?.agePension], `${nom} : mêmes hypothèses de retraite`);
    verifier(central.eventail === null && central.simulations === 0 && central.retraite?.probaDure === null, `${nom} : aucun tirage au hasard`);
    const L1 = libertePatrimoine(complet, PLAN.hypotheses), L2 = libertePatrimoine(central, PLAN.hypotheses);
    egal(L2, L1, `${nom} : liberté financière identique`);
  }
  // Verdict Débutant : projection allégée, mêmes tirages donc même probabilité que la projection complète
  for (const p of profils) {
    const complet = projeter(PLAN, p, {}), legere = projeter(PLAN, p, { legere: true });
    const nom = `légère ${p.age} ans`;
    egal(legere.retraite?.probaDure, complet.retraite?.probaDure, `${nom} : même probabilité que la projection complète`);
    egal(legere.central, complet.central, `${nom} : même scénario central`);
    verifier(legere.eventail === null && legere.retraite?.revenuPreserve === null, `${nom} : ni éventail ni recherche de revenus`);
    // Capital nécessaire : celui qu'il faut au départ pour que le scénario central dure ; plus le revenu est élevé, plus il monte
    const cap = capitalNecessaire(PLAN, p), plus = capitalNecessaire(PLAN, { ...p, retraite: { revenu: 6000 } });
    verifier(cap === null || (cap.capital > 0 && plus && plus.capital >= cap.capital), `${nom} : capital nécessaire croissant avec le revenu`);
  }
  // Liberté financière : capital de 25 fois les besoins annuels
  const r = projeterCentral(PLAN, profils[0]), L = libertePatrimoine(r, PLAN.hypotheses);
  egal(L.objectif, Math.max(0, r.retraite.revenu - Math.max(0, r.retraite.pension)) * 12 * 25, "liberté : objectif = 25 × besoins annuels");
  verifier(L.fire === null || L.fire.v >= L.objectif - 1e-6, "liberté : le capital trouvé atteint l'objectif");
  egal(libertePatrimoine({ central: [], retraite: null }, PLAN.hypotheses), null, "liberté : sans retraite, pas de calcul");
  egal([moisPrecaution({ livretA: 6000, ldds: 3000, pea: 50000 }, 1500), moisPrecaution({ livretA: 6000 }, 0), moisPrecaution({}, 2000)], [6, null, 0], "précaution : livrets ÷ dépenses (PEA exclu)");
}

// ---------------------------------------------------------------- moteur.js : groupes de placements (niveau Débutant)
{
  // Toutes les clés des groupes existent dans le plan, sans doublon entre groupes
  const toutes = Object.values(GROUPES_PLACEMENTS).flat();
  verifier(toutes.every((id) => PLAN.enveloppes[id]), "groupes : toutes les clés existent dans PLAN.enveloppes");
  egal(new Set(toutes).size, toutes.length, "groupes : aucun compte dans deux groupes");
  const plafA = PLAN.enveloppes.livretA.plafond, plafL = PLAN.enveloppes.ldds.plafond;
  egal([plafA, plafL, PLAN.enveloppes.pea.plafond], [22950, 12000, 150000], "groupes : plafonds Livret A, LDDS, PEA");

  // Livrets : Livret A, puis LDDS, puis livret bancaire ; LEP et Livret Jeune remis à 0
  const base = { livretA: 1, ldds: 2, lep: 300, livretJeune: 400, livretBancaire: 5, pea: 7000, per: 900 };
  const copieBase = JSON.stringify(base);
  const l = repartirGroupe(PLAN, "livrets", 30000, base);
  egal([l.livretA, l.ldds, l.livretBancaire, l.lep, l.livretJeune], [22950, 7050, 0, 0, 0], "livrets : 30 000 € = Livret A plein + 7 050 € de LDDS");
  egal([l.pea, l.per], [7000, 900], "livrets : les autres groupes sont intacts");
  egal(JSON.stringify(base), copieBase, "repartirGroupe ne mute pas l'entrée");
  const l2 = repartirGroupe(PLAN, "livrets", 50000, base);
  egal([l2.livretA, l2.ldds, l2.livretBancaire], [22950, 12000, 15050], "livrets : au-delà des plafonds, livret bancaire");
  egal(repartirGroupe(PLAN, "livrets", 10000, {}).livretA, 10000, "livrets : sous le plafond, tout sur le Livret A");
  // Couple : plafonds par personne doublés
  const lc = repartirGroupe(PLAN, "livrets", 50000, {}, { foyer: { actif: true, statut: "marie" } });
  egal([lc.livretA, lc.ldds, lc.livretBancaire], [45900, 4100, 0], "livrets : couple, plafonds doublés");
  const conc = repartirGroupe(PLAN, "livrets", 30000, {}, { foyer: { actif: true, statut: "concubin", vue: "moi" } });
  egal(conc.livretA, 22950, "livrets : concubin « pour toi seul » = un plafond");

  // Assurance-vie : tout en fonds euros
  const av = repartirGroupe(PLAN, "assuranceVie", 40000, { assuranceVie: 5000, assuranceVieUC: 9000 });
  egal([av.assuranceVie, av.assuranceVieUC], [40000, 0], "assurance-vie : tout en fonds euros, UC remis à 0");

  // Bourse : PEA jusqu'à 150 000 €, puis CTO
  const b1 = repartirGroupe(PLAN, "bourse", 100000, { pea: 5, cto: 6 });
  egal([b1.pea, b1.cto], [100000, 0], "bourse : sous 150 000 €, tout en PEA");
  const b2 = repartirGroupe(PLAN, "bourse", 180000, {});
  egal([b2.pea, b2.cto], [150000, 30000], "bourse : surplus en CTO");

  // Montants invalides, arrondis, groupe « autres »
  for (const m of [-500, NaN, "abc", undefined, null]) egal(totalGroupe(repartirGroupe(PLAN, "livrets", m, { livretA: 100 }), "livrets"), 0, `montant invalide (${m}) : 0`);
  egal(repartirGroupe(PLAN, "bourse", 1234.6, {}).pea, 1235, "montant arrondi à l'euro");
  egal(repartirGroupe(PLAN, "autres", 5000, { per: 10 }), { per: 10 }, "« autres » : jamais modifié");
  egal(repartirGroupe(PLAN, "inconnu", 5000, { per: 10 }), { per: 10 }, "groupe inconnu : copie inchangée");

  // totalGroupe
  egal(totalGroupe({ livretA: 100, ldds: 50, pea: 999 }, "livrets"), 150, "totalGroupe : somme du groupe");
  egal(totalGroupe({}, "bourse"), 0, "totalGroupe : groupe vide");
  egal(totalGroupe(undefined, "bourse"), 0, "totalGroupe : placements absents");
  egal(totalGroupe({ per: 1, scpi: 2, pel: 3, orPhysique: 4 }, "autres"), 10, "totalGroupe : autres");

  // groupePersonnalise : écart avec la répartition automatique du total
  egal(groupePersonnalise(PLAN, { livretA: 22950, ldds: 7050 }, "livrets"), false, "personnalisé : le résultat du débutant reste modifiable");
  egal(groupePersonnalise(PLAN, { livretA: 22950, ldds: 12000, livretBancaire: 5050 }, "livrets"), false, "personnalisé : profil Exemple (livrets) = répartition automatique");
  egal(groupePersonnalise(PLAN, { livretA: 5000, ldds: 5000 }, "livrets"), true, "personnalisé : Livret A et LDDS à parts égales");
  egal(groupePersonnalise(PLAN, { lep: 4000 }, "livrets"), true, "personnalisé : un LEP seul (pas un Livret A)");
  egal(groupePersonnalise(PLAN, { livretA: 8000 }, "livrets"), false, "personnalisé : un seul Livret A");
  egal(groupePersonnalise(PLAN, { assuranceVie: 20000, assuranceVieUC: 10000 }, "assuranceVie"), true, "personnalisé : assurance-vie avec unités de compte");
  egal(groupePersonnalise(PLAN, { pea: 150000, cto: 20000 }, "bourse"), false, "personnalisé : PEA plein + CTO = automatique");
  egal(groupePersonnalise(PLAN, { pea: 20000, cto: 20000 }, "bourse"), true, "personnalisé : PEA et CTO à parts égales");
  egal(groupePersonnalise(PLAN, {}, "livrets"), false, "personnalisé : groupe vide");
  egal(groupePersonnalise(PLAN, { per: 10 }, "autres"), false, "personnalisé : « autres » n'est jamais réparti");

  // repartirCapitalPrudent : non-régression de la Découverte (34 ans, 3 000 € de salaire, 700 € d'épargne, 40 000 €)
  egal(repartirCapitalPrudent(PLAN, 40000, 2300), { livretA: 13800, ldds: 0, livretBancaire: 0, pea: 26200, cto: 0 }, "Découverte : 6 mois de dépenses en Livret A, le reste en PEA");
  egal(repartirCapitalPrudent(PLAN, 100000, 5000), { livretA: 22950, ldds: 7050, livretBancaire: 0, pea: 70000, cto: 0 }, "Découverte : précaution au-delà du Livret A, LDDS");
  egal(repartirCapitalPrudent(PLAN, 100000, 8000), { livretA: 22950, ldds: 12000, livretBancaire: 13050, pea: 52000, cto: 0 }, "Découverte : précaution au-delà du LDDS, livret bancaire");
  egal(repartirCapitalPrudent(PLAN, 300000, 1000), { livretA: 6000, ldds: 0, livretBancaire: 0, pea: 150000, cto: 144000 }, "Découverte : PEA plein, surplus en CTO");
  egal(repartirCapitalPrudent(PLAN, 3000, 0), { livretA: 3000, ldds: 0, livretBancaire: 0, pea: 0, cto: 0 }, "Découverte : sans dépenses, 6 000 € de précaution par défaut");
  egal(repartirCapitalPrudent(PLAN, 0, 2000), { livretA: 0, ldds: 0, livretBancaire: 0, pea: 0, cto: 0 }, "Découverte : capital nul");

  // contratsApresRepartition : un PEA ou une assurance-vie apparaît ; un contrat déjà ouvert n'est pas touché
  const aujourdhui = new Date(2026, 10, 16);
  const neuf = contratsApresRepartition({ pea: { ouvert: false, versements: 0, etablissement: "" }, assuranceVie: { ouverte: false, type: "" } }, { pea: 26200, assuranceVie: 5000 }, aujourdhui);
  egal(neuf.pea, { ouvert: true, versements: 26200, etablissement: "", dateOuverture: "2026-11" }, "PEA créé : ouvert, versements = montant, mois courant");
  egal(neuf.assuranceVie, { ouverte: true, type: "" }, "assurance-vie créée : ouverte");
  const exist = contratsApresRepartition({ pea: { ouvert: true, versements: 10000, dateOuverture: "2015-03" }, assuranceVie: { ouverte: true } }, { pea: 40000, assuranceVie: 5000 }, aujourdhui);
  egal([exist.pea, exist.assuranceVie], [null, null], "contrats déjà ouverts : versements et dates conservés");
  egal(contratsApresRepartition({}, { pea: 0, assuranceVie: 0 }, aujourdhui), { pea: null, assuranceVie: null }, "aucun montant : aucun contrat créé");
  // Saisie chiffre par chiffre : les versements suivent le solde tant qu'ils lui étaient égaux
  let prof = { pea: { ouvert: false, versements: 0, etablissement: "" } }, pl = {};
  for (const v of [1, 18, 180, 1800, 18000, 180000]) {
    const apres = repartirGroupe(PLAN, "bourse", v, pl, prof), c = contratsApresRepartition(prof, apres, aujourdhui, pl);
    if (c.pea) prof = { ...prof, pea: c.pea }; pl = apres;
  }
  egal([prof.pea.ouvert, prof.pea.versements, pl.pea, pl.cto], [true, 150000, 150000, 30000], "PEA : saisie progressive de 180 000 € = versements 150 000 €");
  const gains = contratsApresRepartition({ pea: { ouvert: true, versements: 10000 } }, { pea: 40000 }, aujourdhui, { pea: 30000 });
  egal(gains.pea, null, "PEA : versements différents du solde (gains réels), conservés");
  egal(contratsApresRepartition({ pea: { ouvert: true, versements: 30000, dateOuverture: "2015-03" } }, { pea: 35000 }, aujourdhui, { pea: 30000 }).pea, { ouvert: true, versements: 35000, dateOuverture: "2015-03" }, "PEA : versements = solde, ils suivent la saisie");
  egal(contratsApresRepartition({ pea: { ouvert: false, dateOuverture: "2020-01" } }, { pea: 100 }, aujourdhui).pea.dateOuverture, "2020-01", "PEA créé : date déjà saisie conservée");
}

// ---------------------------------------------------------------- moteur.js : allocation en 3 familles (niveau Débutant)
{
  const alloc = { securite: 10000, projet: 5000, prudent: 8000, or: 2000, bourse: 30000, bitcoin: 3000, scpi: 2000 };
  const f = grouperAllocation(alloc);
  egal(f.map((x) => [x.id, x.montant]), [["abri", 15000], ["prudent", 10000], ["dynamique", 35000]], "familles : À l'abri / Prudent / Dynamique");
  egal(f.reduce((t, x) => t + x.montant, 0), Object.values(alloc).reduce((t, x) => t + x, 0), "familles : somme conservée");
  egal(f.map((x) => Math.round(x.part)), [25, 17, 58], "familles : parts en %");
  verifier(Math.abs(f.reduce((t, x) => t + x.part, 0) - 100) < 1e-9, "familles : parts = 100 %");
  egal(FAMILLES_ALLOCATION.flatMap((x) => x.classes).sort(), Object.keys(PLAN.classes).sort(), "familles : toutes les classes du plan, une seule fois");
  const vide = grouperAllocation({});
  egal(vide.map((x) => [x.montant, x.part]), [[0, 0], [0, 0], [0, 0]], "familles : allocation vide");
  egal(grouperAllocation(undefined).length, 3, "familles : allocation absente tolérée");
  egal(grouperAllocation({ securite: "1000", bourse: null, inconnu: 99 })[0].montant, 1000, "familles : valeurs textuelles, classes inconnues ignorées");
}

// ---------------------------------------------------------------- décumulation : ordre de retrait optimal
{
  const REG = () => ({ livrets: { valeur: 50000 }, av: { apres70: { valeur: 0, primes: 0 }, avant70: { valeur: 100000, primes: 60000 }, ancien8: true }, pea: { valeur: 80000, versements: 50000, ancien5: true }, cto: { valeur: 40000, base: 30000 }, per: { valeur: 60000, versementsDeduits: 50000 }, autres: [] });
  const CTX = { parts: 1, partsBase: 1, indexation: 1, couple: false, revenuImposableAutre: 18000, anneesRestantesPER: 20, reserveLivrets: 10000, garderOr: false };
  egal(STRATEGIES_DECUMULATION, ["transmettre", "consommer", "prorata"], "décumulation : stratégies");
  for (const strat of STRATEGIES_DECUMULATION) {
    const reg = REG(), avant = JSON.stringify(reg);
    const p = planifierRetraits(reg, 30000, CTX, strat);
    verifier(Math.abs(p.brut - p.impots - (p.net + p.surplus)) < 1e-6, `décumulation ${strat} : brut − impôts = net + surplus`);
    verifier(!p.insuffisant && Math.abs(p.net - 30000) < 1e-6, `décumulation ${strat} : net = besoin (${p.net})`);
    verifier(JSON.stringify(reg) === avant, `décumulation ${strat} : entrée non mutée`);
  }
  // Petit besoin, PER vide : seule l'AV sous abattement, impôt = prélèvements sociaux
  const sansPER = { ...REG(), per: { valeur: 0, versementsDeduits: 0 } };
  const petit = planifierRetraits(sansPER, 2000, CTX, "transmettre");
  verifier(petit.retraits.length === 1 && petit.retraits[0].id === "av_avant70" && petit.retraits[0].etape === 1, "décumulation : petit besoin = AV (étape 1) seule");
  const gPetit = petit.retraits[0].montant * 0.4;
  verifier(Math.abs(petit.impots - gPetit * 0.172) < 1e-6 && petit.abattementUtilise > 0, "décumulation : impôt = PS seuls sous abattement");
  // PER lissé : la TMI reste dans la cible
  const lisse = planifierRetraits({ ...REG(), per: { valeur: 20000, versementsDeduits: 20000 } }, 30000, CTX, "transmettre");
  const e0 = lisse.retraits.find((r) => r.etape === 0);
  const tmi0 = impotBaremeIndexe(18000, 1, 1, 1).tmi;
  verifier(e0 && impotBaremeIndexe(18000 + e0.montant, 1, 1, 1).tmi <= Math.max(tmi0, 11), "décumulation : PER lissé dans la tranche");
  // 'transmettre' : AV avant 70 ans non touchée au-delà de la purge
  // Réserve de transmission : avant70 protégée en 'transmettre' (croissance nulle, 10 ans couverts par les autres poches)
  {
    const reg0 = () => ({ ...REG(), av: { apres70: { valeur: 0, primes: 0 }, avant70: { valeur: 150000, primes: 90000 }, ancien8: true } });
    const fin = (strat) => {
      let reg = reg0();
      for (let a = 0; a < 10; a++) reg = planifierRetraits(reg, 15000, { ...CTX, reserveTransmissionAV: 100000, anneesRestantesPER: Math.max(1, 20 - a) }, strat).registre;
      return reg.av.avant70.valeur;
    };
    const fT = fin("transmettre"), fC = fin("consommer");
    verifier(fT >= 100000 - 1e-6, `décumulation : réserve de transmission respectée en 'transmettre' (${Math.round(fT)})`);
    verifier(fC < fT, `décumulation : 'consommer' ignore la réserve (${Math.round(fC)} < ${Math.round(fT)})`);
  }
  const tr = planifierRetraits(REG(), 30000, CTX, "transmettre");
  verifier(tr.retraits.every((r) => r.id !== "av_avant70" || r.etape === 1), "décumulation : avant70 seulement purgée");
  // 20 années, croissance nulle : 'transmettre' ≤ 'prorata' (besoins de 15 000 € et 30 000 € par an)
  const cumul = (strat, besoin) => {
    let reg = REG(), total = 0;
    for (let a = 0; a < 20; a++) {
      const p = planifierRetraits(reg, besoin, { ...CTX, anneesRestantesPER: Math.max(1, 20 - a) }, strat);
      total += p.impots; reg = p.registre;
    }
    const r = reg;
    return { impots: total, reste: r.livrets.valeur + r.av.apres70.valeur + r.av.avant70.valeur + r.pea.valeur + r.cto.valeur + r.per.valeur };
  };
  for (const besoin of [15000, 30000]) {
    const cT = cumul("transmettre", besoin), cP = cumul("prorata", besoin);
    resultats.decumulation ??= [];
    resultats.decumulation.push({ besoin, transmettre: cT, prorata: cP });
    // Tolérance de 2 % : l'ordre « transmettre » garde l'assurance-vie et lisse le PER, il ne minimise pas à lui seul l'impôt cumulé
    verifier(cT.impots <= cP.impots * 1.02 + 1e-6, `décumulation ${besoin} €/an : impôts transmettre ${Math.round(cT.impots)} ≤ prorata ${Math.round(cP.impots)} + 2 % (reste ${Math.round(cT.reste)} / ${Math.round(cP.reste)})`);
  }
  const vide = planifierRetraits({ livrets: { valeur: 0 }, av: { apres70: { valeur: 0, primes: 0 }, avant70: { valeur: 0, primes: 0 }, ancien8: false }, pea: { valeur: 0, versements: 0, ancien5: false }, cto: { valeur: 0, base: 0 }, per: { valeur: 0, versementsDeduits: 0 }, autres: [] }, 5000, CTX);
  verifier(vide.insuffisant === true && vide.net === 0, "décumulation : registre vide = insuffisant");
  // Ordre de l'étape 3 : PEA d'abord (défaut) ou compte-titres d'abord
  const REG3 = () => ({ livrets: { valeur: 0 }, av: { apres70: { valeur: 0, primes: 0 }, avant70: { valeur: 0, primes: 0 }, ancien8: false }, pea: { valeur: 80000, versements: 50000, ancien5: true }, cto: { valeur: 40000, base: 30000 }, per: { valeur: 0, versementsDeduits: 0 }, autres: [] });
  const CTX3 = { parts: 1, partsBase: 1, indexation: 1, couple: false, revenuImposableAutre: 0, garderOr: false };
  for (const strat of ["transmettre", "consommer"]) {
    const cto = planifierRetraits(REG3(), 10000, { ...CTX3, ordreEtape3: "ctoDabord" }, strat);
    const pea = planifierRetraits(REG3(), 10000, { ...CTX3, ordreEtape3: "peaDabord" }, strat);
    const defaut = planifierRetraits(REG3(), 10000, CTX3, strat);
    verifier(cto.retraits.length === 1 && cto.retraits[0].id === "cto" && cto.registre.pea.valeur === 80000, `décumulation ${strat} : 'ctoDabord' vide le CTO avant le PEA`);
    verifier(pea.retraits.length === 1 && pea.retraits[0].id === "pea" && pea.registre.cto.valeur === 40000, `décumulation ${strat} : 'peaDabord' vide le PEA avant le CTO`);
    egal(JSON.stringify(defaut), JSON.stringify(pea), `décumulation ${strat} : 'peaDabord' est le défaut`);
    const grand = planifierRetraits(REG3(), 60000, { ...CTX3, ordreEtape3: "ctoDabord" }, strat);
    verifier(grand.registre.cto.valeur === 0 && grand.registre.pea.valeur < 80000, `décumulation ${strat} : 'ctoDabord' prend le PEA après le CTO`);
  }
  const prCto = planifierRetraits(REG3(), 10000, { ...CTX3, ordreEtape3: "ctoDabord" }, "prorata");
  egal(JSON.stringify(prCto), JSON.stringify(planifierRetraits(REG3(), 10000, CTX3, "prorata")), "décumulation : 'prorata' ignore l'ordre de l'étape 3");
  // Impôts dus au décès sur les gains latents (hors droits de succession)
  const regD = { livrets: { valeur: 5000 }, av: { apres70: { valeur: 100000, primes: 60000 }, avant70: { valeur: 0, primes: 0 }, ancien8: true }, pea: { valeur: 100000, versements: 60000, ancien5: true }, cto: { valeur: 50000, base: 10000 }, per: { valeur: 30000, versementsDeduits: 30000 }, autres: [{ id: "scpi", valeur: 20000, base: 5000, taux: 30 }] };
  const attendu = (40000 * 18.6) / 100 + (40000 * 17.2) / 100;
  verifier(Math.abs(impotsAuDeces(regD) - attendu) < 1e-6, `impotsAuDeces : PEA 40 000 × 18,6 % + AV 40 000 × 17,2 % (${impotsAuDeces(regD)})`);
  verifier(impotsAuDeces({ ...regD, pea: { valeur: 0, versements: 0 }, av: { apres70: { valeur: 0, primes: 0 }, avant70: { valeur: 0, primes: 0 } } }) === 0, "impotsAuDeces : CTO, autres, PER et livrets = 0");
  verifier(impotsAuDeces({ pea: { valeur: 50000, versements: 80000 } }) === 0, "impotsAuDeces : pas de gain (moins-value) = 0");
}

// ---------------------------------------------------------------- projection.js : décumulation intégrée à la projection
{
  const profils = [
    { age: 35, salaireNet: 3000, epargneMensuelle: 500, depensesMensuelles: 2000, placements: { livretA: 10000, pea: 20000 } },
    { age: 55, salaireNet: 4000, epargneMensuelle: 800, depensesMensuelles: 2500, placements: { livretA: 20000, pea: 100000, assuranceVie: 80000 } },
    { age: 45, salaireNet: 5000, epargneMensuelle: 1500, depensesMensuelles: 3000, placements: { livretA: 20000, pea: 60000, assuranceVie: 90000, cto: 40000, per: 30000 }, verses: { cto: 25000, assuranceVie: 60000 }, assuranceVie: { dateOuverture: "2012-01" }, pea: { versements: 40000, dateOuverture: "2015-01" } },
  ];
  // Plan sans rendement ni inflation : pas d'effet de report d'impôt, la comparaison des impôts est directe
  const PLAN0 = structuredClone(PLAN);
  for (const k of Object.keys(PLAN0.hypotheses.rendements)) PLAN0.hypotheses.rendements[k] = 0;
  PLAN0.hypotheses.inflation = 0;
  for (const p of profils) {
    const nom = `décumulation ${p.age} ans`;
    const c = projeterCentral(PLAN, p), complet = projeter(PLAN, p, { legere: true });
    const D = c.decumulation;
    verifier(!!D && !!complet.decumulation, `${nom} : présente dans projeterCentral et projeter`);
    if (!D) continue;
    egal(complet.decumulation, D, `${nom} : identique avec ou sans tirages`);
    verifier(Number.isFinite(D.economie) && D.anneesComparees >= 0 && D.exemples.length >= 1, `${nom} : forme de la décumulation`);
    verifier(D.patrimoineFinalOptimise >= D.patrimoineFinalProrata - 1 || D.patrimoineFinalProrata <= 1, `${nom} : patrimoine final optimisé ≥ prorata (${Math.round(D.patrimoineFinalOptimise)} / ${Math.round(D.patrimoineFinalProrata)})`);
    const pts = c.central.filter((x, i) => i >= c.iR && x.retraits);
    verifier(pts.length > 0 && pts.every((x) => x.impotRetraits >= 0 && Array.isArray(x.retraits)), `${nom} : retraits et impôts sur les points de retraite`);
    verifier(pts.every((x) => x.ecartRegistre == null || x.ecartRegistre < 1), `${nom} : registre cohérent avec les classes (< 1 €)`);
    egal(JSON.stringify(projeterCentral(PLAN, p)), JSON.stringify(c), `${nom} : déterminisme`);
    const cons = projeterCentral(PLAN, { ...p, retraite: { priorite: "consommer" } });
    verifier(cons.decumulation?.strategie === "consommer" && Number.isFinite(cons.decumulation.patrimoineFinalOptimise), `${nom} : stratégie « consommer »`);
    const plus = projeterCentral(PLAN, { ...p, retraite: { revenu: (c.retraite?.revenu ?? 2000) + 500 } });
    verifier(plus.central[plus.dernier].financier <= c.central[c.dernier].financier + 1, `${nom} : +500 €/mois de revenu, patrimoine final plus bas ou égal`);
    verifier(["impotsOptimiseReel", "impotsProrataReel", "economieReel", "patrimoineFinalOptimiseReel", "patrimoineFinalProrataReel", "gainPatrimoineReel", "ageFinal"].every((k) => Number.isFinite(D[k])), `${nom} : champs en euros réels présents`);
    verifier(D.gainPatrimoineReel >= -1, `${nom} : gain de patrimoine réel ≥ 0 (${Math.round(D.gainPatrimoineReel)})`);
    verifier(["peaDabord", "ctoDabord"].includes(D.ordreEtape3) && Number.isFinite(D.gainOrdreReel) && Number.isFinite(D.patrimoineFinalNetReel) && Number.isFinite(D.gainPatrimoineNetReel), `${nom} : ordre de l'étape 3 et patrimoine net des impôts au décès présents`);
    verifier(D.gainOrdreReel >= -1, `${nom} : l'ordre retenu n'est pas moins bon que l'autre (${Math.round(D.gainOrdreReel)})`);
    if (p.age === 45 || p.age === 55) for (const strat of ["transmettre", "consommer"]) {
      const Ds = projeterCentral(PLAN, { ...p, retraite: { priorite: strat } }).decumulation;
      verifier(["peaDabord", "ctoDabord"].includes(Ds?.ordreEtape3) && Ds.gainOrdreReel >= -1, `${nom} « ${strat} » : ordre ${Ds?.ordreEtape3}, gain ${Math.round(Ds?.gainOrdreReel)} ≥ −1`);
      if (p.age === 45) egal(Ds.ordreEtape3, "peaDabord", `${nom} « ${strat} » : PEA d'abord (épargne jamais épuisée)`);
      if (p.age === 55 && strat === "consommer") egal(Ds.ordreEtape3, "ctoDabord", `${nom} « consommer » : compte-titres d'abord (épargne épuisée)`);
    }
    if (p.placements.assuranceVie && D.ageEpuisementOptimise == null) verifier(D.avAvant70Final > 0, `${nom} : AV avant 70 ans transmissible conservée (${Math.round(D.avAvant70Final)})`);
  }
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("test_js.mjs")) {
  console.log(`${resultats.ok} vérifications réussies, ${resultats.echecs.length} échec(s)`);
  for (const e of resultats.echecs) console.error(" ✗", e);
  if (resultats.echecs.length) process.exitCode = 1;
}
