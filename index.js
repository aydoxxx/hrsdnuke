require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  AuditLogEvent,
  ChannelType
} = require('discord.js');

// ═══════════════════════════════════════════════════════════════════
//                         HRSDNUKE - ANTI-NUKE BOT
//                      ☠️ GOTH EDITION ☠️
// ═══════════════════════════════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

// ═══════════════════════════════════════════════════════════════════
//                         DATA STORAGE
// ═══════════════════════════════════════════════════════════════════

// Permanent ban list: Map<guildId, Set<userId>>
const permanentBans = new Map();

// Channel deletion tracker: Map<guildId, Map<userId, { count: number, firstDelete: timestamp }>>
const channelDeletionTracker = new Map();

// Whitelisted users (immune to anti-nuke): Map<guildId, Set<userId>>
const whitelistedUsers = new Map();

// Bot owner ID - set this to your Discord ID
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';

// ═══════════════════════════════════════════════════════════════════
//                         HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function getPermanentBans(guildId) {
  if (!permanentBans.has(guildId)) {
    permanentBans.set(guildId, new Set());
  }
  return permanentBans.get(guildId);
}

function getChannelTracker(guildId) {
  if (!channelDeletionTracker.has(guildId)) {
    channelDeletionTracker.set(guildId, new Map());
  }
  return channelDeletionTracker.get(guildId);
}

function getWhitelist(guildId) {
  if (!whitelistedUsers.has(guildId)) {
    whitelistedUsers.set(guildId, new Set());
  }
  return whitelistedUsers.get(guildId);
}

function isWhitelisted(guildId, userId) {
  return getWhitelist(guildId).has(userId) || userId === BOT_OWNER_ID;
}

// ═══════════════════════════════════════════════════════════════════
//                    SCARY TRACED MESSAGE (GERMAN)
// ═══════════════════════════════════════════════════════════════════

async function sendTracedMessage(user, guild) {
  const scaryEmbed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('⛧ 𝕳𝕽𝕾𝕯𝕹𝖀𝕶𝕰 - 𝕾𝕴𝕮𝕳𝕰𝕽𝕳𝕰𝕴𝕿𝕾𝕾𝖄𝕾𝕿𝕰𝕸 ⛧')
    .setDescription(`
# ☠️ DU WURDEST ERFASST ☠️

\`\`\`diff
- WARNUNG: NUKE-VERSUCH ERKANNT
\`\`\`

**Du wurdest von unserem NUKE-SICHERHEITSSYSTEM erfasst.**

╔══════════════════════════════════════════╗
║  ⚠️ ALLE DEINE DATEN WURDEN AN           ║
║     **aydo628** WEITERGELEITET           ║
╚══════════════════════════════════════════╝

## 📍 GEOLOCATION: **TRACED**
## 🖥️ IP-ADRESSE: **LOGGED**
## 🔐 HARDWARE-ID: **ERFASST**

\`\`\`ansi
[2;31m[SYSTEM] Deine Aktionen wurden protokolliert.
[SYSTEM] Alle Admin-Rechte wurden entfernt.
[SYSTEM] Du wurdest als BEDROHUNG markiert.[0m
\`\`\`

**Server:** ${guild.name}
**Zeitpunkt:** ${new Date().toLocaleString('de-DE')}
**Status:** 🔴 PERMANENT ÜBERWACHT

> *Versuche nicht, dies rückgängig zu machen.*
> *Das System vergisst nie.*

⛧ HRSDNUKE PROTECTION SYSTEM ⛧
    `)
    .setThumbnail('https://i.imgur.com/SkAiPtA.png')
    .setFooter({ text: '☠️ hrsdnuke - goth edition ☠️' })
    .setTimestamp();

  try {
    await user.send({ embeds: [scaryEmbed] });
  } catch (error) {
    console.log(`[HRSDNUKE] Konnte DM an ${user.tag} nicht senden.`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//                    ANTI-NUKE: TRACE USER
// ═══════════════════════════════════════════════════════════════════

async function traceUser(guild, userId, reason) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Don't trace the bot itself or whitelisted users
    if (member.user.bot || isWhitelisted(guild.id, userId)) return;
    if (member.id === guild.ownerId) return; // Server owner kann nicht getraced werden

    // Check if user has admin permissions - ADMINS WERDEN AUCH GETRACED!
    const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
    
    console.log(`[HRSDNUKE] ⚠️ TRACING USER: ${member.user.tag} - Grund: ${reason}`);
    if (hasAdmin) {
      console.log(`[HRSDNUKE] ⚠️ USER HAT ADMIN RECHTE - WERDEN ENTFERNT!`);
    }

    // Create or get "traced" role FIRST (before removing roles)
    let tracedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'traced');
    if (!tracedRole) {
      tracedRole = await guild.roles.create({
        name: 'traced',
        color: 0x000000,
        permissions: [], // KEINE Permissions!
        reason: 'HRSDNUKE Anti-Nuke System'
      });
      console.log(`[HRSDNUKE] "traced" Rolle erstellt.`);
    }

    // Get bot's highest role position
    const botMember = await guild.members.fetch(client.user.id);
    const botHighestRole = botMember.roles.highest;

    // Remove ALL roles from the user (including admin roles!)
    const rolesToRemove = member.roles.cache.filter(role => 
      role.id !== guild.id && // @everyone kann nicht entfernt werden
      role.position < botHighestRole.position // Bot kann nur niedrigere Rollen entfernen
    );

    console.log(`[HRSDNUKE] Entferne ${rolesToRemove.size} Rollen von ${member.user.tag}...`);

    // Remove all roles at once for speed
    try {
      await member.roles.set([tracedRole], `[HRSDNUKE] NUKE DETECTED - ${reason}`);
      console.log(`[HRSDNUKE] ✓ Alle Rollen entfernt und "traced" Rolle vergeben!`);
    } catch (e) {
      // Fallback: remove roles one by one
      console.log(`[HRSDNUKE] Bulk-Remove fehlgeschlagen, entferne einzeln...`);
      for (const [, role] of rolesToRemove) {
        try {
          await member.roles.remove(role, `[HRSDNUKE] NUKE DETECTED`);
        } catch (err) {
          console.log(`[HRSDNUKE] Konnte Rolle ${role.name} nicht entfernen: ${err.message}`);
        }
      }
      // Add traced role
      try {
        await member.roles.add(tracedRole, `[HRSDNUKE] User getraced`);
      } catch (err) {
        console.log(`[HRSDNUKE] Konnte traced Rolle nicht hinzufügen: ${err.message}`);
      }
    }

    // Send scary message
    await sendTracedMessage(member.user, guild);

    // Log to console
    console.log(`[HRSDNUKE] ✓ User ${member.user.tag} wurde erfolgreich getraced!`);
    if (hasAdmin) {
      console.log(`[HRSDNUKE] ✓ ADMIN RECHTE WURDEN ENTFERNT!`);
    }

  } catch (error) {
    console.error(`[HRSDNUKE] Fehler beim Tracen:`, error);
  }
}

// ═══════════════════════════════════════════════════════════════════
//                    CHANNEL DELETION MONITOR
// ═══════════════════════════════════════════════════════════════════

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;

  const guild = channel.guild;
  const tracker = getChannelTracker(guild.id);

  try {
    // Get audit logs to find who deleted the channel
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelDelete,
      limit: 1
    });

    const logEntry = auditLogs.entries.first();
    if (!logEntry) return;

    const { executor } = logEntry;
    if (!executor || executor.bot) return;
    if (isWhitelisted(guild.id, executor.id)) return;
    if (executor.id === guild.ownerId) return;

    const now = Date.now();
    const userTracker = tracker.get(executor.id) || { count: 0, firstDelete: now };

    // Reset if more than 1 minute has passed
    if (now - userTracker.firstDelete > 60000) {
      userTracker.count = 0;
      userTracker.firstDelete = now;
    }

    userTracker.count++;
    tracker.set(executor.id, userTracker);

    console.log(`[HRSDNUKE] Channel gelöscht von ${executor.tag} - Count: ${userTracker.count}`);

    // If 2 or more channels deleted within 1 minute = TRACE
    if (userTracker.count >= 2) {
      console.log(`[HRSDNUKE] ⚠️ NUKE DETECTED! User: ${executor.tag}`);
      await traceUser(guild, executor.id, 'Channel-Nuke erkannt (2+ Channels in 1 Minute gelöscht)');
      tracker.delete(executor.id); // Reset after tracing
    }

  } catch (error) {
    console.error('[HRSDNUKE] Fehler bei Channel-Überwachung:', error);
  }
});

// ═══════════════════════════════════════════════════════════════════
//                    MASS BAN DETECTION
// ═══════════════════════════════════════════════════════════════════

const banTracker = new Map(); // Map<guildId, Map<moderatorId, { count, firstBan }>>

function getBanTracker(guildId) {
  if (!banTracker.has(guildId)) {
    banTracker.set(guildId, new Map());
  }
  return banTracker.get(guildId);
}

client.on('guildBanAdd', async (ban) => {
  const guild = ban.guild;
  const tracker = getBanTracker(guild.id);

  try {
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberBanAdd,
      limit: 1
    });

    const logEntry = auditLogs.entries.first();
    if (!logEntry) return;

    const { executor } = logEntry;
    if (!executor || executor.bot) return;
    if (executor.id === client.user.id) return; // Ignore our own bans
    if (isWhitelisted(guild.id, executor.id)) return;
    if (executor.id === guild.ownerId) return;

    const now = Date.now();
    const userTracker = tracker.get(executor.id) || { count: 0, firstBan: now };

    if (now - userTracker.firstBan > 60000) {
      userTracker.count = 0;
      userTracker.firstBan = now;
    }

    userTracker.count++;
    tracker.set(executor.id, userTracker);

    console.log(`[HRSDNUKE] Ban ausgeführt von ${executor.tag} - Count: ${userTracker.count}`);

    // 3+ bans in 1 minute = suspicious
    if (userTracker.count >= 3) {
      console.log(`[HRSDNUKE] ⚠️ MASS BAN DETECTED! User: ${executor.tag}`);
      await traceUser(guild, executor.id, 'Mass-Ban erkannt (3+ Bans in 1 Minute)');
      tracker.delete(executor.id);
    }

  } catch (error) {
    console.error('[HRSDNUKE] Fehler bei Ban-Überwachung:', error);
  }
});

// ═══════════════════════════════════════════════════════════════════
//                    PERMANENT BAN ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════

client.on('guildBanRemove', async (ban) => {
  const guild = ban.guild;
  const userId = ban.user.id;
  const permBans = getPermanentBans(guild.id);

  if (permBans.has(userId)) {
    console.log(`[HRSDNUKE] Permanent gebannter User ${ban.user.tag} wurde entbannt - RE-BANNING!`);
    
    try {
      await guild.members.ban(userId, { 
        reason: '[HRSDNUKE] Permanent Ban - Automatischer Re-Ban' 
      });
      console.log(`[HRSDNUKE] ✓ User ${ban.user.tag} wurde erfolgreich re-gebannt!`);
    } catch (error) {
      console.error(`[HRSDNUKE] Fehler beim Re-Ban:`, error);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
//                    ROLE DELETION MONITOR
// ═══════════════════════════════════════════════════════════════════

const roleTracker = new Map();

function getRoleTracker(guildId) {
  if (!roleTracker.has(guildId)) {
    roleTracker.set(guildId, new Map());
  }
  return roleTracker.get(guildId);
}

client.on('roleDelete', async (role) => {
  const guild = role.guild;
  const tracker = getRoleTracker(guild.id);

  try {
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.RoleDelete,
      limit: 1
    });

    const logEntry = auditLogs.entries.first();
    if (!logEntry) return;

    const { executor } = logEntry;
    if (!executor || executor.bot) return;
    if (isWhitelisted(guild.id, executor.id)) return;
    if (executor.id === guild.ownerId) return;

    const now = Date.now();
    const userTracker = tracker.get(executor.id) || { count: 0, firstDelete: now };

    if (now - userTracker.firstDelete > 60000) {
      userTracker.count = 0;
      userTracker.firstDelete = now;
    }

    userTracker.count++;
    tracker.set(executor.id, userTracker);

    if (userTracker.count >= 2) {
      console.log(`[HRSDNUKE] ⚠️ ROLE NUKE DETECTED! User: ${executor.tag}`);
      await traceUser(guild, executor.id, 'Rollen-Nuke erkannt (2+ Rollen in 1 Minute gelöscht)');
      tracker.delete(executor.id);
    }

  } catch (error) {
    console.error('[HRSDNUKE] Fehler bei Rollen-Überwachung:', error);
  }
});

// ═══════════════════════════════════════════════════════════════════
//                    SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════

const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban-Verwaltung')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Fügt einen User zur permanenten Banliste hinzu')
        .addUserOption(opt => opt.setName('user').setDescription('User zum Bannen').setRequired(false))
        .addStringOption(opt => opt.setName('userid').setDescription('User-ID zum Bannen (für User nicht auf dem Server)').setRequired(false))
        .addStringOption(opt => opt.setName('grund').setDescription('Grund für den Ban').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Entfernt einen User von der permanenten Banliste')
        .addStringOption(opt => opt.setName('userid').setDescription('User-ID zum Entbannen').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Zeigt alle permanent gebannten User')
    ),
  
  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Whitelist-Verwaltung (Immun gegen Anti-Nuke)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Fügt einen User zur Whitelist hinzu')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Entfernt einen User von der Whitelist')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Zeigt alle gewhitelisteten User')
    ),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Entbannt einen User (ohne von Permaban-Liste zu entfernen)')
    .addStringOption(opt => opt.setName('userid').setDescription('User-ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('hrsdnuke')
    .setDescription('Zeigt Bot-Informationen')
];

// ═══════════════════════════════════════════════════════════════════
//                    COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const { commandName, options } = interaction;
  const guild = interaction.guild;

  // Check permissions
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ 
      content: '☠️ Du brauchst Administrator-Rechte für diesen Befehl.', 
      ephemeral: true 
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //                    /ban COMMAND
  // ═══════════════════════════════════════════════════════════════════

  if (commandName === 'ban') {
    const subcommand = options.getSubcommand();

    if (subcommand === 'add') {
      const user = options.getUser('user');
      const userIdInput = options.getString('userid');
      const reason = options.getString('grund') || 'Kein Grund angegeben';

      const targetId = user?.id || userIdInput;

      if (!targetId) {
        return interaction.reply({ 
          content: '☠️ Du musst entweder einen User oder eine User-ID angeben!', 
          ephemeral: true 
        });
      }

      const permBans = getPermanentBans(guild.id);
      permBans.add(targetId);

      try {
        await guild.members.ban(targetId, { reason: `[HRSDNUKE PERMABAN] ${reason}` });
        
        const embed = new EmbedBuilder()
          .setColor(0x000000)
          .setTitle('⛧ PERMANENT BAN ⛧')
          .setDescription(`
**User-ID:** \`${targetId}\`
**Grund:** ${reason}
**Status:** 🔴 PERMANENT GEBANNT

> *Dieser User wird automatisch re-gebannt, falls jemand versucht ihn zu entbannen.*
          `)
          .setFooter({ text: '☠️ hrsdnuke ☠️' })
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      } catch (error) {
        return interaction.reply({ 
          content: `☠️ Ban fehlgeschlagen: ${error.message}`, 
          ephemeral: true 
        });
      }
    }

    if (subcommand === 'remove') {
      const userId = options.getString('userid');
      const permBans = getPermanentBans(guild.id);

      if (!permBans.has(userId)) {
        return interaction.reply({ 
          content: '☠️ Dieser User ist nicht auf der Permaban-Liste.', 
          ephemeral: true 
        });
      }

      permBans.delete(userId);

      try {
        await guild.members.unban(userId, '[HRSDNUKE] Permaban entfernt');
      } catch (e) {
        // User might not be banned
      }

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✓ PERMABAN ENTFERNT')
        .setDescription(`**User-ID:** \`${userId}\`\n**Status:** 🟢 ENTBANNT`)
        .setFooter({ text: '☠️ hrsdnuke ☠️' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'list') {
      const permBans = getPermanentBans(guild.id);
      const banList = Array.from(permBans);

      if (banList.length === 0) {
        return interaction.reply({ 
          content: '☠️ Keine permanent gebannten User.', 
          ephemeral: true 
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('⛧ PERMANENT BAN LISTE ⛧')
        .setDescription(banList.map((id, i) => `\`${i + 1}.\` <@${id}> (\`${id}\`)`).join('\n'))
        .setFooter({ text: `☠️ ${banList.length} User permanent gebannt ☠️` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //                    /whitelist COMMAND
  // ═══════════════════════════════════════════════════════════════════

  if (commandName === 'whitelist') {
    const subcommand = options.getSubcommand();

    if (subcommand === 'add') {
      const user = options.getUser('user');
      const whitelist = getWhitelist(guild.id);
      whitelist.add(user.id);

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✓ WHITELIST')
        .setDescription(`**${user.tag}** wurde zur Whitelist hinzugefügt.\n\n> *Dieser User ist jetzt immun gegen das Anti-Nuke System.*`)
        .setFooter({ text: '☠️ hrsdnuke ☠️' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'remove') {
      const user = options.getUser('user');
      const whitelist = getWhitelist(guild.id);
      whitelist.delete(user.id);

      return interaction.reply({ 
        content: `✓ **${user.tag}** wurde von der Whitelist entfernt.`, 
        ephemeral: true 
      });
    }

    if (subcommand === 'list') {
      const whitelist = getWhitelist(guild.id);
      const list = Array.from(whitelist);

      if (list.length === 0) {
        return interaction.reply({ 
          content: '☠️ Whitelist ist leer.', 
          ephemeral: true 
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('⛧ WHITELIST ⛧')
        .setDescription(list.map((id, i) => `\`${i + 1}.\` <@${id}>`).join('\n'))
        .setFooter({ text: `☠️ ${list.length} User gewhitelisted ☠️` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //                    /unban COMMAND
  // ═══════════════════════════════════════════════════════════════════

  if (commandName === 'unban') {
    const userId = options.getString('userid');

    try {
      await guild.members.unban(userId, '[HRSDNUKE] Manueller Unban');
      return interaction.reply({ 
        content: `✓ User \`${userId}\` wurde entbannt.\n\n⚠️ Falls der User auf der Permaban-Liste ist, wird er automatisch re-gebannt!`, 
        ephemeral: true 
      });
    } catch (error) {
      return interaction.reply({ 
        content: `☠️ Unban fehlgeschlagen: ${error.message}`, 
        ephemeral: true 
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //                    /hrsdnuke COMMAND
  // ═══════════════════════════════════════════════════════════════════

  if (commandName === 'hrsdnuke') {
    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('⛧ 𝕳𝕽𝕾𝕯𝕹𝖀𝕶𝕰 ⛧')
      .setDescription(`
# ☠️ GOTH ANTI-NUKE SYSTEM ☠️

**Version:** 1.0.0
**Status:** 🟢 AKTIV

## 🔒 Schutzfunktionen:
- \`Channel-Nuke Detection\` - 2+ Channels in 1 Min
- \`Mass-Ban Detection\` - 3+ Bans in 1 Min
- \`Role-Nuke Detection\` - 2+ Rollen in 1 Min
- \`Permanent Ban System\` - Automatischer Re-Ban

## ⌨️ Befehle:
- \`/ban add\` - Permanent bannen
- \`/ban remove\` - Permaban entfernen
- \`/ban list\` - Gebannte User anzeigen
- \`/whitelist add/remove/list\` - Whitelist verwalten
- \`/unban\` - User entbannen

## ⚠️ Bei Nuke-Versuch:
1. Alle Rollen werden entfernt
2. "traced" Rolle wird vergeben
3. Scary Nachricht wird gesendet
4. aydo628 wird benachrichtigt

> *Das System überwacht auch Admins.*
      `)
      .setThumbnail('https://i.imgur.com/SkAiPtA.png')
      .setFooter({ text: '☠️ hrsdnuke - goth edition ☠️' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
});

// ═══════════════════════════════════════════════════════════════════
//                    BOT STARTUP
// ═══════════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  ⛧  HRSDNUKE - GOTH ANTI-NUKE SYSTEM  ⛧');
  console.log('');
  console.log(`  Bot: ${client.user.tag}`);
  console.log(`  Server: ${client.guilds.cache.size}`);
  console.log(`  Status: ONLINE`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('[HRSDNUKE] Registriere Slash-Commands...');

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    console.log('[HRSDNUKE] ✓ Slash-Commands registriert!');
  } catch (error) {
    console.error('[HRSDNUKE] Fehler bei Command-Registrierung:', error);
  }

  // Set bot status
  client.user.setPresence({
    activities: [{ name: '☠️ Überwache Server...', type: 3 }],
    status: 'dnd'
  });
});

// ═══════════════════════════════════════════════════════════════════
//                    ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════

process.on('unhandledRejection', (error) => {
  console.error('[HRSDNUKE] Unhandled Rejection:', error);
});

client.on('error', (error) => {
  console.error('[HRSDNUKE] Client Error:', error);
});

// ═══════════════════════════════════════════════════════════════════
//                    LOGIN
// ═══════════════════════════════════════════════════════════════════

client.login(process.env.DISCORD_TOKEN);
