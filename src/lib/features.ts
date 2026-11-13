/**
 * Exchanges (math trade) are not available yet: creating one and joining one are off for everyone, localhost included.
 * Set NEXT_PUBLIC_MATH_TRADE=1 (e.g. in .env.local) to turn both on while it is being built.
 */
export const MATH_TRADE_ENABLED = process.env.NEXT_PUBLIC_MATH_TRADE === '1';

export const IN_DEVELOPMENT_NOTE = '🚧 Funcionalidad en desarrollo: todavía no está disponible.';
