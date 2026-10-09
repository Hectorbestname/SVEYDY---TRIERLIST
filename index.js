
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
  throw new Error("DISCORD_TOKEN, CLIENT_ID ve GUILD_ID ayarlanmalı.");
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

const FILES = {
  tiers: path.join(__dirname, "tiers.json"),
  queues: path.join(__dirname, "queue.json"),
  config: path.join(__dirname, "botconfig.json")
};

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error("JSON okuma hatası:", error);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let tierData = readJSON(FILES.tiers, {});
let queueData = readJSON(FILES.queues, {});
let config = readJSON(FILES.config, {});

const COLORS = {
  main: 0x7C3AED,
  success: 0x22C55E,
  danger: 0xEF4444
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

function getTierRole(guild, tier) {
  return guild.roles.cache.find(
    role => role.name.trim().toUpperCase() === tier.toUpperCase()
  ) || null;
}

function getKitRole(guild, kit) {
  return guild.roles.cache.find(
    role => role.name.trim().toUpperCase() === kit.toUpperCase()
  ) || null;
}

// Yalnızca eksik tier rollerini oluşturur.
// Kit rollerini oluşturmaz veya değiştirmez.
async function ensureTierRoles(guild) {
  await guild.roles.fetch();

  const botMember = await guild.members.fetchMe();

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.error("Eksik tier rolleri için Manage Roles izni gerekli.");
    return;
  }

  for (const tier of TIERS) {
    if (getTierRole(guild, tier)) {
      console.log(`Mevcut rol kullanılıyor: ${tier}`);
      continue;
    }

    try {
      await guild.roles.create({
        name: tier,
        color: COLORS.main,
        reason: "SVEYDY Tier sistemi: eksik rol"
      });

      console.log(`Oluşturulan tier rolü: ${tier}`);
    } catch (error) {
      console.error(`${tier} oluşturulamadı:`, error.message);
    }
  }
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
    queues[kit] = {
      open: false,
      entries: [],
      messageId: null,
      channelId: null
    };
  }
  if (!Array.isArray(queues[kit].entries)) {
    queues[kit].entries = [];
  }
  return queues[kit];
}

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function makeQueueEmbed(guildId, kit) {
  const queue = getQueue(guildId, kit);
  const open = queue.open && queue.entries.length < MAX_QUEUE_SIZE;

  const players = queue.entries.length
    ? queue.entries.map((player, index) =>
        `**${index + 1}.** <@${player.userId}> · \`${player.minecraftUsername}\``
      ).join("\n")
    : "_Sıra boş._";

  return new EmbedBuilder()
    .setColor(open ? COLORS.success : COLORS.danger)
    .setTitle(`⚔️ ${kit} TIER SIRASI`)
    .setDescription(
      `${open ? "🟢 Açık" : "🔴 Kapalı"} · **${queue.entries.length}/${MAX_QUEUE_SIZE}**\n\n${players}`
    )
    .setFooter({ text: "SVEYDY • TIER TEST" })
    .setTimestamp();
}

function queueComponents(kit) {
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
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(queue.messageId);
    await message.edit({
      embeds: [makeQueueEmbed(guild.id, kit)],
      components: queueComponents(kit)
    });
  } catch (error) {
    console.error("Sıra paneli güncellenemedi:", error.message);
  }
}

async function deployCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("tierim")
      .setDescription("Kendi tierlerini göster.")
      .addStringOption(o => o.setName("kit").setDescription("Kit")
        .setRequired(false)
        .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Bir kitin tier listesini göster.")
      .addStringOption(o => o.setName("kit").setDescription("Kit")
        .setRequired(true)
        .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("tierver")
      .setDescription("Oyuncuya tier ver.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption(o => o.setName("oyuncu").setDescription("Oyuncu").setRequired(true))
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true)
        .addChoices(...KITS.map(k => ({ name: k, value: k }))))
      .addStringOption(o => o.setName("tier").setDescription("Tier").setRequired(true)
        .addChoices(...TIERS.map(t => ({ name: t, value: t }))))
      .addStringOption(o => o.setName("minecraft").setDescription("Minecraft adı").setRequired(false)),

    new SlashCommandBuilder()
      .setName("sirakur")
      .setDescription("Kit için sıra paneli kur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true)
        .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("siraac")
      .setDescription("Kit sırasını aç.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true)
        .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("sirakapat")
      .setDescription("Kit sırasını kapat ve temizle.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true)
        .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("panelkur")
      .setDescription("Kit rolü seçim panelini kur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("ayar")
      .setDescription("Tier ve kit rollerini kontrol et.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
}

client.once("ready", async () => {
  console.log(`${client.user.tag} aktif.`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await ensureTierRoles(guild);
    await deployCommands();
    console.log("Komutlar yüklendi.");
  } catch (error) {
    console.error("Başlangıç hatası:", error);
  }

  // Önceki açık sıralar yeniden başlatma sonrasında kapalı başlar.
  for (const queues of Object.values(queueData)) {
    for (const queue of Object.values(queues || {})) {
      if (queue && typeof queue === "object" && "open" in queue) {
        queue.open = false;
      }
    }
  }
  saveQueues();
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const guild = interaction.guild;
      if (!guild) {
        return interaction.reply({ content: "Bu komut sunucuda kullanılmalı.", ephemeral: true });
      }

      if (interaction.commandName === "ayar") {
        await guild.roles.fetch();

        const missingTiers = TIERS.filter(t => !getTierRole(guild, t));
        const missingKits = KITS.filter(k => !getKitRole(guild, k));

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(missingTiers.length || missingKits.length ? COLORS.danger : COLORS.success)
              .setTitle("⚙️ SVEYDY Rol Kontrolü")
              .addFields(
                { name: "Tier rolleri", value: missingTiers.length ? missingTiers.join(", ") : "Hepsi mevcut." },
                { name: "Kit rolleri", value: missingKits.length ? missingKits.join(", ") : "Hepsi mevcut." }
              )
          ],
          ephemeral: true
        });
      }

      if (interaction.commandName === "tierim") {
        const kit = interaction.options.getString("kit");
        const player = tierData[guild.id]?.[interaction.user.id] || {};

        const entries = Object.entries(player)
          .filter(([name, value]) => KITS.includes(name) && value?.tier)
          .filter(([name]) => !kit || name === kit);

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.main)
              .setTitle(`${interaction.user.username} • Tierler`)
              .setDescription(entries.length
                ? entries.map(([name, value]) => `**${name}:** ${value.tier}`).join("\n")
                : "Kayıtlı tier bulunamadı.")
          ],
          ephemeral: true
        });
      }

      if (interaction.commandName === "tierlist") {
        const kit = interaction.options.getString("kit");
        const entries = [];

        for (const [userId, kits] of Object.entries(tierData[guild.id] || {})) {
          const record = kits?.[kit];
          if (record?.tier) entries.push({ userId, ...record });
        }

        entries.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.main)
              .setTitle(`${kit} Tier Listesi`)
              .setDescription(entries.length
                ? entries.map((p, i) => `**${i + 1}.** <@${p.userId}> — **${p.tier}** · \`${p.minecraft || "Belirtilmedi"}\``).join("\n")
                : "Bu kitte henüz tier kaydı yok.")
          ]
        });
      }

      if (interaction.commandName === "tierver") {
        const target = interaction.options.getUser("oyuncu");
        const kit = interaction.options.getString("kit");
        const tier = interaction.options.getString("tier");
        const minecraft = interaction.options.getString("minecraft");

        await guild.roles.fetch();

        const member = await guild.members.fetch(target.id);
        const tierRole = getTierRole(guild, tier);
        const kitRole = getKitRole(guild, kit);
        const botMember = await guild.members.fetchMe();

        if (!tierRole || !kitRole) {
          return interaction.reply({
            content: `Eksik rol: ${!tierRole ? tier : kit}. /ayar komutunu çalıştır.`,
            ephemeral: true
          });
        }

        if (tierRole.position >= botMember.roles.highest.position ||
            kitRole.position >= botMember.roles.highest.position) {
          return interaction.reply({
            content: "Botun rolünü tier ve kit rollerinin üzerine taşı.",
            ephemeral: true
          });
        }

        const previous = tierData[guild.id]?.[target.id]?.[kit];
        const oldTier = previous?.tier;
        const oldRole = oldTier ? getTierRole(guild, oldTier) : null;

        if (oldRole && member.roles.cache.has(oldRole.id)) {
          await member.roles.remove(oldRole);
        }

        await member.roles.add([tierRole, kitRole]);

        tierData[guild.id] ??= {};
        tierData[guild.id][target.id] ??= {};
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
          const channel = await guild.channels.fetch(RESULT_CHANNEL_ID).catch(() => null);
          if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(console.error);
        }

        return interaction.reply({
          content: `✅ ${target} oyuncusuna ${kit} / ${tier} verildi.`,
          embeds: [embed],
          ephemeral: true
        });
      }

      if (interaction.commandName === "sirakur") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = false;
        queue.entries = [];
        queue.channelId = interaction.channelId;

        const message = await interaction.channel.send({
          embeds: [makeQueueEmbed(guild.id, kit)],
          components: queueComponents(kit)
        });

        queue.messageId = message.id;
        saveQueues();

        return interaction.reply({
          content: `${kit} sıra paneli kuruldu. Açmak için /siraac kit:${kit}`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "siraac" || interaction.commandName === "sirakapat") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = interaction.commandName === "siraac";

        if (!queue.open) queue.entries = [];

        saveQueues();
        await refreshQueue(guild, kit);

        return interaction.reply({
          content: queue.open ? `🟢 ${kit} sırası açıldı.` : `🔴 ${kit} sırası kapatıldı ve temizlendi.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "panelkur") {
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
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.main)
              .setTitle("🎮 SVEYDY • KIT ROLLERİ")
              .setDescription("Almak istediğin kit rollerini seç.")
          ],
          components: [new ActionRowBuilder().addComponents(select)]
        });

        return interaction.reply({ content: "Kit paneli kuruldu.", ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "kit_role_select") {
      const guild = interaction.guild;
      await guild.roles.fetch();

      const member = await guild.members.fetch(interaction.user.id);
      const botMember = await guild.members.fetchMe();

      const roles = interaction.values.map(kit => getKitRole(guild, kit));

      if (roles.some(role => !role)) {
        return interaction.reply({
          content: "Seçilen kit rollerinden biri bulunamadı. Rol adlarını kontrol et.",
          ephemeral: true
        });
      }

      if (roles.some(role => role.position >= botMember.roles.highest.position)) {
        return interaction.reply({
          content: "Botun rolü kit rollerinin üzerinde olmalı.",
          ephemeral: true
        });
      }

      await member.roles.add(roles);

      return interaction.reply({
        content: `Kit rollerin verildi: ${interaction.values.join(", ")}`,
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith("queue_join:")) {
      const kit = interaction.customId.split(":")[1];
      const queue = getQueue(interaction.guildId, kit);

      if (!queue.open) {
        return interaction.reply({ content: "Bu sıra kapalı.", ephemeral: true });
      }

      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
        saveQueues();
        await refreshQueue(interaction.guild, kit);
        return interaction.reply({ content: "Sıra dolu.", ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`queue_modal:${kit}`)
        .setTitle(`${kit} Sırasına Katıl`);

      const input = new TextInputBuilder()
        .setCustomId("minecraft_username")
        .setLabel("Minecraft kullanıcı adın")
        .setPlaceholder("Steve123")
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
      const queue = getQueue(interaction.guildId, kit);

      if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        return interaction.reply({ content: "Geçerli Minecraft kullanıcı adı gir.", ephemeral: true });
      }

      if (!queue.open) {
        return interaction.reply({ content: "Bu sıra artık kapalı.", ephemeral: true });
      }

      if (queue.entries.some(p =>
        p.userId === interaction.user.id ||
        p.minecraftUsername.toLowerCase() === username.toLowerCase()
      )) {
        return interaction.reply({ content: "Sen veya bu Minecraft hesabı zaten sırada.", ephemeral: true });
      }

      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
        saveQueues();
        await refreshQueue(interaction.guild, kit);
        return interaction.reply({ content: "Sıra dolu.", ephemeral: true });
      }

      queue.entries.push({
        userId: interaction.user.id,
        minecraftUsername: username,
        joinedAt: new Date().toISOString()
      });

      if (queue.entries.length >= MAX_QUEUE_SIZE) queue.open = false;

      saveQueues();
      await refreshQueue(interaction.guild, kit);

      return interaction.reply({
        content: `Sıraya katıldın! **${kit}** sıra numaran: ${queue.entries.length}.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Komut/etkileşim hatası:", error);

    const response = {
      content: "İşlem başarısız oldu. Render loglarını kontrol et.",
      ephemeral: true
    };

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
});

process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

client.login(TOKEN);
