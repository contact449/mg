// Combobox (shadcn : Radix Popover + cmdk) au thème iOS — un champ qui
// s'ouvre sur une liste filtrable au clavier, pour les longues listes
// (communes et sections…).
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Combobox({ valeur, options, onChange, placeholder = '— Choisir —', recherche = 'Rechercher…' }: {
	valeur: string;
	options: string[];
	onChange: (v: string) => void;
	placeholder?: string;
	recherche?: string;
}) {
	const [ouvert, setOuvert] = useState(false);
	return (
		<Popover.Root open={ouvert} onOpenChange={setOuvert}>
			<Popover.Trigger asChild>
				<button
					type="button"
					className={cn(
						'flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-left text-sm',
						'transition-colors focus:border-tampon focus:outline-none focus:ring-1 focus:ring-tampon/40',
						valeur ? 'text-neutral-900' : 'text-neutral-400',
					)}
				>
					<span className="truncate">{valeur || placeholder}</span>
					<ChevronsUpDown className="h-4 w-4 shrink-0 text-neutral-400" />
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					sideOffset={6}
					collisionPadding={12}
					className="animation-boite z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-neutral-300 bg-neutral-50 shadow-xl"
				>
					<Command>
						<div className="flex items-center gap-2 border-b border-neutral-200 px-3">
							<Search className="h-4 w-4 shrink-0 text-neutral-400" />
							<Command.Input
								autoFocus
								placeholder={recherche}
								className="h-10 w-full bg-transparent text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
							/>
						</div>
						<Command.List className="max-h-64 overflow-y-auto p-1">
							<Command.Empty className="px-3 py-3 text-center text-sm text-neutral-500">Aucun résultat.</Command.Empty>
							{options.map(o => (
								<Command.Item
									key={o}
									value={o}
									onSelect={() => { onChange(o); setOuvert(false); }}
									className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-neutral-800 data-[selected=true]:bg-neutral-100"
								>
									<span className="truncate">{o}</span>
									{o === valeur && <Check className="h-4 w-4 shrink-0 text-tampon" />}
								</Command.Item>
							))}
						</Command.List>
					</Command>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
