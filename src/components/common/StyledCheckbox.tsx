'use client';

import { memo } from 'react';
import { useTheme } from '@mui/material/styles';

interface Props {
  'aria-label': string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Fixed blue color for checkboxes (MUI default blue, not brand orange)
const CHECKBOX_COLOR = '#1976d2';

/**
 * Lightweight checkbox for WebKitGTK stability.
 * Uses fixed dimensions to prevent layout shifts.
 * All states use same SVG container size for consistency.
 */
export const StyledCheckbox = memo(function StyledCheckbox({
  'aria-label': ariaLabel,
  checked,
  indeterminate = false,
  onChange,
}: Props) {
  const theme = useTheme();
  const borderColor = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.54)';
  
  const isActive = checked || indeterminate;
  
  return (
    <span
      className="styled-checkbox"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Fixed size to prevent layout shifts
        width: 18,
        height: 18,
        minWidth: 18,
        minHeight: 18,
        maxWidth: 18,
        maxHeight: 18,
        borderRadius: 2,
        border: `2px solid ${isActive ? CHECKBOX_COLOR : borderColor}`,
        backgroundColor: isActive ? CHECKBOX_COLOR : 'transparent',
        cursor: 'pointer',
        boxSizing: 'border-box',
        flexShrink: 0,
        flexGrow: 0,
      }}
    >
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        ref={(input) => { if (input) input.indeterminate = indeterminate; }}
        onChange={onChange}
        style={{ position: 'absolute', inset: -2, width: 18, height: 18, margin: 0, opacity: 0, cursor: 'pointer' }}
      />
      {/* Always render SVG container with fixed size - content changes based on state */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        style={{
          width: 14,
          height: 14,
          display: 'block',
        }}
      >
        {checked && !indeterminate && (
          <path
            d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
            fill="white"
          />
        )}
        {indeterminate && (
          <rect x="4" y="11" width="16" height="2" fill="white" />
        )}
      </svg>
    </span>
  );
});
