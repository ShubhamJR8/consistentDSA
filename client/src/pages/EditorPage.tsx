import Editor from '@monaco-editor/react';
import { ArrowLeft, CheckCircle2, Play, Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { buttonClasses } from '../components/buttonClasses';
import { ErrorState, LoadingState } from '../components/PageState';
import { SUPPORTED_LANGUAGES } from '../config/languages';
import { useToday } from '../hooks/useCommitments';
import { useJudgeProblem, useRunCode, useSubmitCode } from '../hooks/useSubmission';
import { cn } from '../utils/cn';
import type { Difficulty } from '../types/commitment';
import type { RunResult, SubmitResult } from '../types/submission';

const DIFFICULTY_DOT: Record<Difficulty, string> = {
  Easy: 'bg-protected',
  Medium: 'bg-warning',
  Hard: 'bg-risk',
};

const STATUS_LABEL: Record<SubmitResult['status'], string> = {
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong Answer',
  COMPILE_ERROR: 'Compile Error',
  RUNTIME_ERROR: 'Runtime Error',
  TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
  JUDGE_ERROR: 'Judge Error',
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded-lg border border-border-muted bg-surface-300 px-3 py-2 font-mono text-xs text-zinc-200">
      {children}
    </pre>
  );
}

function RunResultsPanel({ result }: { result: RunResult }) {
  return (
    <div className="space-y-3">
      <p
        className={cn(
          'flex items-center gap-1.5 text-sm font-medium',
          result.allPassed ? 'text-protected' : 'text-risk'
        )}
      >
        {result.allPassed ? (
          <CheckCircle2 className="h-4 w-4" aria-hidden />
        ) : (
          <XCircle className="h-4 w-4" aria-hidden />
        )}
        {result.allPassed ? 'All sample tests passed' : 'Some sample tests failed'}
      </p>
      {result.results.map((test) => (
        <div
          key={test.index}
          className={cn(
            'rounded-xl border px-3 py-3 text-sm',
            test.passed ? 'border-protected/30 bg-protected/5' : 'border-risk/30 bg-risk/5'
          )}
        >
          <p className={cn('font-medium', test.passed ? 'text-protected' : 'text-risk')}>
            Sample {test.index + 1} · {test.passed ? 'Passed' : 'Failed'}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Input
              </span>
              <CodeBlock>{test.input}</CodeBlock>
            </div>
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Expected
              </span>
              <CodeBlock>{test.expectedOutput}</CodeBlock>
            </div>
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Your output
              </span>
              <CodeBlock>{test.actualOutput || '(empty)'}</CodeBlock>
            </div>
            {test.stderr && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  Stderr
                </span>
                <CodeBlock>{test.stderr}</CodeBlock>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubmitResultsPanel({ result }: { result: SubmitResult }) {
  const accepted = result.status === 'ACCEPTED';
  return (
    <div className="space-y-3">
      <div
        className={cn(
          'rounded-xl border px-4 py-3',
          accepted ? 'border-protected/40 bg-protected/10' : 'border-risk/40 bg-risk/10'
        )}
      >
        <p
          className={cn(
            'flex items-center gap-1.5 font-medium',
            accepted ? 'text-protected' : 'text-risk'
          )}
        >
          {accepted ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden />
          )}
          {STATUS_LABEL[result.status]}
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          {result.passedCount} / {result.totalCount} tests passed
          {accepted && ' · marked complete for today'}
        </p>
      </div>
      {result.results.map((test) => (
        <div
          key={test.index}
          className={cn(
            'rounded-xl border px-3 py-3 text-sm',
            test.passed ? 'border-protected/30 bg-protected/5' : 'border-risk/30 bg-risk/5'
          )}
        >
          <p className={cn('font-medium', test.passed ? 'text-protected' : 'text-risk')}>
            {test.isSample ? `Sample ${test.index + 1}` : `Hidden test ${test.index + 1}`} ·{' '}
            {test.passed ? 'Passed' : 'Failed'}
          </p>
          {test.isSample && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  Input
                </span>
                <CodeBlock>{test.input ?? ''}</CodeBlock>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  Expected
                </span>
                <CodeBlock>{test.expectedOutput ?? ''}</CodeBlock>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  Your output
                </span>
                <CodeBlock>{test.actualOutput || '(empty)'}</CodeBlock>
              </div>
            </div>
          )}
          {!test.isSample && !test.passed && (
            <p className="mt-1 text-xs text-zinc-500">
              Hidden test details aren&apos;t shown — only whether it passed.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function EditorPage() {
  const { id = '', problemId = '' } = useParams();
  const todayQuery = useToday(id);
  const judgeQuery = useJudgeProblem(problemId);
  const runCode = useRunCode(id, problemId);
  const submitCode = useSubmitCode(id, problemId);

  const [language, setLanguage] = useState(SUPPORTED_LANGUAGES[0].id);
  const [codeByLanguage, setCodeByLanguage] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<
    { kind: 'run'; data: RunResult } | { kind: 'submit'; data: SubmitResult } | null
  >(null);

  // Seed each language's editor with its starter code the first time it's selected, so switching
  // languages doesn't clobber anything the user already typed.
  useEffect(() => {
    if (!judgeQuery.data || codeByLanguage[language] !== undefined) return;
    const starter = judgeQuery.data.starterCode.find((s) => s.language === language)?.code ?? '';
    setCodeByLanguage((prev) => ({ ...prev, [language]: starter }));
  }, [judgeQuery.data, language, codeByLanguage]);

  if (todayQuery.isPending || judgeQuery.isPending) return <LoadingState />;

  if (judgeQuery.isError || !judgeQuery.data) {
    return (
      <ErrorState
        title="This problem doesn't have an in-editor judge"
        description={judgeQuery.error?.message}
        action={
          <Link to={`/commitment/${id}/today`} className={buttonClasses({ variant: 'secondary' })}>
            Back to today
          </Link>
        }
      />
    );
  }

  if (todayQuery.isError || !todayQuery.data) {
    return (
      <ErrorState
        title="We couldn't load today's commitment"
        description={todayQuery.error?.message}
        action={
          <Link to="/dashboard" className={buttonClasses({ variant: 'secondary' })}>
            Back to dashboard
          </Link>
        }
      />
    );
  }

  const problem = judgeQuery.data;
  const { today } = todayQuery.data;
  const assigned = today?.problems.find((p) => p.id === problemId);

  if (!today || !assigned) {
    return (
      <ErrorState
        title="This problem isn't part of today's commitment"
        action={
          <Link to={`/commitment/${id}/today`} className={buttonClasses({ variant: 'secondary' })}>
            Back to today
          </Link>
        }
      />
    );
  }

  const dayLocked = today.status !== 'PENDING';
  const code = codeByLanguage[language] ?? '';
  const busy = runCode.isPending || submitCode.isPending;
  const error = runCode.error ?? submitCode.error;

  const handleRun = () => {
    setLastResult(null);
    runCode.mutate(
      { language, code },
      { onSuccess: (data) => setLastResult({ kind: 'run', data }) }
    );
  };

  const handleSubmit = () => {
    setLastResult(null);
    submitCode.mutate(
      { language, code },
      { onSuccess: (data) => setLastResult({ kind: 'submit', data }) }
    );
  };

  return (
    <div>
      <Link
        to={`/commitment/${id}/today`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Today
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* Problem statement */}
        <div className="rounded-2xl border border-border-muted bg-surface-200 p-5">
          <div className="flex items-center gap-2">
            <span
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DIFFICULTY_DOT[problem.difficulty])}
            />
            <span className="text-sm text-zinc-400">
              {problem.difficulty} · {problem.topic}
            </span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">{problem.title}</h1>
          {assigned.completed && (
            <p className="mt-2 inline-flex items-center gap-1 text-sm text-protected">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Solved today
            </p>
          )}

          <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-300">{problem.statement}</p>

          {problem.constraints.length > 0 && (
            <div className="mt-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Constraints
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-zinc-400">
                {problem.constraints.map((c) => (
                  <li key={c} className="font-mono text-xs">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {problem.examples.map((example, index) => (
            <div key={index} className="mt-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Example {index + 1}
              </h2>
              <CodeBlock>{`Input: ${example.input}\nOutput: ${example.output}`}</CodeBlock>
              {example.explanation && (
                <p className="mt-1 text-xs text-zinc-500">{example.explanation}</p>
              )}
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="rounded-2xl border border-border-muted bg-surface-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="rounded-lg border border-border-muted bg-surface-100 px-3 py-2 text-sm text-white"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={handleRun}
                disabled={busy}
                loading={runCode.isPending}
              >
                <Play className="h-4 w-4" aria-hidden /> Run
              </Button>
              <Button onClick={handleSubmit} disabled={busy || dayLocked} loading={submitCode.isPending}>
                <Send className="h-4 w-4" aria-hidden /> Submit
              </Button>
            </div>
          </div>

          {dayLocked && (
            <p className="mt-2 text-xs text-zinc-500">
              Today&apos;s commitment is already complete — you can still run your code, but
              submissions won&apos;t change anything.
            </p>
          )}

          <div className="mt-4 overflow-hidden rounded-xl border border-border-muted">
            <Editor
              height="380px"
              theme="vs-dark"
              language={SUPPORTED_LANGUAGES.find((l) => l.id === language)?.monacoId}
              value={code}
              onChange={(value) =>
                setCodeByLanguage((prev) => ({ ...prev, [language]: value ?? '' }))
              }
              options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true }}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-risk/40 bg-risk/10 px-3 py-2 text-sm text-risk"
            >
              {error.message}
            </p>
          )}

          {lastResult && (
            <div className="mt-4">
              {lastResult.kind === 'run' ? (
                <RunResultsPanel result={lastResult.data} />
              ) : (
                <SubmitResultsPanel result={lastResult.data} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
