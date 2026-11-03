// Diffusore a pressione in cima al canale (SPEC §3): canale meno DIFFUSER_CLEARANCE,
// estruso di DIFFUSER_T e appoggiato a filo del bordo superiore.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { totalHeight, type Params } from '../config';

const ROUND_SEGMENTS = 32;

export function diffuserSection(
  channel: CrossSection,
  clearance: number,
): CrossSection {
  if (!(clearance > 0)) return channel;
  return channel.offset(-clearance, 'Round', 2, ROUND_SEGMENTS);
}

/** Solido del diffusore. Non libera `channel`. */
export function buildDiffuser(
  wasm: ManifoldToplevel,
  channel: CrossSection,
  p: Pick<Params, 'DIFFUSER_T' | 'DIFFUSER_CLEARANCE' | 'FLOOR' | 'CHANNEL_DEPTH'>,
): Manifold {
  const { Manifold } = wasm;
  const section = diffuserSection(channel, p.DIFFUSER_CLEARANCE);
  const thickness = Math.max(p.DIFFUSER_T, 0);
  const solid = section.extrude(Math.max(thickness, 0.01)).translate([0, 0, totalHeight(p) - thickness]);
  if (section !== channel) section.delete();
  if (thickness <= 0) {
    const empty = Manifold.cube([0, 0, 0]);
    solid.delete();
    return empty;
  }
  return solid;
}
