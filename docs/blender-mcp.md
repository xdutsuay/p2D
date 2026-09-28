# Blender MCP / Cursor bridge

## Important

**MCP was not connected for earlier work.** Massing was built with:

```powershell
npm run blender:import
```

That writes `.blenderassets/house_ground.blend` in the background. An already-open empty Blender window will **not** update. Open that file (or File → Open).

## Live incremental edits (MCP)

Follow **[blender-mcp-setup.md](blender-mcp-setup.md)**:

1. `uv` installed  
2. Project [`.cursor/mcp.json`](../.cursor/mcp.json)  
3. Install [`blender/addons/blender_mcp_addon.py`](../blender/addons/blender_mcp_addon.py) in Blender  
4. N-panel → **Start MCP Server**  
5. Reload Cursor MCP  

## CLI fallback (always works)

```powershell
npm run blender:import
npm run blender:export
npm run blender:extension
```

Then reopen / revert the `.blend` in the GUI.
