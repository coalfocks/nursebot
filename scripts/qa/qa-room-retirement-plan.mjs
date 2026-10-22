#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const input = process.argv[2];
const output = process.argv[3] ?? 'qa-room-retirement-manifest.json';
if (!input) throw new Error('Usage: node scripts/qa/qa-room-retirement-plan.mjs <room-readback.json> [manifest.json]');

const readback = JSON.parse(await readFile(input, 'utf8'));
if (!Array.isArray(readback.rooms) || !Object.hasOwn(readback, 'room00Id')) {
  throw new Error('Readback must contain { room00Id, rooms: [...] }; this tool never discovers targets by a generic QA prefix.');
}
if (!Number.isInteger(readback.room00Id) || readback.room00Id <= 0) throw new Error('Readback must contain a known positive-integer Room 00 id.');

const analyticsSchools = new Set(['nurse-althea-qa-north-20261015', 'nurse-althea-qa-south-20261015']);
const prefixes = ['QA-MAR-', 'QA-FB-BEDSIDE-'];
const exact = new Set(['QA-LIB-FEEDBACK-20261015']);
const targets = readback.rooms.filter((room) => {
  if (room.id === readback.room00Id) return false;
  const number = room.room_number ?? '';
  return exact.has(number) || prefixes.some((prefix) => number.startsWith(prefix))
    || (analyticsSchools.has(room.school_slug) && number.startsWith('QA-'));
}).map((room) => ({ ...room, previousIsActive: room.is_active })).sort((a, b) => a.id - b.id);

if (targets.length === 0) throw new Error('No explicit added QA rooms found; refusing to write an empty manifest.');
if (targets.some((room) => room.id === readback.room00Id)) throw new Error('Room 00 matched the retirement set.');
for (const room of targets) {
  if (!Number.isInteger(room.id) || room.id <= 0) throw new Error('Every target id must be a positive integer.');
  if (typeof room.room_number !== 'string' || !room.room_number.trim()) throw new Error(`Room ${room.id} has no room_number.`);
  if (typeof room.school_id !== 'string' || !room.school_id.trim() || typeof room.school_slug !== 'string' || !room.school_slug.trim()) throw new Error(`Room ${room.id} has incomplete school identity.`);
  if (typeof room.is_active !== 'boolean') throw new Error(`Room ${room.id} has non-boolean is_active.`);
  if (!Object.hasOwn(room, 'patient_id') || !Object.hasOwn(room, 'available_school_ids') || !Object.hasOwn(room, 'updated_at')) throw new Error(`Room ${room.id} is missing exact metadata fields.`);
}

const manifest = {
  format: 'qa-room-retirement-v1',
  generatedAt: new Date().toISOString(),
  room00Id: readback.room00Id,
  targets,
  execution: 'plan-only; no database connection or mutation is performed by this script',
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, targetCount: targets.length, targetIds: targets.map((room) => room.id), room00Id: readback.room00Id }));
