/** Realistic people for the whole platform (Microsoft Rocketbox, MIT): see registry.ts for the cast. */
export * from "./registry";
export * from "./controller";
export { characterEnvironment, instantiate, loadCharacter, loadClips, loadModel, prefetchCharacters, treatMaterials } from "./loader";
export { RealPerson, type PersonReadyInfo, type RealPersonProps } from "./RealPerson";
export { CharacterLights } from "./lighting";
export { createRealisticPeopleSource, type CastModel, type OfficePersonProps } from "./peopleSource";
export * from "./gait";
export * from "./blend";
