const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CHORES = {
  "🍳 Kitchen": [
    "Empty bins (if needed)",
    "Wipe down countertops (under appliances too)",
    "Dishes (dishwasher and rack)",
    "Wipe drawers & glass",
    "Wipe down appliances",
    "Replace soap/paper towels",
  ],
  "🌿 Outdoors": [
    "Choose one: Mow lawns / Clean deck / Weeding & trimming bushes / Sweep paths & rake leaves / (bad weather) Mop floors",
  ],
  "🧹 Floors": [
    "Dust common areas",
    "Pack away forgotten cans/kitchenware",
    "Clean dining room table",
    "Vacuum common areas",
  ],
  "🚿 Bathrooms": [
    "Refill soap/toilet paper",
    "Wipe down toilet & seat",
    "Clean sinks (remove mould by taps)",
    "Clean toilet bowl",
    "Replace toilet mat & towel",
    "Clean bath",
    "Wipe down shower surfaces",
  ],
};

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULT_STATE = {
  flatmates: [],
  assignments: {},
  completions: {},
  weekStart: null,
  rotationIndex: 0,
};

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...loaded };
    }
  } catch (err) {
    console.error('⚠️  Could not load data.json, starting fresh:', err.message);
  }
  return { ...DEFAULT_STATE };
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️  Could not save data.json:', err.message);
  }
}

let state = loadState();
console.log(`📂 Loaded state: ${state.flatmates.length} flatmates, week of ${state.weekStart || 'not set'}`);

// ─── ROTATION LOGIC ──────────────────────────────────────────────────────────
function rotateChores() {
  const choreNames = Object.keys(CHORES);
  state.assignments = {};
  state.completions = {};

  choreNames.forEach((chore, i) => {
    const personIndex = ((i - state.rotationIndex) % state.flatmates.length + state.flatmates.length) % state.flatmates.length;
    state.assignments[chore] = state.flatmates[personIndex];
    state.completions[chore] = {};
    CHORES[chore].forEach(task => (state.completions[chore][task] = false));
  });

  state.weekStart = new Date().toDateString();
  state.rotationIndex = (state.rotationIndex + 1) % state.flatmates.length;
  saveState();
}

function getProgressBar(done, total) {
  const filled = Math.round((done / total) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${done}/${total}`;
}

// ─── BOT SETUP ───────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });



client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {

  // ── Slash commands ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    try {
      await interaction.deferReply();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] deferReply failed:`, err?.rawError ?? err.message);
      return;
    }

    try {
      if (interaction.commandName === 'members') {
        if (state.flatmates.length === 0)
          return interaction.editReply({ content: '👥 No flatmates added yet. Use `/addmember`!' });
        const embed = new EmbedBuilder()
          .setTitle('🏠 Flatmates in Rotation')
          .setColor(0x5865F2)
          .setDescription(state.flatmates.map((f, i) => `**${i + 1}.** ${f}`).join('\n'));
        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'addmember') {
        const name = interaction.options.getString('name').trim();
        if (state.flatmates.includes(name))
          return interaction.editReply({ content: `⚠️ **${name}** is already in the rotation!` });
        state.flatmates.push(name);
        saveState();
        return interaction.editReply({ content: `✅ Added **${name}** to the flat! Use \`/rotate\` to reassign chores.` });
      }

      if (interaction.commandName === 'removemember') {
        const name = interaction.options.getString('name').trim();
        if (!state.flatmates.includes(name))
          return interaction.editReply({ content: `⚠️ **${name}** isn't in the rotation.` });
        state.flatmates = state.flatmates.filter(f => f !== name);
        saveState();
        return interaction.editReply({ content: `🗑️ Removed **${name}**. Use \`/rotate\` to reassign chores.` });
      }

      if (interaction.commandName === 'rotate') {
        if (state.flatmates.length === 0)
          return interaction.editReply({ content: '⚠️ Add flatmates first with `/addmember`!' });
        rotateChores();
        const embed = new EmbedBuilder()
          .setTitle('🔄 New Week — Chores Rotated!')
          .setColor(0x57F287)
          .setDescription(`Week of **${state.weekStart}**`)
          .setTimestamp();
        Object.entries(state.assignments).forEach(([chore, person]) =>
          embed.addFields({ name: chore, value: `👤 **${person}**`, inline: true })
        );
        embed.setFooter({ text: `Rotation #${state.rotationIndex} • Use /checklist to tick off tasks` });
        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'chores') {
        if (Object.keys(state.assignments).length === 0)
          return interaction.editReply({ content: '📋 No chores assigned yet. Use `/rotate`!' });
        const embed = new EmbedBuilder()
          .setTitle(`🧹 Chore Assignments — Week of ${state.weekStart}`)
          .setColor(0xFEE75C)
          .setFooter({ text: 'Use /checklist to see tasks for your chore' });
        Object.entries(state.assignments).forEach(([chore, person]) => {
          const tasks = CHORES[chore];
          const done = tasks.filter(t => state.completions[chore]?.[t]).length;
          embed.addFields({ name: `${chore} → ${person}`, value: `\`${getProgressBar(done, tasks.length)}\``, inline: false });
        });
        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'progress') {
        if (Object.keys(state.assignments).length === 0)
          return interaction.editReply({ content: '📋 No chores assigned yet!' });
        let totalTasks = 0, totalDone = 0;
        const lines = Object.entries(state.assignments).map(([chore, person]) => {
          const tasks = CHORES[chore];
          const done = tasks.filter(t => state.completions[chore]?.[t]).length;
          totalTasks += tasks.length;
          totalDone += done;
          return `${done === tasks.length ? '✅' : '🔄'} **${chore}** (${person})\n\`${getProgressBar(done, tasks.length)}\``;
        });
        const embed = new EmbedBuilder()
          .setTitle(`📊 Weekly Progress — ${state.weekStart}`)
          .setColor(totalDone === totalTasks ? 0x57F287 : 0x5865F2)
          .setDescription(lines.join('\n\n'))
          .addFields({ name: '🏆 Overall', value: `\`${getProgressBar(totalDone, totalTasks)}\`` })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'history') {
        if (state.flatmates.length === 0)
          return interaction.editReply({ content: '👥 No flatmates added yet!' });
        const choreNames = Object.keys(CHORES);
        const lines = [];
        for (let w = 3; w >= 0; w--) {
          const weekLabel = w === 0 ? '**This week**' : `**${w} week${w > 1 ? 's' : ''} ago**`;
          const rotIdx = ((state.rotationIndex - 1) - w + state.flatmates.length * 10) % state.flatmates.length;
          const pairs = choreNames.map((chore, i) => {
            const person = state.flatmates[(i + rotIdx) % state.flatmates.length];
            return `${chore} → ${person}`;
          });
          lines.push(`${weekLabel}\n${pairs.join('\n')}`);
        }
        const embed = new EmbedBuilder()
          .setTitle('📅 Rotation Schedule — Last 4 Weeks')
          .setColor(0xEB459E)
          .setDescription(lines.join('\n\n'));
        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'checklist') {
        const chore = interaction.options.getString('chore');
        if (!state.assignments[chore])
          return interaction.editReply({ content: '⚠️ No assignments yet. Use `/rotate` first!' });
        const person = state.assignments[chore];
        const tasks = CHORES[chore];
        const done = tasks.filter(t => state.completions[chore]?.[t]).length;
        return interaction.editReply({
          embeds: [buildChecklistEmbed(chore, person, tasks, done)],
          components: buildChecklistButtons(chore, tasks),
        });
      }

    } catch (err) {
      console.error(`[${new Date().toISOString()}] Command error (${interaction.commandName}):`, err);
      interaction.editReply({ content: '❌ Something went wrong. Check the bot logs.' }).catch(() => {});
    }
  }

  // ── Button interactions ────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const [action, chore, taskIndex] = interaction.customId.split('||');
    if (action === 'toggle') {
      const task = CHORES[chore]?.[parseInt(taskIndex)];
      if (!task) return interaction.reply({ content: '⚠️ Unknown task.', ephemeral: true });

      if (!state.completions[chore]) state.completions[chore] = {};
      state.completions[chore][task] = !state.completions[chore][task];
      saveState();

      const person = state.assignments[chore];
      const tasks = CHORES[chore];
      const done = tasks.filter(t => state.completions[chore]?.[t]).length;
      const embed = buildChecklistEmbed(chore, person, tasks, done);
      const rows = buildChecklistButtons(chore, tasks);

      if (done === tasks.length) {
        embed.setColor(0x57F287);
        embed.setFooter({ text: '🎉 All done! Great work!' });
      }

      return interaction.update({ embeds: [embed], components: rows });
    }
  }
});

function buildChecklistEmbed(chore, person, tasks, done) {
  const lines = tasks.map(task => {
    const checked = state.completions[chore]?.[task];
    return `${checked ? '✅' : '⬜'} ${checked ? `~~${task}~~` : task}`;
  });
  return new EmbedBuilder()
    .setTitle(chore)
    .setColor(0x5865F2)
    .setDescription(`**Assigned to:** ${person}\n\n${lines.join('\n')}`)
    .addFields({ name: 'Progress', value: `\`${getProgressBar(done, tasks.length)}\`` })
    .setFooter({ text: 'Tap a number below to tick off a task' });
}

function buildChecklistButtons(chore, tasks) {
  const rows = [];
  for (let i = 0; i < tasks.length; i += 5) {
    const row = new ActionRowBuilder();
    tasks.slice(i, i + 5).forEach((task, j) => {
      const idx = i + j;
      const isDone = state.completions[chore]?.[task];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`toggle||${chore}||${idx}`)
          .setLabel(`${idx + 1}`)
          .setStyle(isDone ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setEmoji(isDone ? '✅' : '⬜')
      );
    });
    rows.push(row);
  }
  return rows;
}

client.login(process.env.DISCORD_TOKEN);