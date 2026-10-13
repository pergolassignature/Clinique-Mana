/** Leaves the app for an outside page in the same tab (Zoom's consent page). Its own module so tests can replace it. */
export function leaveFor(url: string): void {
  window.location.assign(url)
}
