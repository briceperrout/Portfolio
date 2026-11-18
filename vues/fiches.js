// Règle d'architecture : une vue exporte rendre<Nom>() et monter<Nom>() (écouteurs, appelée une seule fois par app.js
// au démarrage) et n'a aucun effet de bord au niveau module. Elle importe ui/commun.js et les modules métier, et des
// fonctions (jamais de const/let) d'app.js : import circulaire sûr car ces fonctions sont hissées.
import { $, etat, echapper, keur } from "../ui/commun.js";
import { eur, pct, economieInteressement, capitalDe } from "../moteur.js";
import { PFU, PRELEVEMENTS, foyerFiscal, decomposerSalaire, PLAFONDS } from "../fiscal.js";
import { OFFRES_ACTIONS, PRIMES, ENTREPRISES } from "../entreprises.js";
import { FRAIS_CHARGE, FRAIS_OPTIMISE, comparerFrais } from "../projection.js";
import { FICHES as CONTENU_FICHES, VERIFIE_LE, PARCOURS_DEBUTANT } from "../fiches.js";
import { texteLie, normaliserProfil, lienFiche, comparerPERPEA, remplirProfil, apresSaisieProfil, profilDeCalcul, niveauCourant } from "../app.js";

// ---------------------------------------------------------------- fiches mémo
// Fiche risques : chaque famille de comptes du profil face à sa garantie
function blocRisques(res) {
  const plan = etat.brouillon, pl = res.profil.placements ?? {}, n = res.profil.personnes ?? 1;
  const G = plan.garanties ?? {};
  const somme = (ids) => ids.reduce((t, id) => t + (Number(pl[id]) || 0), 0);
  const ok = '<span class="ecart-plus">✓ Couvert</span>', ko = (t) => `<span class="ecart-moins">⚠ ${t}</span>`, neutre = (t) => `<span class="muted">${t}</span>`;
  const lignes = [
    ["Livret A, LDDS, LEP, Livret Jeune", somme(["livretA", "ldds", "lep", "livretJeune"]), "Garantie à part (en plus des 100 000 €)", ok],
    ["Livret bancaire et PEL", somme(["livretBancaire", "pel"]), `${eur((G.depotsParBanque ?? 100000) * n)} par banque${n > 1 ? " (couple)" : ""}, compte courant compris`, (v) => (v > (G.depotsParBanque ?? 100000) * n ? ko("Au-dessus : répartir entre banques") : ok)],
    ["Assurance-vie", somme(["assuranceVie", "assuranceVieUC"]), `${eur((G.assuranceParAssureur ?? 70000) * n)} par assureur${n > 1 ? " (couple)" : ""}`, (v) => (v > (G.assuranceParAssureur ?? 70000) * n ? ko("Au-dessus : 2e assureur") : ok)],
    ["PEA et compte-titres", somme(["pea", "cto"]), "Titres à ton nom, rendus en cas de faillite (70 000 € s'ils sont introuvables)", neutre("Pas de garantie contre la baisse")],
    ["PER", somme(["per"]), "Selon le contrat : comme un compte-titres, ou avec tes assurances-vie s'il est assuré", neutre("À vérifier")],
    ["Or physique", somme(["orPhysique"]), "Aucune : ne dépend d'aucun établissement", neutre("Le ranger en lieu sûr")],
    ["Bitcoin sur la plateforme", somme(["plateformeCrypto"]), "Aucune", (v) => (v > 5000 ? ko("Au-dessus de 5 000 € : cold wallet") : neutre("Garder peu"))],
    ["Bitcoin sur cold wallet", somme(["coldWallet"]), "Aucune : dépend de tes mots de récupération", neutre("Les garder en lieu sûr")],
    ["SCPI", somme(["scpi"]), "Aucune : capital non garanti, revente parfois lente", neutre("Diversifier")],
  ].filter(([, v]) => v > 0.5).map(([nom, v, g, st]) => `<tr><td>${texteLie(nom)}</td><td class="m">${eur(v)}</td><td>${echapper(g)}</td><td class="m">${typeof st === "function" ? st(v) : st}</td></tr>`).join("");
  return lignes ? `<div class="table-wrap"><table><thead><tr><th>Comptes</th><th class="m">Montant</th><th>Garantie en cas de faillite</th><th class="m">Statut</th></tr></thead><tbody>${lignes}</tbody></table></div>
    <p class="note" style="margin:8px 0 0">Le site ne sait pas dans quelle banque ou chez quel assureur est chaque compte : il suppose le pire (tout au même endroit). Fais le calcul par établissement avec les étapes ci-dessous.</p>` : '<p class="small muted" style="margin:0">Aucun placement saisi pour ce profil.</p>';
}

// Fiche PER : ce que le PER rapporterait au proche, pour un même effort
function blocCalculPER(res) {
  const plan = etat.brouillon, p = res.profil, per = res.per ?? {};
  const tmi = per.tmi ?? (p.tmi !== "" && p.tmi != null ? Number(p.tmi) : null);
  if (tmi == null) return '<p class="small" style="margin:0">Indique ta tranche d\'imposition (TMI) dans « Mon profil » pour voir ce qu\'un PER te rapporterait.</p>';
  const n = Math.max(1, (plan.hypotheses.ageRetraite ?? 64) - (p.agePrincipal ?? p.age ?? 30));
  const tret = plan.per?.tmiRetraite ?? 11, r = 0.06 / 12, F = (Math.pow(1 + r, 12 * n) - 1) / r;
  const effort = 100, tauxPER = per.exact ? per.tauxEffectif : tmi, mPER = effort / (1 - tauxPER / 100);
  const capPER = mPER * F, versePER = mPER * 12 * n, netPER = capPER - (versePER * tret) / 100 - (capPER - versePER) * (PFU / 100);
  const cap = effort * F, verse = effort * 12 * n, netPEA = cap - (cap - verse) * (PRELEVEMENTS.PS_CAPITAL / 100), netCTO = cap - (cap - verse) * (PFU / 100);
  const gain = (100 * (netPER / netPEA - 1));
  const ab = res.abondement;
  const ligneAb = ab?.mensuel > 0.5 ? `<p class="verdict ok" style="margin:0 0 8px"><b>Abondement :</b> en versant ${eur(ab.mensuel)} par mois sur ton ${ab.surPER ? "PER d'entreprise" : "PEE"}, ton employeur ajoute ${eur(ab.abondementAn)} par an. C'est la première chose à faire.</p>` : "";
  return ligneAb + `<p class="small" style="margin:0 0 8px">Ta tranche : <b>${tmi} %</b>. Chaque 100 € versé sur un PER te fait économiser <b>${eur(tauxPER)}</b> d'impôt${per.exact ? " (taux réel de ton versement prévu, décote et changement de tranche compris)" : " (estimation à ta tranche)"}.${per.actif ? ` Le plan prévoit ${eur(per.mensuel)} par mois, soit <b>${eur(per.economie)} d'impôt en moins par an</b>${per.exact ? `, soit ${Math.round(per.tauxEffectif)} % du versement` : " (estimation à ta tranche)"}.` : per.raison === "refus" && per.economiePossible > 0.5 ? ` Tu as refusé le PER : environ ${eur(per.economiePossible)} d'impôt par an laissés de côté.` : ""}</p>
    <div class="table-wrap"><table><thead><tr><th>Pour 100 € par mois de ta poche pendant ${n} ans</th><th class="m">À la retraite, après impôts</th></tr></thead><tbody>
      <tr><td>PER (${eur(mPER)} placés par mois grâce à l'économie d'impôt)</td><td class="m"><b>${eur(netPER)}</b></td></tr>
      <tr><td>PEA</td><td class="m">${eur(netPEA)}</td></tr>
      <tr><td>Compte-titres</td><td class="m">${eur(netCTO)}</td></tr>
    </tbody></table></div>
    <p class="small" style="margin:8px 0 0">${gain > 5 ? `<b>Le PER fait ${pct(gain)} de mieux que le PEA</b> pour le même effort.` : `Avec ta tranche, l'avantage sur le PEA est faible (${pct(gain)}) : le PEA, disponible, est plus intéressant.`} Hypothèses : 6 % par an, tranche à la retraite de ${tret} %, sortie en capital, montants de l'époque.</p>`;
}

function blocDansTonPlan(f, res) {
  if (f.id === "risques") return blocRisques(res);
  if (f.id === "per") return blocCalculPER(res) + '<div style="margin-top:12px"></div>' + blocDansTonPlanCommun(f, res);
  if (f.id === "net-impot") return blocNetImpot();
  if (f.id === "frais") return blocFrais();
  if (f.id === "epargne-salariale") return blocEpargneSalariale(res) + blocDansTonPlanCommun(f, res);
  return blocDansTonPlanCommun(f, res);
}
function blocFrais() {
  const p = normaliserProfil(etat.profil), P = p.placements ?? {}, out = [];
  const avTot = (P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0);
  const avType = p.assuranceVie?.type ?? "";
  if (p.assuranceVie?.ouverte) {
    const cher = ["Banque traditionnelle", "Assureur ou mutuelle", "Gestion pilotée en ligne"].includes(avType);
    out.push(`<li><b>Assurance-vie</b> (${echapper(avType || "type non précisé")}${avTot > 0 ? `, ${eur(avTot)}` : ""}) : ${cher ? `frais probablement élevés. Retrouve sur ton relevé annuel les frais de gestion et ceux des fonds ; si le total dépasse 1,5 % par an, continue d'alimenter plutôt un contrat en ligne (garde l'ancien s'il a plus de 8 ans). À 1,5 % de frais de plus, ${eur(avTot)} sur 20 ans, c'est environ ${eur(avTot * (Math.pow(1.055, 20) - Math.pow(1.04, 20)))} de moins.` : "type de contrat généralement peu cher. Vérifie quand même les frais des supports."}</li>`);
  }
  if (p.pea?.ouvert) {
    const cher = p.pea.etablissement === "Banque traditionnelle";
    out.push(`<li><b>PEA</b> (${echapper(p.pea.etablissement || "établissement non précisé")}) : ${cher ? "les banques traditionnelles prennent souvent 0,5 % ou plus par ordre et parfois des frais de garde. Un transfert vers un courtier en ligne coûte au plus 150 € et garde l'ancienneté du PEA." : "courtier en ligne : frais de courtage faibles. Choisis des ETF à 0,1 à 0,3 % par an."}</li>`);
  }
  if ((P.per ?? 0) > 0) out.push(`<li><b>PER</b> : vérifie 0 % sur versement et environ 0,5 % par an ; la gestion pilotée « à horizon » ajoute souvent des frais.</li>`);
  if ((P.epargneSalariale ?? 0) > 0) out.push(`<li><b>Épargne salariale</b> : compare les frais courants des FCPE proposés ; préfère un fonds indiciel actions monde.</li>`);
  return out.length ? `<ul class="points" style="margin:0">${out.join("")}</ul>` : `<p class="small muted" style="margin:0">Indique tes contrats dans « Mon profil » (type d'assurance-vie, établissement du PEA) pour voir ce qu'il faut vérifier.</p>`;
}
function blocNetImpot() {
  const p = normaliserProfil(etat.profil), n = Number(p.salaireNetMensuel) || 0;
  if (!(n > 0)) return `<p class="small muted" style="margin:0">Indique ton salaire net après impôt dans « Mon profil » pour voir le détail.</p>`;
  const ff = foyerFiscal(p), d = decomposerSalaire(n, { ...ff, netSurBrut: etat.brouillon.retraitePublique?.netSurBrutSalaire ?? 78 });
  const tmiSaisie = p.tmi !== "" && p.tmi != null ? Number(p.tmi) : null;
  return `<div class="table-wrap"><table><tbody>
      <tr><td>Salaire brut (estimé, salarié non cadre)</td><td class="m">≈ ${eur(d.brut)}</td></tr>
      <tr><td>Cotisations sociales</td><td class="m">≈ − ${eur(d.brut - d.netAvant)}</td></tr>
      <tr><td><b>Net avant impôt</b></td><td class="m"><b>≈ ${eur(d.netAvant)}</b></td></tr>
      <tr><td>Impôt prélevé à la source (taux moyen ≈ ${pct(d.tauxPAS)})</td><td class="m">≈ − ${eur(d.impotMensuel)}</td></tr>
      <tr><td><b>Net après impôt</b> (ce que tu as saisi)</td><td class="m"><b>${eur(n)}</b></td></tr>
    </tbody></table></div>
    <p class="small" style="margin:8px 0 0">${ff.commun ? "Imposition commune avec ton conjoint (2 parts). " : "Personne seule (1 part). "}Tranche marginale estimée : <b>${d.tmi} %</b>${tmiSaisie == null ? ` : tu peux la saisir dans « Mon profil », bloc « Tes impôts » (vérifie-la sur ton avis d'impôt).` : tmiSaisie !== d.tmi ? `, alors que tu as saisi ${tmiSaisie} % : ton avis d'impôt fait foi (enfants, autres revenus, réductions…).` : `, comme celle que tu as saisie.`} Si le brut estimé est loin de ta fiche de paie, vérifie que tu as bien saisi le net <i>après</i> impôt.</p>`;
}
function blocEpargneSalariale(res) {
  const A = etat.profil.abondement ?? {}, acces = A.acces ?? "?", ab = res.abondement;
  const etatAcces = { "?": "Tu n'as pas encore indiqué si ton entreprise propose une épargne salariale : c'est la première chose à vérifier.", non: "Tu as indiqué que ton entreprise ne propose pas d'épargne salariale (ou que tu n'es pas salarié).", pee: "Ton entreprise propose un PEE.", per: "Ton entreprise propose un PER d'entreprise.", les2: "Ton entreprise propose un PEE et un PER d'entreprise." }[acces] ?? "";
  let html = `<p class="small" style="margin:0 0 8px">${etatAcces} <a class="lien-fiche" href="#mon-profil">Modifier dans « Mon profil », bloc « Ton employeur »</a></p>`;
  if (ab) html += `<p class="verdict ok" style="margin:0 0 8px"><b>Argent offert par ton employeur :</b> ${eur(ab.abondementAn)} par an (${eur(ab.net)} après CSG et CRDS)${ab.mensuel > 0.5 ? `, en versant ${eur(ab.mensuel)} par mois${ab.interessement > 0 ? " et en plaçant ton intéressement" : ""}` : ab.interessement > 0 ? ", grâce à ton intéressement placé" : ""}. Sur 10 ans, cela fait ${eur(ab.net * 10)} sans compter les gains.</p>`;
  else if (acces !== "?" && acces !== "non") html += `<p class="small" style="margin:0 0 8px">Pas d'abondement indiqué. Si ton entreprise en verse un, coche « Mon employeur abonde mes versements » et indique le taux.</p>`;
  return html;
}
function blocDansTonPlanCommun(f, res) {
  const plan = etat.brouillon;
  const ids = [f.id, ...(f.couvre ?? [])];
  const vise = (env) => ids.includes(plan.enveloppes[env]?.fiche);
  const comptes = res.reeq.comptes.filter((c) => vise(c.enveloppe));
  const cons = res.consignes.filter((c) => ids.includes(c.fiche));
  let html = "";
  if (comptes.length) html += `<div class="table-wrap"><table><thead><tr><th>Compte</th><th class="m">Actuel</th><th class="m">Cible</th></tr></thead><tbody>${comptes.map((c) => `<tr><td>${f.couvre ? lienFiche(plan.enveloppes[c.enveloppe].fiche, echapper(plan.enveloppes[c.enveloppe].libelle)) : echapper(plan.enveloppes[c.enveloppe].libelle)}<div class="statut-compte">${echapper(c.texte)}</div></td><td class="m">${eur(c.actuel)}</td><td class="m">${eur(c.cible)}</td></tr>`).join("")}</tbody></table></div>`;
  const mvts = res.mouvements.filter((m) => vise(m.enveloppe) || (m.vers && vise(m.vers)));
  if (mvts.length) html += `<p class="small" style="margin:8px 0 0"><b>Ce mois-ci :</b> ${mvts.map((m) => `${m.sens === "retrait" ? "retirer" : m.sens === "arbitrage" ? "arbitrer" : "verser"} ${eur(m.montant)} ${m.sens === "versement" ? "sur" : "de"} ${echapper(plan.enveloppes[m.enveloppe].libelle)}${m.vers ? ` vers ${echapper(plan.enveloppes[m.vers].libelle)}` : ""}`).join(" ; ")}.</p>`;
  if (f.id === "residence" && res.achat) {
    const i = res.achat.ideal;
    html += `<p class="small" style="margin:0">${i ? `Âge idéal pour un bien à ${eur(res.achat.prix)} : <b>${i.age} ans</b> (apport ${eur(i.apportRequis)}, prêt ${eur(i.pret)} sur ${i.duree} ans, ${eur(i.mensualite)} par mois).` : `Bien à ${eur(res.achat.prix)} : hors de portée avant la limite du plan.`}</p>`;
  }
  if (cons.length) html += `<ul class="consignes" style="margin-top:10px">${cons.map((c) => `<li><span class="niveau ${c.niveau}">${{ action: "À faire", info: "Bon à savoir", alerte: "Attention" }[c.niveau]}</span><span>${texteLie(c.texte, f.id)}</span></li>`).join("")}</ul>`;
  return html || `<p class="small muted" style="margin:0">Ce placement n'apparaît pas dans la répartition actuelle du profil.</p>`;
}

// ---------------------------------------------------------------- épargne idéale
// Les placements à avoir, dans l'ordre où les remplir, et où tu en es pour chacun.
// statut : fait | afaire | verifier | non (pas pour toi) | plustard
const PASTILLES = { fait: "C'est fait", afaire: "À faire", verifier: "À vérifier", non: "Pas pour toi", plustard: "Plus tard" };
function produitsIdeaux(res) {
  const plan = etat.brouillon, p = normaliserProfil(etat.profil), P = p.placements ?? {};
  const H = plan.hypotheses ?? {}, A = p.abondement ?? {}, acces = A.acces ?? "?";
  const cible = (envs) => res.reeq.comptes.filter((c) => envs.includes(c.enveloppe)).reduce((t, c) => t + c.cible, 0);
  const tmi = p.tmi !== "" && p.tmi != null ? Number(p.tmi) : null;
  const age = Number(p.age) || 30;
  const L = [];

  // 1. Le coussin de sécurité
  const lep = P.lep ?? 0;
  L.push({ etape: 1, id: "lep", nom: "LEP (livret d'épargne populaire)", fiche: "lep", badge: "Si tu y as droit",
    pourquoi: "Le meilleur livret de France : plus rapporteur que le Livret A, sans risque, sans impôt, disponible à tout moment.",
    chips: ["2,5 % par an", "0 impôt", "Plafond 10 000 €", "Revenus modestes"],
    ...(!p.eligibleLEP ? { statut: "non", texte: "Réservé aux revenus modestes. Si tes revenus baissent, pense à lui : c'est le premier à remplir." }
      : lep >= 9999 ? { statut: "fait", texte: `Rempli (${eur(lep)}).` }
      : { statut: "afaire", texte: lep > 0 ? `${eur(lep)} sur 10 000 € : à compléter en premier.` : "Tu y as droit : ouvre-le et remplis-le en premier." }) });
  if (age <= 25) L.push({ etape: 1, id: "livret-jeune", nom: "Livret Jeune", fiche: "livret-jeune", badge: "De 12 à 25 ans",
    pourquoi: "Un petit livret réservé aux jeunes, souvent mieux payé que le Livret A, sans impôt.",
    chips: ["Taux ≥ Livret A", "0 impôt", "Plafond 1 600 €"],
    ...((P.livretJeune ?? 0) >= 1599 ? { statut: "fait", texte: "Rempli." } : { statut: "afaire", texte: `Tu y as droit jusqu'à tes 25 ans${(P.livretJeune ?? 0) > 0 ? ` : ${eur(P.livretJeune)} sur 1 600 €` : ""}.` }) });
  const SEC = ["lep", "livretJeune", "livretA", "ldds", "livretBancaire"];
  const secA = SEC.reduce((t, e) => t + (P[e] ?? 0), 0), secC = res.alloc?.securite ?? cible(SEC), apport = res.alloc?.projet ?? 0;
  L.push({ etape: 1, id: "livret-a", nom: "Livret A + LDDS", fiche: "livrets", badge: "Indispensable",
    pourquoi: "Ton épargne de sécurité : l'argent des imprévus (panne, perte d'emploi), garanti par l'État et disponible en un clic. C'est elle qui te permet de ne jamais vendre ta bourse au mauvais moment.",
    chips: ["1,7 % par an", "0 impôt", `Plafonds ${eur(PLAFONDS.livretA)} + ${eur(PLAFONDS.ldds)}`, "Dispo immédiate"],
    ...(secA >= secC * 0.95 ? { statut: "fait", texte: `${eur(secA)} sur tes livrets : ton épargne de sécurité (${eur(secC)} selon ton plan) est en place${apport > 0.5 ? `, et ${eur(apport)} y sont gardés pour l'apport de ton achat` : ""}.${secA - secC - apport > 2000 ? ` Le surplus (${eur(secA - secC - apport)}) travaillera mieux ailleurs : voir l'onglet Rééquilibrage.` : ""}` }
      : { statut: "afaire", texte: `${eur(secA)} sur tes livrets, pour ${eur(secC)} d'épargne de sécurité visés par ton plan.` }) });

  // 2. L'argent offert par l'employeur
  const ab = res.abondement;
  L.push({ etape: 2, id: "abondement", nom: "Épargne salariale avec abondement (PEE, PER d'entreprise)", fiche: "epargne-salariale", badge: "Si ton employeur le propose",
    pourquoi: "Le seul placement qui double ton argent le jour même : ton employeur ajoute jusqu'à 3 € pour chaque euro versé. Aucun autre produit ne rapporte autant.",
    chips: ["Jusqu'à +300 % immédiat", "Pas d'impôt sur le revenu", "Souvent 500 à 4 000 €/an offerts", "Bloqué 5 ans ou jusqu'à la retraite"],
    ...(acces === "?" ? { statut: "verifier", texte: "Demande à ton employeur s'il propose un PEE ou un PER d'entreprise avec abondement, puis indique-le dans « Mon profil »." }
      : acces === "non" ? { statut: "non", texte: "Ton employeur n'en propose pas. Si tu changes d'emploi, pose la question." }
      : !ab ? { statut: "verifier", texte: "Tu as un plan, mais pas d'abondement indiqué : vérifie le règlement du plan." }
      : ab.complet ? { statut: "fait", texte: `Tu touches tout l'abondement : ${eur(ab.abondementAn)} offerts par an.` }
      : { statut: "afaire", texte: `Tu touches ${eur(ab.abondementAn)} sur ${eur(ab.plafond)} possibles par an : verse ${eur(ab.versementAn / 12)} par mois pour tout avoir.` }) });

  // 3. Le moteur de ta richesse
  const peaV = Number(p.pea?.versements) || 0;
  L.push({ etape: 3, id: "pea", nom: "PEA (plan d'épargne en actions)", fiche: "pea", badge: "Indispensable",
    pourquoi: `Le moteur de ton patrimoine : des ETF qui suivent des milliers d'entreprises, environ ${pct(H.rendements?.bourse ?? 7)} par an en moyenne sur le long terme, et plus d'impôt sur le revenu après 5 ans.`,
    chips: [`≈ ${pct(H.rendements?.bourse ?? 7)} par an (moyenne)`, `${pct(PRELEVEMENTS.PS_CAPITAL)} sur les gains après 5 ans`, `Plafond ${eur(PLAFONDS.pea)} versés`, "Ouvrir tôt pour prendre date"],
    ...(p.pea?.ouvert ? { statut: "fait", texte: `Ouvert${p.pea.dateOuverture ? ` depuis ${new Date(p.pea.dateOuverture + "-01T12:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}` : ""}${(P.pea ?? 0) > 0 ? `, ${eur(P.pea)} dessus` : ""}.` }
      : { statut: "afaire", texte: "À ouvrir maintenant, même avec 10 € : le compteur des 5 ans démarre à l'ouverture." }) });

  // 4. Les cadeaux fiscaux
  const per = res.per;
  const tret = plan.per?.tmiRetraite ?? 11;
  const tauxE = per?.exact ? per.tauxEffectif : tmi, cmp = tmi != null ? comparerPERPEA(tmi, tret, 20, tauxE) : null;
  const calcul = cmp ? `100 € versés font baisser l'impôt de ${eur(tauxE)}${p.tmiEstimee ? ` (tranche estimée à ${tmi} % d'après tes revenus)` : ""}, mais ces versements seront imposés à la sortie (environ ${tret} % à la retraite). Sur 20 ans, pour 100 € par mois de ta poche : ${eur(cmp.per)} avec le PER contre ${eur(cmp.pea)} avec le PEA, après impôts, soit ${cmp.gain >= 0 ? "+" : "−"}${pct(Math.abs(cmp.gain))}.` : "";
  L.push({ etape: 4, id: "per", nom: "PER (plan d'épargne retraite)", fiche: "per", badge: "Si tu paies assez d'impôt",
    pourquoi: "L'État paie une partie de ton épargne : chaque versement baisse ton impôt de 30 à 45 %, et l'argent est investi en bourse jusqu'à la retraite (ou l'achat de ta résidence principale).",
    chips: ["−30 à −45 % d'impôt", "Investi en ETF", "Bloqué jusqu'à la retraite", "Plafond sur l'avis d'impôt"],
    ...(p.refusPER ? { statut: "non", texte: `Tu l'as écarté${per?.economiePossible > 0.5 ? ` : environ ${eur(per.economiePossible)} d'impôt par an laissés de côté` : ""}.` }
      : tmi == null ? { statut: "verifier", texte: "Indique ta tranche d'imposition dans « Mon profil » pour savoir s'il vaut le coup." }
      : per?.actif ? ((P.per ?? 0) > 0 ? { statut: "fait", texte: `Ouvert. Le plan y verse ${eur(per.mensuel)} par mois : environ ${eur(per.economie)} d'impôt en moins par an${per.exact ? "" : " (estimation à ta tranche)"}.` }
        : { statut: "afaire", texte: `À ouvrir : ${eur(per.mensuel)} par mois, environ ${eur(per.economie)} d'impôt en moins par an${per.exact ? "" : " (estimation à ta tranche)"}.` })
      : per?.raison === "pas-de-flux-bourse" ? { statut: "plustard", texte: `Intéressant pour toi : ${calcul} Mais pour l'instant toute ton épargne va à la sécurité ou à l'apport ; le plan commencera le PER ensuite.` }
      : per?.raison === "age" ? { statut: "non", texte: "Depuis 2026, les versements faits après 70 ans ne sont plus déductibles." }
      : per?.raison === "non-resident" ? { statut: "non", texte: "Réservé aux résidents fiscaux français." }
      : { statut: "non", texte: `${calcul} ${cmp && cmp.gain > 5 ? "Le gain existe, mais ton plan ne prend le PER qu'à partir d'une tranche de 30 %." : "Pas la peine de bloquer l'argent jusqu'à la retraite : le PEA fait aussi bien ou mieux."}` }) });
  const avOuverte = !!p.assuranceVie?.ouverte;
  L.push({ etape: 4, id: "assurance-vie", nom: "Assurance-vie", fiche: avOuverte ? "assurance-vie" : "meilleures-assurances-vie", badge: "Indispensable",
    pourquoi: "Le couteau suisse : disponible à tout moment, impôts allégés après 8 ans, et jusqu'à 152 500 € par enfant transmis sans droits de succession.",
    chips: ["Fiscalité douce après 8 ans", "152 500 € transmis sans droits", "Fonds euros garanti ou ETF", "Ouvrir tôt pour prendre date"],
    ...(avOuverte ? { statut: "fait", texte: `Ouverte${(P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0) > 0 ? ` (${eur((P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0))})` : ""}.` }
      : { statut: "afaire", texte: "À ouvrir maintenant avec un petit montant, en ligne et sans frais d'entrée : le compteur des 8 ans démarre à l'ouverture. Voir la fiche « Les meilleures assurances-vie »." }) });

  // 5. Quand le reste est plein
  L.push({ etape: 5, id: "cto", nom: "Compte-titres", fiche: "cto", badge: "Plus tard",
    pourquoi: "Pour continuer à investir en bourse sans limite quand le PEA est plein, ou pour les ETF qui n'entrent pas dans un PEA.",
    chips: ["Sans plafond", "31,4 % sur les gains", "Disponible"],
    ...(peaV >= 140000 || (P.cto ?? 0) > 0 ? { statut: (P.cto ?? 0) > 0 ? "fait" : "afaire", texte: (P.cto ?? 0) > 0 ? `${eur(P.cto)} dessus.` : "Ton PEA est presque plein : c'est le moment." }
      : { statut: "plustard", texte: `Quand ton PEA sera plein (${eur(peaV)} versés sur ${eur(PLAFONDS.pea)}).` }) });
  L.push({ etape: 5, id: "residence", nom: "Résidence principale", fiche: "residence", badge: "Projet de vie",
    pourquoi: "Le seul investissement qu'on peut faire avec l'argent de la banque : le crédit remplace le loyer, et la plus-value à la revente est exonérée d'impôt.",
    chips: ["Plus-value sans impôt", "Effet de levier du crédit", "Fin du loyer"],
    ...(p.proprietaire && (p.logement?.usage ?? "rp") === "rp" ? { statut: "fait", texte: "Tu es propriétaire de ton logement." }
      : p.projetRP?.actif ? { statut: "afaire", texte: res.achat?.ideal ? `Projet prévu : un bien à ${eur(res.achat.prix)}, idéalement à ${res.achat.ideal.age} ans.` : "Projet prévu : voir l'onglet Trajectoire." }
      : { statut: "plustard", texte: "Pas de projet indiqué. Tu peux en tester un dans « Mon profil »." }) });
  const paliers = plan.paliers ?? [];
  const seuil = (c) => paliers.find((x) => (x.cibles?.[c] ?? 0) > 0)?.capital;
  const div = [["bitcoin", "bitcoin"], ["or", "or physique"], ["scpi", "SCPI"]];
  const prevus = div.filter(([c]) => (res.alloc?.[c] ?? 0) > 0.5);
  L.push({ etape: 5, id: "diversification", nom: "Diversification : or, SCPI, bitcoin", fiche: "or", badge: "Plus tard",
    pourquoi: "Des petites parts qui ne bougent pas comme la bourse : l'or protège dans les crises, les SCPI versent des loyers, le bitcoin peut beaucoup monter (et beaucoup baisser).",
    chips: div.map(([c, n]) => `${n} dès ${eur(seuil(c) ?? 0)}`),
    ...(prevus.length ? { statut: "afaire", texte: `Ton plan prévoit : ${prevus.map(([c, n]) => `${n} ${eur(res.alloc[c])}`).join(", ")}.` }
      : { statut: "plustard", texte: `Pas encore : ton plan les ajoute à partir de ${eur(Math.min(...div.map(([c]) => seuil(c) ?? Infinity)))} de capital.` }) });
  return L;
}
// Ce que tu laisses sur la table chaque année
function argentPerdu(res) {
  const p = normaliserProfil(etat.profil), P = p.placements ?? {}, A = p.abondement ?? {};
  const out = [], tmi = Number(p.tmi) || 0;
  const ab = res.abondement;
  if (ab && !ab.complet) out.push(["Abondement non touché", ab.plafond - ab.abondementAn, "epargne-salariale"]);
  if ((A.acces ?? "?") === "?" && !["independant", "etudiant", "retraite"].includes(p.statutPro)) out.push(["Abondement possible, à vérifier auprès de ton employeur", null, "epargne-salariale"]);
  if (p.refusPER && res.per?.economiePossible > 0.5) out.push(["Impôt non économisé (PER écarté)", res.per.economiePossible, "per"]);
  if (p.eligibleLEP && (P.lep ?? 0) < 9999) out.push(["LEP pas rempli (2,5 % au lieu de 1,7 %)", ((PLAFONDS.lep - (P.lep ?? 0)) * 0.8) / 100, "lep"]);
  const inter = Number(A.interessement) || 0;
  if (inter > 0 && A.placer === false && !["non", "?"].includes(A.acces) && tmi > 0) out.push(["Impôt payé sur l'intéressement reçu au lieu d'être placé", economieInteressement(p, inter).economie, "epargne-salariale"]);
  if ((P.livretBancaire ?? 0) > 1000 && (P.livretA ?? 0) + (P.ldds ?? 0) < 34900) out.push(["Super livret imposé alors que le Livret A et le LDDS ne sont pas pleins", null, "livret-bancaire"]);
  return out;
}
export function rendreEpargneIdeale() {
  const res = etat.resultat, el = $("#ideale");
  if (!res) { el.innerHTML = `<p class="note">Remplis d'abord « Mon profil ».</p>`; return; }
  const L = produitsIdeaux(res);
  const concernes = L.filter((x) => x.statut !== "non" && x.statut !== "plustard");
  const faits = concernes.filter((x) => x.statut === "fait").length;
  const part = concernes.length ? (100 * faits) / concernes.length : 0;
  const ETAPES = {
    1: ["Le coussin de sécurité", "Avant tout placement : de quoi faire face aux imprévus sans rien vendre. Sans risque, sans impôt, disponible tout de suite."],
    2: ["L'argent offert", "Si ton employeur ajoute de l'argent, c'est la priorité absolue : aucun placement ne rapporte autant."],
    3: ["Le moteur de ton patrimoine", "La bourse sur le long terme, dans l'enveloppe la moins imposée."],
    4: ["Les cadeaux fiscaux", "Ouvrir tôt pour prendre date, et laisser l'État payer une partie de ton épargne."],
    5: ["Quand le reste est en place", "Pour aller plus loin, une fois les bases solides."],
  };
  const carte = (x) => `<article class="produit ${x.statut}">
      <div class="tete"><h4>${lienFiche(x.fiche, echapper(x.nom))}</h4><span class="etiquette ${x.badge === "Indispensable" ? "projet" : x.badge.startsWith("Si") ? "action" : ""}">${echapper(x.badge)}</span></div>
      <p class="pourquoi">${texteLie(x.pourquoi, x.fiche)}</p>
      <ul class="chips">${x.chips.map((c) => `<li>${echapper(c)}</li>`).join("")}</ul>
      <div class="pour-toi"><span class="etat-pt ${x.statut}">${PASTILLES[x.statut]}</span><span>${echapper(x.texte)}</span></div>
    </article>`;
  const perdu = argentPerdu(res);
  const totalPerdu = perdu.reduce((t, x) => t + (x[1] ?? 0), 0);
  el.innerHTML = `
    <section class="panneau">
      <div class="ideal-tete">
        <div><h2>L'épargne idéale</h2>
          <p>Les placements qu'il faut avoir et dont il faut profiter quand on y a droit, dans l'ordre où les remplir. C'est la logique de ton plan : d'abord la sécurité, puis l'argent offert, puis la bourse dans les enveloppes les moins imposées. Pour chacun, où tu en es d'après ton profil.</p></div>
        <div class="score"><b>${faits} / ${concernes.length}</b><span>placements qui te concernent déjà en place</span><span class="jauge"><span style="width:${part}%;background:var(--accent)"></span></span></div>
      </div>
    </section>
    <section class="panneau bandeau-frais"><h3>⚠ Attention aux frais</h3><p class="small" style="margin:0">Pour chaque placement ci-dessous, ouvre-le là où les frais sont bas : 0 % sur les versements, environ 0,5 % par an, des ETF. Avec 2 % de frais par an au lieu de 0,5 %, 100 € par mois pendant 30 ans donnent 69 400 € au lieu de 91 400 €. <a class="lien-fiche" href="#fiche-frais">Tout sur les frais</a></p></section>
    ${perdu.length ? `<section class="panneau attention"><h3 style="margin:0 0 8px">Ce que tu laisses sur la table</h3>
      <div class="table-wrap"><table class="table-perdu"><tbody>${perdu.map(([t, m, f]) => `<tr><td>${lienFiche(f, echapper(t))}</td><td class="m">${m == null ? "à vérifier" : `${eur(m)} par an`}</td></tr>`).join("")}</tbody></table></div>
      ${totalPerdu > 0.5 ? `<p class="small" style="margin:8px 0 0">Au moins <b>${eur(totalPerdu)} par an</b>, soit ${eur(totalPerdu * 10)} sur 10 ans sans compter ce que cet argent aurait rapporté.</p>` : ""}</section>` : ""}
    ${Object.entries(ETAPES).map(([n, [titre, intro]]) => {
      const items = L.filter((x) => x.etape === Number(n));
      return items.length ? `<section class="etape-ideale"><h3><span class="num">${n}</span>${titre}</h3><p>${intro}</p><div class="produits">${items.map(carte).join("")}</div></section>` : "";
    }).join("")}
    <section class="panneau" style="margin-top:18px"><h3 style="margin:0 0 8px">Les règles d'or</h3>
      <ul class="points">
        <li>Ouvre tôt le PEA et l'assurance-vie, même avec 10 € : leurs avantages fiscaux dépendent de leur âge, pas du montant.</li>
        <li>Programme des versements automatiques chaque mois, le lendemain de la paie : on n'épargne pas ce qui reste, on dépense ce qui reste.</li>
        <li>Pas plus d'un mois de dépenses sur le compte courant : au-delà, l'argent perd de la valeur avec l'inflation.</li>
        <li>Ne jamais vendre sa bourse dans une crise : c'est l'épargne de sécurité qui paie les imprévus (voir la simulation de crise dans Trajectoire).</li>
        <li>Fuir les frais : pas de frais d'entrée sur une assurance-vie, des ETF plutôt que des fonds à 2 % par an.</li>
      </ul></section>
    <section class="panneau"><h3 style="margin:0 0 8px">À éviter</h3>
      <ul class="points">
        <li>Les produits « garantis » à rendement mirobolant, les placements promis sur les réseaux sociaux, le trading de produits complexes.</li>
        <li>Les contrats vendus en agence avec 3 à 5 % de frais sur chaque versement.</li>
        <li>Le super livret imposé tant que le Livret A, le LDDS (et le LEP si tu y as droit) ne sont pas pleins.</li>
        <li>Mettre toute son épargne salariale en actions de sa propre entreprise.</li>
        <li>Laisser l'intéressement ou la participation partir par défaut sans choisir les fonds.</li>
      </ul>
      <p class="small muted" style="margin:8px 0 0">Les taux et plafonds sont ceux de novembre 2026. Les détails, les cas particuliers et les sources sont dans chaque fiche.</p></section>`;
}

const HAUT_FICHES = ["frais", "lexique", "risques", "net-impot"];
// Bandeau « Attention aux frais » des fiches de placements
function bandeauFrais(f) {
  if (!f.frais?.length) return "";
  return `<section class="panneau bandeau-frais"><h3>⚠ Attention aux frais</h3>
    <p class="small">C'est ce qui fait le plus de différence sur la durée : 1 % de frais en plus par an, c'est environ 17 % de capital en moins au bout de 30 ans. Avant d'ouvrir, vérifie chaque ligne dans le document d'informations clés (DIC). <a class="lien-fiche" href="#fiche-frais">Tout sur les frais</a></p>
    <div class="table-wrap"><table><thead><tr><th>Frais</th><th>À viser</th><th>Trop cher</th></tr></thead><tbody>${f.frais.map(([t, bon, cher]) => `<tr><td><b>${echapper(t)}</b></td><td>${echapper(bon)}</td><td>${echapper(cher)}</td></tr>`).join("")}</tbody></table></div></section>`;
}
// Exemples d'abondement de grandes entreprises (fiche Épargne salariale)
const ENTREPRISES_TRIEES = [...ENTREPRISES].sort((a, b) => b.max - a.max);
function blocEntreprises() {
  const lien = ([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${echapper(t)}</a>`;
  return `<p style="margin:0 0 8px">Le maximum légal (11 534 € par an) n'est presque jamais atteint. Dans les grandes entreprises, l'abondement va le plus souvent de <b>quelques centaines d'euros à environ 4 000 € par an</b>. Voici des barèmes trouvés dans des accords et des documents publics, du plus généreux au plus modeste :</p>
    <div class="table-wrap"><table class="tableau-fiche"><thead><tr><th>Entreprise</th><th>Plans</th><th>Barème</th><th class="m">Abondement maximum par an</th><th class="m">À verser pour tout toucher</th><th>Source</th></tr></thead><tbody>
    ${ENTREPRISES_TRIEES.map((e) => `<tr>
      <td class="fort">${echapper(e.nom)}<div class="small muted">${echapper(e.secteur)} · ${echapper(e.annee)}</div></td>
      <td>${echapper(e.plans)}</td>
      <td>${echapper(e.bareme)}${e.total ? `<div class="small muted">${echapper(e.total)}</div>` : ""}${e.note ? `<div class="small muted">${echapper(e.note)}</div>` : ""}</td>
      <td class="m"><b>${eur(e.max)}</b></td>
      <td class="m">${e.verser ? `${eur(e.verser)}<div class="small muted">${eur(e.verser / 12)} par mois</div>` : '<span class="muted">selon le barème</span>'}</td>
      <td class="small">${echapper(e.fiabilite)}<br>${e.sources.map(lien).join("<br>")}${e.profil ? `<br><button type="button" class="lien" data-entreprise="${echapper(e.nom)}">Tester dans mon profil</button>` : ""}</td>
    </tr>`).join("")}
    </tbody></table></div>
    <p style="margin:12px 0 6px"><b>Les offres d'actions réservées aux salariés</b> : une autre forme d'argent offert, mais investie dans une seule entreprise.</p>
    <ul class="points">${OFFRES_ACTIONS.map(([n, a, t, src]) => `<li><b>${echapper(n)}</b> (${echapper(a)}) : ${echapper(t)}. ${lien(src)}</li>`).join("")}</ul>
    <p class="note" style="margin:8px 0 0">Ces barèmes sont renégociés tous les 1 à 3 ans et peuvent varier selon la filiale ou le statut : ce sont des ordres de grandeur pour se projeter, par exemple avant de postuler. Le règlement de ton plan fait foi. Pour les barèmes par tranches, « Tester dans mon profil » utilise un taux moyen qui donne le même abondement maximum.</p>`;
}
// Top 3 des assurances-vie, avec la recommandation pour le profil
function blocTop3(f) {
  const res = etat.resultat, P = normaliserProfil(etat.profil).placements ?? {};
  let reco = "";
  if (res) {
    const a = res.alloc ?? {}, prudent = (a.prudent ?? 0) + (a.projet ?? 0), bourse = a.bourse ?? 0;
    const part = prudent + bourse > 0 ? (100 * prudent) / (prudent + bourse) : 0;
    const choix = part >= 30 ? f.top3[0] : f.top3[1];
    const av = (P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0);
    reco = `<p class="verdict ok" style="margin:0 0 12px"><b>Pour ton profil : ${echapper(choix.nom)}.</b> ${part >= 30 ? `Ton plan met environ ${pct(part)} de ta part placée (hors livrets) sur la partie prudente : le fonds en euros compte beaucoup, et celui de Linxea Spirit 2 est l'un des meilleurs.` : `Ton plan met surtout ta part placée en bourse (${pct(100 - part)}) : les frais de 0,30 % de Lucya CNP sur les ETF font la plus grande différence.`}${av > 70000 ? ` Avec ${eur(av)} en assurance-vie, ouvre aussi un contrat chez un autre assureur (Lucya Cardif par exemple) pour rester sous la garantie de 70 000 € par assureur.` : ""}</p>`;
  }
  return reco + `<div class="produits">${f.top3.map((x, i) => `<article class="produit${i === 0 ? " fait" : ""}">
      <div class="tete"><h4><span class="num-top">${i + 1}</span> ${echapper(x.nom)}</h4><span class="etiquette ${i === 0 ? "projet" : "action"}">${echapper(x.titre)}</span></div>
      <p class="small muted" style="margin:0">${echapper(x.assureur)}</p>
      <ul class="chips">${x.chiffres.map((c) => `<li>${echapper(c)}</li>`).join("")}</ul>
      <p class="pourquoi"><b>Pour qui :</b> ${texteLie(x.pourQui, f.id)}</p>
      <div><b class="small">Pourquoi on le choisit</b><ul class="arguments pour">${x.pour.map((t) => `<li>${texteLie(t, f.id)}</li>`).join("")}</ul></div>
      <div><b class="small">Ses limites</b><ul class="arguments contre">${x.contre.map((t) => `<li>${texteLie(t, f.id)}</li>`).join("")}</ul></div>
    </article>`).join("")}</div>
    <p class="note" style="margin:8px 0 0">Classement établi pour ce plan (gestion libre, ETF, fonds en euros, arbitrages gratuits) à partir des comparatifs d'octobre et novembre 2026. Aucun lien commercial avec ces contrats. Les taux et bonus changent chaque année : vérifie le DIC avant d'ouvrir.</p>`;
}
// Intéressement et participation versés par de grandes entreprises
function blocPrimes() {
  const lien = ([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${echapper(t)}</a>`;
  return `<p style="margin:0 0 8px">Ces primes dépendent des résultats : elles peuvent doubler, baisser de moitié ou disparaître d'une année à l'autre. Voici ce que de grandes entreprises ont réellement versé récemment, de la plus généreuse à la plus faible :</p>
    <div class="table-wrap"><table class="tableau-fiche"><thead><tr><th>Entreprise</th><th>Période</th><th>Ce qui a été versé</th><th>Source</th></tr></thead><tbody>
    ${PRIMES.map((x) => `<tr><td class="fort">${echapper(x.nom)}</td><td class="small">${echapper(x.annee)}</td><td>${echapper(x.texte)}</td><td class="small">${lien(x.source)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="note" style="margin:8px 0 0">Montants moyens bruts par salarié en France, tirés de communiqués, d'articles de presse et de documents syndicaux (vérifiés le 13 novembre 2026). Le montant de chacun dépend souvent de son salaire et de son temps de présence. Pour ton plan, saisis plutôt une moyenne prudente de tes dernières années dans « Mon profil », champ « Intéressement + participation » : une année faible arrive toujours.</p>`;
}
function appliquerEntreprise(nom) {
  const e = ENTREPRISES.find((x) => x.nom === nom);
  if (!e?.profil) return;
  const P = e.profil;
  Object.assign(etat.profil.abondement, { acces: P.acces, actif: true, plan: P.plan ?? (P.acces === "pee" ? "pee" : "pereco"), taux: P.taux, plafond: P.plafond, surInteressement: !!P.surInteressement });
  remplirProfil();
  apresSaisieProfil();
}
// ---------------------------------------------------------------- simulateur « Impact des frais » (fiche Les frais)
// Valeurs de départ = profil actif ; null tant que l'utilisateur n'y a pas touché (elles suivent alors le profil).
const fraisSim = { capital: null, mensuel: null, annees: null };
function valeursFraisSim() {
  const p = etat.profil;
  const ageRetraite = etat.brouillon?.hypotheses?.ageRetraite ?? 64;
  const parDefaut = Math.min(40, Math.max(10, ageRetraite - (Number(p.age) || 30)));
  return {
    capital: fraisSim.capital ?? Math.round(capitalDe(profilDeCalcul(p))),
    mensuel: fraisSim.mensuel ?? Math.round(Number(p.epargneMensuelle) || 0),
    annees: fraisSim.annees ?? parDefaut,
  };
}
function depensesPourFrais() {
  const p = etat.profil;
  if (Number(p.depensesMensuelles) > 0) return Number(p.depensesMensuelles);
  const reste = (Number(p.salaireNetMensuel) || 0) - (Number(p.epargneMensuelle) || 0);
  return reste > 0 ? reste : 0;
}
function graphiqueFrais(r) {
  const W = 640, H = 240, g = { l: 56, r: 12, t: 12, b: 26 };
  const max = Math.max(1, r.capitalOptimise);
  const x = (a) => g.l + ((W - g.l - g.r) * a) / r.annees;
  const y = (v) => H - g.b - ((H - g.t - g.b) * v) / max;
  const ligne = (s) => s.map((v, a) => `${a ? "L" : "M"}${x(a).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const aire = `${ligne(r.optimise)} ${r.charge.map((v, a) => `L${x(r.annees - a).toFixed(1)},${y(r.charge[r.annees - a]).toFixed(1)}`).join(" ")} Z`;
  let axes = "";
  for (const f of [0, 0.5, 1]) axes += `<line class="axe" x1="${g.l}" x2="${W - g.r}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${g.l - 6}" y="${y(max * f) + 4}" text-anchor="end">${keur(max * f)}</text>`;
  for (const f of [0, 0.5, 1]) axes += `<text x="${x(r.annees * f)}" y="${H - 6}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${f === 0 ? "départ" : `${Math.round(r.annees * f)} ans`}</text>`;
  return `<svg class="graphe fs-graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du capital sur ${r.annees} ans avec ${FRAIS_CHARGE} % de frais par an, comparée à ${FRAIS_OPTIMISE} % de frais par an">${axes}<path class="c-ecart" d="M${aire.slice(1)}"/><path class="c-cher" d="${ligne(r.charge)}"/><path class="c-bon" d="${ligne(r.optimise)}"/></svg>`;
}
function resultatFrais(v) {
  const dep = depensesPourFrais();
  const r = comparerFrais({ capital: v.capital, mensuel: v.mensuel, annees: v.annees, depensesMensuelles: dep });
  const nbAnnees = (x) => `${(Math.round(x * 10) / 10).toLocaleString("fr-FR")} an${x >= 2 ? "s" : ""}`;
  const equivalent = r.anneesDepenses != null
    ? `Cela représente <b>${nbAnnees(r.anneesDepenses)} de dépenses</b> (${eur(dep)} par mois dans ton profil) : autant d'années de vie, ou de retraite, que les frais te prennent.`
    : `Renseigne tes dépenses (ou ton salaire) dans « Mon profil » pour voir ce que cela représente en années de dépenses.`;
  return `<div class="fs-cartes">
      <div class="fs-carte cher"><span>Contrat chargé en frais · ${pct(FRAIS_CHARGE)} par an</span><b class="num">${eur(r.capitalCharge)}</b><span>assurance-vie bancaire, fonds actifs</span></div>
      <div class="fs-carte bon"><span>Enveloppe optimisée · ${pct(FRAIS_OPTIMISE)} par an</span><b class="num">${eur(r.capitalOptimise)}</b><span>PEA + ETF</span></div>
    </div>
    <div class="fs-ecart" role="status"><span class="small">Capté par les frais en ${r.annees} an${r.annees > 1 ? "s" : ""}</span><span class="gros num">${eur(r.ecart)}</span>
      <p>Soit ${pct(r.ecartPct)} du capital que tu aurais pu avoir, pour ${eur(r.verse)} versés en tout. ${equivalent}</p>
      <p>Avec la règle des 4 %, cet écart aurait payé <b>${eur(r.renteMensuelle4pct)} par mois</b> de retraite en plus.</p></div>
    ${graphiqueFrais(r)}
    <div class="fs-legende"><span><i style="background:var(--warn)"></i>Frais ${pct(FRAIS_CHARGE)}</span><span><i style="background:var(--accent)"></i>Frais ${pct(FRAIS_OPTIMISE)}</span><span>La zone colorée est ce que les frais captent.</span></div>`;
}
function blocSimulateurFrais() {
  const v = valeursFraisSim();
  return `<div class="frais-sim" id="frais-sim">
    <div class="fs-saisie">
      <label><span>Capital de départ (€)</span><input type="number" inputmode="decimal" min="0" max="100000000" step="1000" value="${v.capital}" data-fs="capital"></label>
      <label><span>Versement mensuel (€)</span><input type="number" inputmode="decimal" min="0" max="100000" step="50" value="${v.mensuel}" data-fs="mensuel"></label>
      <label><span>Horizon : <b id="fs-annees-txt">${v.annees}</b> ans</span><input type="range" min="1" max="50" step="1" value="${v.annees}" data-fs="annees" aria-label="Horizon en années"><input type="number" inputmode="numeric" min="1" max="50" step="1" value="${v.annees}" data-fs="annees-nb" aria-label="Horizon en années (saisie)"></label>
    </div>
    <p class="small muted" style="margin:0">Valeurs de départ prises dans ton profil actif. <button type="button" class="lien" data-fs-reset>Revenir aux valeurs de mon profil</button></p>
    <div id="fs-resultat" aria-live="polite">${resultatFrais(v)}</div>
  </div>`;
}

export function rendreFiches() {
  const id = location.hash.startsWith("#fiche-") ? location.hash.slice(7).split("?")[0] : null;
  const f = CONTENU_FICHES.find((x) => x.id === id);
  const verifie = new Date(VERIFIE_LE + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (!f) {
    const intro = `<p class="note" style="margin:0 0 12px">Un mémo par compte : ce que c'est, où l'ouvrir, comment faire, et ce que ton plan prévoit. Les mots compliqués sont expliqués dans le lexique. Informations vérifiées le ${verifie}.</p>`;
    const tout = `<div class="cartes">${CONTENU_FICHES.filter((x) => x.guide || HAUT_FICHES.includes(x.id)).map((x) => `<a class="carte carte-guide" href="#fiche-${x.id}"><span class="etiquette projet">${x.guide ? "À lire en premier" : x.id === "risques" ? "Se protéger" : x.id === "net-impot" ? "Comprendre sa paie" : x.id === "frais" ? "Attention aux frais" : "Les mots expliqués"}</span><h2>${x.titre}</h2><p>${echapper(x.accroche)}</p></a>`).join("")}</div>
      <h3 class="annee" style="margin:20px 0 8px">Une fiche par compte</h3>
      <div class="cartes">${CONTENU_FICHES.filter((x) => !x.guide && !HAUT_FICHES.includes(x.id)).map((x) => `<a class="carte" href="#fiche-${x.id}"><h2>${x.titre}</h2><p>${echapper(x.accroche)}</p></a>`).join("")}</div>`;
    const niv = niveauCourant();
    if (niv !== "debutant") { $("#fiches").innerHTML = intro + tout; return; }
    // Débutant : un parcours de 6 fiches d'abord, toutes les autres repliées (aucune fiche n'est retirée)
    const parcours = PARCOURS_DEBUTANT.map((e, i) => { const x = CONTENU_FICHES.find((y) => y.id === e.id); return x ? `<a class="carte carte-guide" href="#fiche-${x.id}"><span class="etiquette projet">Étape ${i + 1} sur ${PARCOURS_DEBUTANT.length}</span><h2>${x.titre}</h2><p>${echapper(e.phrase)}</p></a>` : ""; }).join("");
    $("#fiches").innerHTML = intro + `<h3 class="annee" style="margin:0 0 8px">Par où commencer</h3><div class="cartes" id="parcours-fiches">${parcours}</div>
      <details class="toutes-fiches" style="margin-top:20px"><summary><b>Toutes les fiches</b></summary><div style="margin-top:12px">${tout}</div></details>`;
    return;
  }
  const res = etat.resultat;
  const L = (t) => texteLie(t, f.id);
  $("#fiches").innerHTML = `<article class="fiche-detail">
    <a class="retour" href="#fiches">← Toutes les fiches</a>
    <h2 class="titre-fiche">${f.titre}</h2>
    <p class="accroche">${L(f.accroche)}</p>
    ${bandeauFrais(f)}
    ${f.guide || f.id === "lexique" ? "" : `<p class="small muted" style="margin:0">Dans ton plan : ${L(f.role)}</p>
    <section class="panneau encart"><h3>Dans ton plan, pour ce profil</h3>${res ? blocDansTonPlan(f, res) : ""}</section>`}
    <section><h3>L'essentiel</h3><dl class="essentiel">${f.essentiel.map(([k, v]) => `<div><dt>${k}</dt><dd>${L(v)}</dd></div>`).join("")}</dl></section>
    ${f.sections.map((sec) => `<section><h3>${sec.titre}</h3>${sec.special === "entreprises" ? blocEntreprises() : sec.special === "top3" ? blocTop3(f) : sec.special === "primes" ? blocPrimes() : sec.special === "simulateurFrais" ? blocSimulateurFrais() : ""}${sec.points ? `<${sec.ordonne ? "ol" : "ul"} class="points">${sec.points.map((p) => `<li>${L(p)}</li>`).join("")}</${sec.ordonne ? "ol" : "ul"}>` : ""}${sec.tableau ? `<div class="table-wrap"><table class="tableau-fiche"><thead><tr>${sec.tableau.entetes.map((h) => `<th>${echapper(h)}</th>`).join("")}</tr></thead><tbody>${sec.tableau.lignes.map((l) => `<tr>${l.map((c, i) => `<td${i === 0 ? ' class="fort"' : ""}>${L(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</section>`).join("")}
    ${f.videos?.length ? `<section><h3>En vidéo</h3><ul class="points">${f.videos.map(([t, u, n]) => `<li><a class="lien-video" href="${u}" target="_blank" rel="noopener">▶ ${echapper(t)}</a>${n ? ` <span class="muted small">${echapper(n)}</span>` : ""}</li>`).join("")}</ul></section>` : ""}
    ${f.etapes?.length ? `<section><h3>Étapes</h3><ol class="points">${f.etapes.map((p) => `<li>${L(p)}</li>`).join("")}</ol></section>` : ""}
    ${f.attention?.length ? `<section class="vigilance"><h3>Points de vigilance</h3><ul class="points">${f.attention.map((p) => `<li>${L(p)}</li>`).join("")}</ul></section>` : ""}
    <p class="note">${f.guide || f.id === "lexique" ? `Mis à jour le ${verifie}.` : `Informations vérifiées le ${verifie}. Taux, plafonds et fiscalité évoluent : les revérifier avant d'agir. Les plateformes citées sont des exemples, pas des recommandations.`}${f.sources.length ? ` Sources : ${f.sources.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${echapper(t)}</a>`).join(" · ")}.` : ""}</p>
  </article>`;
}

// Écouteurs des fiches, de l'épargne idéale (entreprises) et du simulateur de frais, attachés une seule fois au démarrage par app.js
export function monterFiches() {
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-entreprise]");
    if (!b) return;
    appliquerEntreprise(b.dataset.entreprise);
    location.hash = "#mon-profil";
    setTimeout(() => $("#ab-acces")?.scrollIntoView({ block: "center" }), 50);
  });
  $("#ab-exemple").innerHTML = `<option value="">Choisir une entreprise…</option>${ENTREPRISES_TRIEES.filter((e) => e.profil).map((e) => `<option value="${echapper(e.nom)}">${echapper(e.nom)} : jusqu'à ${eur(e.max)} par an</option>`).join("")}`;
  $("#ab-exemple").addEventListener("change", (ev) => { const v = ev.target.value; ev.target.value = ""; if (v) appliquerEntreprise(v); });
  document.addEventListener("profil:change", () => { fraisSim.capital = fraisSim.mensuel = fraisSim.annees = null; });
  $("#fiches").addEventListener("input", (e) => {
    const cle = e.target.dataset?.fs;
    if (!cle) return;
    const racine = e.target.closest("#frais-sim");
    const nombre = (min, max) => Math.min(max, Math.max(min, Number(String(e.target.value).replace(",", ".")) || 0));
    if (cle === "capital") fraisSim.capital = nombre(0, 1e8);
    else if (cle === "mensuel") fraisSim.mensuel = nombre(0, 1e5);
    else {
      fraisSim.annees = Math.round(nombre(1, 50));
      // curseur et champ numérique restent synchronisés (sans réécrire le champ en cours de saisie)
      for (const el of racine.querySelectorAll('[data-fs="annees"], [data-fs="annees-nb"]')) if (el !== e.target) el.value = fraisSim.annees;
      racine.querySelector("#fs-annees-txt").textContent = fraisSim.annees;
    }
    racine.querySelector("#fs-resultat").innerHTML = resultatFrais(valeursFraisSim());
  });
  $("#fiches").addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-fs-reset]")) return;
    fraisSim.capital = fraisSim.mensuel = fraisSim.annees = null;
    rendreFiches();
  });
}
