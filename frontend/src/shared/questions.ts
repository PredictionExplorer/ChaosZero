/** Cycle statistic a question card displays; `formatQuestionMetric` renders each one. */
export type QuestionMetric =
  | "gestures"
  | "endurance"
  | "chrono"
  | "ethSpent"
  | "cstBurned"
  | "parity"
  | "sameGesture"
  | "maxCstPaid";

export interface QuestionDefinition {
  readonly title: string;
  readonly question: string;
  readonly detail: string;
  readonly metric: QuestionMetric;
  /** Label for the live value when it is not a plain "This cycle" statistic. */
  readonly currentLabel?: string;
  /** Fixed resolution rule shown instead of the previous cycle's value. */
  readonly condition?: string;
}

export const QUESTIONS: readonly QuestionDefinition[] = [
  {
    title: "More gestures?",
    question: "Will this cycle have more gestures than the previous cycle?",
    detail: "Every ETH and CST gesture counts. An equal total resolves NO.",
    metric: "gestures",
  },
  {
    title: "Longer Endurance?",
    question: "Will the Endurance duration exceed the previous cycle’s?",
    detail:
      "The longest uninterrupted hold, including the final hold through cycle closure. Equal durations resolve NO.",
    metric: "endurance",
  },
  {
    title: "Longer Chrono?",
    question: "Will the Chrono duration exceed the previous cycle’s?",
    detail: "The longest time a gesture holds the Endurance record. Equal durations resolve NO.",
    metric: "chrono",
  },
  {
    title: "More ETH spent?",
    question: "Will more ETH be spent on gestures than in the previous cycle?",
    detail:
      "Counts ETH paid for gestures, excluding separate contributions. An equal amount resolves NO.",
    metric: "ethSpent",
  },
  {
    title: "More CST burned?",
    question: "Will gestures burn more CST than in the previous cycle?",
    detail:
      "Counts CST paid for gestures, excluding other token burns. An equal amount resolves NO.",
    metric: "cstBurned",
  },
  {
    title: "Odd gesture count?",
    question: "Will this cycle end with an odd number of gestures?",
    detail:
      "Counts every ETH and CST gesture, including free CST gestures, when the cycle closes. An odd total resolves YES; an even total resolves NO. Each new gesture flips the answer, so it is decided only at closure.",
    metric: "parity",
    condition: "Odd total",
  },
  {
    title: "One gesture, both titles?",
    question: "Will the same gesture earn both Endurance and Chrono?",
    detail:
      "The exact same gesture must earn both titles. Two different gestures from the same wallet resolve NO.",
    metric: "sameGesture",
    currentLabel: "Endurance / Chrono",
    condition: "Same gesture",
  },
  {
    title: "Higher CST peak?",
    question: "Will the highest CST payment exceed the previous cycle’s?",
    detail:
      "Compares the largest CST amount actually paid for one gesture. An equal peak resolves NO.",
    metric: "maxCstPaid",
  },
];

export const QUESTION_COUNT = QUESTIONS.length;
export type QuestionId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const answerYes = (values: number, question: number) => (values & (1 << question)) !== 0;
