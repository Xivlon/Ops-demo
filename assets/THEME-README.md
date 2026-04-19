# LuggageLink Revenue Excel Theme

## Overview

This custom Office theme (`.thmx`) is designed specifically for LuggageLink revenue summaries and financial exports. It applies brand-consistent colors and professional typography to Excel workbooks, making your revenue reports look polished and consistent across the team.

## File

- **File**: `LuggageLink-Revenue.thmx`
- **Location**: `assets/LuggageLink-Revenue.thmx`

## Color Palette

The theme uses colors drawn directly from the LuggageLink Ops dashboard:

| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| Dark 1 | Slate 900 | `#0F172A` | Headings, primary text |
| Light 1 | White | `#FFFFFF` | Backgrounds |
| Dark 2 | Slate 800 | `#1E293B` | Secondary text |
| Light 2 | Slate 100 | `#F1F5F9` | Alternate row backgrounds |
| Accent 1 | Purple 600 | `#7C3AED` | Primary brand color, headers |
| Accent 2 | Green 500 | `#22C55E` | Revenue, positive trends |
| Accent 3 | Blue 500 | `#3B82F6` | Transport/data series |
| Accent 4 | Amber 500 | `#F59E0B` | Warnings, highlights |
| Accent 5 | Red 500 | `#EF4444` | Negative variances |
| Accent 6 | Cyan 500 | `#06B6D4` | Storage/data series |
| Hyperlink | Purple 500 | `#8B5CF6` | Links |
| Followed Link | Purple 700 | `#6D28D9` | Visited links |

## Typography

- **Headings**: Segoe UI Semibold
- **Body**: Segoe UI

## Installation (One-Time Setup)

### Windows
1. Copy `LuggageLink-Revenue.thmx` to:
   ```
   %appdata%\Microsoft\Templates\Document Themes\
   ```
2. Open Excel
3. Go to **Page Layout → Themes**
4. Select **"LuggageLink Revenue"** from the Custom section

### macOS
1. Copy `LuggageLink-Revenue.thmx` to:
   ```
   ~/Library/Group Containers/UBF8T346G9.Office/User Content.localized/Themes/
   ```
2. Open Excel
3. Go to **Themes** and select **"LuggageLink Revenue"**

## Usage with Revenue Exports

### Option 1: Apply Theme After Opening CSV
1. Download the revenue report CSV from the ops dashboard
2. Open in Excel
3. Go to **Page Layout → Themes → LuggageLink Revenue**
4. Save as `.xlsx` to preserve formatting

### Option 2: Set as Default Theme
Set "LuggageLink Revenue" as your default Excel theme so all new workbooks use it automatically:

**Excel → File → Options → General → Office Theme** (select your custom theme)

### Option 3: Embed in Templates
If you frequently build revenue summaries from scratch:
1. Create a new workbook
2. Apply the **LuggageLink Revenue** theme
3. Add your standard revenue summary layout (headers, formulas, charts)
4. Save as `LuggageLink-Revenue-Template.xltx` in your Templates folder

## Chart Colors

When you create charts using this theme, Excel automatically cycles through the accent colors in this order:
1. **Purple** (`#7C3AED`) — Primary metric
2. **Green** (`#22C55E`) — Revenue/growth
3. **Blue** (`#3B82F6`) — Transport volume
4. **Amber** (`#F59E0B`) — Warnings/targets
5. **Red** (`#EF4444`) — Costs/losses
6. **Cyan** (`#06B6D4`) — Storage volume

## Tips

- **Cell Styles**: Use the themed cell styles (Heading 1, Heading 2, Good/Bad/Neutral) for automatic color updates if the theme changes later
- **Conditional Formatting**: Use theme colors in conditional formatting rules so they stay consistent
- **Pivot Tables**: Pivot table styles will automatically use the theme's accent colors for headers and subtotals
