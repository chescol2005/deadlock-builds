export const INTENT_KEYS = [
  "burst",
  "sustain",
  "tank",
  "mobility",
  "utility",
] as const;

export type IntentKey = (typeof INTENT_KEYS)[number];

export const SCORE_CATEGORIES = [
  "damage",
  "survivability",
  "mobility",
  "utility",
  "economy",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

export type IntentWeights = Readonly<Record<IntentKey, number>>;

export interface EngineInput {
	heroId: string;
	intent: IntentWeights;
	currentItems: ReadonlyArray<string>;
	matchContext?: Readonly<Record<string, string | number | boolean>>;
}

export interface ScoreBreakdown {
	byCategory: Partial<Record<ScoreCategory, number>>;
	total: number;
}

export interface ItemCandidate {
	itemId: string;
	name: string;
	cost: number;
	categoryValues: Readonly<Record<ScoreCategory, number>>;
	tags: ReadonlyArray<string>;
}

export interface StageScore {
	stageId: string;
	byCategory: Partial<Record<ScoreCategory, number>>;
	total: number;
	reasons: ReadonlyArray<string>;
}

export interface ItemRecommendation {
  item: ItemCandidate;
  finalScore: number;
  breakdown: ScoreBreakdown;
  stageScores: ReadonlyArray<StageScore>;
  reasons: ReadonlyArray<string>;
}

export interface EngineOutput {
  version: 1;
  normalizedIntent: IntentWeights;
  recommendations: ReadonlyArray<ItemRecommendation>;
}

export interface ScoringStage {
  stageId: string;
  score(input: EngineInput, candidate: ItemCandidate): StageScore;
}