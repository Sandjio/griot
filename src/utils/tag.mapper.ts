/**
 * Maps user-friendly genre/theme names to Qloo URNs.
 */

const GENRE_TAG_MAP: Record<string, string> = {
  action: "urn:tag:genre:media:action",
  adventure: "urn:tag:genre:media:adventure",
  comedy: "urn:tag:genre:media:comedy",
  drama: "urn:tag:genre:media:drama",
  romance: "urn:tag:genre:media:romance",
  horror: "urn:tag:genre:media:horror",
  fantasy: "urn:tag:genre:media:fantasy",
  sci_fi: "urn:tag:genre:media:science_fiction",
  "sci-fi": "urn:tag:genre:media:science_fiction",
  supernatural: "urn:tag:genre:media:supernatural",
  thriller: "urn:tag:genre:media:thriller",
  slice_of_life: "urn:tag:genre:media:slice_of_life",
  "slice of life": "urn:tag:genre:media:slice_of_life",
  mystery: "urn:tag:genre:media:mystery",
  // Theme mappings (can also be used as tags)
  revenge: "urn:tag:theme:media:revenge",
  redemption: "urn:tag:theme:media:redemption",
  friendship: "urn:tag:theme:media:friendship",
  love: "urn:tag:theme:media:love",
  betrayal: "urn:tag:theme:media:betrayal",
  // Add more as needed...
};

export const resolveGenreTags = (tags: string[]): string[] => {
  return tags
    .map((t) => GENRE_TAG_MAP[t.toLowerCase().replace(/[\s\-]/g, "_")])
    .filter((t): t is string => !!t);
};
