const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const OUTDOORS = "🌿 Outdoors";
const WILDCARD = "🃏 Wildcard";

// Free-text chores: whoever is assigned describes what they did instead of just ticking a task
const NOTE_CHORES = {
  [OUTDOORS]: 'e.g. Mowed the front lawn, swept the paths',
  [WILDCARD]: 'e.g. Fixed the leaky tap, cleaned out the fridge',
};

const CHORES = {
  "🍳 Kitchen": [
    "Empty bins (if needed)",
    "Wipe down countertops (under appliances too)",
    "Dishes (dishwasher and rack)",
    "Wipe drawers & glass",
    "Wipe down appliances",
    "Replace soap/paper towels",
  ],
  [OUTDOORS]: [
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
  lastAutoRotate: null,
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
  state.lastAutoRotate = getPeriodKey();
  state.history = [...state.history, { weekStart: state.weekStart, assignments: { ...state.assignments } }].slice(-HISTORY_WEEKS);
  state.rotationIndex = (state.rotationIndex + 1) % state.flatmates.length;
  saveState();
}

// ─── AUTO-ROTATION ───────────────────────────────────────────────────────────
// Chores rotate every Monday at 9:00am New Zealand time (follows NZST/NZDT).
const ROTATE_TZ = 'Pacific/Auckland';
const ROTATE_HOUR = 9;
const CHECK_INTERVAL_MS = 60 * 1000;

// Date (YYYY-MM-DD) of the most recent Monday 9am NZ time, i.e. the current rotation period
function getPeriodKey(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-NZ', {
      timeZone: ROTATE_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const daysSinceMonday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  const back = daysSinceMonday === 0 && Number(parts.hour) < ROTATE_HOUR ? 7 : daysSinceMonday;
  const monday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - back));
  return monday.toISOString().slice(0, 10);
}

function buildRotateEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🔄 New Week — Chores Rotated!')
    .setColor(0x57F287)
    .setDescription(`Week of **${state.weekStart}**`)
    .setTimestamp();
  Object.entries(state.assignments).forEach(([chore, person]) =>
    embed.addFields({ name: chore, value: `👤 **${person}**`, inline: true })
  );
  embed.setFooter({ text: `Rotation #${state.rotationIndex} • Use /checklist to tick off tasks` });
  return embed;
}

async function checkAutoRotate() {
  try {
    const period = getPeriodKey();
    // First run with auto-rotation: start from the current period instead of rotating straight away
    if (!state.lastAutoRotate) {
      state.lastAutoRotate = period;
      saveState();
      return;
    }
    if (state.lastAutoRotate >= period || state.flatmates.length === 0) return;

    rotateChores();
    console.log(`[${new Date().toISOString()}] 🔄 Auto-rotated chores for period ${period}`);

    if (!process.env.CHANNEL_ID) {
      console.warn('⚠️  CHANNEL_ID is not set, so the rotation was not announced.');
      return;
    }
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);
    await channel.send({ embeds: [buildRotateEmbed()] });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Auto-rotate error:`, err);
  }
}

function getProgressBar(done, total) {
  const filled = Math.round((done / total) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${done}/${total}`;
}

// ─── BOT SETUP ───────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });



client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  checkAutoRotate();
  setInterval(checkAutoRotate, CHECK_INTERVAL_MS);
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
        return interaction.editReply({ embeds: [buildRotateEmbed()] });
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

      // Note chores: ticking opens a text box; un-ticking clears what was written
      if (chore in NOTE_CHORES && !state.completions[chore][task])
        return interaction.showModal(buildNoteModal(chore, state.notes[chore]));
      if (chore in NOTE_CHORES) delete state.notes[chore];

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
  if (interaction.isModalSubmit() && interaction.customId.startsWith('note||')) {
    const chore = interaction.customId.split('||')[1];
    if (!(chore in NOTE_CHORES)) return interaction.reply({ content: '⚠️ Unknown chore.', ephemeral: true });
    const note = interaction.fields.getTextInputValue('note').trim();
    if (!note) return interaction.reply({ content: '⚠️ Please describe what you did.', ephemeral: true });
    if (!state.assignments[chore]) return interaction.reply({ content: '⚠️ No assignments yet. Use `/rotate` first!', ephemeral: true });

    const tasks = CHORES[chore];
    state.notes[chore] = note;
    state.completions[chore] = Object.fromEntries(tasks.map(t => [t, true]));
    saveState();

    const embed = buildChecklistEmbed(chore, state.assignments[chore], tasks, tasks.length)
      .setColor(0x57F287)
      .setFooter({ text: '🎉 All done! Great work!' });
    return interaction.update({ embeds: [embed], components: buildChecklistButtons(chore, tasks) });
  }
});

function buildNoteModal(chore, existing) {
  const input = new TextInputBuilder()
    .setCustomId('note')
    .setLabel('What did you do?')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(NOTE_CHORES[chore])
    .setMaxLength(500)
    .setRequired(true);
  if (existing) input.setValue(existing);
  return new ModalBuilder()
    .setCustomId(`note||${chore}`)
    .setTitle(chore)
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
    .setFooter({ text: chore in NOTE_CHORES ? 'Tap the button below to describe what you did' : 'Tap a number below to tick off a task' });
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