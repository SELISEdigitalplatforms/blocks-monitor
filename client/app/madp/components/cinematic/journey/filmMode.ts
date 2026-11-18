/** The promo film's scripted story and its recording mode (?story=, ?rec): never for people using the app. They are
 *  on only in a development build that turns them on (VITE_FACTORY_FILM_MODE=1 in the dev server's env): off by default,
 *  and never on in a hosted (production) build, whatever its env says. Even then the story never creates a project
 *  (JourneyStage's hand-off). */
export interface FilmEnv {
  DEV?: boolean;
  PROD?: boolean;
  VITE_FACTORY_FILM_MODE?: string;
}

export function filmModeEnabled(env: FilmEnv = import.meta.env as FilmEnv): boolean {
  return env.DEV === true && env.PROD !== true && env.VITE_FACTORY_FILM_MODE === "1";
}
