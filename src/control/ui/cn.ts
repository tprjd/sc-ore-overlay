// Class-name combiner used by every control-window primitive: clsx for
// conditional/array class lists, tailwind-merge to dedupe conflicting Tailwind
// utilities (so a caller's `className` reliably overrides a default).

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
