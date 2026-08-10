// Segmented control animé (inspiré du toggle Liquid Glass d'Apple, sans le
// verre) : le segment actif glisse d'une option à l'autre — un seul indicateur
// absolu, translaté en CSS (ressort léger via cubic-bezier).
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Segmente<T extends string>({ options, valeur, onChange, rendu, className }: {
	options: readonly T[];
	valeur: T;
	onChange: (v: T) => void;
	rendu?: (o: T) => ReactNode; // libellé personnalisé (défaut : la valeur)
	className?: string;
}) {
	const n = options.length;
	const i = Math.max(0, options.indexOf(valeur));
	return (
		<div className={cn('relative grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-neutral-200 p-0.5', className)}>
			<span
				aria-hidden
				className="absolute inset-y-0.5 left-0.5 rounded bg-neutral-50 shadow-sm dark:bg-neutral-300"
				style={{
					// largeur d'une colonne : padding (4 px) et gaps (2 px chacun) déduits
					width: `calc((100% - ${4 + (n - 1) * 2}px) / ${n})`,
					transform: `translateX(calc(${i * 100}% + ${i * 2}px))`,
					transition: 'transform 350ms cubic-bezier(.3,1.35,.5,1)',
				}}
			/>
			{options.map(o => (
				<button
					key={o}
					type="button"
					onClick={() => onChange(o)}
					className={cn(
						'relative rounded-[8px] px-3 py-2 text-sm font-semibold transition-colors',
						valeur === o ? 'text-neutral-900' : 'text-neutral-600 active:opacity-60',
					)}
				>
					{rendu ? rendu(o) : o}
				</button>
			))}
		</div>
	);
}
