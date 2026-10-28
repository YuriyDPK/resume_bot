export async function choose(locator, value) {
  await locator.click();
  await locator.page().locator('[role="option"][data-value="' + value + '"]').click();
}
