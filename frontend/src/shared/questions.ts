export const QUESTIONS = [
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
    title: "CST ahead of ETH?",
    question: "Will CST gestures outnumber ETH gestures?",
    detail: "Compares payment counts within this cycle. Equal counts resolve NO.",
    metric: "paymentMix",
  },
  {
    title: "One gesture, both titles?",
    question: "Will the same gesture earn both Endurance and Chrono?",
    detail:
      "The exact same gesture must earn both titles. Two different gestures from the same wallet resolve NO.",
    metric: "sameGesture",
  },
  {
    title: "Higher CST peak?",
    question: "Will the highest CST payment exceed the previous cycle’s?",
    detail:
      "Compares the largest CST amount actually paid for one gesture. An equal peak resolves NO.",
    metric: "maxCstPaid",
  },
] as const;

export const QUESTION_COUNT = QUESTIONS.length;
export type QuestionId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const questionKnown = (mask: number, question: number) => (mask & (1 << question)) !== 0;
export const answerYes = (values: number, question: number) => (values & (1 << question)) !== 0;
