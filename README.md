# 🧹 Flat Chore Bot — Setup Guide

A Discord bot that rotates chores among flatmates each week with interactive checklists.

---

## ✨ Features

- Rotates chore assignments across flatmates automatically
- Interactive checklist with tick-off buttons per chore
- Progress bars showing completion per chore
- Overall weekly progress view
- Add/remove flatmates anytime

---

## 📦 Commands

| Command | Description |
|---|---|
| `/addmember <name>` | Add a flatmate to the rotation |
| `/removemember <name>` | Remove a flatmate (with fewer flatmates than chores, 🃏 Wildcard is switched off) |
| `/members` | List all flatmates |
| `/rotate` | Assign chores for a new week |
| `/assign <chore> <name>` | Change who has a chore this week (swaps with their current chore) |
| `/chores` | Show this week's assignments + progress |
| `/checklist <chore>` | Show tasks for a chore with tick-off buttons |
| `/progress` | Show overall weekly completion |

---

## 🚀 Setup Instructions

### Step 1 — Create a Discord Application & Bot 

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** → give it a name (e.g. "Chore Bot")
3. Click **"Bot"** in the left sidebar
4. Click **"Add Bot"** → confirm
5. Click **"Reset Token"** → copy the token (you'll need this later!)
6. Copy the **Application ID** from the General Information page (you'll need this too!)
7. Scroll down and enable:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**

### Step 2 — Invite the Bot to Your Server

1. In the Developer Portal, click **"OAuth2"** → **"URL Generator"**
2. Under **Scopes**, tick:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Under **Bot Permissions**, tick:
   - ✅ `Send Messages`
   - ✅ `Use Slash Commands`
   - ✅ `Embed Links`
4. Copy the generated URL and open it in your browser
5. Select your flat's server and click **"Authorise"**

### Step 3 — Get Your Server ID

1. In Discord, go to **Settings → Advanced** and enable **Developer Mode**
2. Right-click your server name → **"Copy Server ID"**

### Step 4 — Install Dependencies & Configure

Make sure you have [Node.js](https://nodejs.org) (v18+) installed, then:

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env

# 3. Edit .env and fill in your three values:
#    DISCORD_TOKEN = the bot token from Step 1
#    CLIENT_ID     = the Application ID from Step 1
#    GUILD_ID      = the server ID from Step 3
```

Your `.env` should look like this:
```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
GUILD_ID=your_server_id_here
CHANNEL_ID=channel_for_weekly_rotation_posts
```

`CHANNEL_ID` is the channel where the bot posts the weekly rotation. Chores rotate automatically every Tuesday at 9:00am New Zealand time while the bot is running. If the bot was offline at that time, it rotates when it next starts. Each rotation moves everyone down one chore (the last chore wraps back to the first), and the announcement includes a ✅/❌ summary of the week that just ended. Without `CHANNEL_ID` the rotation still happens, but it isn't announced.

### Step 5 — Register Slash Commands (once only!)

Run this **one time** to register the bot's slash commands with Discord:

```bash
node register.js
```

You should see:
```
Registering slash commands...
✅ Slash commands registered! You can now start the bot with: node bot.js
```

> ⚠️ You only ever need to run `register.js` again if you add, rename, or remove commands. **Do not run it on every restart** — it's unnecessary and can cause the bot to miss interactions while the request is in flight.

### Step 6 — Start the Bot

```bash
node bot.js
```

You should see:
```
✅ Logged in as Chore Bot#1234
```

**If the server restarts**, just run `node bot.js` again. That's it — the slash commands are stored permanently on Discord's servers and don't need to be re-registered.

### Step 7 — Use the Bot!

In your Discord server:

```
/addmember Alice
/addmember Bob
/addmember Charlie
/rotate
/chores
```

---

## 🛠 Customising Chores

Open `bot.js` and edit the `CHORES` object near the top of the file:

```js
const CHORES = {
  "🍳 Kitchen": [
    "Do the dishes",
    "Wipe benches",
    // add or remove tasks here
  ],
  "🛁 Bathroom": [
    "Clean the toilet",
    // ...
  ],
  // add new chore categories here
};
```

If you add or rename chore categories, re-run `node register.js` once afterwards so the `/checklist` command's choices stay up to date.

---

## ☁️ Updating the Bot on Your Server (Oracle Cloud)

Merge your changes into `main` on GitHub first, then SSH into the server and run:

```bash
cd ~/Discord-Chore-bot
cp data.json ~/data.backup.json     # back up the live data
git stash                           # set your live data.json aside
git checkout main
git pull
git stash pop                       # put your data.json back
npm install                         # only needed if dependencies changed
pm2 restart chorebot
pm2 logs chorebot --lines 20        # look for "Logged in"
```

- If `git stash pop` reports a conflict in `data.json`, restore your data with `cp ~/data.backup.json data.json`.
- `.env` isn't in git, so pulling never touches your token or IDs.
- Run `node register.js` again only if the slash commands changed (new command or chore added or renamed).
- To replace the server's `data.json` with the one on your PC, stop the bot (`pm2 stop chorebot`) before copying it, or the bot will overwrite it from memory:
  ```powershell
  scp -i C:\path\to\your-key.key .\data.json ubuntu@<vm-ip>:~/Discord-Chore-bot/data.json
  ```

---

## 💡 Tips

- Run `/rotate` every Monday to reset assignments for the week
- Anyone can tick off checklist items — it updates for everyone
- State is saved to `data.json` automatically, so restarting the bot won't lose progress

---

## 🔒 Keep Your Token Safe

- **Never** share your `DISCORD_TOKEN` with anyone
- **Never** commit your `.env` file to GitHub
- Add `.env` to your `.gitignore`