import type { Database } from './database.types';

export type Room = Database['public']['Tables']['rooms']['Row'];
export type ScenarioBaseline = Partial<Room> & Record<string, unknown>;

export const resolveAssignmentRoom = <TRoom extends Record<string, unknown>>(
  room: TRoom,
  scenarioBaseline: unknown,
): TRoom => {
  if (!scenarioBaseline || typeof scenarioBaseline !== 'object' || Array.isArray(scenarioBaseline)) {
    return room;
  }

  return { ...room, ...(scenarioBaseline as Partial<TRoom>) };
};

export const getScenarioBaseline = (assignment: { scenario_baseline?: unknown } | null | undefined) =>
  assignment?.scenario_baseline ?? null;
