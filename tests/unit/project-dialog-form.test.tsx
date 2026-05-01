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

  it("renders a checkbox per active user, checked for current members", () => {
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[{ user_id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null }]}
        activeUsers={[
          { id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null },
          { id: "u2", email: "bob@x.com", first_name: "Bob", last_name: null }
        ]}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
      />
    );
    const alex = screen.getByLabelText(/alex/i) as HTMLInputElement;
    const bob = screen.getByLabelText(/bob/i) as HTMLInputElement;
    expect(alex.checked).toBe(true);
    expect(bob.checked).toBe(false);
  });

  it("checking an unchecked box calls onAddMember", () => {
    const onAdd = vi.fn();
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[{ user_id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null }]}
        activeUsers={[
          { id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null },
          { id: "u2", email: "bob@x.com", first_name: "Bob", last_name: null }
        ]}
        onAddMember={onAdd}
        onRemoveMember={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText(/bob/i));
    expect(onAdd).toHaveBeenCalledWith("u2");
  });

  it("unchecking a checked box calls onRemoveMember", () => {
    const onRemove = vi.fn();
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[
          { user_id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null },
          { user_id: "u2", email: "bob@x.com", first_name: "Bob", last_name: null }
        ]}
        activeUsers={[
          { id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null },
          { id: "u2", email: "bob@x.com", first_name: "Bob", last_name: null }
        ]}
        onAddMember={vi.fn()}
        onRemoveMember={onRemove}
      />
    );
    fireEvent.click(screen.getByLabelText(/alex/i));
    expect(onRemove).toHaveBeenCalledWith("u1");
  });

  it("disables the checkbox for the last remaining member", () => {
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[{ user_id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null }]}
        activeUsers={[{ id: "u1", email: "alex@x.com", first_name: "Alex", last_name: null }]}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
      />
    );
    const checkbox = screen.getByLabelText(/alex/i) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("shows fallback when no active users available", () => {
    render(
      <ProjectDialogForm
        {...baseProps}
        members={[]}
        activeUsers={[]}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
      />
    );
    expect(screen.getByText(/No active users available/i)).toBeInTheDocument();
  });
});
