/* ============================ POINT D'ENTRÉE ============================ */

function doGet() {
	// bundle statique (aucun scriptlet) : createHtmlOutputFromFile évite le
	// coût de templating de createTemplateFromFile().evaluate().
	return HtmlService.createHtmlOutputFromFile('Index')
		.setTitle('Archives — Gestion des demandes')
		.addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
		.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
