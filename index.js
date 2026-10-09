
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const RESULT_CHANNEL_ID = process.env.TIER_RESULT_CHANNEL_ID || "";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("DISCORD_TOKEN, CLIENT_ID ve GUILD_ID Render Environment Variables bölümünde ayarlanmalı.");
}

const KITS = [
  "SWORD", "AXE", "MACE", "CRYSTAL", "UHC",
  "POT", "SMP", "NETPOT", "DIAPOT"
];

const TIERS = [
  "HT1", "LT1", "HT2", "LT2", "HT3",
  "LT3", "HT4", "LT4", "HT5", "LT5"
];

const MAX_QUEUE_SIZE = 20;
const DATA_DIR = __dirname;

const FILES = {
  tiers: path.join(DATA_DIR, "tiers.json"),
  queues: path.join(DATA_DIR, "queue.json"),
  config: path.join(DATA_DIR, "botconfig.json")
};

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return structuredClone(fallback);
    }

    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`JSON okuma hatası (${path.basename(file)}):`, error);
    return structuredClone(fallback);
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`JSON yazma hatası (${path.basename(file)}):`, error);
    throw error;
  }
}

let tierData = readJSON(FILES.tiers, {});
let queueData = readJSON(FILES.queues, {});
let config = readJSON(FILES.config, {});

const COLORS = {
  main: 0x7C3AED,
  success: 0x22C55E,
  danger: 0xEF4444,
  info: 0x3B82F6
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

function saveTiers() {
  writeJSON(FILES.tiers, tierData);
}

function saveQueues() {
  writeJSON(FILES.queues, queueData);
}

function saveConfig() {
  writeJSON(FILES.config, config);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function getGuildQueues(guildId) {
  if (!queueData[guildId] || Array.isArray(queueData[guildId])) {
    queueData[guildId] = {};
  }

  return queueData[guildId];
}

function getQueue(guildId, kit) {
  const queues = getGuildQueues(guildId);

  if (!queues[kit]) {
    queues[kit] = { open: false, entries: [], messageId: null, channelId: null };
  }

  if (!Array.isArray(queues[kit].entries)) {
    queues[kit].entries = [];
  }

  return queues[kit];
}

function getPlayerTier(guildId, userId, kit) {
  return tierData[guildId]?.[userId]?.[kit] || null;
}

function getKitRole(guild, kit) {
  return guild.roles.cache.find(role =>
    normalizeName(role.name) === normalizeName(kit)
  );
}

function getTierRole(guild, tier) {
  return guild.roles.cache.find(role =>
    normalizeName(role.name) === normalizeName(tier)
  );
}

function isStaff(member) {
  return Boolean(
    member &&
    (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild)
    )
  );
}

function makeQueueEmbed(guildId, kit) {
  const queue = getQueue(guildId, kit);
  const open = queue.open && queue.entries.length < MAX_QUEUE_SIZE;

  const list = queue.entries.length
    ? queue.entries.map((player, index) =>
        `**${index + 1}.** <@${player.userId}> · \`${player.minecraftUsername}\``
      ).join("\n")
    : "_Henüz oyuncu yok._";

  return new EmbedBuilder()
    .setColor(open ? COLORS.success : COLORS.danger)
    .setTitle(`⚔️ ${kit} TIER SIRASI`)
    .setDescription(
      `${open ? "🟢 Açık" : "🔴 Kapalı"} · **${queue.entries.length}/${MAX_QUEUE_SIZE}**\n\n${list}`
    )
    .setFooter({ text: "SVEYDY • TIER TEST" })
    .setTimestamp();
}

function makeQueueComponents(kit) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_join:${kit}`)
        .setLabel("Sıraya Katıl")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

async function refreshQueue(guild, kit) {
  const queue = getQueue(guild.id, kit);
  if (!queue.channelId || !queue.messageId) return;

  try {
    const channel = await guild.channels.fetch(queue.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(queue.messageId);
    await message.edit({
      embeds: [makeQueueEmbed(guild.id, kit)],
      components: makeQueueComponents(kit)
    });
  } catch (error) {
    console.error(`${kit} sıra paneli güncellenemedi:`, error.message);
  }
}

async function deployCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("tierim")
      .setDescription("Kendi tierlerini göster.")
      .addStringOption(option =>
        option.setName("kit")
          .setDescription("Tierini görmek istediğin kit")
          .setRequired(false)
          .addChoices(...KITS.map(kit => ({ name: kit, value: kit })))
      ),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Bir kitin tier listesini göster.")
      .addStringOption(option =>
        option.setName("kit")
          .setDescription("Kit seç")
          .setRequired(true)
          .addChoices(...KITS.map(kit => ({ name: kit, value: kit })))
      ),

    new SlashCommandBuilder()
      .setName("tierver")
      .setDescription("Bir oyuncuya tier ver veya tierini değiştir.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption(option =>
        option.setName("oyuncu").setDescription("Oyuncu").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("kit")
          .setDescription("Kit")
          .setRequired(true)
          .addChoices(...KITS.map(kit => ({ name: kit, value: kit })))
      )
      .addStringOption(option =>
        option.setName("tier")
          .setDescription("Yeni tier")
          .setRequired(true)
          .addChoices(...TIERS.map(tier => ({ name: tier, value: tier })))
      )
      .addStringOption(option =>
        option.setName("minecraft")
          .setDescription("Minecraft kullanıcı adı")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("sirakur")
      .setDescription("Seçilen kit için kısa sıra paneli kur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(option =>
        option.setName("kit")
          .setDescription("Sıra kurulacak kit")
          .setRequired(true)
          .addChoices(...KITS.map(kit => ({ name: kit, value: kit })))
      ),

    new SlashCommandBuilder()
      .setName("siraac")
      .setDescription("Seçilen kitin sırasını aç.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(option =>
        option.setName("kit").setDescription("Kit").setRequired(true)
          .addChoices(...KITS.map(kit => ({ name: kit, value: kit })))
      ),

    new SlashCommandBuilder()
      .setName("sirakapat")
      .setDescription("Seçilen kitin sırasını kapat ve temizle.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(option =>
        option.setName("kit").setDescription("Kit").setRequired(true)
          .addChoices(...KITS.map(kit => ({ name: kit, value: kit })))
      ),

    new SlashCommandBuilder()
      .setName("panelkur")
      .setDescription("Kit rolü seçim panelini kur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("ayar")
      .setDescription("Mevcut tier ve kit rollerini kontrol et.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log(`${commands.length} slash komutu sunucuya yüklendi.`);
}

client.once("ready", async () => {
  console.log(`${client.user.tag} aktif.`);

  // Bot yeniden başladığında açık sıraları güvenlik için kapatır.
  for (const [guildId, queues] of Object.entries(queueData)) {
    for (const queue of Object.values(queues || {})) {
      if (queue && typeof queue === "object" && "open" in queue) {
        queue.open = false;
      }
    }
  }

  saveQueues();

  try {
    await deployCommands();
  } catch (error) {
    console.error("Slash komutları yüklenemedi:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      const guild = interaction.guild;

      if (!guild) {
        return interaction.reply({
          content: "Bu komut sunucuda kullanılmalı.",
          ephemeral: true
        });
      }

      if (commandName === "tierim") {
        const kit = interaction.options.getString("kit");
        const player = tierData[guild.id]?.[interaction.user.id] || {};
        const entries = Object.entries(player)
          .filter(([key, value]) => KITS.includes(key) && value?.tier);

        const filtered = kit
          ? entries.filter(([key]) => key === kit)
          : entries;

        if (!filtered.length) {
          return interaction.reply({
            content: kit
              ? `${kit} için kayıtlı tierin yok.`
              : "Henüz kayıtlı tierin yok.",
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor(COLORS.main)
          .setTitle(`🏆 ${interaction.user.username} • Tierler`)
          .setThumbnail(interaction.user.displayAvatarURL())
          .setDescription(filtered.map(([key, value]) =>
            `**${key}:** ${value.tier}`
          ).join("\n"));

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === "tierlist") {
        const kit = interaction.options.getString("kit");
        const rows = [];

        for (const [userId, kits] of Object.entries(tierData[guild.id] || {})) {
          const record = kits?.[kit];
          if (record?.tier) {
            rows.push({ userId, tier: record.tier, minecraft: record.minecraft || "Belirtilmedi" });
          }
        }

        rows.sort((a, b) =>
          TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)
        );

        const embed = new EmbedBuilder()
          .setColor(COLORS.main)
          .setTitle(`🏆 ${kit} Tier Listesi`)
          .setDescription(
            rows.length
              ? rows.map((row, index) =>
                  `**${index + 1}.** <@${row.userId}> — **${row.tier}** · \`${row.minecraft}\``
                ).join("\n")
              : "Bu kit için henüz tier kaydı yok."
          );

        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === "tierver") {
        const target = interaction.options.getUser("oyuncu");
        const kit = interaction.options.getString("kit");
        const tier = interaction.options.getString("tier");
        const minecraft = interaction.options.getString("minecraft");

        const member = await guild.members.fetch(target.id);
        const tierRole = getTierRole(guild, tier);
        const kitRole = getKitRole(guild, kit);

        if (!tierRole) {
          return interaction.reply({
            content: `❌ **${tier}** rolü sunucuda bulunamadı. Yeni rol oluşturmadım; mevcut rolü kontrol et.`,
            ephemeral: true
          });
        }

        if (!kitRole) {
          return interaction.reply({
            content: `❌ **${kit}** rolü sunucuda bulunamadı. Rol adını kontrol et.`,
            ephemeral: true
          });
        }

        const botMember = guild.members.me;
        if (
          !botMember ||
          tierRole.position >= botMember.roles.highest.position ||
          kitRole.position >= botMember.roles.highest.position
        ) {
          return interaction.reply({
            content: "❌ Botun rolü, verilecek rollerin üstünde olmalı.",
            ephemeral: true
          });
        }

        const previous = getPlayerTier(guild.id, target.id, kit);
        const oldTier = previous?.tier || null;
        const oldRole = oldTier ? getTierRole(guild, oldTier) : null;

        if (oldRole && member.roles.cache.has(oldRole.id)) {
          await member.roles.remove(oldRole).catch(() => {});
        }

        await member.roles.add([tierRole, kitRole]);

        if (!tierData[guild.id]) tierData[guild.id] = {};
        if (!tierData[guild.id][target.id]) tierData[guild.id][target.id] = {};

        tierData[guild.id][target.id][kit] = {
          tier,
          minecraft: minecraft || previous?.minecraft || "Belirtilmedi",
          tester: interaction.user.id,
          updatedAt: new Date().toISOString()
        };

        saveTiers();

        const embed = new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle("🏆 TIER SONUCU")
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: "Oyuncu", value: `<@${target.id}>`, inline: true },
            { name: "Kit", value: kit, inline: true },
            { name: "Sonuç", value: `${oldTier || "Yeni"} → **${tier}**`, inline: true },
            { name: "Minecraft", value: tierData[guild.id][target.id][kit].minecraft, inline: true },
            { name: "Test Eden", value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();

        if (RESULT_CHANNEL_ID) {
          const resultChannel = await guild.channels.fetch(RESULT_CHANNEL_ID).catch(() => null);
          if (resultChannel?.isTextBased()) {
            await resultChannel.send({ embeds: [embed] }).catch(console.error);
          }
        }

        return interaction.reply({
          content: `✅ ${target} oyuncusuna **${kit} / ${tier}** verildi.`,
          embeds: [embed],
          ephemeral: true
        });
      }

      if (commandName === "sirakur") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = false;
        queue.entries = [];
        queue.channelId = interaction.channelId;

        const message = await interaction.channel.send({
          embeds: [makeQueueEmbed(guild.id, kit)],
          components: makeQueueComponents(kit)
        });

        queue.messageId = message.id;
        saveQueues();

        return interaction.reply({
          content: `✅ ${kit} için ayrı sıra paneli kuruldu. Sırayı açmak için \`/siraac kit:${kit}\` kullan.`,
          ephemeral: true
        });
      }

      if (commandName === "siraac") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = true;
        saveQueues();
        await refreshQueue(guild, kit);

        return interaction.reply({
          content: `🟢 **${kit}** sırası açıldı.`,
          ephemeral: true
        });
      }

      if (commandName === "sirakapat") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = false;
        queue.entries = [];
        saveQueues();
        await refreshQueue(guild, kit);

        return interaction.reply({
          content: `🔴 **${kit}** sırası kapatıldı ve temizlendi.`,
          ephemeral: true
        });
      }

      if (commandName === "panelkur") {
        const embed = new EmbedBuilder()
          .setColor(COLORS.main)
          .setTitle("🎮 SVEYDY • KIT ROLLERİ")
          .setDescription("Almak istediğin kit rollerini aşağıdaki menüden seç.");

        const select = new StringSelectMenuBuilder()
          .setCustomId("kit_role_select")
          .setPlaceholder("Kit rollerini seç...")
          .setMinValues(1)
          .setMaxValues(KITS.length)
          .addOptions(KITS.map(kit => ({
            label: kit,
            value: kit,
            description: `${kit} rolünü al`
          })));

        await interaction.channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(select)]
        });

        return interaction.reply({
          content: "✅ Kit rol paneli kuruldu.",
          ephemeral: true
        });
      }

      if (commandName === "ayar") {
        const missingTiers = TIERS.filter(tier => !getTierRole(guild, tier));
        const missingKits = KITS.filter(kit => !getKitRole(guild, kit));

        const embed = new EmbedBuilder()
          .setColor(missingTiers.length || missingKits.length ? COLORS.danger : COLORS.success)
          .setTitle("⚙️ SVEYDY • Rol Kontrolü")
          .addFields(
            {
              name: "Tier Rolleri",
              value: missingTiers.length ? `Eksik: ${missingTiers.join(", ")}` : "✅ Tüm tier rolleri mevcut."
            },
            {
              name: "Kit Rolleri",
              value: missingKits.length ? `Eksik: ${missingKits.join(", ")}` : "✅ Tüm kit rolleri mevcut."
            }
          )
          .setFooter({ text: "Bu komut yeni rol oluşturmaz." });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "kit_role_select") {
      const guild = interaction.guild;
      const member = await guild.members.fetch(interaction.user.id);
      const missing = interaction.values.filter(kit => !getKitRole(guild, kit));

      if (missing.length) {
        return interaction.reply({
          content: `❌ Şu roller bulunamadı: ${missing.join(", ")}. Yetkiliye bildir.`,
          ephemeral: true
        });
      }

      const roles = interaction.values.map(kit => getKitRole(guild, kit));
      const botMember = guild.members.me;

      if (roles.some(role => role.position >= botMember.roles.highest.position)) {
        return interaction.reply({
          content: "❌ Botun rolünü kit rollerinin üzerine taşımalısın.",
          ephemeral: true
        });
      }

      await member.roles.add(roles);

      return interaction.reply({
        content: `✅ Aldığın kit rolleri: ${interaction.values.join(", ")}`,
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith("queue_join:")) {
      const kit = interaction.customId.split(":")[1];

      if (!KITS.includes(kit)) {
        return interaction.reply({
          content: "Geçersiz kit.",
          ephemeral: true
        });
      }

      const queue = getQueue(interaction.guildId, kit);

      if (!queue.open) {
        return interaction.reply({
          content: `🔴 **${kit}** sırası şu anda kapalı.`,
          ephemeral: true
        });
      }

      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
        saveQueues();
        await refreshQueue(interaction.guild, kit);

        return interaction.reply({
          content: "Sıra dolmuş. Yeni oyuncu alınmıyor.",
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`queue_modal:${kit}`)
        .setTitle(`${kit} Sırasına Katıl`);

      const input = new TextInputBuilder()
        .setCustomId("minecraft_username")
        .setLabel("Minecraft kullanıcı adın")
        .setPlaceholder("Örn: Steve123")
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(16)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("queue_modal:")) {
      const kit = interaction.customId.split(":")[1];
      const username = interaction.fields.getTextInputValue("minecraft_username").trim();

      if (!KITS.includes(kit)) {
        return interaction.reply({ content: "Geçersiz kit.", ephemeral: true });
      }

      if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        return interaction.reply({
          content: "Geçerli bir Minecraft kullanıcı adı gir.",
          ephemeral: true
        });
      }

      const queue = getQueue(interaction.guildId, kit);

      if (!queue.open) {
        return interaction.reply({
          content: `🔴 **${kit}** sırası artık kapalı.`,
          ephemeral: true
        });
      }

      const duplicateUser = queue.entries.some(player => player.userId === interaction.user.id);
      const duplicateName = queue.entries.some(player =>
        normalizeName(player.minecraftUsername) === normalizeName(username)
      );

      if (duplicateUser || duplicateName) {
        return interaction.reply({
          content: "❌ Sen veya bu Minecraft kullanıcı adı zaten sırada.",
          ephemeral: true
        });
      }

      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
        saveQueues();
        await refreshQueue(interaction.guild, kit);

        return interaction.reply({
          content: "Sıra dolmuş.",
          ephemeral: true
        });
      }

      queue.entries.push({
        userId: interaction.user.id,
        minecraftUsername: username,
        joinedAt: new Date().toISOString()
      });

      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
      }

      saveQueues();
      await refreshQueue(interaction.guild, kit);

      return interaction.reply({
        content: `✅ **${kit}** sırasına eklendin. Sıradaki numaran: **${queue.entries.length}**.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Etkileşim hatası:", error);

    const message = "❌ İşlem sırasında hata oluştu. Bot konsolundaki hatayı kontrol edin.";

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

client.login(TOKEN);
