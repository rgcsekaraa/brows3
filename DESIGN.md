---
name: S3 Browser
description: Existing compact MUI interface with light and dark surfaces and orange actions.
colors:
  primary-light: "#EA8D00"
  primary-dark: "#FF9900"
  primary-hover: "#CC7A00"
  primary-contrast: "#000000"
  url-text-action-light: "#995700"
  secondary: "#232F3E"
  background-light: "#F8F9FA"
  paper-light: "#FFFFFF"
  text-light: "#111827"
  text-secondary-light: "#374151"
  divider-light: "#E5E7EB"
  background-dark: "#0B0F19"
  paper-dark: "#111827"
  text-dark: "#F9FAFB"
  text-secondary-dark: "#9CA3AF"
  divider-dark: "#1F2937"
  success: "#2E7D32"
  error: "#D32F2F"
  warning: "#ED6C02"
  info: "#0288D1"
typography:
  display:
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif'
    fontSize: "2.5rem"
    fontWeight: 800
    letterSpacing: "-0.03em"
  headline:
    fontSize: "1.5rem"
    fontWeight: 700
    letterSpacing: "-0.025em"
  dialog-title:
    fontSize: "1.1rem"
    fontWeight: 800
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif'
    fontSize: "0.925rem"
    lineHeight: 1.6
  compact-body:
    fontSize: "0.85rem"
    fontWeight: 500
  label:
    fontWeight: 700
    letterSpacing: "-0.01em"
rounded:
  surface: "4px"
  pill: "999px"
spacing:
  half: "4px"
  one: "8px"
  one-and-half: "12px"
  two: "16px"
  two-and-half: "20px"
  three: "24px"
  four: "32px"
components:
  button-primary-light:
    backgroundColor: "{colors.primary-light}"
    textColor: "{colors.primary-contrast}"
    rounded: "{rounded.pill}"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.primary-contrast}"
    rounded: "{rounded.pill}"
  button-url-text-light:
    textColor: "{colors.url-text-action-light}"
    rounded: "{rounded.pill}"
  button-url-text-dark:
    textColor: "{colors.primary-dark}"
    rounded: "{rounded.pill}"
  dialog-light:
    backgroundColor: "{colors.paper-light}"
    rounded: "{rounded.surface}"
---

# Design System: S3 Browser

## Overview

This document records the incumbent interface, with the existing theme and components as authority. It uses compact MUI controls, orange actions, and light or dark neutral surfaces. No new visual identity or metaphor is introduced.

Key characteristics:

- Compact controls and small text for operational screens.
- Pill action buttons alongside gently rounded dialogs and fields.
- Shared light and dark modes with semantic feedback colors.

Sources: `src/lib/theme.ts`, `src/components/common/BaseDialog.tsx`, `src/components/common/urlActionStyles.ts`, and the URL workflow components. The surface contract is `.impeccable/surfaces/url-workflows.md`.

## Colors

Primary orange identifies filled actions. The primary foreground is black. The theme's secondary color is dark blue. Neutral backgrounds, paper, text, and divider tokens vary by mode; feedback uses the existing success, error, warning, and info palette.

URL workflow text and outlined buttons use the local darker orange token for their labels in light mode and the theme primary in dark mode. This adjustment applies to enabled labels only. Filled buttons and outlined borders continue using the theme palette.

## Typography

The shared font stack starts with Inter, then Roboto, Helvetica, Arial, and sans-serif. Theme headings use bold weights and negative tracking. Dialog titles have their own title token. Body copy uses the body role; supporting workflow descriptions and review rows use compact body text. Buttons retain sentence case and the theme's bold label treatment.

## Layout

MUI spacing follows an eight-pixel base with half steps. BaseDialog uses 20px header padding, 24px content padding with 32px top padding, and 24px footer padding with 8px top padding. Footer actions have a 12px gap. URL dialogs request full width with the `md` maximum width.

URL import content forms one column with 16px gaps. Compact review rows use dividers and expand their options in place. Source actions and profile bucket override fields wrap. Long destination paths, object keys, and host text wrap within their containers. URL review pages show ten entries at a time. The surface contract targets no horizontal overflow at 800px and 1440px.

## Elevation & Depth

The app bar has no shadow and uses a bottom divider. Drawers use a side divider. BaseDialog combines a subtle border, a shadow, and backdrop blur. Dark dialogs use the paper color at 80% opacity; light dialogs use opaque white. The dialog backdrop uses black at 70% in dark mode and 40% in light mode. Exact shadows and blur values are recorded in the sidecar.

Theme transition durations are zero. Button, icon button, list item, and list item button transitions are disabled; button ripple remains enabled.

## Shapes

The theme's base corner radius is the surface token. URL action buttons use the pill token. Text fields retain MUI's outlined shape. Review rows use bottom dividers rather than separate decorative cards.

## Components

Buttons use the existing MUI small size in URL workflows. Filled actions sit in the dialog footer, outlined actions add links to review, and text actions perform secondary operations. Busy and invalid states disable the relevant actions.

BaseDialog provides the shared title, accessible close control, scrollable content, and footer. Its title uses a white gradient in dark mode and a black gradient in light mode. Use the existing component instead of recreating its frame.

Text fields use visible labels and supporting helper text. Public links remain editable. Import source fields in expanded review rows use password presentation. Validation uses field errors and existing semantic alerts.

Public URL settings use a transparent, zero-elevation accordion. Import review rows disclose per-file options with compact icon buttons. Transfer recovery actions use small icon buttons with accessible names and tooltips. These workflows remain within the established profile, dialog, and transfer surfaces.

## Do's and Don'ts

- Do reuse the theme and BaseDialog for additional workflow surfaces.
- Do keep URL workflow controls compact and use the shared local action style.
- Do preserve both light and dark appearances and visible disabled, error, and busy states.
- Don't replace the existing dark, orange, and light visual system.
- Don't promote the local URL text-action contrast adjustment into an unrequested global palette change.
