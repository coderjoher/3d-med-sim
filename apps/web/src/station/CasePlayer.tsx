import type { AnswerRecord, InputBus, InteractionLog, PlayerCase, ScoreResult } from '@medsim/core';
export interface CasePlayerProps {
  playerCase: PlayerCase;
  mode: 'assessment' | 'practice' | 'preview';
  onSubmit?(answers: AnswerRecord[], log: InteractionLog, timedOut: boolean): Promise<Partial<ScoreResult> | void> | void;
  inputBus?: InputBus; attemptId?: string;
}
export function CasePlayer(props: CasePlayerProps) {
  return <div data-testid="case-player">{props.playerCase.case_id}</div>;
}
