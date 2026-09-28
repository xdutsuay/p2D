# Connect Blender ↔ Cursor (live MCP)

Until this is running, Cursor only builds `.blend` files **headlessly** (`npm run blender:import`). That does **not** update a Blender window you already have open.

## One-time setup

### 1. `uv` (already installing if missing)
Needed so Cursor can run `uvx blender-mcp`.

### 2. Cursor MCP config
Project file: [`.cursor/mcp.json`](../.cursor/mcp.json) (Windows `cmd /c uvx blender-mcp`).

Reload MCP / restart Cursor after adding it.

### 3. Blender addon (Blender 5.2)

Use the zip (easiest):  
[`blender/addons/mcp_for_blender.zip`](../blender/addons/mcp_for_blender.zip)

**There is no “Install Add-on” button anymore.** In 5.2 it is **Install from Disk**:

1. In Blender: **Edit → Preferences**
2. Left sidebar: open **Get Extensions** *(or **Add-ons**)*
3. Top-right of that panel: click the **▾ dropdown** (chevron / hamburger)
4. Choose **Install from Disk…**
5. Select `E:\codes\p2D\blender\addons\mcp_for_blender.zip`
6. Search for **MCP** and enable the checkbox for **MCP for Blender**
7. Close Preferences
8. In the 3D View press **N** → tab **MCP for Blender** → **Start MCP Server**

Alternate: drag `mcp_for_blender.zip` from File Explorer into the Blender window, then enable it under Add-ons.

### 4. Open the house file
File we generate:

`E:\codes\p2D\.blenderassets\house_ground.blend`

(I launched this once for you; if the viewport looks empty, press **Home** / **View → Frame All**.)

## Daily incremental loop
1. Start Blender with `house_ground.blend`  
2. Start MCP server in the N-panel  
3. Ask Cursor to change walls/pillars/rooms  
4. Or without MCP: edit `data/private/house_graph.json` → `npm run blender:import` → **File → Revert** / reopen in Blender  

CLI fallback stays supported even when MCP is off.
