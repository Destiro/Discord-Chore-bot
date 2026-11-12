const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const OUTDOORS = "🌿 Outdoors";
const WILDCARD = "🃏 Wildcard";
const BATHROOMS = "🚿 Bathrooms";

// The ensuite has its own checklist (the main bathroom's minus the tasks it doesn't have).
// Doing either bathroom counts as the Bathrooms chore for the week.
const ENSUITE = "🚿 Bathrooms — Ensuite";
const ENSUITE_SKIPPED_TASKS = ["Clean bath"];

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
    "Empty the vacuum dust bin",
  ],
  [WILDCARD]: [
    "Something extra the house needed (tap to describe what you did)",
  ],
  [BATHROOMS]: [
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
  autoRotateSchedule: null,
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

// ─── CHECKLIST HELPERS ───────────────────────────────────────────────────────
// Tasks for a checklist (the ensuite is a checklist but not a chore of its own)
function getTasks(chore) {
  return chore === ENSUITE
    ? CHORES[BATHROOMS].filter(t => !ENSUITE_SKIPPED_TASKS.includes(t))
    : CHORES[chore];
}

// The chore (and so the assignment) a checklist belongs to
function choreOf(chore) {
  return chore === ENSUITE ? BATHROOMS : chore;
}

function countDone(chore) {
  return getTasks(chore).filter(t => state.completions[chore]?.[t]).length;
}

// Progress towards a chore; Bathrooms is complete once either bathroom is finished
function getChoreProgress(chore) {
  const total = CHORES[chore].length;
  if (chore !== BATHROOMS) return { done: countDone(chore), total };
  const mainDone = countDone(BATHROOMS);
  const ensuiteDone = countDone(ENSUITE);
  const complete = mainDone === total || ensuiteDone === getTasks(ENSUITE).length;
  return { done: complete ? total : Math.max(mainDone, ensuiteDone), total };
}

// ─── ROTATION LOGIC ──────────────────────────────────────────────────────────
// Chores that are switched off (in this order) when there are fewer flatmates than chores
const OPTIONAL_CHORES = [WILDCARD];

function getActiveChores() {
  const extra = Math.max(Object.keys(CHORES).length - state.flatmates.length, 0);
  const dropped = OPTIONAL_CHORES.slice(0, extra);
  return Object.keys(CHORES).filter(chore => !dropped.includes(chore));
}

// Keep this week's history entry in line with manual changes to the assignments
function syncHistory() {
  if (state.history.length) state.history[state.history.length - 1].assignments = { ...state.assignments };
}

function rotateChores() {
  const choreNames = getActiveChores();
  const current = choreNames.map(chore => state.assignments[chore]);
  // Everyone moves down one chore (the last chore wraps to the first). Only possible when
  // each flatmate currently has exactly one chore; otherwise fall back to the join order.
  const canShift = state.flatmates.length === choreNames.length &&
    state.flatmates.every(f => current.includes(f));
  state.assignments = {};
  state.completions = {};
  state.notes = {};

  choreNames.forEach((chore, i) => {
    const personIndex = ((i - state.rotationIndex) % state.flatmates.length + state.flatmates.length) % state.flatmates.length;
    state.assignments[chore] = canShift
      ? current[(i - 1 + choreNames.length) % choreNames.length]
      : state.flatmates[personIndex];
    state.completions[chore] = {};
    CHORES[chore].forEach(task => (state.completions[chore][task] = false));
  });
  state.completions[ENSUITE] = Object.fromEntries(getTasks(ENSUITE).map(t => [t, false]));

  state.weekStart = new Date().toDateString();
  state.lastAutoRotate = getPeriodKey();
  state.autoRotateSchedule = ROTATE_SCHEDULE;
  state.history = [...state.history, { weekStart: state.weekStart, assignments: { ...state.assignments } }].slice(-HISTORY_WEEKS);
  state.rotationIndex = (state.rotationIndex + 1) % state.flatmates.length;
  saveState();
}

// ─── AUTO-ROTATION ───────────────────────────────────────────────────────────
// Chores rotate every Tuesday at 9:00am New Zealand time (follows NZST/NZDT).
const ROTATE_TZ = 'Pacific/Auckland';
const ROTATE_DAY = 'Tue';
const ROTATE_HOUR = 9;
const ROTATE_SCHEDULE = `${ROTATE_DAY}${ROTATE_HOUR}`;
const CHECK_INTERVAL_MS = 60 * 1000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Date (YYYY-MM-DD) of the most recent rotation time (Tuesday 9am NZ), i.e. the current rotation period
function getPeriodKey(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-NZ', {
      timeZone: ROTATE_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const daysSinceRotateDay = (WEEKDAYS.indexOf(parts.weekday) - WEEKDAYS.indexOf(ROTATE_DAY) + 7) % 7;
  const back = daysSinceRotateDay === 0 && Number(parts.hour) < ROTATE_HOUR ? 7 : daysSinceRotateDay;
  const rotateDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - back));
  return rotateDate.toISOString().slice(0, 10);
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

// What got done in the week that's ending; call before rotateChores() resets it
function buildSummaryEmbed() {
  if (Object.keys(state.assignments).length === 0) return null;
  const lines = Object.entries(state.assignments).map(([chore, person]) => {
    const { done, total } = getChoreProgress(chore);
    const note = state.notes?.[chore];
    const status = done === total ? '✅' : `❌ (${done}/${total})`;
    return `${status} **${chore}** — ${person}${note ? `\n📝 ${note}` : ''}`;
  });
  return new EmbedBuilder()
    .setTitle(`📋 Last Week's Chores — ${state.weekStart}`)
    .setColor(0xFEE75C)
    .setDescription(lines.join('\n'));
}

function buildRotateEmbeds() {
  const summary = buildSummaryEmbed();
  rotateChores();
  return summary ? [summary, buildRotateEmbed()] : [buildRotateEmbed()];
}

async function checkAutoRotate() {
  try {
    const period = getPeriodKey();
    // First run, or the schedule was changed: start from the current period instead of rotating straight away
    if (!state.lastAutoRotate || state.autoRotateSchedule !== ROTATE_SCHEDULE) {
      state.lastAutoRotate = period;
      state.autoRotateSchedule = ROTATE_SCHEDULE;
      saveState();
      return;
    }
    if (state.lastAutoRotate >= period || state.flatmates.length === 0) return;

    const embeds = buildRotateEmbeds();
    console.log(`[${new Date().toISOString()}] 🔄 Auto-rotated chores for period ${period}`);

    if (!process.env.CHANNEL_ID) {
      console.warn('⚠️  CHANNEL_ID is not set, so the rotation was not announced.');
      return;
    }
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);
    await channel.send({ embeds });
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
        // A chore that was switched off (e.g. Wildcard) comes back on for the new flatmate
        const reopened = getActiveChores().find(c => !state.assignments[c]);
        if (reopened && Object.keys(state.assignments).length > 0) {
          state.assignments[reopened] = name;
          state.completions[reopened] = Object.fromEntries(CHORES[reopened].map(t => [t, false]));
          syncHistory();
          saveState();
          return interaction.editReply({ content: `✅ Added **${name}** to the flat! ${reopened} is back on and **${name}** has it this week.` });
        }
        saveState();
        return interaction.editReply({ content: `✅ Added **${name}** to the flat! Use \`/rotate\` to reassign chores.` });
      }

      if (interaction.commandName === 'removemember') {
        const name = interaction.options.getString('name').trim();
        if (!state.flatmates.includes(name))
          return interaction.editReply({ content: `⚠️ **${name}** isn't in the rotation.` });
        state.flatmates = state.flatmates.filter(f => f !== name);

        // Switch off an optional chore (e.g. Wildcard); whoever had it takes over the removed person's chore
        const freedChore = Object.keys(state.assignments).find(c => state.assignments[c] === name);
        const active = getActiveChores();
        const dropped = Object.keys(state.assignments).filter(c => !active.includes(c));
        if (dropped.length > 0) {
          const notes = dropped.map(chore => {
            const person = state.assignments[chore];
            delete state.assignments[chore];
            delete state.completions[chore];
            delete state.notes[chore];
            if (freedChore && freedChore !== chore) {
              state.assignments[freedChore] = person;
              return `${chore} is off while there are ${state.flatmates.length} flatmates, so **${person}** takes over ${freedChore}.`;
            }
            return `${chore} is off while there are ${state.flatmates.length} flatmates.`;
          });
          syncHistory();
          saveState();
          return interaction.editReply({ content: `🗑️ Removed **${name}**. ${notes.join(' ')}` });
        }
        saveState();
        return interaction.editReply({ content: `🗑️ Removed **${name}**. Use \`/rotate\` to reassign chores.` });
      }

      if (interaction.commandName === 'rotate') {
        if (state.flatmates.length === 0)
          return interaction.editReply({ content: '⚠️ Add flatmates first with `/addmember`!' });
        return interaction.editReply({ embeds: buildRotateEmbeds() });
      }

      if (interaction.commandName === 'assign') {
        const chore = interaction.options.getString('chore');
        const input = interaction.options.getString('name').trim();
        const name = state.flatmates.find(f => f.toLowerCase() === input.toLowerCase());
        if (!name)
          return interaction.editReply({ content: `⚠️ **${input}** isn't in the rotation. Use \`/members\` to see who is.` });
        if (Object.keys(state.assignments).length === 0)
          return interaction.editReply({ content: '⚠️ No assignments yet. Use `/rotate` first!' });
        if (!state.assignments[chore])
          return interaction.editReply({ content: `⚠️ ${chore} is off while there are fewer flatmates than chores.` });

        // Swap with whatever chore this person had, so everyone still has exactly one
        const previous = state.assignments[chore];
        const otherChore = Object.keys(state.assignments).find(c => c !== chore && state.assignments[c] === name);
        state.assignments[chore] = name;
        if (otherChore) state.assignments[otherChore] = previous;
        syncHistory();
        saveState();

        const swapNote = otherChore && previous !== name ? ` **${previous}** now has ${otherChore}.` : '';
        const pairs = Object.entries(state.assignments).map(([c, p]) => `${c} → ${p}`).join('\n');
        return interaction.editReply({ content: `✅ **${name}** now has ${chore}.${swapNote}\n\n${pairs}` });
      }

      if (interaction.commandName === 'chores') {
        if (Object.keys(state.assignments).length === 0)
          return interaction.editReply({ content: '📋 No chores assigned yet. Use `/rotate`!' });
        const embed = new EmbedBuilder()
          .setTitle(`🧹 Chore Assignments — Week of ${state.weekStart}`)
          .setColor(0xFEE75C)
          .setFooter({ text: 'Use /checklist to see tasks for your chore' });
        Object.entries(state.assignments).forEach(([chore, person]) => {
          const { done, total } = getChoreProgress(chore);
          embed.addFields({ name: `${chore} → ${person}`, value: `\`${getProgressBar(done, total)}\``, inline: false });
        });
        return interaction.editReply({ embeds: [embed] });
      }

      if (interaction.commandName === 'progress') {
        if (Object.keys(state.assignments).length === 0)
          return interaction.editReply({ content: '📋 No chores assigned yet!' });
        let totalTasks = 0, totalDone = 0;
        const lines = Object.entries(state.assignments).map(([chore, person]) => {
          const { done, total } = getChoreProgress(chore);
          totalTasks += total;
          totalDone += done;
          return `${done === total ? '✅' : '🔄'} **${chore}** (${person})\n\`${getProgressBar(done, total)}\``;
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
        if (!state.assignments[chore] && Object.keys(state.assignments).length > 0)
          return interaction.editReply({ content: `⚠️ ${chore} is off while there are fewer flatmates than chores.` });
        if (!state.assignments[chore])
          return interaction.editReply({ content: '⚠️ No assignments yet. Use `/rotate` first!' });
        const person = state.assignments[chore];
        if (chore === BATHROOMS)
          return interaction.editReply({
            content: `🚿 Which bathroom is **${person}** ticking off?`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('bathroom||main').setLabel('Main bathroom').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('bathroom||ensuite').setLabel('Ensuite').setStyle(ButtonStyle.Primary),
            )],
          });
        const tasks = CHORES[chore];
        const done = countDone(chore);
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
    if (action === 'bathroom') {
      const checklist = chore === 'ensuite' ? ENSUITE : BATHROOMS;
      if (!state.assignments[BATHROOMS]) return interaction.reply({ content: '⚠️ No assignments yet. Use `/rotate` first!', ephemeral: true });
      if (!state.completions[checklist]) state.completions[checklist] = {};
      const tasks = getTasks(checklist);
      return interaction.update({
        content: null,
        embeds: [buildChecklistEmbed(checklist, state.assignments[BATHROOMS], tasks, countDone(checklist))],
        components: buildChecklistButtons(checklist, tasks),
      });
    }
    if (action === 'toggle') {
      const task = getTasks(chore)?.[parseInt(taskIndex)];
      if (!task) return interaction.reply({ content: '⚠️ Unknown task.', ephemeral: true });

      if (!state.assignments[choreOf(chore)]) return interaction.reply({ content: '⚠️ No assignments yet. Use `/rotate` first!', ephemeral: true });

      if (!state.completions[chore]) state.completions[chore] = {};

      // Note chores: ticking opens a text box; un-ticking clears what was written
      if (chore in NOTE_CHORES && !state.completions[chore][task])
        return interaction.showModal(buildNoteModal(chore, state.notes[chore]));
      if (chore in NOTE_CHORES) delete state.notes[chore];

      state.completions[chore][task] = !state.completions[chore][task];
      saveState();

      const person = state.assignments[choreOf(chore)];
      const tasks = getTasks(chore);
      const done = countDone(chore);
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
    .setTitle(chore === BATHROOMS ? `${BATHROOMS} — Main bathroom` : chore)
    .setColor(0x5865F2)
    .setDescription(`**Assigned to:** ${person}\n\n${lines.join('\n')}${note ? `\n\n📝 **What was done:** ${note}` : ''}`)
    .addFields({ name: 'Progress', value: `\`${getProgressBar(done, tasks.length)}\`` })
    .setFooter({ text: chore in NOTE_CHORES ? 'Tap the button below to describe what you did'
      : choreOf(chore) === BATHROOMS ? 'Tap a number to tick off a task • Finishing either bathroom completes the chore'
      : 'Tap a number below to tick off a task' });
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