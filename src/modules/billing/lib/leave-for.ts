/** Leaves the app for an outside page in the same tab (Intuit's consent page, Stripe Checkout). Its own module so tests can replace it. */
export function leaveFor(url: string): void {
  window.location.assign(url)
}
