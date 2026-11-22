// Everyone in the seeded factory. All people are invented. Every account signs in with PASSWORD.
// SELISE runs the factory (OPERATOR_DOMAIN); the client companies' staff use their own domains, which the
// allowed-email-domains platform setting lists (seed/build/platform.ts).
import type { PersonDef } from "../model";

export const PASSWORD = "Factory2026";
export const OPERATOR_DOMAIN = "selisegroup.com";

const op = (local: string): string => `${local}@${OPERATOR_DOMAIN}`;

export const PEOPLE: PersonDef[] = [
  // platform
  { key: "daniel", name: "Daniel Ammann", email: op("daniel.ammann"), title: "Platform administrator", superAdmin: true, lastSignIn: "-0d@08:12" },
  { key: "mira", name: "Mira Schoch", email: op("mira.schoch"), title: "Support desk", platformRole: "support-desk", lastSignIn: "-1d@13:40" },

  // SELISE delivery teams
  { key: "sandra", name: "Sandra Keller", email: op("sandra.keller"), title: "Engagement lead", lastSignIn: "-0d@09:05" },
  { key: "luca", name: "Luca Bernasconi", email: op("luca.bernasconi"), title: "Solution architect", lastSignIn: "-0d@08:47" },
  { key: "elena", name: "Elena Frei", email: op("elena.frei"), title: "Business analyst", lastSignIn: "-1d@16:20" },
  { key: "marco", name: "Marco Huber", email: op("marco.huber"), title: "QA and security lead", lastSignIn: "-1d@11:02" },
  { key: "reto", name: "Reto Arnold", email: op("reto.arnold"), title: "Delivery lead", lastSignIn: "-0d@10:31" },
  { key: "simon", name: "Simon Gerber", email: op("simon.gerber"), title: "Software architect", lastSignIn: "-2d@15:55" },
  { key: "anna", name: "Anna Rossi", email: "anna.rossi@studio-rossi.ch", title: "UX designer (freelance)", lastSignIn: "-3d@10:10" },

  // Alpine Fresh AG
  { key: "jonas", name: "Jonas Meier", email: "jonas.meier@alpine-fresh.ch", title: "Head of Operations, Alpine Fresh AG", lastSignIn: "-2d@19:45" },
  { key: "petra", name: "Petra Wyss", email: "petra.wyss@alpine-fresh.ch", title: "Order desk lead, Alpine Fresh AG", lastSignIn: "-1d@07:58" },
  { key: "nicole", name: "Nicole Graf", email: "nicole.graf@alpine-fresh.ch", title: "Order desk, Alpine Fresh AG", noAccount: true },

  // Lindenhof Treuhand AG
  { key: "claudia", name: "Claudia Imhof", email: "claudia.imhof@lindenhof-treuhand.ch", title: "Managing partner, Lindenhof Treuhand AG", lastSignIn: "-4d@17:30" },
  { key: "beat", name: "Beat Zimmermann", email: "beat.zimmermann@lindenhof-treuhand.ch", title: "IT and operations, Lindenhof Treuhand AG", lastSignIn: "-1d@09:15" },

  // Talwerk Fluidsysteme GmbH
  { key: "katrin", name: "Katrin Vogel", email: "katrin.vogel@talwerk-fluid.de", title: "Head of Digital Services, Talwerk", lastSignIn: "-0d@07:40" },
  { key: "stefan", name: "Stefan Brandt", email: "stefan.brandt@talwerk-fluid.de", title: "Lead IT architect, Talwerk", lastSignIn: "-1d@14:12" },
  { key: "aylin", name: "Aylin Demir", email: "aylin.demir@talwerk-fluid.de", title: "Product owner field service, Talwerk", lastSignIn: "-0d@09:58" },
  { key: "jan", name: "Jan Kowalski", email: "jan.kowalski@talwerk-fluid.de", title: "QA and release manager, Talwerk", lastSignIn: "-0d@08:20" },
  { key: "florian", name: "Florian Weber", email: "florian.weber@talwerk-fluid.de", title: "IT security officer, Talwerk", lastSignIn: "-1d@10:44" },
  { key: "martina", name: "Martina Lang", email: "martina.lang@talwerk-fluid.de", title: "Service operations manager, Talwerk", lastSignIn: "-3d@08:05" },
  { key: "oliver", name: "Oliver Schmitt", email: "oliver.schmitt@talwerk-fluid.de", title: "Former field service coordinator, Talwerk", deactivated: { at: "-12d@16:00", by: "daniel" }, lastSignIn: "-14d@11:20" },
  { key: "lena", name: "Lena Hoffmann", email: "lena.hoffmann@talwerk-fluid.de", title: "Digital product manager, Talwerk", noAccount: true },
];

export function person(key: string): PersonDef {
  const p = PEOPLE.find((x) => x.key === key);
  if (!p) throw new Error(`seed: unknown person ${key}`);
  return p;
}
