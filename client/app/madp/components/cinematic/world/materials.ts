/** Shared geometry and materials of the office: everything reuses these (few programs, few draw calls). */
import { BoxGeometry, Color, CylinderGeometry, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from "three";

export const box = new BoxGeometry(1, 1, 1);
export const plane = new PlaneGeometry(1, 1);
export const cyl = new CylinderGeometry(1, 1, 1, 32);
export const cylLo = new CylinderGeometry(1, 1, 1, 14);
export const ico = new IcosahedronGeometry(1, 1);
export const sphere = new SphereGeometry(1, 20, 14);
export const cylTaper = new CylinderGeometry(1, 0.78, 1, 28);
/** a blade leaf: a thin, tapering slab (unit height, scaled per leaf) */
export const leafBlade = new CylinderGeometry(0.012, 0.045, 1, 4);

const glow = (hex: string, k: number) => new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(k), toneMapped: false });

export const M = {
  floor: new MeshStandardMaterial({ color: "#d9dce2", roughness: 0.32, metalness: 0.05 }),
  carpet: new MeshStandardMaterial({ color: "#c4c9d3", roughness: 1 }),
  wood: new MeshStandardMaterial({ color: "#c49a6c", roughness: 0.55 }),
  woodDark: new MeshStandardMaterial({ color: "#6b4f3a", roughness: 0.6 }),
  wall: new MeshStandardMaterial({ color: "#f3f4f7", roughness: 0.92 }),
  ceiling: new MeshStandardMaterial({ color: "#f6f7f9", roughness: 1 }),
  white: new MeshStandardMaterial({ color: "#fafbfc", roughness: 0.4 }),
  graphite: new MeshStandardMaterial({ color: "#262a33", roughness: 0.45, metalness: 0.45 }),
  frame: new MeshStandardMaterial({ color: "#3a3f4b", roughness: 0.4, metalness: 0.6 }),
  steel: new MeshStandardMaterial({ color: "#b8bdc7", roughness: 0.3, metalness: 0.8 }),
  fabric: new MeshStandardMaterial({ color: "#d6d9e0", roughness: 1 }),
  fabricBlue: new MeshStandardMaterial({ color: "#2f4fd0", roughness: 0.95 }),
  chair: new MeshStandardMaterial({ color: "#2b2f38", roughness: 0.8 }),
  leaf: new MeshStandardMaterial({ color: "#3f7a4f", roughness: 0.7 }),
  leafLight: new MeshStandardMaterial({ color: "#5f9a68", roughness: 0.7 }),
  trunk: new MeshStandardMaterial({ color: "#6b5340", roughness: 0.9 }),
  planter: new MeshStandardMaterial({ color: "#e9e7e3", roughness: 0.55 }),
  soil: new MeshStandardMaterial({ color: "#2a2420", roughness: 1 }),
  pot: new MeshStandardMaterial({ color: "#e7e2da", roughness: 0.7 }),
  glass: new MeshStandardMaterial({ color: "#dbe7ff", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.14, depthWrite: false }),
  frosted: new MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }),
  sky: new MeshBasicMaterial({ color: new Color("#dfe9f7"), toneMapped: false }),
  light: new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  screenOff: new MeshStandardMaterial({ color: "#14171e", roughness: 0.25, metalness: 0.3 }),
  glowBlue: glow("#5d86ff", 1.6),
  glowViolet: glow("#8d72ff", 1.5),
  glowTeal: glow("#2cc7c0", 1.4),
  glowGreen: glow("#2fd59a", 1.4),
  invisible: new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
};
