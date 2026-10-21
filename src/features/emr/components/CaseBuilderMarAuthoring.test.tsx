import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CaseBuilderMarAuthoring from "./CaseBuilderMarAuthoring";

const { api } = vi.hoisted(() => ({
  api: {
    getPatientByRoomId: vi.fn(),
    getRoomContext: vi.fn(),
    listOrders: vi.fn(),
    listMarEvents: vi.fn(),
    getMarHistoryRevision: vi.fn(),
    getMarReadiness: vi.fn(),
    saveMarHistory: vi.fn(),
  },
}));

function ScopeSwitcher() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/case-builder/mar?roomId=8")}
    >
      Switch scope
    </button>
  );
}

vi.mock("../lib/api", () => ({ emrApi: api }));
vi.mock("../../../stores/authStore", () => ({
  useAuthStore: () => ({
    profile: {
      id: "author-1",
      role: "school_admin",
      school_id: "school-1",
      full_name: "Author",
    },
  }),
}));

describe("Case Builder MAR authoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    api.getPatientByRoomId.mockResolvedValue({
      id: "patient-1",
      roomId: 7,
      mrn: "MRN-1",
      firstName: "Test",
      lastName: "Patient",
      dateOfBirth: "1980-01-01",
      gender: "Other",
      allergies: [],
    });
    api.getRoomContext.mockResolvedValue({
      data: { hospital_stay_days: 1 },
      error: null,
    });
    api.listOrders.mockResolvedValue([
      {
        id: "med-1",
        patientId: "patient-1",
        roomId: 7,
        assignmentId: null,
        overrideScope: "room",
        category: "Medication",
        orderName: "Example",
        dose: "10 mg",
        route: "PO",
        frequency: "q4h",
        priority: "Routine",
        status: "Active",
        orderedBy: "Author",
        orderTime: "2026-10-20T00:00:00Z",
      },
    ]);
    api.listMarEvents.mockResolvedValue([]);
    api.getMarHistoryRevision.mockResolvedValue(0);
    api.getMarReadiness.mockResolvedValue(true);
  });

  it("keeps Generate MAR Given preview-only and does not write", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    expect(api.saveMarHistory).not.toHaveBeenCalled();
    expect(view.getByText(/Preview generated locally/)).toBeInTheDocument();
    expect(
      view.getByRole("spinbutton", { name: /:scheduled:12 time/i }),
    ).toHaveValue(12);
  });

  it("keeps the authorized list and local hypothetical preview usable when MAR persistence is unavailable", async () => {
    api.getMarReadiness.mockResolvedValue(false);
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    expect(view.getByRole("status")).toHaveTextContent(/Local preview only/);
    expect(
      view.getByRole("button", { name: /Add medication/i }),
    ).toBeDisabled();
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    expect(view.getByText(/Preview generated locally/)).toBeInTheDocument();
    expect(view.getByText(/local hypothetical preview/)).toBeInTheDocument();
    expect(api.saveMarHistory).not.toHaveBeenCalled();
  });

  it("labels a failed history read unavailable instead of treating it as an empty baseline", async () => {
    api.listMarEvents.mockImplementation(async (...args: unknown[]) => {
      (args[4] as ((message: string) => void) | undefined)?.(
        "history unavailable",
      );
      return [];
    });
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    expect(view.getByRole("status")).toHaveTextContent(
      /Saved MAR history is unavailable, not empty/,
    );
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole("button", { name: /Save authored MAR/i }));
    expect(api.saveMarHistory).not.toHaveBeenCalled();
  });

  it("allows authored preview edits and keeps them keyed to the occurrence", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    const dose = view.getByRole("textbox", {
      name: /med-1:scheduled:12 dose/i,
    });
    fireEvent.change(dose, { target: { value: "15 mg" } });
    expect(dose).toHaveValue("15 mg");
    const previewKey = Object.keys(window.localStorage).find((key) =>
      key.endsWith(":preview"),
    );
    expect(
      JSON.parse(window.localStorage.getItem(previewKey ?? "") ?? "{}")
        .events[0],
    ).toMatchObject({
      occurrenceKey: "med-1:scheduled:12",
      orderedDose: "15 mg",
    });
  });

  it("blocks Save and shows the edited-row error for an invalid time", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    fireEvent.change(
      view.getByRole("spinbutton", { name: /med-1:scheduled:12 time/i }),
      { target: { value: "0" } },
    );
    expect(
      view.getByText(/MAR_TIME_MUST_PRECEDE_FIRST_PAGE/),
    ).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: /Save authored MAR/i }),
    ).toBeDisabled();
    expect(api.saveMarHistory).not.toHaveBeenCalled();
  });

  it("uses the persisted generation request id for a retry and clears it only after success", async () => {
    api.saveMarHistory
      .mockResolvedValueOnce({ ok: false, error: "unknown outcome" })
      .mockResolvedValueOnce({ ok: true, revision: 1 });
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole("button", { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(1));
    const requestId = api.saveMarHistory.mock.calls[0][6];
    const requestKey = Object.keys(window.localStorage).find((key) =>
      key.endsWith(":generation-request-id"),
    );
    expect(window.localStorage.getItem(requestKey ?? "")).toBe(
      JSON.stringify(requestId),
    );
    fireEvent.click(view.getByRole("button", { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(2));
    expect(api.saveMarHistory.mock.calls[1][6]).toBe(requestId);
    expect(api.saveMarHistory.mock.calls[1][5]).toEqual(
      api.saveMarHistory.mock.calls[0][5],
    );
    await waitFor(() =>
      expect(
        Object.keys(window.localStorage).some((key) =>
          key.endsWith(":generation-request-id"),
        ),
      ).toBe(false),
    );
  });

  it("freezes the unknown envelope while allowing the visible draft to be edited", async () => {
    api.saveMarHistory
      .mockResolvedValueOnce({ ok: false, error: "unknown outcome" })
      .mockResolvedValueOnce({ ok: true, revision: 1 });
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole("button", { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(1));
    const oldRequestId = api.saveMarHistory.mock.calls[0][6];
    const oldEvents = api.saveMarHistory.mock.calls[0][5];
    const dose = view.getByRole("textbox", {
      name: /med-1:scheduled:12 dose/i,
    });
    fireEvent.change(dose, { target: { value: "15 mg" } });
    expect(dose).toHaveValue("15 mg");
    fireEvent.click(view.getByRole("button", { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(2));
    expect(api.saveMarHistory.mock.calls[1][6]).toBe(oldRequestId);
    expect(api.saveMarHistory.mock.calls[1][5]).toEqual(oldEvents);
    expect(api.saveMarHistory.mock.calls[1][5][0]).toMatchObject({
      orderedDose: "10 mg",
      administeredDose: "10 mg",
    });
  });

  it("reconciles a deterministic revision conflict before rotating the request", async () => {
    api.saveMarHistory.mockResolvedValueOnce({
      ok: false,
      error: "MAR changed in another window. Reload the preview before saving.",
    });
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    const originalRequestId = JSON.parse(
      window.localStorage.getItem(
        Object.keys(window.localStorage).find((key) =>
          key.endsWith(":generation-request-id"),
        ) ?? "",
      ) ?? "null",
    );
    fireEvent.click(view.getByRole("button", { name: /Save authored MAR/i }));
    await waitFor(() =>
      expect(
        view.getByText(/reconciled\. Review the preview and save again/i),
      ).toBeInTheDocument(),
    );
    expect(view.queryByText(/unknown outcome/i)).not.toBeInTheDocument();
    const reconciledRequestId = JSON.parse(
      window.localStorage.getItem(
        Object.keys(window.localStorage).find((key) =>
          key.endsWith(":generation-request-id"),
        ) ?? "",
      ) ?? "null",
    );
    expect(reconciledRequestId).not.toBe(originalRequestId);
  });

  it("discards a persisted preview and request when authored medication metadata changes", async () => {
    const first = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(first.getByText("Example")).toBeInTheDocument());
    fireEvent.click(first.getByRole("button", { name: /Generate MAR Given/i }));
    await waitFor(() =>
      expect(
        Object.keys(window.localStorage).some((key) =>
          key.endsWith(":preview"),
        ),
      ).toBe(true),
    );
    first.unmount();
    api.listOrders.mockResolvedValue([
      {
        id: "med-1",
        patientId: "patient-1",
        roomId: 7,
        assignmentId: null,
        overrideScope: "room",
        category: "Medication",
        orderName: "Example",
        dose: "20 mg",
        route: "PO",
        frequency: "q4h",
        priority: "Routine",
        status: "Active",
        orderedBy: "Author",
        orderTime: "2026-10-20T00:00:00Z",
      },
    ]);
    const second = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(second.getByText("Example")).toBeInTheDocument(),
    );
    expect(
      second.getByText(/Choose timings, then Generate MAR Given/),
    ).toBeInTheDocument();
    expect(
      Object.keys(window.localStorage).some((key) => key.endsWith(":preview")),
    ).toBe(false);
    expect(
      Object.keys(window.localStorage).some((key) =>
        key.endsWith(":generation-request-id"),
      ),
    ).toBe(false);
  });

  it("excludes learner-scoped orders and events from authored loading and saving", async () => {
    api.saveMarHistory.mockResolvedValue({ ok: true, revision: 1 });
    api.listOrders.mockResolvedValueOnce([
      {
        id: "med-1",
        patientId: "patient-1",
        roomId: 7,
        assignmentId: null,
        overrideScope: "room",
        category: "Medication",
        orderName: "Example",
        dose: "10 mg",
        route: "PO",
        frequency: "q4h",
        priority: "Routine",
        status: "Active",
        orderedBy: "Author",
        orderTime: "2026-10-20T00:00:00Z",
      },
      {
        id: "learner-med",
        patientId: "patient-1",
        roomId: 7,
        assignmentId: "assignment-1",
        overrideScope: "assignment",
        category: "Medication",
        orderName: "Learner only",
        dose: "1 mg",
        route: "PO",
        frequency: "once",
        priority: "Routine",
        status: "Active",
        orderedBy: "Learner",
        orderTime: "2026-10-20T00:00:00Z",
      },
    ]);
    api.listMarEvents.mockResolvedValueOnce([
      {
        id: "learner-event",
        patientId: "patient-1",
        roomId: 7,
        assignmentId: "assignment-1",
        occurrenceKey: "learner",
        medicationName: "Learner only",
        category: "scheduled",
        status: "Given",
        source: "learner",
        recordVersion: 1,
      },
    ]);
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.getByText("Example")).toBeInTheDocument());
    expect(view.queryByText("Learner only")).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole("button", { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalled());
    expect(api.saveMarHistory.mock.calls[0][5]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ medicationName: "Learner only" }),
      ]),
    );
  });

  it("fails closed for an unavailable authorized-order read and never invokes save", async () => {
    api.listOrders.mockImplementation(async (...args: unknown[]) => {
      (args[3] as ((message: string) => void) | undefined)?.(
        "orders unavailable",
      );
      return [];
    });
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(view.getByRole("status")).toHaveTextContent(
        /authorized medication list is unavailable/i,
      ),
    );
    expect(
      view.getByRole("button", { name: /Generate MAR Given/i }),
    ).toBeDisabled();
    expect(
      view.queryByRole("button", { name: /Save authored MAR/i }),
    ).not.toBeInTheDocument();
    expect(api.saveMarHistory).not.toHaveBeenCalled();
  });

  it("ignores a stale A-scope order error after switching to settled B data", async () => {
    let staleOrderError: ((message: string) => void) | undefined;
    api.getPatientByRoomId.mockImplementation(async (roomId: number) => ({
      id: roomId === 7 ? "patient-a" : "patient-b",
      roomId,
      mrn: `MRN-${roomId}`,
      firstName: "Test",
      lastName: "Patient",
      dateOfBirth: "1980-01-01",
      gender: "Other",
      allergies: [],
    }));
    api.listOrders.mockImplementation(
      async (
        _patientId: string,
        _assignmentId: unknown,
        roomId: number,
        onError?: (message: string) => void,
      ) => {
        if (roomId === 7) {
          staleOrderError = onError;
          return new Promise(() => undefined);
        }
        return [
          {
            id: "med-b",
            patientId: "patient-b",
            roomId: 8,
            assignmentId: null,
            overrideScope: "room",
            category: "Medication",
            orderName: "Current B medication",
            dose: "5 mg",
            route: "PO",
            frequency: "q6h",
            priority: "Routine",
            status: "Active",
            orderedBy: "Author",
            orderTime: "2026-10-20T00:00:00Z",
          },
        ];
      },
    );
    const view = render(
      <MemoryRouter initialEntries={["/case-builder/mar?roomId=7"]}>
        <ScopeSwitcher />
        <CaseBuilderMarAuthoring />
      </MemoryRouter>,
    );
    fireEvent.click(view.getByRole("button", { name: "Switch scope" }));
    await waitFor(() =>
      expect(view.getByText("Current B medication")).toBeInTheDocument(),
    );
    staleOrderError?.("stale A orders unavailable");
    expect(view.getByText("Current B medication")).toBeInTheDocument();
    expect(
      view.queryByText(/authorized medication list is unavailable/i),
    ).not.toBeInTheDocument();
  });
});
