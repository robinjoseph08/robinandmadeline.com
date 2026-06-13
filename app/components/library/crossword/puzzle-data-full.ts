// The hardcoded 15x15 crossword (the 5x5 mini lives in puzzle-data.ts, and
// puzzles.ts maps URL slugs to both). Like the mini, this is placeholder
// content: the grid is real and solvable (generated with a throwaway
// backtracking filler over a crossword word list, 36 blocks with standard
// 180-degree rotational symmetry), but the clues will be rewritten with ones
// about the couple before the wedding. A unit test runs validatePuzzle over
// it to keep the grid and clue sets consistent.
//
// The grid ("." squares are blocks):
//
//   Y O U . T I L D E . D R I E D
//   A D S . E M A I L . J E T L I
//   L I E . N A S A L . S P O O N
//   E N D A N G E R E D . A L P O
//   . . . F I E R Y . A S I D E S
//   P L A T E S . . I V O R Y . .
//   L I M E S . E A T I N . O U T
//   O V E R . I D L E S . B U S H
//   T E N . P S A L M . G O S E E
//   . . D R E A M . . A L C O R N
//   C A M E R A . A T T I C . . .
//   A W E D . C A T H O D E R A Y
//   R A N D Y . P A Y N E . I R E
//   A R T I E . E L M E R . S E A
//   T E S T S . S L E D S . E A R

import type { CrosswordPuzzle } from "./puzzle";

export const weddingFull: CrosswordPuzzle = {
  id: "wedding-full-v1",
  title: "The Wedding Crossword",
  width: 15,
  height: 15,
  solution:
    "YOU.TILDE.DRIED" +
    "ADS.EMAIL.JETLI" +
    "LIE.NASAL.SPOON" +
    "ENDANGERED.ALPO" +
    "...FIERY.ASIDES" +
    "PLATES..IVORY.." +
    "LIMES.EATIN.OUT" +
    "OVER.IDLES.BUSH" +
    "TEN.PSALM.GOSEE" +
    "..DREAM..ALCORN" +
    "CAMERA.ATTIC..." +
    "AWED.CATHODERAY" +
    "RANDY.PAYNE.IRE" +
    "ARTIE.ELMER.SEA" +
    "TESTS.SLEDS.EAR",
  clues: {
    easy: {
      across: {
        "1": "The person reading this clue", // YOU
        "4": "Squiggly mark over the n in jalapeno", // TILDE
        "9": "Like flowers pressed in a keepsake book", // DRIED
        "14": "Commercials, for short", // ADS
        "15": "Message sent to an inbox", // EMAIL
        "16": "Martial arts film star whose first name is also a plane", // JETLI
        "17": "Fib", // LIE
        "18": "Like a stuffy-sounding voice", // NASAL
        "19": "Utensil for soup", // SPOON
        "20": "Like pandas and other at-risk species", // ENDANGERED
        "23": "Brand of dog food", // ALPO
        "24": "Full of flames", // FIERY
        "25": "Comments said under your breath", // ASIDES
        "27": "Dishes you eat dinner from", // PLATES
        "30": "Classic off-white wedding dress shade", // IVORY
        "31": "Green citrus fruits", // LIMES
        "32": "Have dinner at home (2 words)", // EATIN
        "34": "Opposite of in", // OUT
        "37": "Finished and done", // OVER
        "38": "Runs without going anywhere, as an engine", // IDLES
        "39": "Shrub in the garden", // BUSH
        "40": "Number of fingers", // TEN
        "41": "Song from the Bible's book of 150", // PSALM
        "42": "Pay a visit to (2 words)", // GOSEE
        "43": "What you do while sleeping", // DREAM
        "45": "___ State, historically Black university in Mississippi", // ALCORN
        "46": "Device for taking wedding photos", // CAMERA
        "48": "Storage space under the roof", // ATTIC
        "50": "Filled with wonder", // AWED
        "51": "Beam inside old tube televisions (2 words)", // CATHODERAY
        "56": "Man's name that rhymes with candy", // RANDY
        "58": "Surname that sounds like an ache", // PAYNE
        "59": "Great anger", // IRE
        "60": "Man's name short for Arthur", // ARTIE
        "61": "Glue brand with an orange cap", // ELMER
        "62": "Big body of salt water", // SEA
        "63": "Quizzes and exams", // TESTS
        "64": "Rides for snowy hills", // SLEDS
        "65": "Body part you hear with", // EAR
      },
      down: {
        "1": "Ivy League school in New Haven", // YALE
        "2": "Norse god with two ravens", // ODIN
        "3": "Not brand new, like a secondhand car", // USED
        "4": "Sneakers, informally", // TENNIES
        "5": "Pictures", // IMAGES
        "6": "Focused beam of light", // LASER
        "7": "Private journal", // DIARY
        "8": "Fashion magazine with a French name", // ELLE
        "9": "They keep the dance floor going", // DJS
        "10": "Fix", // REPAIR
        "11": "Smug phrase after being proven right (4 words)", // ITOLDYOUSO
        "12": "Skip the big wedding and run off to marry", // ELOPE
        "13": "T. rex and friends, for short", // DINOS
        "21": '"Happily ever ___"', // AFTER
        "22": "Oscar winner Viola", // DAVIS
        "26": "Parents' boy", // SON
        "27": "The story of a book or movie", // PLOT
        "28": "Broadcast as it happens", // LIVE
        "29": "Changes to the Constitution", // AMENDMENTS
        "30": "A thing on a list", // ITEM
        "32": "Dutch cheese in red wax", // EDAM
        "33": "Every bit", // ALL
        "35": "Person logged into an app", // USER
        "36": "At that time", // THEN
        "38": "Newton who explained gravity", // ISAAC
        "39": "Italian lawn bowling game", // BOCCE
        "41": "For each", // PER
        "42": "Planes without engines", // GLIDERS
        "44": "Website with upvotes and subreddits", // REDDIT
        "45": "Made up for a mistake", // ATONED
        "46": "Unit for weighing a diamond", // CARAT
        "47": "Knowing what's going on", // AWARE
        "48": "Even a little bit (2 words)", // ATALL
        "49": 'Herb that sounds like "time"', // THYME
        "52": "Chimps and gorillas", // APES
        "53": "Get up in the morning", // RISE
        "54": "Region", // AREA
        "55": "Twelve months", // YEAR
        "57": "The answer everyone hopes for at a proposal", // YES
      },
    },
    medium: {
      across: {
        "1": "Second-person pronoun", // YOU
        "4": "Diacritical squiggle in Spanish", // TILDE
        "9": "Preserved by removing moisture", // DRIED
        "14": "Pop-ups and billboards", // ADS
        "15": "Electronic letter", // EMAIL
        "16": '"Romeo Must Die" star (2 words)', // JETLI
        "17": "Untruth", // LIE
        "18": "Relating to the nose", // NASAL
        "19": "Cuddle close, or stir with it", // SPOON
        "20": "Threatened with extinction", // ENDANGERED
        "23": "Purina competitor in the pet aisle", // ALPO
        "24": "Passionate or blazing", // FIERY
        "25": "Stage whispers to the audience", // ASIDES
        "27": "China pieces on a registry", // PLATES
        "30": "Color between white and cream", // IVORY
        "31": "Margarita garnishes", // LIMES
        "32": "Opposite of dining out (2 words)", // EATIN
        "34": "No longer trendy", // OUT
        "37": 'Word after "game" or before "easy"', // OVER
        "38": "Sits in neutral", // IDLES
        "39": "Rose or holly, for example", // BUSH
        "40": "Perfect gymnastics score", // TEN
        "41": "Sacred hymn", // PSALM
        "42": "Check out in person (2 words)", // GOSEE
        "43": "Aspiration", // DREAM
        "45": "Mississippi's ___ State University", // ALCORN
        "46": "It captures the big moments", // CAMERA
        "48": "Top floor for old boxes", // ATTIC
        "50": "Wonder-struck", // AWED
        "51": "Electron stream in a CRT (2 words)", // CATHODERAY
        "56": "Country star Travis", // RANDY
        "58": '"Sideways" director Alexander', // PAYNE
        "59": "Wrath", // IRE
        "60": "Shaw of the swing era", // ARTIE
        "61": "Fudd who hunts a wascally wabbit", // ELMER
        "62": "The Caribbean, for one", // SEA
        "63": "Finals, for example", // TESTS
        "64": "Toboggans and luges", // SLEDS
        "65": "Corn unit", // EAR
      },
      down: {
        "1": "Harvard's bulldog rival", // YALE
        "2": "Thor's father", // ODIN
        "3": "Pre-owned", // USED
        "4": "Casual kicks, casually", // TENNIES
        "5": "What a photographer delivers", // IMAGES
        "6": "Pointer for a presentation, perhaps", // LASER
        "7": "Book with a tiny lock, often", // DIARY
        "8": 'Woods of "Legally Blonde"', // ELLE
        "9": "Reception music masters, briefly", // DJS
        "10": "Mend, as a hem before the ceremony", // REPAIR
        "11": "Gloater's line (4 words)", // ITOLDYOUSO
        "12": "Marry in secret", // ELOPE
        "13": "Jurassic beasts, briefly", // DINOS
        "21": "Following", // AFTER
        "22": "Jazz trumpeter Miles", // DAVIS
        "26": "Daughter's brother", // SON
        "27": "Garden bed, or a scheme", // PLOT
        "28": "Like concert albums recorded on stage", // LIVE
        "29": "The Bill of Rights comprises ten", // AMENDMENTS
        "30": "Couple, in gossip columns", // ITEM
        "32": "Gouda's round cousin", // EDAM
        "33": "The whole amount", // ALL
        "35": "One with a login name", // USER
        "36": "Next in a sequence", // THEN
        "38": "Biblical son of Abraham and Sarah", // ISAAC
        "39": "Backyard game with a pallino", // BOCCE
        "41": "___ capita", // PER
        "42": "Porch chairs that swing gently", // GLIDERS
        "44": "Online home of AMAs", // REDDIT
        "45": "Did penance", // ATONED
        "46": "Engagement ring spec", // CARAT
        "47": "In the loop", // AWARE
        "48": '"Not ___" (polite reply to thanks) (2 words)', // ATALL
        "49": "Sprig in a bouquet garni", // THYME
        "52": "Mimics", // APES
        "53": "What dough does before baking", // RISE
        "54": "Length times width, for a rectangle", // AREA
        "55": "Anniversary unit", // YEAR
        "57": "Opposite of no", // YES
      },
    },
    hard: {
      across: {
        "1": "Not me", // YOU
        "4": "A little wave from Spain?", // TILDE
        "9": "Cured, as flowers or fruit", // DRIED
        "14": "They interrupt the program", // ADS
        "15": "Post that needs no stamp", // EMAIL
        "16": "Wushu champion turned movie star (2 words)", // JETLI
        "17": "It may be little and white", // LIE
        "18": "How a kazoo solo sounds", // NASAL
        "19": "What the dish ran away with, in rhyme", // SPOON
        "20": "Like a species on the brink", // ENDANGERED
        "23": "Chow chow's chow, maybe", // ALPO
        "24": "Like a habanero or a hot temper", // FIERY
        "25": "Parenthetical remarks", // ASIDES
        "27": "They get licked clean at a good reception", // PLATES
        "30": "Soap brand that floats", // IVORY
        "31": "Key players in a Florida pie?", // LIMES
        "32": "Skip the restaurant (2 words)", // EATIN
        "34": "What three strikes make", // OUT
        "37": "How radio speakers end a turn", // OVER
        "38": "What a waiting limo does", // IDLES
        "39": "Home of the proverbial two birds", // BUSH
        "40": "Top of a countdown", // TEN
        "41": 'It often starts "The Lord is my shepherd"', // PSALM
        "42": "Catch, as a matinee (2 words)", // GOSEE
        "43": "Team or wedding preceder", // DREAM
        "45": "Physicist George ___, X-ray spectrometer inventor", // ALCORN
        "46": "Lights, ___, action!", // CAMERA
        "48": "Where heirlooms gather dust", // ATTIC
        "50": "Left speechless at the altar, maybe", // AWED
        "51": "CRT minus the tube? (2 words)", // CATHODERAY
        "56": 'Jackson once of "American Idol"', // RANDY
        "58": "Golfer Stewart with a U.S. Open trophy", // PAYNE
        "59": 'Fury found inside "fire"', // IRE
        "60": "Bandleader Shaw who married eight times", // ARTIE
        "61": "Borden's bull of glue fame", // ELMER
        "62": "Where there are plenty of fish, in a saying", // SEA
        "63": "Trials of patience, perhaps", // TESTS
        "64": "Winter coasters", // SLEDS
        "65": "A good listener lends one", // EAR
      },
      down: {
        "1": "Lock brand or bulldog school", // YALE
        "2": "One-eyed ruler of Asgard", // ODIN
        "3": "Like good bookstore bargains", // USED
        "4": "Court shoes you can dance in", // TENNIES
        "5": "Mirror productions", // IMAGES
        "6": "Kind of focus or tag", // LASER
        "7": "Dear one for daily secrets?", // DIARY
        "8": "She, in Paris", // ELLE
        "9": "Spinners at the party, for short", // DJS
        "10": "What a cobbler or a counselor may do", // REPAIR
        "11": "Vindicated victor's victory lap (4 words)", // ITOLDYOUSO
        "12": "Trade the guest list for a ladder?", // ELOPE
        "13": "Museum skeletons, informally", // DINOS
        "21": "Word before party or thought", // AFTER
        "22": 'Bette of "All About Eve"', // DAVIS
        "26": "Junior, to Senior", // SON
        "27": "What thickens, in a cliche", // PLOT
        "28": "Word before band or wire", // LIVE
        "29": "Constitutional add-ons", // AMENDMENTS
        "30": "An official couple, in tabloid speak", // ITEM
        "32": 'Cheese whose name is "made" backward', // EDAM
        "33": "What love conquers, they say", // ALL
        "35": "The U of UX", // USER
        "36": "Now's partner", // THEN
        "38": "Sci-fi writer Asimov", // ISAAC
        "39": "Bowls, Italian style", // BOCCE
        "41": "As specified by", // PER
        "42": "Aircraft that ride thermals", // GLIDERS
        "44": "The self-styled front page of the internet", // REDDIT
        "45": "Settled a score with one's conscience", // ATONED
        "46": "Homophone of a rabbit's favorite snack", // CARAT
        "47": "Clued in", // AWARE
        "48": "In any way (2 words)", // ATALL
        "49": "Parsley, sage, and rosemary's partner", // THYME
        "52": "King Kong and company", // APES
        "53": "Stand, as for the bride", // RISE
        "54": "51, famously", // AREA
        "55": "Leap ___", // YEAR
        "57": '"I do," in a word', // YES
      },
    },
  },
};
