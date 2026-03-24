type LoadingStateProps = {
  label: string;
  message?: string;
};

export function PageLoadingState({ label, message }: LoadingStateProps) {
  return (
    <main className="page loadingStatePage">
      <div className="loadingState" role="status" aria-live="polite" aria-label={label}>
        <span className="loadingStateSpinner" aria-hidden="true" />
        <div className="loadingStateCopy">
          <p className="loadingStateLabel">{label}</p>
          {message ? <p className="loadingStateMessage">{message}</p> : null}
        </div>
      </div>
    </main>
  );
}

export function InlineLoadingState({ label, message }: LoadingStateProps) {
  return (
    <div className="inlineLoadingState" role="status" aria-live="polite" aria-label={label}>
      <span className="loadingStateSpinner inlineLoadingStateSpinner" aria-hidden="true" />
      <div className="loadingStateCopy">
        <p className="loadingStateLabel">{label}</p>
        {message ? <p className="loadingStateMessage">{message}</p> : null}
      </div>
    </div>
  );
}
