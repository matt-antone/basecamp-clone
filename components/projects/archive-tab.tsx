"use client";

import { useEffect, useRef, useState } from "react";
import { authedJsonFetch } from "@/lib/browser-auth";
import { OneShotButton } from "@/components/one-shot-button";
import { ArchiveProjectRow, type ArchiveProjectItem } from "./archive-project-row";

type ArchiveResult = {
  projects: ArchiveProjectItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type Props = {
  accessToken: string | null;
  onToken: (token: string | null) => void;
  onRestore: (project: ArchiveProjectItem) => Promise<void>;
};

export function ArchiveTab({ accessToken, onToken, onRestore }: Props) {
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ArchiveResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchValue);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchValue]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      search: debouncedSearch,
      page: String(page),
      limit: "20"
    });

    authedJsonFetch({ accessToken, onToken, path: `/projects/archived?${params}` })
      .then(({ data }) => {
        if (!cancelled) {
          setResult(data as unknown as ArchiveResult);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load archived projects");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [debouncedSearch, page, accessToken, refreshKey]);

  async function handleRestore(project: ArchiveProjectItem) {
    await onRestore(project);
    setRefreshKey((k) => k + 1);
  }

  const projects = result?.projects ?? [];
  const totalPages = result?.totalPages ?? 1;
  const total = result?.total ?? 0;

  return (
    <div className="archiveTabRoot">
      <section className="projectsFilterShelf">
        <div className="projectsFilterControls">
          <label className="projectsSearchShell">
            <span className="projectsSearchLabel sr-only">Find</span>
            <input
              className="projectsSearchInput"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search archived projects"
              aria-label="Search archived projects"
            />
            <span className="projectsSearchHint">/</span>
          </label>
        </div>
        <div className="projectsResultsMeta">
          {!loading && result && (
            <p className="projectsResultsNote">
              {total} archived project{total === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </section>

      {loading && (
        <div className="archiveLoadingState">
          <p>Loading archived projects…</p>
        </div>
      )}

      {!loading && error && (
        <div className="archiveErrorState">
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <section className="projectsEmptyState">
          <p className="projectsEmptyEyebrow">Archive</p>
          <h2>
            {debouncedSearch
              ? "No archived projects match this search."
              : "No archived projects are parked here yet."}
          </h2>
          {debouncedSearch && (
            <p>Try widening the search.</p>
          )}
        </section>
      )}

      {!loading && !error && projects.length > 0 && (
        <>
          <ul className="archiveProjectList">
            {projects.map((project) => (
              <ArchiveProjectRow
                key={project.id}
                project={project}
                onRestore={handleRestore}
              />
            ))}
          </ul>

          {totalPages > 1 && (
            <nav className="archivePagination" aria-label="Archive pagination">
              <OneShotButton
                type="button"
                className="archivePaginationButton"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                ← Prev
              </OneShotButton>
              <span className="archivePaginationInfo">
                Page {page} of {totalPages}
              </span>
              <OneShotButton
                type="button"
                className="archivePaginationButton"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next →
              </OneShotButton>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
