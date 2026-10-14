import type messages from "../../../messages/si.json";

export type Area = keyof (typeof messages)["areas"];

/** A menu entry's label key under "nav" in messages/si.json. */
export type NavKey = Exclude<keyof (typeof messages)["nav"], "label" | "waiting">;

/**
 * A number in the header or menu (NTF-1): the count, when the server read it (milliseconds), and the
 * address that reads it again. The layout that holds it isn't rendered again on a client-side move,
 * so the screen reads it again after every move and shows the newer reading.
 */
export type LiveCount = { count: number; at: number; source: string };

export type NavEntry = {
  href: string;
  labelKey: NavKey;
  /** Highlight only on this exact path, not on pages below it. */
  exact?: boolean;
  /** Other paths that belong to this entry, such as the second tab of one screen. */
  alsoActive?: string[];
  /** How many cases wait there (NTF-1); a badge shows when it is more than 0. */
  count?: LiveCount;
};
