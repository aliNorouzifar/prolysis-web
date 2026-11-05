// The session id is client-generated and held in localStorage; the backend upserts it
// on first use, so a returning browser keeps its workspace across restarts.
const KEY = "prolysis.session";

export function sessionId(): string {
  let sid = localStorage.getItem(KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem(KEY, sid);
  }
  return sid;
}

export function resetSession(): string {
  localStorage.removeItem(KEY);
  return sessionId();
}
