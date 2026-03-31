# Copilot RTL

Adds automatic **RTL (Right-to-Left)** support to VS Code Copilot chat for Arabic and mixed Arabic/English text.

- Arabic or mixed text → RTL direction + your chosen font
- English-only text → LTR (unchanged)
- Code blocks → always LTR

---

## Usage

Open the Command Palette (`Ctrl+Shift+P`) and run:

| Command | Description |
|---|---|
| `Copilot RTL: Enable` | Inject RTL patch and reload VS Code |
| `Copilot RTL: Disable` | Remove RTL patch and reload VS Code |
| `Copilot RTL: Show Status` | Check if the patch is currently active |

> **Note:** VS Code may show a warning that the installation is modified — this is expected. If you see a permissions error, restart VS Code as Administrator.

---

## Changing Font & Size

1. Open **Settings** (`Ctrl+,`)
2. Search for **Copilot RTL**
3. Update the settings:

| Setting | Default | Description |
|---|---|---|
| `copilotRtl.fontFamily` | `vazirmatn` | Font for Arabic text (e.g. `Tahoma`, `Arial`, `Cairo`, `Segoe UI`) |
| `copilotRtl.fontSize` | `13` | Font size in pixels (8–40) |

After changing a setting, VS Code will automatically prompt you to **Reload** to apply the change.

---

## Install from VSIX

```
code --install-extension copilot-rtl-x.x.x.vsix
```

Or via Extensions panel → `...` → **Install from VSIX...**
