// Mirrors server/src/config/languages.ts — kept in sync manually since it's a small, static list.
export interface SupportedLanguage {
  id: string;
  label: string;
  /** Monaco's built-in language id for syntax highlighting. */
  monacoId: string;
}

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { id: 'javascript', label: 'JavaScript (Node.js 18)', monacoId: 'javascript' },
  { id: 'python', label: 'Python 3', monacoId: 'python' },
  { id: 'java', label: 'Java', monacoId: 'java' },
  { id: 'cpp', label: 'C++ (GCC 9)', monacoId: 'cpp' },
];
