const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Free-text chore: whoever is assigned describes what they did instead of ticking a fixed task
const WILDCARD = "🃏 Wildcard";

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
  [WILDCARD]: [
    "Something extra the house needed (tap to describe what you did)",
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
const HISTORY_WEEKS = 4;

const DEFAULT_STATE = {
  flatmates: [],
  assignments: {},
  completions: {},
  weekStart: null,
  rotationIndex: 0,
  history: [],
  notes: {},
};

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = { ...DEFAULT_STATE, ...JSON.parse(raw) };
      // Data saved before history was tracked: seed it with the current week
      if (loaded.history.length === 0 && loaded.weekStart)
        loaded.history = [{ weekStart: loaded.weekStart, assignments: loaded.assignments }];
      return loaded;
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
  state.notes = {};

  choreNames.forEach((chore, i) => {
    const personIndex = ((i - state.rotationIndex) % state.flatmates.length + state.flatmates.length) % state.flatmates.length;
    state.assignments[chore] = state.flatmates[personIndex];
    state.completions[chore] = {};
    CHORES[chore].forEach(task => (state.completions[chore][task] = false));
  });

  state.weekStart = new Date().toDateString();
  state.history = [...state.history, { weekStart: state.weekStart, assignments: { ...state.assignments } }].slice(-HISTORY_WEEKS);
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
        if (state.history.length === 0)
          return interaction.editReply({ content: '📅 No rotations yet. Use `/rotate`!' });
        const lines = state.history.map((week, i) => {
          const w = state.history.length - 1 - i;
          const weekLabel = w === 0 ? '**This week**' : `**${w} week${w > 1 ? 's' : ''} ago**`;
          const pairs = Object.entries(week.assignments).map(([chore, person]) => `${chore} → ${person}`);
          return `${weekLabel} (${week.weekStart})\n${pairs.join('\n')}`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`📅 Rotation History — Last ${HISTORY_WEEKS} Weeks`)
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

      if (!state.assignments[chore]) return interaction.reply({ content: '⚠️ No assignments yet. Use `/rotate` first!', ephemeral: true });

      if (!state.completions[chore]) state.completions[chore] = {};

      // Wildcard: ticking opens a text box; un-ticking clears what was written
      if (chore === WILDCARD && !state.completions[chore][task])
        return interaction.showModal(buildWildcardModal(state.notes[chore]));
      if (chore === WILDCARD) delete state.notes[chore];

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

  // ── Modal submissions ──────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'wildcard-note') {
    const note = interaction.fields.getTextInputValue('note').trim();
    if (!note) return interaction.reply({ content: '⚠️ Please describe what you did.', ephemeral: true });
    if (!state.assignments[WILDCARD]) return interaction.reply({ content: '⚠️ No assignments yet. Use `/rotate` first!', ephemeral: true });

    state.notes[WILDCARD] = note;
    state.completions[WILDCARD] = { [CHORES[WILDCARD][0]]: true };
    saveState();

    const tasks = CHORES[WILDCARD];
    const embed = buildChecklistEmbed(WILDCARD, state.assignments[WILDCARD], tasks, 1)
      .setColor(0x57F287)
      .setFooter({ text: '🎉 All done! Great work!' });
    return interaction.update({ embeds: [embed], components: buildChecklistButtons(WILDCARD, tasks) });
  }
});

function buildWildcardModal(existing) {
  const input = new TextInputBuilder()
    .setCustomId('note')
    .setLabel('What did you do?')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('e.g. Fixed the leaky tap, cleaned out the fridge')
    .setMaxLength(500)
    .setRequired(true);
  if (existing) input.setValue(existing);
  return new ModalBuilder()
    .setCustomId('wildcard-note')
    .setTitle('Wildcard chore')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildChecklistEmbed(chore, person, tasks, done) {
  const note = state.notes?.[chore];
  const lines = tasks.map(task => {
    const checked = state.completions[chore]?.[task];
    return `${checked ? '✅' : '⬜'} ${checked ? `~~${task}~~` : task}`;
  });
  return new EmbedBuilder()
    .setTitle(chore)
    .setColor(0x5865F2)
    .setDescription(`**Assigned to:** ${person}\n\n${lines.join('\n')}${note ? `\n\n📝 **What was done:** ${note}` : ''}`)
    .addFields({ name: 'Progress', value: `\`${getProgressBar(done, tasks.length)}\`` })
    .setFooter({ text: chore === WILDCARD ? 'Tap the button below to describe what you did' : 'Tap a number below to tick off a task' });
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