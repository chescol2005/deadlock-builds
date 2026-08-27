import { PhaseTimeline as SharedPhaseTimeline } from "@/app/guide/components/PhaseTimeline";
import { PHASE_CARDS, PILL_COLORS } from "@/lib/farming/campData";

export function PhaseTimeline() {
  return <SharedPhaseTimeline cards={PHASE_CARDS} pillColors={PILL_COLORS} />;
}
