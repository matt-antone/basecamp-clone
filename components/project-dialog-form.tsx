"use client";

import { OneShotButton } from "@/components/one-shot-button";

type ProjectDialogClient = {
  id: string;
  name: string;
  code: string;
};

export type ProjectDialogValues = {
  name: string;
  description: string;
  deadline: string;
  requestor: string;
  tags: string;
  clientId: string;
  /** PM note; only shown on project detail edit, not create dialog. */
  pm_note: string;
};

type ProjectDialogMember = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

type ProjectDialogActiveUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

type ProjectDialogFormProps = {
  title: string;
  submitLabel: string;
  values: ProjectDialogValues;
  clients: ProjectDialogClient[];
  submitting?: boolean;
  clientDisabled?: boolean;
  /** When true, show PM note (detail edit only). */
  showPmNote?: boolean;
  members?: ProjectDialogMember[];
  activeUsers?: ProjectDialogActiveUser[];
  onAddMember?: (userId: string) => void;
  onRemoveMember?: (userId: string) => void;
  onChange: (values: ProjectDialogValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function ProjectDialogForm({
  title,
  submitLabel,
  values,
  clients,
  submitting = false,
  clientDisabled = false,
  showPmNote = false,
  members,
  activeUsers,
  onAddMember,
  onRemoveMember,
  onChange,
  onSubmit,
  onCancel
}: ProjectDialogFormProps) {
  function updateField<K extends keyof ProjectDialogValues>(field: K, value: ProjectDialogValues[K]) {
    onChange({
      ...values,
      [field]: value
    });
  }

  const canSubmit = values.name.trim().length > 0 && values.clientId.length > 0 && !submitting;
  const showMembers = Boolean(members && activeUsers && onAddMember && onRemoveMember);

  return (
    <form method="dialog" className="dialogForm">
      <h3>{title}</h3>
      <div className="form">
        <label className="dialogField">
          <span>Name</span>
          <input
            value={values.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Project name"
          />
        </label>
        <label className="dialogField">
          <span>Description</span>
          <input
            value={values.description}
            onChange={(event) => updateField("description", event.target.value)}
            placeholder="Description"
          />
        </label>
        <label className="dialogField">
          <span>Deadline</span>
          <input
            type="date"
            value={values.deadline}
            onChange={(event) => updateField("deadline", event.target.value)}
          />
        </label>
        <label className="dialogField">
          <span>Requester</span>
          <input
            value={values.requestor}
            onChange={(event) => updateField("requestor", event.target.value)}
            placeholder="Who requested this work?"
          />
        </label>
        <label className="dialogField">
          <span>Tags</span>
          <input
            value={values.tags}
            onChange={(event) => updateField("tags", event.target.value)}
            placeholder="Tags (comma separated)"
          />
        </label>
        {showPmNote ? (
          <label className="dialogField">
            <span>PM note</span>
            <textarea
              value={values.pm_note}
              maxLength={256}
              rows={3}
              onChange={(event) => updateField("pm_note", event.target.value)}
              placeholder="Short note for the team (shown on list and board)"
            />
            <span className="dialogFieldHint">{(values.pm_note ?? "").length}/256</span>
          </label>
        ) : null}
        <label className="dialogField">
          <span>Client</span>
          <select
            value={values.clientId}
            onChange={(event) => updateField("clientId", event.target.value)}
            disabled={clientDisabled}
          >
            <option value="">Select client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} - {client.name}
              </option>
            ))}
          </select>
        </label>
        {clientDisabled ? <p className="dialogFieldHint">Client stays fixed after a project is created.</p> : null}
        {showMembers ? (
          <fieldset className="dialogField">
            <legend>Members</legend>
            <ul className="memberList">
              {members!.map((m) => (
                <li key={m.user_id} className="memberListItem">
                  <span>{m.email}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${m.email}`}
                    disabled={members!.length <= 1}
                    onClick={() => onRemoveMember!(m.user_id)}
                  >×</button>
                </li>
              ))}
            </ul>
            <select
              aria-label="Add member"
              value=""
              onChange={(event) => {
                const next = event.target.value;
                if (next) {
                  onAddMember!(next);
                  event.target.value = "";
                }
              }}
            >
              <option value="">Add a member…</option>
              {activeUsers!
                .filter((u) => !members!.some((m) => m.user_id === u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
            </select>
          </fieldset>
        ) : null}
      </div>
      <div className="row">
        <OneShotButton type="button" onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? "Saving..." : submitLabel}
        </OneShotButton>
        <OneShotButton type="button" className="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </OneShotButton>
      </div>
    </form>
  );
}
