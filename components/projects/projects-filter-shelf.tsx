"use client";

import type { KeyboardEvent, RefObject } from "react";
import type { ProjectSort } from "@/components/projects/projects-workspace-context";

type Props = {
  searchValue: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  effectiveSearchActive: boolean;
  filterClientId: string | null;
  setFilterClientId: (id: string | null) => void;
  derivedClientOptions: { id: string; label: string }[];
  clientFilterDisabled: boolean;
  projectSort: ProjectSort;
  setProjectSort: (sort: ProjectSort) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  resultCount: number;
  clientCount: number;
};

export function ProjectsFilterShelf(props: Props) {
  return (
    <section className="projectsFilterShelf" onKeyDown={props.onKeyDown}>
      <div className="projectsFilterControls">
        <div className="projectsFilterToolbar">
          <label className="projectsFilterField projectsClientFilterField">
            <span className="projectsFilterLabel">Client</span>
            <select
              className="projectsClientSelect"
              value={props.filterClientId ?? ""}
              onChange={(event) => props.setFilterClientId(event.target.value || null)}
              aria-label="Filter projects by client"
              disabled={props.clientFilterDisabled}
            >
              <option value="">All clients</option>
              {props.derivedClientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </label>
          <label className="projectsFilterField projectsClientFilterField">
            <span className="projectsFilterLabel">Sort</span>
            <select
              className="projectsClientSelect"
              value={props.projectSort}
              onChange={(event) => props.setProjectSort(event.target.value as ProjectSort)}
              aria-label="Sort projects"
              disabled={props.effectiveSearchActive}
            >
              <option value="title">Title A–Z</option>
              <option value="created">Newest First</option>
            </select>
          </label>
          <label className="projectsFilterField projectsSearchShell">
            <span className="projectsSearchLabel sr-only">Find</span>
            <input
              ref={props.searchInputRef}
              className="projectsSearchInput"
              value={props.searchValue}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="Search projects, discussions, or files"
              aria-label="Search projects"
            />
            <span className="projectsSearchHint">/</span>
          </label>
        </div>
      </div>
      <div className="projectsResultsMeta">
        <p className="projectsResultsNote">
          {props.resultCount} showing across {props.clientCount} clients
        </p>
      </div>
    </section>
  );
}
