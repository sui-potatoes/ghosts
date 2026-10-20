import { useSyncExternalStore } from "react";
import { session, type Session } from "../session";

/** The live session; the component re-renders on every `session.changed()`. */
export function useSession(): Session {
  useSyncExternalStore(session.subscribe, session.getVersion);
  return session;
}
