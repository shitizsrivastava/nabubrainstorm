# NabuBrainstorm — Step-by-step guide

The same guide lives inside the app: **❓ Help → 🎬 OBS Guide**. This file is the printable copy.

> **The idea:** you number your assets 1, 2, 3 on the board. In OBS, one special *Browser Source* shows **one asset at a time**, with no background, on top of your webcam — like dropping a picture on the timeline, but live. You press a hotkey to bring up the next one.

---

## PART A — One-time setup (about 10 minutes)

### 1. Put 3 test items on the board
- Click **＋ Text** in the toolbar → click the board → type `Hello`.
- Click **🖼 Image** → choose any picture.
- Click **📌 Sticky** → click the board → type `Third`.

You should see a small gold circle with a number (1, 2, 3) on each item. That is the order they will appear in.

### 2. Copy the Cut-in link
Toolbar **📡 OBS** → in "1 · Overlay links" click **Copy** on the **Cut-in** row.

### 3. Make the browser source in OBS
1. In OBS, under **Sources**, click **+**.
2. Choose **Browser**, keep "Create new", name it `Cut-ins`, click **OK**.
3. Paste the link into **URL**.
4. **Width `1920`**, **Height `1080`**.
5. Tick **Control audio via OBS**.
6. Make sure *Shutdown source when not visible* and *Refresh browser when scene becomes active* are **not** ticked.
7. **OK**. The preview stays empty — that is correct.

### 4. Put it in front of your webcam
In the Sources list drag **Cut-ins** *above* your webcam.

### 5. Test it
Keep NabuBrainstorm open (minimized is fine) and press:

| Keys | Does |
|------|------|
| `Ctrl` + `Alt` + `→` | Next asset (first press shows #1) |
| `Ctrl` + `Alt` + `←` | Previous asset |
| `Ctrl` + `Alt` + `↓` | Hide |
| `Ctrl` + `Alt` + `L` | Laser pointer on/off |

You should see "Hello" big in the middle of the OBS preview with no background, and a red **● LIVE 1** label at the bottom-left of the app. After the last asset, one more press hides it.

### 6. (Optional, recommended) Buttons inside OBS
App: **📡 OBS** → **Copy** on the **Control dock** row.
OBS: **View → Docks → Custom Browser Docks…** → name `Cut-ins`, paste URL → **Apply**. You get big Prev / Next / Hide buttons and a clickable list.

### 7. (Optional) Let the app control OBS
OBS: **Tools → WebSocket Server Settings** → enable server → enable authentication → set a password → OK.
App: **📡 OBS** → section 2 → enter the password → tick *Remember* and *Connect automatically* → **Connect**. A green dot means it works.

You then get: automatic **scene switching** per asset, **Start/Stop recording** buttons, and **chapter markers** in your recording (needs OBS 30.2+ with MKV or Hybrid-MP4 recording).

---

## PART B — For every video

1. **Collect** images, clips, quotes and notes on the board.
2. **Order:** click a gold number to change it.
3. **Write what you will say:** right-click an item → **🗒 Commentary…**.
4. **Per-item look:** right-click → **🎬 Cut-in settings…** (position, animation, size, target seconds, sound effect, OBS scene, chapter title).
5. **Script screen:** click **📜 Prompter** and drag that window next to your camera (A−/A+ size, ⇋ mirror, slider = auto-scroll).
6. **Record:** start recording and press `Ctrl`+`Alt`+`→` at each point. The corner label shows time on this item vs your target.
7. **After:**
   - **🎞 Session → 📋 Copy YouTube chapters** → paste into the description (needs 3+ chapters, first at 0:00, each ≥ 10 s — handled for you).
   - **Export EDL** → import into Premiere (File → Import) or DaVinci Resolve (File → Import → Timeline) to place the same graphics in your editor.
   - **Thumbnail:** **🖼 Frame** → arrange → right-click the frame's yellow label → **Export as JPG** (1280 px, under YouTube's 2 MB limit). **Duplicate as variant** for an A/B test, or use **📐 Templates → Thumbnail A/B Test**.

### Show the whole board instead of single items
Use the **Mirror** link (📡 OBS → Copy on the Mirror row) as a second Browser Source. Turn on **🔴 Laser** to point with a glowing red dot.

---

## PART C — Updating the app

1. Click **⟳ Update** at the top. If a newer version exists it says **Update to vX** → click it → **Restart to update**.
2. No internet / no online release? **❓ Help → 📁 Updates folder**, drop the new `NabuBrainstorm Setup x.y.z.exe` inside (folder: `Documents\NabuBrainstorm\Updates`), then click **⟳ Update**.

For the developer: `.\update-local.ps1` builds an installer and drops it into the Updates folder; `.\release.ps1` publishes it on GitHub.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| OBS shows nothing | App must be running. Items must be numbered. Press Next once. Re-copy the link from 📡 OBS (the `k=…` key must be included). In OBS right-click the source → *Refresh cache of current page*. |
| Hotkey does nothing | Another program uses it. 📡 OBS → Hotkeys → click a box, press a new combo → **Save shortcuts**. A red box = could not register. |
| Video black / silent | Use H.264 MP4. Tick *Control audio via OBS* and check the Audio Mixer. |
| Wrong size/position | Browser Source width/height must equal your OBS canvas (usually 1920×1080). Tune per item with Cut-in settings. |
| Can't connect to OBS | Enable the WebSocket server in OBS, exact password, port 4455. |
| No chapter markers in recording | Need OBS 30.2+ and MKV or Hybrid-MP4 format. |
| Links stopped working | Re-copy them from 📡 OBS (the key lives in `%APPDATA%\nabu-brainstorm\nabu-config.json`). |
| Update says "No published release found" | Use the Updates folder (Part C, step 2). |

## Where things are saved
- Boards: `Documents\NabuBrainstorm\Autosaves` (auto, every ~30 s) and `…\Saved` (Ctrl+S).
- Images: `Documents\NabuBrainstorm\Assets` (stored once, so saves are small). **To back up or move a board, copy the whole `NabuBrainstorm` folder**, or use *Save As…* which embeds images in one portable file.
- Updates: `Documents\NabuBrainstorm\Updates`.
