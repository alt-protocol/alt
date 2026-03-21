```markdown
# Design System Document: The Kinetic Architect

## 1. Overview & Creative North Star: "The Kinetic Architect"
This design system is built upon the concept of **The Kinetic Architect**. It moves away from the "startup-chic" aesthetic of rounded bubbles and friendly gradients, favoring instead the cold, calculated precision of architectural blueprints and high-end editorial journals. 

The goal is to establish **Institutional Trust** through data clarity and brutalist elegance. We achieve this by rejecting "standard" UI patterns in favor of high-density layouts, intentional asymmetry, and a sophisticated interplay between deep charcoal voids and high-precision neon accents. We do not chase hype; we provide a platform for absolute clarity.

---

## 2. Colors & Tonal Architecture
The palette is rooted in deep, light-absorbing neutrals, punctuated by a surgical application of neon.

### Color Tokens
*   **Surface (Primary):** `#131313` (The Foundation)
*   **Neon Primary:** `#d9f99d` (The Precision Tool)
*   **Secondary (Slate/Purple):** `secondary_container: #4f319c` | `on_secondary: #381385`
*   **Tertiary (Deep Tech):** `tertiary_fixed_dim: #c0c1ff`

### The "No-Line" Rule
Traditional 1px solid borders are strictly prohibited for sectioning. We define space through **Surface Shifts**. Boundaries are created by placing a `surface_container_low` element directly against a `surface` background. This creates a "monolithic" feel where the UI looks carved from a single block rather than assembled from parts.

### Surface Hierarchy & Nesting
Use the `surface_container` tiers to create depth. To highlight a specific data module:
1.  **Base Layer:** `surface` (`#131313`)
2.  **Section Layer:** `surface_container_low` (`#1c1b1b`)
3.  **Active Component:** `surface_container_high` (`#2a2a2a`)

### The Glass & Gradient Rule
For floating overlays or high-importance modal states, use **Glassmorphism**. Apply a backdrop-blur of 12px-20px to a 60% opaque `surface_container`. Subtle gradients should only exist between `primary_fixed` (`#ceee93`) and `primary_fixed_dim` (`#b3d17a`) to give main CTAs a "lit-from-within" glow, mimicking a physical neon tube.

---

## 3. Typography
The typographic system relies on the tension between the geometric, technical `Space Grotesk` and the highly legible, professional `Manrope`.

*   **Display & Headline (Space Grotesk):** These should be treated as architectural elements. Use `display-lg` (3.5rem) for hero moments with a tight `-0.02em` letter-spacing. This font communicates the "Dessau-inspired" heritage—functional and bold.
*   **Body & Labels (Manrope):** Use `body-md` (0.875rem) for all technical data. Manrope’s neutrality balances the aggression of the headlines, ensuring institutional trust.
*   **Hierarchy Tip:** For labels, use `label-sm` in uppercase with `+0.05em` letter-spacing to create a "technical blueprint" feel.

---

## 4. Elevation & Depth
In this system, elevation is a matter of light and tone, not physical shadows.

*   **The Layering Principle:** Depth is achieved by stacking surface tokens. A `surface_container_lowest` card placed on a `surface_container_high` background creates a "recessed" effect, suggesting the data is etched into the screen.
*   **Ambient Shadows:** If a floating element (like a dropdown) is required, use an extra-diffused shadow: `box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4)`. The shadow color must never be pure black; it should be a deep tint of your surface color.
*   **The "Ghost Border" Fallback:** If accessibility demands a border, use the `outline_variant` token at **15% opacity**. This "Ghost Border" provides a hint of structure without breaking the monolithic aesthetic.

---

## 5. Components

### Buttons
*   **Primary:** Background: `primary` (#ffffff), Text: `on_primary` (#243600). Roundedness: `sm` (0.125rem). This high-contrast white button serves as the ultimate focal point.
*   **Precision (Neon):** Background: `#d9f99d`, Text: `#131f00`. Used for "Success" states or critical "Commit" actions.
*   **Secondary:** Ghost style using the `outline` token at 20% opacity. Text in `on_surface`.

### Cards & Data Modules
*   **Strict Rule:** No dividers. Separate content using the spacing scale (e.g., `spacing-8` or `1.75rem`).
*   **Background:** Use `surface_container_lowest` for a subtle "sunken" data field look.
*   **Edge Treatment:** Use the `sm` (0.125rem) or `none` (0px) roundedness for a sharper, more architectural feel.

### Input Fields
*   **State:** Unfocused inputs should have no visible border, only a background shift to `surface_container_low`.
*   **Focus:** Transition the background to `surface_container_high` and introduce a precision neon underline (2px) using `primary_container`.

### Chips & Tags
*   Compact, rectangular (roundedness: `sm`). Use `secondary_container` backgrounds with `on_secondary_container` text for a subtle purple-charcoal tech vibe.

---

## 6. Do’s and Don’ts

### Do:
*   **Embrace High Density:** Use the spacing scale (0.2rem - 0.5rem) to pack data tightly. This is for professionals, not casual scrollers.
*   **Use Asymmetry:** Align text to the left while placing data metrics on the far right of a container to create an editorial "spread" feel.
*   **Prioritize Type Scale:** Let the difference between `display-lg` and `label-sm` create the visual interest.

### Don’t:
*   **No Gamification:** Avoid bouncy animations, "friendly" icons, or bright primary-color backgrounds for anything other than specific CTAs.
*   **No 1px Borders:** Never use a solid, high-contrast line to separate two sections of the same importance.
*   **No Standard Shadows:** Avoid the "Material Design" look of 2px blur shadows. Keep it tonal or keep it flat.
*   **No Large Radii:** Never use `rounded-full` or `xl` (0.75rem) for functional containers. Keep corners sharp (`sm` or `none`) to maintain the brutalist elegance.

---

## 7. Spacing Utility Reference
*   **Micro (1.5):** 0.3rem — For internal label-to-data spacing.
*   **Standard (4):** 0.9rem — For internal component padding.
*   **Section (10):** 2.25rem — For vertical separation between major data modules.
*   **Gutter (16):** 3.5rem — For page margins.```