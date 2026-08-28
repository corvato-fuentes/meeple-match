// Shared sessionStorage key so the board page's "← Volver" can return to wherever it was opened
// from (admin dashboard or a player's ticket page). Client-side <Link> navigation never updates
// document.referrer, so that can't be used to detect the origin page.
export function BOARD_RETURN_KEY(code: string): string {
  return `mm_board_return_${code}`;
}
