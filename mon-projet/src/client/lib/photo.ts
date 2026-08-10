/** Compresse une image (max 1600 px, JPEG qualité 0.82) et renvoie le
 *  base64 sans en-tête — le format attendu par ajouterPhoto. */
export function compresserPhoto(fichier: File, maxPx = 1600, qualite = 0.82): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(fichier);
		img.onload = () => {
			let w = img.width, h = img.height;
			if (Math.max(w, h) > maxPx) {
				const k = maxPx / Math.max(w, h);
				w = Math.round(w * k);
				h = Math.round(h * k);
			}
			const cv = document.createElement('canvas');
			cv.width = w;
			cv.height = h;
			cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
			URL.revokeObjectURL(url);
			resolve(cv.toDataURL('image/jpeg', qualite).split(',')[1]);
		};
		img.onerror = reject;
		img.src = url;
	});
}

/** Fichier (PDF…) vers base64 sans en-tête, sans compression. */
export function fichierVersBase64(fichier: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result).split(',')[1]);
		r.onerror = () => reject(r.error);
		r.readAsDataURL(fichier);
	});
}

/** URL de miniature Drive à partir d'une URL de fichier Drive. */
export function miniatureDrive(url: string): string {
	const m = url.match(/[-\w]{25,}/);
	return m ? `https://drive.google.com/thumbnail?id=${m[0]}&sz=w200` : '';
}
