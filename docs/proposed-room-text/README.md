# Room-text EMR language (read from prod 2026-11-20, nothing modified)

| Room text | Rooms | Conflict with new server policy |
|---|---|---|
| "Detailed chart/lab/imaging sections below are authoring reference for the EHR, not nurse-chat knowledge; direct those questions to the chart without quoting values or interpretations." | 49 (all 2xx-5xx rooms and ED 20-29 with authored overnight control text) | Direct conflict: tells the nurse to redirect questions she can answer (prior labs, history). Server policy now supersedes; SQL proposed. |
| "For all medical orders or adjustments, tell the doctor to enter orders into the EMR… You are not allowed to perform orders until placed in the EMR. … you can't see if an order is placed." | 405 | Mostly compatible (nurse does not enter orders, order status uncertain). "Tell the doctor to enter orders" is fine; leave. |
| "If asked for a lab you don't know: 'I'm not sure—have you ordered it?' / 'Can you order it?' / 'Have you checked the EMR?'" | 503, 504, 505, 405 | Compatible (scoped to labs she doesn't know). "Can you order it?" is a question to the doctor, not a nurse order. Leave. |
| "(If the doctor asks for details you don't have, respond with: 'I'm not sure. Can you check the EMR?')" and pending-read language | ED 22 | Compatible (info she lacks). |
| "Refer full active orders and prenatal history to the EMR." / "(Available in EMR if the doctor asks.)" | L&D 01, L&D 03 | Conflicts with "established history" being answerable. Proposed manual review by room author; not in SQL. |
| "Do not claim evaluation goals are in the chart." | all authored rooms | Unrelated (hidden-goal protection); keep. |
| "…already in chart / already in EMR" headings | 204, 305 | Descriptive labels only; harmless. |

Pinned attempts: `student_room_assignments.scenario_baseline` holds a copy of the room text for 64 assignments containing the boundary sentence; those cannot be fixed by editing `rooms`. The server policy block is placed after the room text and declared authoritative, so they are covered without row edits.
