import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Apps Script ne sert qu'un seul fichier HTML : tout le bundle (JS, CSS)
// est inliné dans dist/index.html par vite-plugin-singlefile.
export default defineConfig({
	root: "src/client",
	plugins: [react(), tailwindcss(), viteSingleFile()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src/client", import.meta.url)),
		},
	},
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
});
