"use client";

export type ProjectDialogClient = {
  id: string;
  name: string;
  code: string;
};

export type ProjectDialogValues = {
  name: string;
  description: string;
  requestor: string;
  tags: string;
  clientId: string;
};

type ProjectDialogFormProps = {
  title: string;
  submitLabel: string;
  values: ProjectDialogValues;
  clients: ProjectDialogClient[];
  submitting?: boolean;
  clientDisabled?: boolean;
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
      </div>
      <div className="row">
        <button type="button" onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? "Saving..." : submitLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
