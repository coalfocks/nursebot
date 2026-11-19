// PLUMBING FIXTURE ONLY. Used by `--mock` to exercise the real generate-feedback pipeline
// end to end without an OpenAI key. The scores and sentences below are placeholders chosen
// to cite real event IDs for this attempt. They are NOT an evaluation and must never be read
// as a result. Outputs from a mock run are written to a separate `mock/` folder.

const ids = {
  learnerNeed: "chat:84b4e108-4b31-4faf-99cc-c56c93950f6b",
  learnerRequest: "chat:b360c4ba-a221-4879-8728-33927d8912e4",
  nurseReply: "chat:5b2d37c0-2a36-4e45-ad66-6df476178a02",
  orders: [
    "order:a188ff44-2afd-46d7-85f8-69170442ce0d",
    "order:9b6aa2f6-1587-4b37-88d5-3317f494899d",
    "order:df5b6a30-9367-4663-accd-10547eb74ce9",
    "order:176cb4b3-49b7-4358-a7db-d991473454e4",
    "order:3e001f26-8509-446f-8cbf-43454aa5e682",
    "order:347261b7-fd2e-4fff-8f21-3cf9e33fdb3c",
    "order:175215bf-8428-4bca-a496-ad3807e3eb30",
    "order:aef6c8ff-fcf0-4b4e-81bc-27f7beaa3ffe",
  ],
  note: "assignment-note:2808c092-d44f-4078-88be-954f11e0ffa3",
};

const communicationSection = {
  communication_breakdown: {
    focused_information_gathering: {
      score: 2,
      feedback:
        "PLUMBING FIXTURE: learner asked for saturation, oxygen settings and vitals.",
      evidence_event_ids: [ids.learnerNeed],
    },
    closed_loop_team_communication: {
      score: 2,
      feedback: "PLUMBING FIXTURE: learner request is linked to a nurse reply.",
      evidence_event_ids: [ids.learnerRequest, ids.nurseReply],
    },
    efficiency_deduction: {
      score: 0,
      feedback: "PLUMBING FIXTURE: no efficiency deduction.",
      evidence_event_ids: [],
    },
  },
};

const mdmSection = {
  clinical_reasoning_breakdown: {
    orders_monitoring_quality: {
      score: 3,
      feedback: "PLUMBING FIXTURE: learner orders are linked to the packet.",
      evidence_event_ids: ids.orders,
    },
    clinical_reasoning_documentation: {
      score: 2,
      feedback: "PLUMBING FIXTURE: learner progress note is linked.",
      evidence_event_ids: [ids.note],
    },
    safety_deduction: {
      score: 0,
      feedback: "PLUMBING FIXTURE: no unsafe action.",
      evidence_event_ids: [],
    },
  },
  safety_result: {
    level: "none",
    action: null,
    rationale: "PLUMBING FIXTURE: no unsafe learner action.",
    evidence_event_ids: [],
  },
  learning_objectives: "PLUMBING FIXTURE: learning objectives.",
  strengths: [
    "PLUMBING FIXTURE strength one.",
    "PLUMBING FIXTURE strength two.",
  ],
  improvements: [
    "PLUMBING FIXTURE improvement one.",
    "PLUMBING FIXTURE improvement two.",
  ],
  recommendations: [],
  action_review: [],
};

const commentary = {
  strengths: [
    {
      text: "PLUMBING FIXTURE: you asked for saturation and vitals first.",
      evidence_event_ids: [ids.learnerNeed],
    },
    {
      text: "PLUMBING FIXTURE: you placed the requested orders.",
      evidence_event_ids: [ids.orders[0]],
    },
  ],
  improvements: [
    {
      text: "PLUMBING FIXTURE: state when you will reassess.",
      evidence_event_ids: [ids.note],
    },
    {
      text: "PLUMBING FIXTURE: confirm the nurse has the plan.",
      evidence_event_ids: [ids.nurseReply],
    },
  ],
};

export function mockResponse(
  params: { messages: Array<{ role: string; content: string }> },
): string {
  const user = params.messages.map((m) => m.content).join("\n");
  if (user.includes("COMMUNICATION SECTION:")) {
    return JSON.stringify(communicationSection);
  }
  if (user.includes("MEDICAL DECISION-MAKING SECTION:")) {
    return JSON.stringify(mdmSection);
  }
  if (
    user.includes("VALID EVIDENCE IDS") &&
    user.includes("Write a short debrief")
  ) return JSON.stringify(commentary);
  throw new Error("PLUMBING FIXTURE: unexpected request type");
}
