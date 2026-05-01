"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  useProjectsWorkspace,
  type Project,
  type ProjectSort
} from "@/components/projects/projects-workspace-context";

export function useProjectsFilterShelf(projects: Project[]) {
  const {
    activeSearch,
    setActiveSearch,
    filterClientId,
    setFilterClientId,
    projectSort,
    setProjectSort,
    refreshProjects,
    getProjectClientLabel
  } = useProjectsWorkspace();

  const [searchValue, setSearchValue] = useState(activeSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(activeSearch);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasMountedQueryEffectRef = useRef(false);

  const trimmedSearchValue = debouncedSearch.trim();
  const effectiveSearch = trimmedSearchValue.length >= 2 ? trimmedSearchValue : "";

  useEffect(() => {
    setSearchValue(activeSearch);
    setDebouncedSearch(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchValue]);

  useEffect(() => {
    if (!hasMountedQueryEffectRef.current) {
      hasMountedQueryEffectRef.current = true;
      return;
    }

    setActiveSearch(effectiveSearch);
    void refreshProjects({
      clientId: filterClientId,
      search: effectiveSearch,
      sort: projectSort
    });
  }, [effectiveSearch, filterClientId, projectSort, refreshProjects, setActiveSearch]);

  const derivedClientOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const project of projects) {
      const cid = project.client_id?.trim();
      if (!cid) continue;
      if (!byId.has(cid)) {
        byId.set(cid, { id: cid, label: getProjectClientLabel(project) });
      }
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [projects, getProjectClientLabel]);

  const derivedClientIds = useMemo(
    () => new Set(derivedClientOptions.map((option) => option.id)),
    [derivedClientOptions]
  );

  const clientFilterDisabled = Boolean(filterClientId && !derivedClientIds.has(filterClientId));

  function handleCommandRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setSearchValue("");
      searchInputRef.current?.blur();
    }
  }

  return {
    searchValue,
    setSearchValue,
    effectiveSearch,
    searchInputRef,
    derivedClientOptions,
    clientFilterDisabled,
    filterClientId,
    setFilterClientId,
    projectSort,
    setProjectSort: setProjectSort as (sort: ProjectSort) => void,
    handleCommandRowKeyDown
  };
}
