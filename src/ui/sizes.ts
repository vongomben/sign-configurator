// Taglie dello strumento Misura (SPEC §12.2). L'altezza fa fede; la taglia è solo un'etichetta.

import type { SizePreset } from '../order/schema';

export interface SizeOption {
  id: SizePreset;
  heightMm: number;
}

export const SIZES: readonly SizeOption[] = [
  { id: 'S', heightMm: 80 },
  { id: 'M', heightMm: 120 },
  { id: 'L', heightMm: 180 },
  { id: 'XL', heightMm: 250 },
];

export const DEFAULT_SIZE: SizePreset = 'M';
