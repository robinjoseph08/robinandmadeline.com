// The hardcoded wedding crossword. This is placeholder content: the grid is
// real and solvable, but the clues will be rewritten with ones about the
// couple before the wedding. The object below is plain JSON-shaped data, so
// it is easy to author by hand or generate with a simple script; a unit test
// runs validatePuzzle over it to keep the grid and clue sets consistent.
//
// The grid ("." squares are blocks):
//
//   . K I S S
//   D A N C E
//   A P N E A
//   S P E N T
//   H A R E .

import type { CrosswordPuzzle } from "./puzzle";

export const weddingCrossword: CrosswordPuzzle = {
  id: "wedding-mini-v1",
  title: "The Wedding Mini",
  width: 5,
  height: 5,
  solution: ".KISSDANCEAPNEASPENTHARE.",
  clues: {
    easy: {
      across: {
        "1": "Smooch shared at the altar",
        "5": "The couple's first one is a reception highlight",
        "6": "Sleep disorder often treated with a CPAP machine",
        "7": "Used up, like a wedding budget",
        "8": "Speedy rabbit that lost to the tortoise",
      },
      down: {
        "1": "Greek letter after iota",
        "2": "Like some circles and voices",
        "3": "Section of a play",
        "4": "Find yours on the reception chart",
        "5": "Sprint, or a pinch of salt",
      },
    },
    medium: {
      across: {
        "1": "It often seals the deal at a ceremony",
        "5": "Waltz or tango, for example",
        "6": "Breathing interruption during sleep",
        "7": "Completely exhausted",
        "8": "Overconfident racer of fable",
      },
      down: {
        "1": "Fraternity letter between iota and lambda",
        "2": "Kind of monologue or tube",
        "3": "What a dramatic guest might make",
        "4": "Reserved spot at the reception",
        "5": "The longer Morse code signal",
      },
    },
    hard: {
      across: {
        "1": "French connection?",
        "5": "Floor exercise at a reception?",
        "6": "Snorer's pause",
        "7": "Like confetti after the send-off",
        "8": "Animal that naps mid-race, famously",
      },
      down: {
        "1": "Tenth letter, in Athens",
        "2": "Closer to the heart?",
        "3": "It can be stolen without a crime",
        "4": "What an usher helps you find",
        "5": "It's long in Morse and short in recipes",
      },
    },
  },
};
