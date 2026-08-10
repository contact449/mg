// Sidebar animée (adaptée d'Aceternity UI) : repliée en rail d'icônes,
// dépliée au survol. Version Vite/React de l'original Next.js — les liens
// sont des boutons du routeur interne (pas de next/link), pas de variante
// mobile : la barre du bas iOS reste la navigation du téléphone.
import { createContext, useContext, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { cn } from '@/lib/utils';

interface SidebarContextProps {
	open: boolean;
	setOpen: Dispatch<SetStateAction<boolean>>;
	animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(undefined);

export const useSidebar = () => {
	const context = useContext(SidebarContext);
	if (!context) throw new Error('useSidebar doit être utilisé dans <Sidebar>');
	return context;
};

export function Sidebar({ children, open: openProp, setOpen: setOpenProp, animate = true }: {
	children: ReactNode;
	open?: boolean;
	setOpen?: Dispatch<SetStateAction<boolean>>;
	animate?: boolean;
}) {
	const [openState, setOpenState] = useState(false);
	const open = openProp !== undefined ? openProp : openState;
	const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;
	return (
		<SidebarContext.Provider value={{ open, setOpen, animate }}>
			{children}
		</SidebarContext.Provider>
	);
}

/** Rail desktop : 64 px replié, 240 px au survol. Masqué sur mobile. */
export function SidebarBody({ className, children }: { className?: string; children: ReactNode }) {
	const { open, setOpen, animate } = useSidebar();
	return (
		<aside
			className={cn(
				'chrome-app hidden shrink-0 flex-col overflow-hidden border-r border-neutral-300/60 px-3 py-4 transition-[width] duration-300 ease-out md:flex',
				className,
			)}
			style={{ width: animate ? (open ? 240 : 64) : 240 }}
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
		>
			{children}
		</aside>
	);
}

/** Sous-lien indenté (ex. tuiles favorites du Suivi) — visible déplié seulement. */
export function SidebarSousLink({ label, onClick }: { label: string; onClick: () => void }) {
	const { open } = useSidebar();
	if (!open) return null;
	return (
		<button
			type="button"
			onClick={onClick}
			className="ml-9 flex w-auto items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800"
		>
			<span className="truncate">{label}</span>
		</button>
	);
}

export function SidebarLink({ actif, icone, label, onClick, className }: {
	actif?: boolean;
	icone: ReactNode;
	label: string;
	onClick: () => void;
	className?: string;
}) {
	const { open, animate } = useSidebar();
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			className={cn(
				'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm font-semibold transition-colors',
				actif ? 'bg-tampon/10 text-tampon' : 'text-neutral-600 hover:bg-neutral-200/60',
				className,
			)}
		>
			<span className="shrink-0">{icone}</span>
			<span
				className="whitespace-pre transition-opacity duration-300"
				style={{ opacity: animate ? (open ? 1 : 0) : 1 }}
			>
				{label}
			</span>
		</button>
	);
}
