// Real back end: IndexedDB library + Microsoft account and sync.
// (Placeholder until library.js and account.js land.)
export async function createBackend() {
  const { createMock } = await import("./mock.js");
  return createMock("unconfigured");
}
