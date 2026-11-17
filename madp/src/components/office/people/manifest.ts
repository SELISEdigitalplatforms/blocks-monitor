export type PersonFamily = "A" | "B";
export type PersonGender = "male" | "female";

export interface PersonClips {
  idle: string;
  walk: string;
  work: string;
  greet: string;
  sit?: string;
}

export interface PersonModel {
  id: string;
  url: string;
  family: PersonFamily;
  gender: PersonGender;
  outfit: string;
}

/** Animation clip names per rig family (family A rig "CharacterArmature", family B rig "HumanArmature"). */
export const CLIPS: Record<"A" | "B_male" | "B_female", PersonClips> = {
  A: { idle: "Idle", walk: "Walk", work: "Interact", greet: "Wave" },
  B_male: {
    idle: "Man_Idle",
    walk: "Man_Walk",
    work: "Man_Standing",
    greet: "Man_Clapping",
    sit: "Man_Sitting",
  },
  B_female: {
    idle: "Female_Idle",
    walk: "Female_Walk",
    work: "Female_Standing",
    greet: "Female_Clapping",
    sit: "Female_Sitting",
  },
};

export function clipsFor(p: PersonModel): PersonClips {
  if (p.family === "A") return CLIPS.A;
  return p.gender === "male" ? CLIPS.B_male : CLIPS.B_female;
}

const url = (file: string) => `/madp/models/office/people/${file}.glb`;

export const PEOPLE: readonly PersonModel[] = [
  { id: "business_man", url: url("business_man"), family: "A", gender: "male", outfit: "Suit" },
  { id: "casual_character", url: url("casual_character"), family: "A", gender: "male", outfit: "Casual" },
  { id: "hoodie_character", url: url("hoodie_character"), family: "A", gender: "male", outfit: "Hoodie" },
  { id: "punk_a", url: url("punk_a"), family: "A", gender: "male", outfit: "Street style" },
  { id: "punk_b", url: url("punk_b"), family: "A", gender: "female", outfit: "Street style" },
  { id: "animated_woman", url: url("animated_woman"), family: "A", gender: "female", outfit: "Casual" },
  { id: "man_in_suit", url: url("man_in_suit"), family: "B", gender: "male", outfit: "Formal" },
  { id: "woman", url: url("woman"), family: "B", gender: "female", outfit: "Formal" },
  { id: "woman_casual", url: url("woman_casual"), family: "B", gender: "female", outfit: "Casual" },
  { id: "woman_in_dress", url: url("woman_in_dress"), family: "B", gender: "female", outfit: "Dress" },
];
