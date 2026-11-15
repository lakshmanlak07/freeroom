/** Part 2: the people count is typeable, steppable, validated inline, and synced to the URL. */
import { expect, test } from '@playwright/test';
import { OWNER, login } from '../helpers';

test('search people count: type, arrow keys, steppers, inline error, URL sync', async ({
  page,
}) => {
  await login(page, OWNER);
  await page.goto('/');
  const people = page.getByLabel('People', { exact: true });
  await expect(people).toHaveAttribute('inputmode', 'numeric');

  await people.fill('12');
  await people.blur();
  await expect(page).toHaveURL(/minCapacity=12/);

  await people.press('ArrowUp');
  await expect(people).toHaveValue('13');
  await expect(page).toHaveURL(/minCapacity=13/);
  await page.getByRole('button', { name: 'Fewer: People' }).click();
  await expect(page).toHaveURL(/minCapacity=12/);

  await people.fill('0');
  await people.blur();
  const err = page.locator('#min-capacity-error');
  await expect(err).toHaveText('At least 1.');
  await expect(people).toHaveAttribute('aria-invalid', 'true');
  await expect(people).toHaveAttribute('aria-describedby', /min-capacity-error/);
  await expect(page).toHaveURL(/minCapacity=12/); // invalid input never reaches the URL

  await people.fill('');
  await people.blur();
  await expect(err).toHaveCount(0);
  await expect(page).not.toHaveURL(/minCapacity=/);

  // 16px text (no iOS zoom on focus) and 44px tap targets.
  expect(await people.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  const plus = (await page.getByRole('button', { name: 'More: People' }).boundingBox())!;
  expect(plus.height).toBeGreaterThanOrEqual(44);
});
