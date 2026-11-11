// Little painted pictures for the HUD's need gauges: a heart, a roast leg of
// fowl, a drop of water and a bolt of strength, drawn in ink with a light
// wash, to sit on the gauges' glass.

const INK = '#2a1a0c';

export const NEED_ICONS: Record<'health' | 'food' | 'water' | 'stamina', string> = {
  health: `<svg viewBox="0 0 48 48" class="orb-icon"><defs><radialGradient id="ic-h" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ff9b8a"/><stop offset="0.6" stop-color="#d23a2c"/><stop offset="1" stop-color="#7a1810"/></radialGradient></defs>
    <path d="M24 40 C10 30 6 23 7 16.5 C8 10.5 13 7.5 17.5 8 C20.5 8.3 22.6 10.2 24 12.8 C25.4 10.2 27.5 8.3 30.5 8 C35 7.5 40 10.5 41 16.5 C42 23 38 30 24 40 Z" fill="url(#ic-h)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M13 15.5 C13.5 12.8 15.8 11.4 18 11.8" fill="none" stroke="#ffe2da" stroke-width="2" stroke-linecap="round" opacity="0.9"/></svg>`,
  food: `<svg viewBox="0 0 48 48" class="orb-icon"><defs><radialGradient id="ic-f" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#f6c27a"/><stop offset="0.55" stop-color="#c0702a"/><stop offset="1" stop-color="#6e3612"/></radialGradient></defs>
    <path d="M29.5 9.5 C37.5 8 42.5 14 40.5 21 C38.8 27 32 30.5 26.5 29 L19.5 35.5 C20.8 37.6 20 40.4 17.6 41 C15.6 41.5 14 40 14.3 38.2 C12.4 38.6 10.6 37 11.2 35 C11.9 32.8 14.6 32.2 16.5 33.4 L23.2 26.6 C21.3 21.3 23.6 11 29.5 9.5 Z" fill="url(#ic-f)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M17 33.6 L21.6 29 M19.4 35.8 L23.6 31.4" stroke="#f3e6cc" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M28.5 14 C32 12.6 35.5 14 36.6 17" fill="none" stroke="#ffe6b8" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
    <path d="M30 22.5 l1.2 1.2 M34 19.5 l1 1 M27.5 18 l1 1" stroke="#7a3e14" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  water: `<svg viewBox="0 0 48 48" class="orb-icon"><defs><radialGradient id="ic-w" cx="38%" cy="55%" r="70%"><stop offset="0" stop-color="#bfe6ff"/><stop offset="0.55" stop-color="#3f8fd0"/><stop offset="1" stop-color="#174a7c"/></radialGradient></defs>
    <path d="M24 6.5 C24 6.5 37 21.5 37 29 C37 36.4 31.2 41.5 24 41.5 C16.8 41.5 11 36.4 11 29 C11 21.5 24 6.5 24 6.5 Z" fill="url(#ic-w)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M17 29.5 C17 26 19 23 21 21" fill="none" stroke="#f0faff" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/></svg>`,
  stamina: `<svg viewBox="0 0 48 48" class="orb-icon"><defs><linearGradient id="ic-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8ffb0"/><stop offset="0.55" stop-color="#8cc63a"/><stop offset="1" stop-color="#3f6e14"/></linearGradient></defs>
    <path d="M27.5 5.5 L12.5 27 L22.5 27 L18.5 42.5 L35.5 19.5 L25 19.5 Z" fill="url(#ic-s)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M25.5 10 L17.5 22.5" stroke="#fbffe8" stroke-width="2" stroke-linecap="round" opacity="0.85"/></svg>`,
};

/** A small coin, for purses. */
export const COIN_ICON = `<svg viewBox="0 0 24 24" class="coin-icon"><circle cx="12" cy="12" r="9" fill="#d9a83a" stroke="${INK}" stroke-width="1.6"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#8a6416" stroke-width="1.2"/><path d="M8.5 9 C9.5 7.6 11 7 12.5 7.2" stroke="#fff1c0" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;

/** A little house, for settlements. */
export const SETTLEMENT_ICON = `<svg viewBox="0 0 24 24" class="place-icon"><path d="M3 11 L12 4 L21 11" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M5.5 10 L5.5 20 L18.5 20 L18.5 10" fill="#c9a26a" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><rect x="10" y="14" width="4" height="6" fill="#6b4422" stroke="${INK}" stroke-width="1.2"/></svg>`;

/** A compass rose, for the open country. */
export const WILDS_ICON = `<svg viewBox="0 0 24 24" class="place-icon"><circle cx="12" cy="12" r="9" fill="none" stroke="${INK}" stroke-width="1.4"/><path d="M12 3.5 L14 12 L12 20.5 L10 12 Z" fill="#9a2d1e" stroke="${INK}" stroke-width="1"/><path d="M3.5 12 L12 10 L20.5 12 L12 14 Z" fill="#c9a26a" stroke="${INK}" stroke-width="1"/></svg>`;
