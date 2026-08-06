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
  await expect
    .poll(async () => (await requiredBox(toolbar)).y)
    .toBeCloseTo(0, 0);
  const pauseButton = toolbar.getByRole("button", { name: "Pause timer" });
  const settingsButton = toolbar.getByRole("button", { name: "Settings" });
  await expect(pauseButton).toBeVisible();
  await expect(settingsButton).toBeVisible();

  await pauseButton.click();
  const initialPauseDialog = page.getByTestId("crossword-pause-dialog");
  await expect(initialPauseDialog).toBeVisible();
  await initialPauseDialog.getByRole("button", { name: "Resume" }).click();
  await expect(initialPauseDialog).toBeHidden();
  expect((await requiredBox(toolbar)).y).toBeCloseTo(0, 0);

  await settingsButton.click();
  const settingsDialog = page.getByTestId("crossword-settings-dialog");
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("button", { name: "Close" }).click();
  await expect(settingsDialog).toBeHidden();
  expect((await requiredBox(toolbar)).y).toBeCloseTo(0, 0);

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
  const devControls = page.getByTestId("crossword-dev-controls");
  await expect(devControls).toBeVisible();
  await expect(
    devControls.getByRole("button", { name: "Fill all but final square" }),
  ).toBeVisible();

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
      clueListBox.y,
      "the clue list should participate in normal page layout",
    )
    .toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);

  await toolbar.getByRole("button", { name: "Pause timer" }).click();
  const pauseDialog = page.getByTestId("crossword-pause-dialog");
  await expect(pauseDialog).toBeVisible();
  await pauseDialog.getByRole("button", { name: "Resume" }).click();
  await expect(pauseDialog).toBeHidden();
  await expect(clueList).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Show crossword grid" }),
  ).toHaveAttribute("aria-pressed", "true");

  expect(await clueList.evaluate((element) => element.scrollTop)).toBe(0);
  const downHeadingPageY = await downHeading.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY,
  );
  await page.evaluate(
    (top) => window.scrollTo({ top }),
    downHeadingPageY + 200,
  );
  await expect(downHeading).toBeVisible();
  expect(await clueList.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await expect(toolbar).toBeVisible();
  await expect(gridToggle).toBeVisible();
  const stickyToolbarBox = await requiredBox(toolbar);
  const stickyDownHeadingBox = await requiredBox(downHeading);
  expect(stickyToolbarBox.y).toBeCloseTo(0, 0);
  expect(stickyDownHeadingBox.y).toBeCloseTo(
    stickyToolbarBox.y + stickyToolbarBox.height,
    0,
  );

  const lastClue = clueList.getByRole("listitem").last();
  await lastClue.scrollIntoViewIfNeeded();
  const lastClueBox = await requiredBox(lastClue);
  const dockBox = await requiredBox(
    page.getByTestId("crossword-mobile-solve-dock"),
  );
  expect(lastClueBox.y + lastClueBox.height).toBeLessThanOrEqual(dockBox.y + 1);

  const keyboardBoxAfterScroll = await requiredBox(keyboard);
  expect(keyboardBoxAfterScroll.x).toBeCloseTo(keyboardBox.x, 0);
  expect(keyboardBoxAfterScroll.y).toBeCloseTo(keyboardBox.y, 0);
  expect(keyboardBoxAfterScroll.width).toBeCloseTo(keyboardBox.width, 0);
  expect(keyboardBoxAfterScroll.height).toBeCloseTo(keyboardBox.height, 0);
  expect(clueBarBox.y).toBeLessThan(keyboardBoxAfterScroll.y);

  const firstDownSquare = downAnswer.getByRole("button").first();
  await firstDownSquare.click();
  await keyboard.getByRole("button", { name: "Enter Q", exact: true }).click();
  await expect(firstDownSquare).toHaveText("Q");
  await expect(firstDownSquare).toHaveAccessibleName(/, Q(?:,|$)/);
});

test("proposal crossword restores the mobile scroll position after reload", async ({
  page,
}) => {
  await page.goto("/games/proposal");

  const readyDialog = page.getByRole("dialog", { name: "Ready to solve?" });
  await readyDialog.getByRole("button", { name: "Start solving" }).click();
  await expect(readyDialog).toBeHidden();
  const keyboard = page.getByRole("group", { name: "Crossword keyboard" });
  await keyboard.getByRole("button", { name: "Enter F", exact: true }).click();
  await expect(page.getByTestId("crossword-square-0-0")).toContainText("F");
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("crossword:proposal-v1:progress");
    if (!raw) {
      return false;
    }
    const progress = JSON.parse(raw) as { entries?: string };
    return progress.entries?.startsWith("F") === true;
  });

  await page.reload();
  const pauseDialog = page.getByTestId("crossword-pause-dialog");
  await expect(pauseDialog).toBeVisible();
  await pauseDialog.getByRole("button", { name: "Resume" }).click();
  await expect(pauseDialog).toBeHidden();

  const toolbar = page.getByRole("group", { name: "Crossword controls" });
  await expect
    .poll(async () => (await requiredBox(toolbar)).y)
    .toBeCloseTo(0, 0);
  await expect(page.getByTestId("crossword-square-0-1")).toHaveClass(
    /bg-secondary(?:\s|$)/,
  );
  await expect(page.getByTestId("crossword-square-0-0")).not.toHaveClass(
    /bg-secondary(?:\s|$)/,
  );
});

test("proposal crossword grid clears the solve dock on a short mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto("/games/proposal");

  const readyDialog = page.getByRole("dialog", { name: "Ready to solve?" });
  await readyDialog.getByRole("button", { name: "Start solving" }).click();
  await expect(readyDialog).toBeHidden();

  const toolbar = page.getByRole("group", { name: "Crossword controls" });
  await expect
    .poll(async () => (await requiredBox(toolbar)).y)
    .toBeCloseTo(0, 0);

  const grid = page.getByRole("application", { name: "Crossword grid" });
  const dock = page.getByTestId("crossword-mobile-solve-dock");
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight }),
  );

  const gridBox = await requiredBox(grid);
  const dockBox = await requiredBox(dock);
  expect(gridBox.y + gridBox.height).toBeLessThanOrEqual(dockBox.y + 1);
});
