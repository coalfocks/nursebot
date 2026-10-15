import { readFile } from 'node:fs/promises';

const sourcePath = process.argv[2] || 'docs/snapshots/2026-10-02-authored-room-cases.json';
const snapshot = JSON.parse(await readFile(sourcePath, 'utf8'));
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const splitGoals = (value) => clean(value)
  .split(/\s*\n\s*|(?=•)/)
  .map((item) => item.replace(/^\s*(?:[-*•]|Goals of Case)\s*/i, '').trim())
  .filter(Boolean);

const rooms = [...snapshot.rooms]
  .sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }))
  .map((room) => {
    const diagnosis = clean(room.expected_diagnosis);
    const authoredGoals = splitGoals(room.case_goals);
    let status = 'supported';
    let disposition = 'Retain authored goals and show them only after completion.';
    if (!diagnosis) {
      status = 'unclear';
      disposition = 'Diagnosis is absent from the source; do not invent a diagnosis-specific goal. Author review required.';
    } else if (authoredGoals.length === 0 || /^do hard things$/i.test(authoredGoals.join(' '))) {
      status = 'placeholder';
      disposition = 'Goal text is a placeholder; author review required before adding post-case goals.';
    } else if (/persistent pneumonia/i.test(diagnosis) && /acute cholecystitis/i.test(authoredGoals.join(' '))) {
      status = 'mismatch';
      disposition = 'Diagnosis and goal text conflict; preserve source and author review rather than guessing.';
    }
    return {
      room: room.room_number,
      diagnosis: diagnosis || null,
      status,
      disposition,
      exact_post_completion_goal_text: status === 'supported' ? authoredGoals : [],
    };
  });

console.log(JSON.stringify({
  sourcePath,
  generatedAt: new Date().toISOString(),
  counts: {
    rooms: rooms.length,
    supported: rooms.filter((room) => room.status === 'supported').length,
    unclear: rooms.filter((room) => room.status === 'unclear').length,
    placeholder: rooms.filter((room) => room.status === 'placeholder').length,
    mismatch: rooms.filter((room) => room.status === 'mismatch').length,
  },
  rooms,
}, null, 2));
