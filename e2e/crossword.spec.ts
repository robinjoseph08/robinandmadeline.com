import { expect, test, type Locator } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const QWERTY_TOP_ROW = ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"];

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test.use({ viewport: MOBILE_VIEWPORT });

test("proposal crossword clue list keeps its mobile controls and keyboard usable", async ({
  page,
}) => {
  await page.goto("/games/proposal");

  const readyDialog = page.getByRole("dialog", { name: "Ready to solve?" });
  await expect(readyDialog).toBeVisible();
  await readyDialog.getByRole("button", { name: "Start solving" }).click();
  await expect(readyDialog).toBeHidden();

  const toolbar = page.getByRole("group", { name: "Crossword controls" });
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Pause timer" }),
  ).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Settings" })).toBeVisible();

  await toolbar.getByRole("button", { name: "List all clues" }).click();

  const gridToggle = toolbar.getByRole("button", {
    name: "Show crossword grid",
  });
  await expect(toolbar).toBeVisible();
  await expect(gridToggle).toBeVisible();
  await expect(gridToggle).toHaveAttribute("aria-pressed", "true");
  await expect(
    toolbar.getByRole("button", { name: "Pause timer" }),
  ).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Settings" })).toBeVisible();

  const clueList = page.getByRole("region", { name: "Crossword clue list" });
  await expect(clueList).toBeVisible();
  await expect(
    clueList.getByRole("heading", { name: "Across", exact: true }),
  ).toBeVisible();
  const downHeading = clueList.getByRole("heading", {
    name: "Down",
    exact: true,
  });
  await expect(downHeading).toBeAttached();

  const acrossAnswer = clueList
    .getByRole("group", {
      name: /\d+ Across answer/,
    })
    .first();
  const downAnswer = clueList
    .getByRole("group", {
      name: /\d+ Down answer/,
    })
    .first();
  await expect(acrossAnswer.getByRole("button").first()).toBeEnabled();
  await expect(downAnswer.getByRole("button").first()).toBeEnabled();

  const answerGroups = clueList.getByRole("group", { name: /answer/ });
  const answerGroupCount = await answerGroups.count();
  let fifteenSquareAnswer: Locator | null = null;
  for (let index = 0; index < answerGroupCount; index++) {
    const candidate = answerGroups.nth(index);
    if ((await candidate.getByRole("button").count()) === 15) {
      fifteenSquareAnswer = candidate;
      break;
    }
  }
  expect(fifteenSquareAnswer).not.toBeNull();
  const fifteenSquareBox = await requiredBox(fifteenSquareAnswer!);
  expect(fifteenSquareBox.x).toBeGreaterThanOrEqual(0);
  expect(fifteenSquareBox.x + fifteenSquareBox.width).toBeLessThanOrEqual(
    MOBILE_VIEWPORT.width,
  );
  const fifteenSquareWidth = (
    await requiredBox(fifteenSquareAnswer!.getByRole("button").first())
  ).width;
  const shortSquareWidth = (
    await requiredBox(acrossAnswer.getByRole("button").first())
  ).width;
  expect(shortSquareWidth).toBeCloseTo(fifteenSquareWidth, 0);

  const keyboard = page.getByRole("group", { name: "Crossword keyboard" });
  const clueBar = page.getByTestId("crossword-mobile-clue-bar");
  await expect(keyboard).toBeVisible();
  await expect(clueBar).toBeVisible();

  const keyboardBox = await requiredBox(keyboard);
  expect(keyboardBox.y + keyboardBox.height).toBeCloseTo(
    MOBILE_VIEWPORT.height,
    0,
  );

  const topRowKeys = QWERTY_TOP_ROW.map((letter) =>
    keyboard.getByRole("button", { name: `Enter ${letter}`, exact: true }),
  );
  for (const key of topRowKeys) {
    await expect(key).toBeVisible();
    await expect(key).toBeEnabled();
  }

  const keyBoxes = await Promise.all(topRowKeys.map(requiredBox));
  const averageKeyWidth =
    keyBoxes.reduce((total, box) => total + box.width, 0) / keyBoxes.length;
  expect(averageKeyWidth).toBeGreaterThan(28);
  for (const [index, box] of keyBoxes.entries()) {
    expect(Math.abs(box.width - averageKeyWidth)).toBeLessThanOrEqual(2);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 0.5);
    if (index > 0) {
      const previous = keyBoxes[index - 1];
      expect(box.x).toBeGreaterThanOrEqual(previous.x + previous.width - 0.5);
    }
  }
  for (const rightEdgeLetter of ["P", "L"] as const) {
    const box = await requiredBox(
      keyboard.getByRole("button", {
        name: `Enter ${rightEdgeLetter}`,
        exact: true,
      }),
    );
    expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width - 1);
  }

  const toolbarBox = await requiredBox(toolbar);
  const clueListBox = await requiredBox(clueList);
  expect
    .soft(
      clueListBox.y - (toolbarBox.y + toolbarBox.height),
      "the clue list should start directly below the toolbar without a blank grid row",
    )
    .toBeLessThanOrEqual(1);
  const clueBarBox = await requiredBox(clueBar);
  expect
    .soft(
      clueListBox.y + clueListBox.height,
      "the clue-list scrollport should end above the fixed solve dock",
    )
    .toBeLessThanOrEqual(clueBarBox.y + 1);

  await toolbar.getByRole("button", { name: "Pause timer" }).click();
  const pauseDialog = page.getByTestId("crossword-pause-dialog");
  await expect(pauseDialog).toBeVisible();
  await pauseDialog.getByRole("button", { name: "Resume" }).click();
  await expect(pauseDialog).toBeHidden();
  await expect(clueList).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Show crossword grid" }),
  ).toHaveAttribute("aria-pressed", "true");

  const toolbarBoxBeforeScroll = await requiredBox(toolbar);
  await clueList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => clueList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const scrolledClueListBox = await requiredBox(clueList);
  const downHeadingBox = await requiredBox(downHeading);
  expect(downHeadingBox.y).toBeGreaterThanOrEqual(scrolledClueListBox.y - 1);
  expect(downHeadingBox.y).toBeLessThanOrEqual(scrolledClueListBox.y + 2);
  expect(downHeadingBox.y + downHeadingBox.height).toBeLessThanOrEqual(
    scrolledClueListBox.y + scrolledClueListBox.height + 1,
  );
  const lastClueBox = await requiredBox(clueList.getByRole("listitem").last());
  expect
    .soft(
      scrolledClueListBox.y +
        scrolledClueListBox.height -
        lastClueBox.y -
        lastClueBox.height,
      "scrolling to the end should not leave blank content below the last clue",
    )
    .toBeLessThanOrEqual(2);

  await expect(toolbar).toBeVisible();
  await expect(gridToggle).toBeVisible();
  const toolbarBoxAfterScroll = await requiredBox(toolbar);
  expect(toolbarBoxAfterScroll.y).toBeCloseTo(toolbarBoxBeforeScroll.y, 0);

  const keyboardBoxAfterScroll = await requiredBox(keyboard);
  expect(keyboardBoxAfterScroll.x).toBeCloseTo(keyboardBox.x, 0);
  expect(keyboardBoxAfterScroll.y).toBeCloseTo(keyboardBox.y, 0);
  expect(keyboardBoxAfterScroll.width).toBeCloseTo(keyboardBox.width, 0);
  expect(keyboardBoxAfterScroll.height).toBeCloseTo(keyboardBox.height, 0);

  const firstDownSquare = downAnswer.getByRole("button").first();
  await firstDownSquare.click();
  await keyboard.getByRole("button", { name: "Enter Q", exact: true }).click();
  await expect(firstDownSquare).toHaveText("Q");
  await expect(firstDownSquare).toHaveAccessibleName(/, Q(?:,|$)/);
});
