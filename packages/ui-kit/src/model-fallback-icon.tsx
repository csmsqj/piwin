/**
 * Neutral "model" mark for a model whose vendor has no brand icon.
 * Used instead of a provider monogram so an unbranded model (e.g. a relay's
 * in-house model) doesn't read as if the channel's letter were its logo.
 */

import type { CSSProperties, ReactElement } from 'react';
import { IconSpark } from './icons/conversation-icons.js';

export type ModelFallbackIconProps = {
  size?: number;
  radius?: number | string;
  /** `avatar` (default) draws the neutral tile; `glyph` is the bare mark. */
  variant?: 'avatar' | 'glyph';
  className?: string;
  style?: CSSProperties;
  /** Forwarded as `data-provider-icon` so callers keep one attribute contract. */
  providerId?: string;
};

const FALLBACK_BG = '#edf1f6';
const FALLBACK_FG = '#64748b';

export function ModelFallbackIcon(props: ModelFallbackIconProps): ReactElement {
  const size = props.size ?? 28;
  const isGlyph = props.variant === 'glyph';
  const radius = props.radius ?? Math.max(8, Math.round(size * 0.29));
  const className = ['provider-icon', 'is-model-fallback', isGlyph ? 'is-glyph' : '', props.className]
    .filter(Boolean)
    .join(' ');
  // The spark's strokes are thin at small sizes; the glyph variant sits in
  // text lines, so it takes the full box like brand glyphs do.
  const markSize = isGlyph ? size : Math.round(size * 0.62);

  return (
    <span
      className={className}
      aria-hidden
      data-provider-icon={props.providerId}
      data-provider-brand="model"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        userSelect: 'none',
        ...(isGlyph
          ? {}
          : { borderRadius: radius, background: FALLBACK_BG, color: FALLBACK_FG }),
        ...props.style,
      }}
    >
      <IconSpark size={markSize} strokeWidth={1.8} style={{ display: 'block' }} />
    </span>
  );
}
