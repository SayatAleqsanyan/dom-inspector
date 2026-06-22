# DOM Inspector — Chrome Extension

## Installation (Developer Mode)

1. Build or copy these files into one folder:
   ```
   extension/
   ├── manifest.json
   ├── background.js
   ├── content.js
   ├── popup.html
   ├── popup.js
   ├── inspector.js      ← copy from dist/
   ├── inspector.css     ← copy from dist/
   └── icons/
       ├── icon16.png
       ├── icon48.png
       └── icon128.png
   ```

2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `extension/` folder
5. The DOM Inspector icon appears in your toolbar

## Usage

- Click the toolbar icon to open the popup
- Toggle **Enable inspector** or click **Enable on this page**
- Hover over any element while holding **Alt** (or your configured key)
- Click to pin the selected element
- Press **Escape** to close

## Popup options

| Option | Description |
|---|---|
| Enable inspector | Toggle on/off for the current tab |
| Freeze on click | Pin element on click without holding Alt |
| Dark theme | Switch between dark and light theme |
| Trigger key | Modifier key for hover inspection |

## Context menu

Right-click any element → **Inspect with DOM Inspector**

## Keyboard shortcuts

| Key | Action |
|---|---|
| Alt + hover | Inspect element |
| Alt + click | Pin element |
| Escape | Close panel |
| ↑ Arrow | Navigate to parent |
| ↓ Arrow | Navigate to first child |
| ← → Arrows | Navigate to siblings |
