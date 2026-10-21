export interface SupportedLanguage {
  /** Our internal id — used in Problem.starterCode[].language and Submission.language. */
  id: string;
  label: string;
  judge0Id: number;
}

// A fixed, small set for the MVP judge. Judge0 supports many more languages; expand here (and
// author starter code per problem for the new one) if that's ever needed.
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { id: 'javascript', label: 'JavaScript (Node.js 18)', judge0Id: 63 },
  { id: 'python', label: 'Python 3', judge0Id: 71 },
  { id: 'java', label: 'Java', judge0Id: 62 },
  { id: 'cpp', label: 'C++ (GCC 9)', judge0Id: 54 },
];

export const isSupportedLanguage = (id: string): boolean =>
  SUPPORTED_LANGUAGES.some((language) => language.id === id);

export const judge0IdFor = (id: string): number => {
  const language = SUPPORTED_LANGUAGES.find((l) => l.id === id);
  if (!language) throw new Error(`Unsupported language: ${id}`);
  return language.judge0Id;
};
