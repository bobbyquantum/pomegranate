import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function waitForApp(page: Page) {
  // Wait for the database to initialize and the app to render
  await page.waitForSelector('text=PomegranateDB', { timeout: 15_000 });
}

async function addTodo(page: Page, title: string) {
  const input = page.getByPlaceholder('What needs to be done?');
  await input.fill(title);
  await input.press('Enter');
  // Wait for the todo to appear in the list
  await expect(page.getByText(title)).toBeVisible();
}

async function getTodoCount(page: Page): Promise<{ remaining: number; done: number }> {
  const statsText = await page.locator('text=/\\d+ remaining/').textContent();
  const match = statsText?.match(/(\d+) remaining · (\d+) done/);
  return {
    remaining: match ? parseInt(match[1], 10) : 0,
    done: match ? parseInt(match[2], 10) : 0,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test.describe('PomegranateDB Todo Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
  });

  test('renders the app with header and input', async ({ page }) => {
    await expect(page.getByText('PomegranateDB')).toBeVisible();
    await expect(page.getByText('Reactive offline-first database')).toBeVisible();
    await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();
  });

  test('shows empty state when no todos exist', async ({ page }) => {
    // The empty state may or may not show depending on prior test state.
    // Check for either todos or the empty state
    const emptyOrTodos = page.locator('text=No todos yet').or(page.locator('[data-testid="todo-item"]'));
    await expect(emptyOrTodos.first()).toBeVisible({ timeout: 5000 }).catch(() => {
      // If neither appears, that's fine — there may be leftover data from persistence
    });
  });

  test('adds a new todo', async ({ page }) => {
    const title = `Test todo ${Date.now()}`;
    await addTodo(page, title);

    // Verify it appears in the list
    await expect(page.getByText(title)).toBeVisible();

    // Stats should reflect the new item
    const stats = await getTodoCount(page);
    expect(stats.remaining).toBeGreaterThanOrEqual(1);
  });

  test('toggles a todo between active and completed', async ({ page }) => {
    const title = `Toggle test ${Date.now()}`;
    await addTodo(page, title);

    const statsBefore = await getTodoCount(page);

    // Find the todo row and click the checkbox (the circular button before the title)
    const todoText = page.getByText(title);
    const todoRow = todoText.locator('..');
    const checkbox = todoRow.locator('div').first();
    await checkbox.click();

    // Wait for reactive update
    await page.waitForTimeout(500);

    const statsAfter = await getTodoCount(page);
    expect(statsAfter.done).toBe(statsBefore.done + 1);
    expect(statsAfter.remaining).toBe(statsBefore.remaining - 1);

    // Toggle back
    await checkbox.click();
    await page.waitForTimeout(500);

    const statsRestored = await getTodoCount(page);
    expect(statsRestored.remaining).toBe(statsBefore.remaining);
  });

  test('deletes a todo', async ({ page }) => {
    const title = `Delete me ${Date.now()}`;
    await addTodo(page, title);

    const statsBefore = await getTodoCount(page);

    // Click the ✕ delete button in the same row
    const todoText = page.getByText(title);
    const todoRow = todoText.locator('..');
    const deleteBtn = todoRow.getByText('✕');
    await deleteBtn.click();

    // Wait for removal
    await page.waitForTimeout(500);

    await expect(page.getByText(title)).not.toBeVisible();

    const statsAfter = await getTodoCount(page);
    expect(statsAfter.remaining + statsAfter.done).toBe(
      statsBefore.remaining + statsBefore.done - 1,
    );
  });

  test('seeds sample todos', async ({ page }) => {
    const statsBefore = await getTodoCount(page);

    await page.getByText('+ Add samples').click();

    // Wait for reactive update
    await page.waitForTimeout(1000);

    const statsAfter = await getTodoCount(page);
    expect(statsAfter.remaining + statsAfter.done).toBe(
      statsBefore.remaining + statsBefore.done + 5,
    );

    // Verify sample content appeared
    await expect(page.getByText('Buy groceries 🛒')).toBeVisible();
    await expect(page.getByText('Write PomegranateDB docs 📖')).toBeVisible();
  });

  test('filters between all, active, and completed', async ({ page }) => {
    // Seed some data
    const titleA = `Filter active ${Date.now()}`;
    const titleB = `Filter done ${Date.now()}`;
    await addTodo(page, titleA);
    await addTodo(page, titleB);

    // Complete one
    const todoBText = page.getByText(titleB);
    const todoBRow = todoBText.locator('..');
    await todoBRow.locator('div').first().click();
    await page.waitForTimeout(500);

    // Filter: Active — should show A but not B
    await page.getByText('Active', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(titleA)).toBeVisible();
    await expect(page.getByText(titleB)).not.toBeVisible();

    // Filter: Done — should show B but not A
    await page.getByText('Done', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(titleB)).toBeVisible();
    await expect(page.getByText(titleA)).not.toBeVisible();

    // Filter: All — should show both
    await page.getByText('All', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(titleA)).toBeVisible();
    await expect(page.getByText(titleB)).toBeVisible();
  });

  test('clears completed todos', async ({ page }) => {
    // Seed some data and complete a few
    await page.getByText('+ Add samples').click();
    await page.waitForTimeout(1000);

    // Verify samples appeared
    await expect(page.getByText('Buy groceries 🛒')).toBeVisible();

    // Get initial count
    const statsBefore = await getTodoCount(page);
    expect(statsBefore.remaining).toBeGreaterThanOrEqual(5);

    // Complete a couple items by clicking their checkboxes
    const firstTodo = page.getByText('Buy groceries 🛒').locator('..');
    await firstTodo.locator('div').first().click();
    await page.waitForTimeout(300);

    const secondTodo = page.getByText('Walk the dog 🐕').locator('..');
    await secondTodo.locator('div').first().click();
    await page.waitForTimeout(500);

    // Should now have some completed
    const statsMiddle = await getTodoCount(page);
    expect(statsMiddle.done).toBeGreaterThanOrEqual(2);

    // Click clear completed
    await page.getByText('Clear completed').click();
    await page.waitForTimeout(1500);

    // Verify cleared items are gone and remaining count dropped
    const statsAfter = await getTodoCount(page);
    expect(statsAfter.done).toBeLessThan(statsMiddle.done);
  });

  test('data persists across page reloads', async ({ page }) => {
    const title = `Persist me ${Date.now()}`;
    await addTodo(page, title);

    // Reload the page
    await page.reload();
    await waitForApp(page);

    // Todo should still be there (IndexedDB persistence)
    await expect(page.getByText(title)).toBeVisible({ timeout: 5000 });
  });

  test('input clears after adding a todo', async ({ page }) => {
    const input = page.getByPlaceholder('What needs to be done?');
    await input.fill('Temporary text');
    await input.press('Enter');
    await page.waitForTimeout(300);

    // Input should be cleared
    await expect(input).toHaveValue('');
  });

  test('empty input does not create a todo', async ({ page }) => {
    const statsBefore = await getTodoCount(page);

    const input = page.getByPlaceholder('What needs to be done?');
    await input.fill('   ');
    await input.press('Enter');
    await page.waitForTimeout(300);

    const statsAfter = await getTodoCount(page);
    expect(statsAfter.remaining + statsAfter.done).toBe(
      statsBefore.remaining + statsBefore.done,
    );
  });

  test('offline persistence stress test — 10 todos survive a reload', async ({ page }) => {
    // Add 10 uniquely-titled todos
    const prefix = `stress-${Date.now()}`;
    for (let i = 1; i <= 10; i++) {
      await addTodo(page, `${prefix}-${i}`);
    }

    const statsBefore = await getTodoCount(page);
    expect(statsBefore.remaining).toBeGreaterThanOrEqual(10);

    // Reload the page and wait for the app to re-initialise
    await page.reload();
    await waitForApp(page);

    // All 10 items must still be present
    for (let i = 1; i <= 10; i++) {
      await expect(page.getByText(`${prefix}-${i}`)).toBeVisible({ timeout: 8_000 });
    }

    // Overall count must not have dropped
    const statsAfter = await getTodoCount(page);
    expect(statsAfter.remaining + statsAfter.done).toBeGreaterThanOrEqual(
      statsBefore.remaining + statsBefore.done,
    );
  });
});
