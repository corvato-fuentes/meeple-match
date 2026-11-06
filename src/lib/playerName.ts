/** The name shown everywhere for a player: their alias if they have one, otherwise "first last". */
export function displayNameOf(firstName: string, lastName: string, alias?: string | null): string {
  return alias?.trim() || `${firstName.trim()} ${lastName.trim()}`.trim();
}
