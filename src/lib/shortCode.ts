import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

const CHARS = "ABCDEFGHJKLMNPQRTUVWXY3479";

function generate(length = 6): string {
  return Array.from({ length }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join("");
}

export async function generateUniqueShortCode(): Promise<string> {
  for (let attempts = 0; attempts < 20; attempts++) {
    const code = generate();
    const snap = await getDoc(doc(db, "events", code));
    if (!snap.exists()) return code;
  }
  throw new Error("Could not generate unique event short code after 20 attempts");
}
