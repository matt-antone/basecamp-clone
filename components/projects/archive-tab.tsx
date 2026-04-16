"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { authedJsonFetch } from "@/lib/browser-auth";
import { buildArchiveProjectsUrl } from "@/lib/archive-projects-url";
import { OneShotButton } from "@/components/one-shot-button";
import { useProjectsWorkspace } from "@/components/projects/projects-workspace-context";
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
  onOpenCreateDialog: () => void;
};

export function ArchiveTab({ accessToken, onToken, onRestore, onOpenCreateDialog }: Props) {
  const { clients } = useProjectsWorkspace();
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);
  const [filterClientId, setFilterClientId] = useState<string | null>(null);

  const clientOptions = useMemo(
    () =>
      [...clients]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          id: c.id,
          label: c.archived_at ? `${c.name} (Archived)` : c.name
        })),
    [clients]
  );
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

    authedJsonFetch({
      accessToken,
      onToken,
      path: buildArchiveProjectsUrl({ search: debouncedSearch, page, clientId: filterClientId })
    })
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
  }, [debouncedSearch, page, accessToken, filterClientId, refreshKey]);

  async function handleRestore(project: ArchiveProjectItem) {
    await onRestore(project);
    setRefreshKey((k) => k + 1);
  }

  const projects = result?.projects ?? [];
  const totalPages = result?.totalPages ?? 1;
  const total = result?.total ?? 0;

  return (
    <div className="archiveTabRoot">
      <div className="projectsHeader">
        <h1>Archive</h1>
        <OneShotButton type="button" className="projectPrimaryButton" onClick={onOpenCreateDialog}>
          New project
        </OneShotButton>
      </div>
      <section className="projectsFilterShelf">
        <div className="projectsFilterControls">
          <div className="projectsFilterToolbar">
            <label className="projectsFilterField projectsClientFilterField">
              <span className="projectsFilterLabel">Client</span>
              <select
                className="projectsClientSelect"
                value={filterClientId ?? ""}
                onChange={(e) => {
                  setFilterClientId(e.target.value || null);
                  setPage(1);
                }}
                aria-label="Filter archived projects by client"
              >
                <option value="">All clients</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="projectsFilterField projectsSearchShell">
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
