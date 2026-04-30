// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProjectDialogForm } from "@/components/project-dialog-form";

const baseProps = {
  title: "Edit Project",
  submitLabel: "Save",
  values: {
    name: "Test",
    description: "",
    deadline: "",
    requestor: "",
    tags: "",
    clientId: "c1",
    pm_note: ""
  },
  clients: [{ id: "c1", name: "Client", code: "C1" }],
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn()
};

describe("ProjectDialogForm Members section", () => {
  afterEach(() => cleanup());

  it("does not render Members section when member props are absent", () => {
    render(<ProjectDialogForm {...baseProps} />);
    expect(screen.queryByText(/^Members$/)).not.toBeInTheDocument();
  });

  it("renders members and supports remove", () => {
    const onRemove = vi.fn();
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[
          { user_id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null },
          { user_id: "u2", email: "bob@x.com", first_name: "Bob", last_name: null }
        ]}
        activeUsers={[]}
        onAddMember={vi.fn()}
        onRemoveMember={onRemove}
      />
    );
    expect(screen.getByText("alex@x.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove alex@x.com/i }));
    expect(onRemove).toHaveBeenCalledWith("u1");
  });

  it("disables remove when only one member", () => {
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[{ user_id: "u1", email: "alex@x.com", first_name: null, last_name: null }]}
        activeUsers={[]}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /remove alex@x.com/i })).toBeDisabled();
  });

  it("calls onAddMember when picker selection changes", () => {
    const onAdd = vi.fn();
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[{ user_id: "u1", email: "alex@x.com", first_name: null, last_name: null }]}
        activeUsers={[
          { id: "u1", email: "alex@x.com", first_name: null, last_name: null },
          { id: "u2", email: "bob@x.com", first_name: null, last_name: null }
        ]}
        onAddMember={onAdd}
        onRemoveMember={vi.fn()}
      />
    );
    const picker = screen.getByLabelText("Add member") as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "u2" } });
    expect(onAdd).toHaveBeenCalledWith("u2");
  });
});
