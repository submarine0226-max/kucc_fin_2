import { AuroraVisual, auroraInfo } from './aurora';
import { CymaticsVisual, cymaticsInfo } from './cymatics';
import { GalaxyVisual, galaxyInfo } from './galaxy';
import { GardenVisual, gardenInfo } from './garden';
import { InkVisual, inkInfo } from './ink';
import { MarblingVisual, marblingInfo } from './marbling';
import { OrbitVisual, orbitInfo } from './orbit';
import { TunnelVisual, tunnelInfo } from './tunnel';
import { CatsVisual, catsInfo } from './cats';
import type { Visual, VisualInfo } from './types';

export const VISUALS: { info: VisualInfo; create(): Visual }[] = [
  { info: inkInfo, create: () => new InkVisual() },
  { info: galaxyInfo, create: () => new GalaxyVisual() },
  { info: auroraInfo, create: () => new AuroraVisual() },
  { info: orbitInfo, create: () => new OrbitVisual() },
  { info: catsInfo, create: () => new CatsVisual() },
  { info: cymaticsInfo, create: () => new CymaticsVisual() },
  { info: tunnelInfo, create: () => new TunnelVisual() },
  { info: gardenInfo, create: () => new GardenVisual() },
  { info: marblingInfo, create: () => new MarblingVisual() },
];
