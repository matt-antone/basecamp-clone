# JSX Extraction Plan: Board/List, File Panel, Discussion Composer

## Summary
Refactor the three JSX-heavy areas into dedicated, presentational-first React components to improve readability while preserving existing behavior, routes, and data flow. Page files keep network/state logic; extracted components receive typed props and callbacks.

## Implementation Changes
1. Extract board/list rendering from `app/page.tsx` into `components/projects/projects-list-view.tsx` and `components/projects/projects-board-view.tsx`.
2. Extract file panel and create-discussion dialog body from `app/[id]/page.tsx` into `components/projects/project-files-panel.tsx` and `components/discussions/create-discussion-dialog.tsx`.
3. Extract composer UI from `app/[id]/[discussion]/page.tsx` into `components/discussions/discussion-composer.tsx`.
4. Keep state, fetch/upload logic, and orchestration in page files; pass typed props/callbacks only.
5. Preserve current CSS class names to avoid visual regressions.

## Public Interfaces / Types
- Add local component prop interfaces for each extracted component.
- No API route, schema, env var, or payload changes.
- Keep shared helpers/components (`MarkdownEditor`, `ThumbnailPreview`, `OneShotButton`, `formatBytes`, project utils).

## Test Plan
1. Add/update unit tests for callback wiring and render states of extracted components.
2. Run `npm run test -- --reporter=dot`.
3. Run `npm run build`.
4. Manual smoke: project board/list interactions, files upload/download flow, discussion composer with attachment queue.

## Assumptions
- Refactor is behavior-neutral and presentational-first.
- Existing tests remain the primary regression gate.
- No CSS redesign is in scope.
