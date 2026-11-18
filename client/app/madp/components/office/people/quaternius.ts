/** The default people: the CC0 Quaternius set (manifest.ts), plain quantized glTF, so no WebAssembly decoder is needed
 *  under the app's CSP. Loaded once per session, cloned per agent (loader.ts), animated by Person.tsx. */

import { castFor, castInUse } from "./casting";
import { loadPerson } from "./loader";
import type { PersonModel } from "./manifest";
import { Person } from "./Person";
import { type PeopleSource, registerDefaultPeople } from "./source";

export const QUATERNIUS_PEOPLE: PeopleSource<PersonModel> = {
  name: "quaternius",
  castFor: (role, index) => castFor(role, index),
  prefetch(agents) {
    for (const m of castInUse(agents)) void loadPerson(m).catch(() => undefined);
  },
  Person,
};

registerDefaultPeople(QUATERNIUS_PEOPLE);
