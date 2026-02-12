# Quicker Folders

Quicker Folders is a simple Obsidian plugin that automatically opens a selected note when you click on a folder in the filetree.

Do you frequently find yourself clicking through your obsidian filetree just to open the same note and wish there was a quicker way? This plugin is for you.

## How it works

When you click on a folder, Quicker Folders opens a selected note from that folder. If there is a note titled `index` it will open that note. If an index note does not exist, you can set it to instead open the topmost note or the most recently edited note.

If you do not wish to declare an index via a title, you can also do so via front matter: `index_note: true`. This can be quickly accomplishedvia the Command Pallete: `Quicker Folders: Quicker Folders: Set current note as index` or via right click menu. 

*Note: any notes with the frontmatter declaration will always take precedence over notes with "index" in their titles".*

Additionally, you can set it so clicking on a folder opens your index note but keeps the folder closed. This can be helpful if you have a folder full of notes but only need to view your index note on a freqent basic.

### Example
I keep a folder full of notes for every book I've read along with an index note that catelogs each of these books. I frequently like to look at my index note but dont like the visual clutter that a big folder of notes provides. Quicker Folders allows me to quickly access my book index. This is especially helpful on the mobile app where space is limited.

### Tip
If you generally prefer the default Obsidian behavior (where clicking on a folder expands it but does not open anything), you can set it to do nothing when there is not an index note. Set fallback to `nothing`. Therefore, it will behave as it always has unless you specify an index note. See settings (below) for more info.

## Installation
Quicker Folders can be installed either via the BRAT Plugin (recommended) or manually.

### BRAT Installation
Using BRAT is the recommended, and easiest, way to install Obsidian plugins that are not available in the Obsidian Community Store.

1. Install BRAT via community plugins.
2. Open BRAT and select "Add Beta Plugin"
3. Paste `https://github.com/titandrive/Obsidian-QuickerFolders` into the text bar
4. Click "Add Plugin"

Quicker Folders is now installed and BRAT will automatically keep track of updates for you.

### Manual Installation
1. Browse to Quicker Folders [Releases](https://github.com/titandrive/Obsidian-QuickerFolders/releases)
2. Download the latest release
3. Extract the release and copy it to your obsidian vault: `.../MyVault/.obsidian/plugins/quicker-folders`
4. Restart Obsidian
5. Enable Quicker Folders in Settings/Community Plugins

## Settings
Quicker Folders is quite straightforward and works without any configuration. There are only a few settings:

- **Fallback behavior** (What to open when a folder has no `index.md`)
  - *Most recent:* The most recently edited note (default)
  - *Alphabetical:* The first note (alphabetically)
  - *Nothing:* Do nothing
- **Nested folder behavior:** (What to open when a folder contains only subfolders and no notes)
  - *Recently edited index:* Most recently edited index note contained in subfolders (default)
  - *Recently edited note:* Most recently edited note contained in subolders
  - *Nothing:* Do nothing
- **Keyword:** Allows you to change the keyword from `index` to anything of your choosing. 3 character minimum. 
- **Strict matching:** Whether it will open any note containing "index" in the title, or whether it will only open notes named exactly `index.md`. (Default: off)
- **Allow folder toggle:** Whether clicking a folder name expands/collapses it. When disabled, you can still collapse a folder by clicking the arrow. (Default: on)

## AI Disclosure
This plugin was made with the assistance of Claude Code.

## License
MIT
