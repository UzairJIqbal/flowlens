/** The pull request's repository, number and title, as the header shows them. */
export function PreviewCrumbs({
  repoOwner,
  repoName,
  prNumber,
  prTitle,
}: {
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prTitle: string;
}) {
  return (
    <h1 className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 font-mono">
        <span className="text-muted">{repoOwner}/</span>
        {repoName}
        <span className="text-muted">#</span>
        {prNumber}
      </span>
      <span className="truncate text-muted" title={prTitle}>
        {prTitle}
      </span>
    </h1>
  );
}
