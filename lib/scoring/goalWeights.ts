import type { ItemTag } from "../items";

export type BuildGoal = "burst" | "tank" | "sustain" | "mobility" | "dps";

export type TagWeights = Record<ItemTag, number>;

export type GoalWeightsMap = Record<BuildGoal, TagWeights>;

export const GOAL_WEIGHTS_MAP: GoalWeightsMap = {
  burst: {
    burst: 1.0,
    dps: 0.7,
    utility: 0.3,
    mobility: 0.2,
    sustain: 0.1,
    tankiness: 0.1,
  },
  tank: {
    tankiness: 1.0,
    sustain: 0.5,
    utility: 0.4,
    mobility: 0.3,
    dps: 0.2,
    burst: 0.1,
  },
  sustain: {
    sustain: 1.0,
    tankiness: 0.6,
    utility: 0.4,
    dps: 0.3,
    mobility: 0.2,
    burst: 0.2,
  },
  mobility: {
    mobility: 1.0,
    utility: 0.5,
    sustain: 0.3,
    tankiness: 0.3,
    dps: 0.3,
    burst: 0.2,
  },
  dps: {
    dps: 1.0,
    burst: 0.6,
    utility: 0.3,
    sustain: 0.2,
    mobility: 0.2,
    tankiness: 0.1,
  },
};

export function getWeightsForGoal(goal: BuildGoal): TagWeights {
  return GOAL_WEIGHTS_MAP[goal];
}
