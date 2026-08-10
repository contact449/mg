/* ============================ HABILITATIONS ============================ */

// Deux niveaux : ADMIN (crée demandes et bons, gère les habilitations),
// AGENT (reclasse, preuve, reçoit ses bons, photographie sur place).
// L'accès anonyme n'existe plus : toute consultation exige une identité
// (compte Google habilité, ou personne + code déclarés dans l'app).

// Mémo par exécution : une exécution google.script.run = une seule identité.
// Le point d'entrée (gardé) calcule le rôle avec l'ident reçu ; les appels
// internes qui suivent (sans ident) réutilisent ce résultat.
// ponytail: les helpers restent des fonctions globales appelables via
// google.script.run — le verrou porte sur les points d'entrée de l'UI.
var _memoRole = null;

// Rôle effectif — identité = session Google si détectée, sinon identité
// déclarée { email, code } saisie dans l'app (porte le rôle complet).
function _role(ident) {
	if (!_memoRole) _memoRole = _calculerRole(ident);
	return _memoRole;
}

function _calculerRole(ident) {
	const emailSession = _agent();
	if (emailSession && emailSession !== 'inconnu') {
		const l = _ligneHabilitation(emailSession);
		if (l) return { email: l.email, role: l.role, nom: l.nom, declare: false };
		return { email: emailSession, role: 'Lecture', declare: false };
	}
	if (ident && ident.email && ident.code) {
		const l = _ligneHabilitation(ident.email);
		if (l && l.code && String(ident.code).trim() === l.code) {
			return { email: l.email, role: l.role, nom: l.nom, declare: true };
		}
	}
	return { email: '', role: 'Lecture', declare: false };
}

/** Ligne d'habilitation d'un email (null si absent). */
function _ligneHabilitation(email) {
	const f = _classeur().getSheetByName(NOM_FEUILLE_HABILITATIONS);
	if (!f || f.getLastRow() < 2) return null;
	email = String(email).trim().toLowerCase();
	const v = f.getRange(2, 1, f.getLastRow() - 1, ENTETES_HABILITATIONS.length).getDisplayValues();
	for (const l of v) {
		if (String(l[0]).trim().toLowerCase() === email) {
			return {
				email: email, nom: String(l[1]),
				role: ROLES.indexOf(String(l[2])) >= 0 ? String(l[2]) : 'Agent',
				code: String(l[5] || '').trim()
			};
		}
	}
	return null;
}

function _exiger(roles, ident) {
	const p = _role(ident || null);
	if (roles.indexOf(p.role) < 0) {
		throw new Error('Action non autorisée — votre compte (' + (p.email || 'non connecté') +
			') n\'est pas habilité. Demandez l\'accès à un administrateur.');
	}
	return p;
}

/** Libellé d'agent pour l'historique (undefined -> _journaliser retombe sur la session). */
function _nomAgent(ident) {
	const p = _role(ident || null);
	if (!p.email) return undefined;
	return p.declare ? (p.nom || p.email) + ' (déclaré)' : p.email;
}

/** Profil de l'utilisateur courant (pour adapter l'interface). */
function getProfil(ident) {
	const p = _role(ident || null);
	return {
		email: p.email, nom: p.nom || '', role: p.role,
		connecte: !!p.email, declare: !!p.declare,
		peutModifier: p.role === 'Admin' || p.role === 'Agent',
		estAdmin: p.role === 'Admin'
	};
}

/** Un seul aller-retour au chargement : profil + écran Suivi (liste + stats).
 *  Sans identité valable, aucune donnée ne part : l'app affiche le login. */
function getBootstrap(ident) {
	const profil = getProfil(ident);
	return { profil: profil, suivi: profil.peutModifier ? getSuivi('Tous') : null };
}

/** Identification par personne + code (aucun compte Google requis). */
function identifier(email, code) {
	const p = _role({ email: email, code: code });
	if (!p.declare) {
		Utilities.sleep(800); // freine les essais de codes
		throw new Error('Identification refusée — vérifie la personne choisie et le code.');
	}
	return getProfil({ email: email, code: code });
}

/** Liste publique pour l'écran d'identification (jamais les codes). */
function listerPersonnes() {
	const f = _classeur().getSheetByName(NOM_FEUILLE_HABILITATIONS);
	if (!f || f.getLastRow() < 2) return [];
	return f.getRange(2, 1, f.getLastRow() - 1, ENTETES_HABILITATIONS.length).getDisplayValues()
		.map(l => ({
			email: String(l[0]).trim().toLowerCase(),
			nom: String(l[1]) || String(l[0]),
			role: String(l[2]),
			aCode: !!String(l[5] || '').trim()
		}));
}

function listerHabilitations(ident) {
	_exiger(['Admin'], ident);
	const f = _feuille(NOM_FEUILLE_HABILITATIONS);
	const n = f.getLastRow() - 1;
	if (n < 1) return [];
	return f.getRange(2, 1, n, ENTETES_HABILITATIONS.length).getDisplayValues()
		.map(l => ({ email: l[0], nom: l[1], role: l[2], ajouteLe: l[3], ajoutePar: l[4], aCode: !!String(l[5] || '').trim() }));
}

function ajouterHabilitation(email, nom, role, code, ident) {
	const admin = _exiger(['Admin'], ident);
	email = String(email || '').trim().toLowerCase();
	if (!email || email.indexOf('@') < 0) throw new Error('Email invalide');
	if (ROLES.indexOf(role) < 0) role = 'Agent';
	const f = _feuille(NOM_FEUILLE_HABILITATIONS);
	if (f.getLastRow() > 1) {
		const v = f.getRange(2, 1, f.getLastRow() - 1, 1).getValues();
		for (const l of v) {
			if (String(l[0]).trim().toLowerCase() === email) throw new Error('Cet email est déjà habilité');
		}
	}
	f.appendRow([email, nom || '', role, _maintenant(), admin.email, String(code || '').trim()]);
	return { ok: true };
}

/** Définit / change le code personnel d'une personne (identification hors domaine). */
function definirCode(email, code, ident) {
	_exiger(['Admin'], ident);
	email = String(email || '').trim().toLowerCase();
	code = String(code || '').trim();
	if (code.length < 4) throw new Error('Code trop court — 4 caractères minimum');
	const f = _feuille(NOM_FEUILLE_HABILITATIONS);
	const n = f.getLastRow() - 1;
	if (n < 1) throw new Error('Aucune habilitation');
	const v = f.getRange(2, 1, n, 1).getValues();
	for (let i = 0; i < v.length; i++) {
		if (String(v[i][0]).trim().toLowerCase() === email) {
			f.getRange(i + 2, 6).setValue(code);
			return { ok: true };
		}
	}
	throw new Error('Email introuvable : ' + email);
}

function retirerHabilitation(email, ident) {
	const admin = _exiger(['Admin'], ident);
	email = String(email || '').trim().toLowerCase();
	if (email === admin.email.toLowerCase()) throw new Error('Impossible de retirer votre propre habilitation');
	const f = _feuille(NOM_FEUILLE_HABILITATIONS);
	const n = f.getLastRow() - 1;
	if (n < 1) throw new Error('Aucune habilitation');
	const v = f.getRange(2, 1, n, 1).getValues();
	for (let i = 0; i < v.length; i++) {
		if (String(v[i][0]).trim().toLowerCase() === email) { f.deleteRow(i + 2); return { ok: true }; }
	}
	throw new Error('Email introuvable : ' + email);
}
