# Blocks Design System

A comprehensive design system documentation for maintaining consistent UI/UX across Blocks applications. This guide defines typography, color palette, spacing, shadows, and component styling standards.

---

## 1. Typography

### Font Family

- **Primary Font**: DM Sans
- **Fallback**: system-ui, -apple-system, sans-serif

### Font Sizes & Weights

| Element         | Size            | Weight | Line Height | Usage                          |
| --------------- | --------------- | ------ | ----------- | ------------------------------ |
| h3 (Card Title) | 1.25rem (20px)  | 600    | 1.2         | Section headers within cards   |
| Default Body    | 0.875rem (14px) | 400    | 1.5         | Standard paragraph text        |
| Small           | 0.75rem (12px)  | 400    | 1.5         | Helper text, captions, badges  |
| Labels          | 0.875rem (14px) | 500    | -           | Form labels, table headers     |
| Medium Emphasis | 0.875rem (14px) | 500    | -           | Emphasized text within content |

### Text Styles

- **Tracking**: Default tight (CSS tracking-tight: -0.015em)
- **Line Clamp**: Use `line-clamp-1` for truncated single line text
- **Emphasis Hierarchy**: High → Medium → Low emphasis colors applied to text

---

## 2. Color Palette

### Light Mode

#### Primary Colors

| Variable               | HSL Value    | RGB Hex   | Usage                        |
| ---------------------- | ------------ | --------- | ---------------------------- |
| `--primary`            | 206 100% 35% | `#0066B2` | Primary actions, CTAs, links |
| `--primary-foreground` | 210 40% 98%  | `#F7F9FC` | Text on primary background   |

#### Secondary Colors

| Variable                 | HSL Value         | RGB Hex   | Usage                                |
| ------------------------ | ----------------- | --------- | ------------------------------------ |
| `--secondary`            | 210 40% 96.1%     | `#EFF2F7` | Secondary buttons, muted backgrounds |
| `--secondary-foreground` | 222.2 47.4% 11.2% | `#1A1F3A` | Text on secondary background         |

#### Blocks Color System (Light)

**Primary Gradient** (Blue-based):

- 25: `#F3F7FC` (Lightest)
- 50: `#CBE2F4`
- 100: `#A8CEED`
- 200: `#7CB8E0`
- 300: `#5BA5D7`
- 400: `#5BA5D7`
- 500: `#1B5BA8` (Core primary)
- 600: `#0D3B7A` (Darker)
- 700: `#031D52` (Darkest)
- 800: `#000311` (Near black)
- 900: `#000000`

**Secondary Gradient** (Teal-based):

- 50: `#F2FFFD`
- 100: `#CDEFF0`
- 200: `#A8E0E3`
- 300: `#84D2D7`
- 400: `#60C4CB`
- 500: `#15AC97` (Core secondary)
- 600: `#0E8B79` (Darker)
- 700: `#086A5B` (Darkest)
- 800: `#024940` (Near black)
- 900: `#001814`

#### Neutral & Emphasis Colors (Light)

| Variable                   | HSL Value      | Usage                          |
| -------------------------- | -------------- | ------------------------------ |
| `--background`             | 0 0% 100%      | Main page background           |
| `--foreground`             | 222.2 84% 4.9% | Primary text (#0E1419)         |
| `--card`                   | 0 0% 100%      | Card backgrounds               |
| `--card-foreground`        | 222.2 84% 4.9% | Text on cards                  |
| `--border-default`         | 0 0% 85%       | Default borders (#D9D9D9)      |
| `--border-medium-emphasis` | 0 0% 48%       | Medium emphasis borders        |
| `--high-emphasis`          | 0 0% 15%       | High emphasis text (#262626)   |
| `--medium-emphasis`        | 0 0% 33%       | Medium emphasis text (#545454) |
| `--low-emphasis`           | 0 0% 62%       | Low emphasis text (#9E9E9E)    |

#### Status Colors (Light)

| Color   | HSL Value   | Hex       | Usage                         |
| ------- | ----------- | --------- | ----------------------------- |
| Error   | 0 100% 60%  | `#FF3333` | Destructive actions, errors   |
| Success | 146 79% 44% | `#22C55E` | Success states, confirmations |
| Warning | 43 94% 56%  | `#FBBF24` | Warnings, cautions            |

**Warning Gradient** (Light):

- 50: `#FFFBEB`
- 100: `#FEF3C7`
- 200: `#FDE68A`
- 300: `#FCD34D`
- 400: `#FBBF24`
- 500: `#F59E0B`
- 600: `#D97706`
- 700: `#B45309`
- 800: `#92400E`
- 900: `#78350F`

#### Chart Colors

| Variable          | HSL Value   | Usage              |
| ----------------- | ----------- | ------------------ |
| `--chart-purple`  | 277 66% 71% | Data visualization |
| `--chart-magenta` | 312 99% 68% | Data visualization |
| `--chart-yellow`  | 49 89% 49%  | Data visualization |
| `--chart-red`     | 2 71% 70%   | Data visualization |
| `--chart-blue`    | 211 96% 70% | Data visualization |
| `--chart-orange`  | 30 92% 57%  | Data visualization |

#### Other Colors

| Variable                      | Value       | Usage                         |
| ----------------------------- | ----------- | ----------------------------- |
| `--avatar-surface-default`    | `#C0C9D1`   | Avatar backgrounds            |
| `--avatar-text-high-emphasis` | `#262626`   | Text on avatars               |
| `--surface-app`               | 220 33% 96% | App surfaces, alt backgrounds |

---

### Dark Mode

#### Primary Colors

| Variable               | HSL Value   | RGB Hex   | Usage                        |
| ---------------------- | ----------- | --------- | ---------------------------- |
| `--primary`            | 218 75% 45% | `#4B8FDB` | Primary actions, CTAs, links |
| `--primary-foreground` | 0 0% 96%    | `#F5F5F5` | Text on primary background   |

#### Secondary Colors

| Variable                 | HSL Value         | RGB Hex   | Usage                                |
| ------------------------ | ----------------- | --------- | ------------------------------------ |
| `--secondary`            | 217.2 32.6% 17.5% | `#1E2A3A` | Secondary buttons, muted backgrounds |
| `--secondary-foreground` | 210 40% 98%       | `#F7F9FC` | Text on secondary background         |

#### Blocks Color System (Dark)

**Primary Gradient** (Blue-based):

- 25: `#050C1B` (Lightest in dark)
- 50: `#0D1A36`
- 100: `#1A2C54`
- 200: `#273E6F`
- 300: `#34508A`
- 400: `#4162A5`
- 500: `#4B8FDB` (Core primary)
- 600: `#6BA3E0`
- 700: `#8BB8E8`
- 800: `#A8C7EF`
- 900: `#D0E0F6`

**Secondary Gradient** (Teal-based):

- 50: `#051612`
- 100: `#0A2724`
- 200: `#0F3836`
- 300: `#1A4D46`
- 400: `#2A6460`
- 500: `#42B5A0` (Core secondary)
- 600: `#5ECAB8`
- 700: `#7DDFCE`
- 800: `#A5EDE4`
- 900: `#CEFAF5`

#### Neutral & Emphasis Colors (Dark)

| Variable                   | HSL Value      | Usage                          |
| -------------------------- | -------------- | ------------------------------ |
| `--background`             | 222.2 84% 4.9% | Main page background (#0E1419) |
| `--foreground`             | 210 40% 98%    | Primary text (#F7F9FC)         |
| `--card`                   | 222.2 84% 4.9% | Card backgrounds               |
| `--card-foreground`        | 210 40% 98%    | Text on cards                  |
| `--border-default`         | 0 0% 85%       | Default borders (inherited)    |
| `--border-medium-emphasis` | 0 0% 48%       | Medium emphasis borders        |
| `--high-emphasis`          | 0 0% 96%       | High emphasis text (#F5F5F5)   |
| `--medium-emphasis`        | 0 0% 85%       | Medium emphasis text (#D9D9D9) |
| `--low-emphasis`           | 0 0% 62%       | Low emphasis text (#9E9E9E)    |

#### Status Colors (Dark)

| Color   | HSL Value   | Hex       | Usage                         |
| ------- | ----------- | --------- | ----------------------------- |
| Error   | 0 100% 60%  | `#FF3333` | Destructive actions, errors   |
| Success | 146 79% 44% | `#22C55E` | Success states, confirmations |
| Warning | 43 71% 49%  | `#F59E0B` | Warnings, cautions            |

**Warning Gradient** (Dark):

- 50: `#1E1309`
- 100: `#2C1E0F`
- 200: `#3A2A15`
- 300: `#483619`
- 400: `#564220`
- 500: `#644E27`
- 600: `#7A5A3A`
- 700: `#908646`
- 800: `#A69250`
- 900: `#BAA858`

**Error Colors** (Dark):
| Variable | Value | Usage |
|----------|-------|-------|
| `--blocks-error-50` | `#2C1415` | Error backgrounds |
| `--blocks-error-100` | `#451719` | Error surfaces |
| `--blocks-error-800` | `#F8B1A8` | Error text |
| `--base-error` | `#FF3333` | Error accents |

#### Other Colors (Dark)

| Variable                      | Value      | Usage                         |
| ----------------------------- | ---------- | ----------------------------- |
| `--surface-app`               | 216 73% 3% | App surfaces, alt backgrounds |
| `--avatar-surface-default`    | `#C0C9D1`  | Avatar backgrounds            |
| `--avatar-text-high-emphasis` | `#262626`  | Text on avatars               |

---

## 3. Spacing System

### Base Spacing Unit

Tailwind default spacing scale (4px base):

- xs: 0.5rem (8px)
- sm: 1rem (16px)
- md: 1.5rem (24px)
- lg: 2rem (32px)
- xl: 2.5rem (40px)

### Common Spacing Patterns

| Element                | Spacing                 | Usage                                              |
| ---------------------- | ----------------------- | -------------------------------------------------- |
| Page Container Padding | 2rem (32px)             | Horizontal padding on pages                        |
| Card Padding           | px-5 py-4 (20px / 16px) | Standard card content padding                      |
| Card Header Margin     | mb-5 (20px)             | Space between header and content                   |
| Gap in Grids           | gap-3 (12px)            | Small gap; gap-4 (16px) Medium; gap-6 (24px) Large |
| Component Spacing      | space-y-1.5 (6px)       | Between label and content pairs                    |

---

## 4. Border Radius

### System Values

- **Base Radius Variable**: `--radius: 0.5rem` (8px)
- **lg**: 0.5rem (8px) - Most components
- **md**: calc(var(--radius) - 2px) = 6px - Medium components
- **sm**: calc(var(--radius) - 4px) = 4px - Small components

### Usage Examples

| Component      | Radius                                   | Example                                     |
| -------------- | ---------------------------------------- | ------------------------------------------- |
| Cards          | `rounded-sm` (4px) or `rounded-lg` (8px) | Card containers                             |
| Buttons        | `rounded-sm` (4px)                       | Most buttons; `rounded-xl` for pill buttons |
| Inputs         | `rounded-md` (6px)                       | Form inputs                                 |
| Modals/Dialogs | `rounded-lg` (8px)                       | Modal containers                            |
| Pills          | `rounded-xl` (12px)                      | Status/environment badges                   |

---

## 5. Shadows

### Shadow Scales

#### Light Mode

| Class       | CSS Value                  | Usage                              |
| ----------- | -------------------------- | ---------------------------------- |
| `shadow-sm` | 0 1px 2px rgba(0,0,0,0.05) | Subtle shadow for elevated content |
| (Default)   | None or minimal            | Most UI components                 |

#### Dark Mode

- Shadows remain consistent with light mode for visual elevation

### Shadow Application Rules

- **Cards**: Use `shadow-sm` for subtle elevation
- **Dropdowns/Modals**: Apply shadow for focus/elevation
- **Hover States**: Increase shadow opacity slightly on hover
- **Default Elements**: No shadow for flat design aesthetic

---

## 6. Component Styling Standards

### Buttons

#### Variants

| Variant               | Background          | Text                          | Hover State               |
| --------------------- | ------------------- | ----------------------------- | ------------------------- |
| `default`/`primary`   | `bg-primary`        | White                         | `hover:opacity-90`        |
| `secondary`           | `bg-secondary`      | `text-secondary-foreground`   | `hover:bg-secondary/80`   |
| `destructive`         | `bg-destructive`    | `text-destructive-foreground` | `hover:bg-destructive/90` |
| `destructive-outline` | Transparent         | `text-error`                  | `hover:bg-destructive/20` |
| `outline`             | Transparent, border | `text-accent-foreground`      | `hover:bg-accent`         |
| `ghost`               | Transparent         | Inherit                       | `hover:bg-accent`         |
| `link`                | None                | `text-primary`                | `hover:underline`         |

#### Sizes

| Size      | Height | Padding     | Usage                      |
| --------- | ------ | ----------- | -------------------------- |
| `xxs`     | 6px    | px-4 py-2   | Very small, inline actions |
| `xs`      | 8px    | px-4 py-2   | Small actions              |
| `sm`      | 9px    | px-4 py-2   | Regular small buttons      |
| `default` | 10px   | px-4 py-2   | Standard button height     |
| `lg`      | 11px   | px-8        | Large CTA buttons          |
| `icon`    | 10px   | 10px x 10px | Icon-only buttons          |

#### States

- **Disabled**: `opacity-50`, `cursor-not-allowed`
- **Focus**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Transition**: `transition-colors`

### Cards

#### Structure

```tsx
<Card className="rounded-sm border bg-card px-2 py-2 shadow-sm">
  <CardHeader className="mb-5 flex flex-col">
    <CardTitle className="text-xl font-semibold text-high-emphasis" />
    <CardDescription className="text-sm text-muted-foreground" />
  </CardHeader>
  <CardContent />
  <CardFooter className="flex items-center" />
</Card>
```

#### Styling

- **Border**: `border` (using `--border` CSS variable)
- **Background**: `bg-card`
- **Padding**: `px-2 py-2` (minimum) to `px-5 py-4` (standard)
- **Shadow**: `shadow-sm`
- **Radius**: `rounded-sm` (4px) default

### Form Elements

#### Inputs

- **Height**: 40px (h-10)
- **Border**: `border border-input`
- **Padding**: `px-3 py-2`
- **Border Radius**: `rounded-md` (6px)
- **Focus**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Placeholder**: `placeholder:text-muted-foreground`
- **Disabled**: `disabled:cursor-not-allowed disabled:opacity-50`

#### Labels

- **Typography**: `text-sm` base text
- **Color**: Use high-emphasis, medium-emphasis, or muted-foreground based on hierarchy

### Badges

#### Variants

| Variant       | Background       | Text                          | Border      | Hover                     |
| ------------- | ---------------- | ----------------------------- | ----------- | ------------------------- |
| `default`     | `bg-primary`     | `text-primary-foreground`     | Transparent | `hover:bg-primary/80`     |
| `secondary`   | `bg-secondary`   | `text-secondary-foreground`   | Transparent | `hover:bg-secondary/80`   |
| `destructive` | `bg-destructive` | `text-destructive-foreground` | Transparent | `hover:bg-destructive/80` |
| `outline`     | Transparent      | `text-foreground`             | Varies      | -                         |
| `success`     | `bg-green-100`   | `text-green-800`              | Transparent | -                         |
| `error`       | `bg-red-100`     | `text-red-800`                | Transparent | -                         |
| `info`        | `bg-blue-50`     | `text-blue-800`               | Transparent | -                         |

#### Styling

- **Padding**: `px-2 py-1`
- **Border Radius**: `rounded`
- **Font**: `text-xs font-semibold`

### Alerts

#### Variants

| Variant       | Background | Text Color             | Usage                  |
| ------------- | ---------- | ---------------------- | ---------------------- |
| `default`     | `bg-card`  | `text-card-foreground` | Neutral information    |
| `destructive` | `bg-card`  | `text-destructive`     | Error/warning messages |

#### Styling

- **Padding**: `px-4 py-3`
- **Border**: `rounded-lg border`
- **Font**: `text-sm`
- **Icon**: 4px size, vertically aligned
- **Grid Layout**: Icon + content side-by-side with 12px gap

### Tables

#### Structure

- **Container**: Wrapped in `relative w-full overflow-auto`
- **Font**: `text-sm`
- **Header Background**: Inherits from `thead`
- **Row Borders**: `border-b` with last row border removed
- **Row Hover** (optional): `hover:bg-muted/50` with `cursor-pointer`

#### Cell Sizing

- **Table Head Height**: 12px (h-12)
- **Table Head Padding**: `px-2` mobile, `md:px-4` desktop
- **Table Cell Padding**: `p-2 md:px-4 md:py-3`

---

## 7. Emphasis & Text Hierarchy

### Text Color Hierarchy (Light Mode)

| Level  | Color Variable       | HSL Value         | Usage                            |
| ------ | -------------------- | ----------------- | -------------------------------- |
| High   | `--high-emphasis`    | 0 0% 15%          | Primary text, headings (#262626) |
| Medium | `--medium-emphasis`  | 0 0% 33%          | Secondary text, labels (#545454) |
| Low    | `--low-emphasis`     | 0 0% 62%          | Tertiary text, hints (#9E9E9E)   |
| Muted  | `--muted-foreground` | 215.4 16.3% 46.9% | Disabled, very subtle text       |

### Text Color Hierarchy (Dark Mode)

| Level  | Color Variable       | HSL Value       | Usage                            |
| ------ | -------------------- | --------------- | -------------------------------- |
| High   | `--high-emphasis`    | 0 0% 96%        | Primary text, headings (#F5F5F5) |
| Medium | `--medium-emphasis`  | 0 0% 85%        | Secondary text, labels (#D9D9D9) |
| Low    | `--low-emphasis`     | 0 0% 62%        | Tertiary text, hints (#9E9E9E)   |
| Muted  | `--muted-foreground` | 215 20.2% 65.1% | Disabled, very subtle text       |

### Application Rules

- **High Emphasis**: Card titles (h3), section headers, important labels
- **Medium Emphasis**: Body text, form labels, table headers
- **Low Emphasis**: Helper text, captions, placeholder text
- **Muted**: Disabled states, very subtle metadata

---

## 8. Borders

### Border Styles

| Variable                   | Light Mode        | Dark Mode         | Usage                             |
| -------------------------- | ----------------- | ----------------- | --------------------------------- |
| `--border`                 | 214.3 31.8% 91.4% | 217.2 32.6% 17.5% | Default element borders           |
| `--input`                  | 214.3 31.8% 91.4% | 217.2 32.6% 17.5% | Input field borders               |
| `--border-default`         | 0 0% 85%          | 0 0% 85%          | Subtle borders (#D9D9D9)          |
| `--border-medium-emphasis` | 0 0% 48%          | 0 0% 48%          | Medium emphasis borders (#7A7A7A) |

### Border Usage

| Component  | Border Width | Style | Color            |
| ---------- | ------------ | ----- | ---------------- |
| Cards      | 1px          | solid | `border-default` |
| Inputs     | 1px          | solid | `border-input`   |
| Tables     | 1px          | solid | `border-default` |
| Separators | 1px          | solid | `border-default` |
| Dividers   | 1px          | solid | `border-default` |

---

## 9. Focus & Interaction States

### Focus States

- **Ring Style**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Ring Color**: CSS variable `--ring` (221.2 83.2% 53.3% light, 224.3 76.3% 48% dark)
- **Ring Offset**: 2px

### Hover States

- **Buttons**: Opacity reduction (`opacity-90`) or background color adjustment
- **Table Rows**: Subtle background change (`bg-muted/50`) with `cursor-pointer`
- **Links**: `hover:underline`
- **Badges**: Opacity reduction on hover

### Disabled States

- **Opacity**: 50% opacity
- **Cursor**: `cursor-not-allowed`
- **Interactive Elements**: Non-interactive

---

## 10. Responsive Design

### Breakpoints (Tailwind Default)

- **sm**: 640px
- **md**: 768px (primary breakpoint for this design)
- **lg**: 1024px
- **xl**: 1280px
- **2xl**: 1400px (custom)

### Common Patterns

| Pattern      | Mobile   | Tablet   | Desktop  |
| ------------ | -------- | -------- | -------- |
| Grid Columns | 1 col    | 2 cols   | 2-3 cols |
| Padding      | 1rem     | 1.5rem   | 2rem     |
| Gap          | 12px     | 16px     | 24px     |
| Font Size    | 0.875rem | 0.875rem | 1rem     |

---

## 11. Gradients & Special Effects

### Blocks Gradient

```css
.blocks-gradient {
  background: linear-gradient(135deg, #0066b2 0%, #00b2ff 100%);
}
```

- **Usage**: Hero sections, special CTAs, brand elements
- **Direction**: 135deg (top-left to bottom-right)
- **Colors**: Primary blue to bright cyan

---

## 12. Scrollbar Styling

### Scrollbar Configuration

```css
scrollbar-width: thin;
scrollbar-color: hsl(var(--border-default)) transparent;

::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

::-webkit-scrollbar-thumb {
  background: hsl(var(--border-default));
  border-radius: 9999px;
}

::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--border-medium-emphasis));
}
```

---

## 13. Animation & Transitions

### Predefined Animations

| Animation        | Duration | Timing            | Usage              |
| ---------------- | -------- | ----------------- | ------------------ |
| `accordion-down` | 0.2s     | ease-out          | Accordion expand   |
| `accordion-up`   | 0.2s     | ease-out          | Accordion collapse |
| `caret-blink`    | 1.25s    | ease-out infinite | Text input caret   |

### Transition Rules

- **Colors**: `transition-colors` for color changes
- **All**: `transition-all` for multiple property changes
- **Duration**: Mostly instantaneous (0.2s) to avoid sluggish UI

---

## 14. Dark Mode Implementation

### Activation

```html
<!-- Add 'dark' class to root element -->
<html class="dark"></html>
```

### CSS Variable Override

All color variables automatically switch when `dark` class is applied via `:root[class~="dark"]` selector.

### Component Considerations

- Borders remain same across modes
- Text emphasis levels adjust for contrast
- Status colors maintain semantic meaning
- Backgrounds invert appropriately

---

## 15. Implementation Guidelines

### Best Practices

1. **Use CSS Variables**: Always reference design tokens via CSS variables (e.g., `bg-primary`) rather than hardcoding colors
2. **Maintain Spacing**: Use consistent spacing scale (8px multiples) for alignment
3. **Hierarchy**: Use text emphasis colors to create clear visual hierarchy
4. **Accessibility**:
   - Ensure sufficient color contrast (WCAG AA minimum)
   - Always include focus states on interactive elements
   - Use semantic HTML and ARIA labels
5. **Consistency**: Reuse component variants instead of creating new ones
6. **Responsive**: Design mobile-first; use Tailwind breakpoints for tablet/desktop

### Common Component Combinations

#### Info Card

```tsx
<Card className="rounded-sm border bg-card px-5 py-4 shadow-sm">
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Subtitle or description</CardDescription>
  </CardHeader>
  <CardContent>Content goes here</CardContent>
</Card>
```

#### Primary CTA

```tsx
<Button variant="primary" size="lg">
  Action
</Button>
```

#### Form Group

```tsx
<div className="space-y-1.5">
  <label className="text-sm text-medium-emphasis">Label</label>
  <Input placeholder="Enter value" />
</div>
```

#### Emphasis Levels

```tsx
<div className="text-high-emphasis">Primary information</div>
<div className="text-medium-emphasis">Secondary information</div>
<div className="text-low-emphasis">Tertiary information</div>
```

---

## 16. Color Contrast Guidelines

### WCAG AA Compliance (Minimum 4.5:1 for text)

| Combination                        | Light Mode | Dark Mode | Status             |
| ---------------------------------- | ---------- | --------- | ------------------ |
| High Emphasis Text on Background   | ✓          | ✓         | Compliant          |
| Medium Emphasis Text on Background | ✓          | ✓         | Compliant          |
| Primary Button Text on Primary     | ✓          | ✓         | Compliant          |
| Low Emphasis Text on Background    | ⚠️         | ⚠️        | Use for hints only |

### Recommendations

- Avoid using low-emphasis text on light backgrounds for critical information
- Always test color combinations with accessibility tools before deployment
- Use AAA contrast (7:1) for crucial information

---

## Summary Table: Key Design Tokens

| Category    | Light      | Dark       | Notes               |
| ----------- | ---------- | ---------- | ------------------- |
| Primary     | #0066B2    | #4B8FDB    | Main action color   |
| Secondary   | #EFF2F7    | #1E2A3A    | Muted backgrounds   |
| Background  | #FFFFFF    | #0E1419    | Main surface        |
| Foreground  | #0E1419    | #F7F9FC    | Main text           |
| Border      | #E4E4E7    | #2C3A4C    | Element dividers    |
| Error       | #FF3333    | #FF3333    | Destructive actions |
| Success     | #22C55E    | #22C55E    | Positive states     |
| Warning     | #F59E0B    | #F59E0B    | Cautions            |
| Card Radius | 8px        | 8px        | Component corners   |
| Focus Ring  | 2px offset | 2px offset | Interactive focus   |
| Base Font   | DM Sans    | DM Sans    | Typography          |
| Base Size   | 14px       | 14px       | Default text size   |

---

## Migration Checklist for New Projects

- [ ] Install Tailwind CSS with theme configuration
- [ ] Copy color variables to CSS base layer
- [ ] Import and implement component UI kits
- [ ] Set typography to DM Sans
- [ ] Configure dark mode with `class` strategy
- [ ] Test all components in light and dark modes
- [ ] Verify contrast ratios for WCAG compliance
- [ ] Review focus states on all interactive elements
- [ ] Test responsive behavior across breakpoints
- [ ] Conduct accessibility audit

---

**Last Updated**: 2026-06-07
**Design System Version**: 1.0
**Status**: Active Production
