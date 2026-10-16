// Run this ONCE to register slash commands with Discord.
// You never need to run this again unless you add/rename/remove commands.
//
//   node register.js

const { SlashCommandBuilder, REST, Routes } = require('discord.js');
require('dotenv').config();

const CHORES = {
  "🍳 Kitchen": [],
  "🌿 Outdoors": [],
  "🧹 Floors": [],
  "🚿 Bathrooms": [],
};

const commands = [
  new SlashCommandBuilder()
    .setName('chores')
    .setDescription("Show this week's chore assignments"),

  new SlashCommandBuilder()
    .setName('checklist')
    .setDescription('Show and tick off tasks for a chore')
    .addStringOption(opt =>
      opt.setName('chore')
        .setDescription('Which chore?')
        .setRequired(true)
        .addChoices(...Object.keys(CHORES).map(c => ({ name: c, value: c })))
    ),

  new SlashCommandBuilder()
    .setName('addmember')
    .setDescription('Add a flatmate to the rotation')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Their name').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('removemember')
    .setDescription('Remove a flatmate from the rotation')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Their name').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('members')
    .setDescription('List all flatmates in the rotation'),

  new SlashCommandBuilder()
    .setName('rotate')
    .setDescription('Assign chores for a new week'),

  new SlashCommandBuilder()
    .setName('progress')
    .setDescription('Show overall completion progress for this week'),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show the rotation schedule for the last 4 weeks'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered! You can now start the bot with: node bot.js');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();