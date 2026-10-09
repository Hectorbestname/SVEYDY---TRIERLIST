
const {
  Client,
  GatewayIntentBits,
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
  throw new Error("DISCORD_TOKEN, CLIENT_ID ve GUILD_ID değişkenlerini Render'de ayarla.");
}

const KITS = [
  "SWORD", "AXE", "MACE", "CRYSTAL",
  "UHC", "POT", "SMP", "NETPOT", "DIAPOT"
];

const TIERS = [
  "HT1", "LT1", "HT2", "LT2", "HT3",
  "LT3", "HT4", "LT4", "HT5", "LT5"
];

const MAX_QUEUE_SIZE = 20;
const COLOR = 0x7C3AED;

const FILES = {
  tiers: path.join(__dirname, "tiers.json"),
  queues: path.join(__dirname, "queue.json")
};

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return structuredClone(fallback);
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Dosya okunamadı: ${file}`, error);
    return structuredClone(fallback);
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let tierData = readJSON(FILES.tiers, {});
let queueData = readJSON(FILES.queues, {});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

function saveTiers() {
  saveJSON(FILES.tiers, tierData);
}

function saveQueues() {
  saveJSON(FILES.queues, queueData);
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

// Yalnızca "MACE LT5" gibi birleşik rol adlarını kullanır.
function getTierRole(guild, kit, tier) {
  const expectedName = `${kit} ${tier}`;
  return guild.roles.cache.find(
    role => normalize(role.name) === normalize(expectedName)
  ) || null;
}

// Kit rolleri sunucuda zaten mevcut olmalı.
function getKitRole(guild, kit) {
  return guild.roles.cache.find(
    role => normalize(role.name) === normalize(kit)
  ) || null;
}

function getQueue(guildId, kit) {
  if (!queueData[guildId] || Array.isArray(queueData[guildId])) {
    queueData[guildId] = {};
  }

  if (!queueData[guildId][kit]) {
    queueData[guildId][kit] = {
      open: false,
      entries: [],
      channelId: null,
      messageId: null
    };
  }

  const queue = queueData[guildId][kit];
  if (!Array.isArray(queue.entries)) queue.entries = [];

  return queue;
}

function queueEmbed(guildId, kit) {
  const queue = getQueue(guildId, kit);
  const open = queue.open && queue.entries.length < MAX_QUEUE_SIZE;

  const players = queue.entries.length
    ? queue.entries.map((p, i) =>
        `**${i + 1}.** <@${p.userId}> · \`${p.minecraftUsername}\``
      ).join("\n")
    : "_Sıra boş._";

  return new EmbedBuilder()
    .setColor(open ? 0x22C55E : 0xEF4444)
    .setTitle(`⚔️ ${kit} TIER SIRASI`)
    .setDescription(
      `${open ? "🟢 Açık" : "🔴 Kapalı"} · **${queue.entries.length}/${MAX_QUEUE_SIZE}**\n\n${players}`
    )
    .setFooter({ text: "SVEYDY • TIER TEST" })
    .setTimestamp();
}

function queueButtons(kit) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_join:${kit}`)
        .setLabel("Sıraya Katıl")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("⚔️")
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
      embeds: [queueEmbed(guild.id, kit)],
      components: queueButtons(kit)
    });
  } catch (error) {
    console.error(`${kit} sıra paneli güncellenemedi:`, error.message);
  }
}

async function deployCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("tierver")
      .setDescription("Oyuncuya kit tieri ver.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption(o => o.setName("oyuncu").setDescription("Oyuncu").setRequired(true))
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true)
        .addChoices(...KITS.map(k => ({ name: k, value: k }))))
      .addStringOption(o => o.setName("tier").setDescription("Tier").setRequired(true)
        .addChoices(...TIERS.map(t => ({ name: t, value: t }))))
      .addStringOption(o => o.setName("minecraft").setDescription("Minecraft kullanıcı adı").setRequired(false)),

    new SlashCommandBuilder()
      .setName("tierim")
      .setDescription("Kendi tierlerini göster.")
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(false)
        .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Kit tier listesini göster.")
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true)
        .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("sirakur")
      .setDescription("Kit sıra paneli kur.")
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
      .setDescription("Kit rol panelini kur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("ayar")
      .setDescription("Kit ve birleşik tier rollerini kontrol et.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ].map(c => c.toJSON());

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
    await guild.roles.fetch();

    // Genel HT1/LT5 rolleri oluşturulmaz.
    // Yalnızca kit + tier rolleri kontrol edilir; mevcut roller değiştirilmez.
    const missing = [];
    for (const kit of KITS) {
      for (const tier of TIERS) {
        if (!getTierRole(guild, kit, tier)) {
          missing.push(`${kit} ${tier}`);
        }
      }
    }

    if (missing.length) {
      console.warn("Sunucuda bulunamayan kit+tier rolleri:", missing.join(", "));
    }

    await deployCommands();
    console.log("Slash komutları yüklendi.");
  } catch (error) {
    console.error("Bot başlangıç hatası:", error);
  }

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

        const missing = [];
        for (const kit of KITS) {
          for (const tier of TIERS) {
            if (!getTierRole(guild, kit, tier)) missing.push(`${kit} ${tier}`);
          }
        }

        const missingKits = KITS.filter(kit => !getKitRole(guild, kit));

        const embed = new EmbedBuilder()
          .setColor(missing.length || missingKits.length ? 0xEF4444 : 0x22C55E)
          .setTitle("⚙️ SVEYDY • Rol Kontrolü")
          .setDescription(
            `**Eksik kit+tier rolleri:**\n${missing.length ? missing.slice(0, 40).join(", ") : "Yok"}\n\n` +
            `**Eksik kit rolleri:**\n${missingKits.length ? missingKits.join(", ") : "Yok"}`
          );

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.commandName === "tierver") {
        const target = interaction.options.getUser("oyuncu");
        const kit = interaction.options.getString("kit");
        const tier = interaction.options.getString("tier");
        const minecraft = interaction.options.getString("minecraft");

        await guild.roles.fetch();

        const member = await guild.members.fetch(target.id);
        const botMember = await guild.members.fetchMe();
        const newRole = getTierRole(guild, kit, tier);
        const kitRole = getKitRole(guild, kit);

        if (!newRole) {
          return interaction.reply({
            content: `❌ **${kit} ${tier}** rolü sunucuda bulunamadı. Genel ${tier} rolü kullanılmayacak. Önce doğru rolü oluştur.`,
            ephemeral: true
          });
        }

        if (!kitRole) {
          return interaction.reply({
            content: `❌ **${kit}** kit rolü bulunamadı.`,
            ephemeral: true
          });
        }

        if (
          newRole.position >= botMember.roles.highest.position ||
          kitRole.position >= botMember.roles.highest.position
        ) {
          return interaction.reply({
            content: "❌ Bot rolünü kit ve tier rollerinin üstüne taşı.",
            ephemeral: true
          });
        }

        const previous = tierData[guild.id]?.[target.id]?.[kit];
        const oldTier = previous?.tier;
        const oldRole = oldTier ? getTierRole(guild, kit, oldTier) : null;

        if (oldRole && oldRole.id !== newRole.id && member.roles.cache.has(oldRole.id)) {
          await member.roles.remove(oldRole);
        }

        await member.roles.add([newRole, kitRole]);

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
          .setColor(COLOR)
          .setTitle("🏆 TIER SONUCU")
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: "Oyuncu", value: `<@${target.id}>`, inline: true },
            { name: "Kit", value: kit, inline: true },
            { name: "Yeni rol", value: `**${kit} ${tier}**`, inline: true },
            { name: "Önceki tier", value: oldTier || "Yeni kayıt", inline: true },
            { name: "Minecraft", value: tierData[guild.id][target.id][kit].minecraft, inline: true },
            { name: "Test eden", value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();

        if (RESULT_CHANNEL_ID) {
          const channel = await guild.channels.fetch(RESULT_CHANNEL_ID).catch(() => null);
          if (channel?.isTextBased()) {
            await channel.send({ embeds: [embed] }).catch(console.error);
          }
        }

        return interaction.reply({
          content: `✅ ${target} oyuncusuna **${kit} ${tier}** rolü verildi.`,
          embeds: [embed],
          ephemeral: true
        });
      }

      if (interaction.commandName === "tierim") {
        const kit = interaction.options.getString("kit");
        const records = tierData[guild.id]?.[interaction.user.id] || {};

        const entries = Object.entries(records)
          .filter(([name, record]) => KITS.includes(name) && record?.tier)
          .filter(([name]) => !kit || name === kit);

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLOR)
              .setTitle(`${interaction.user.username} • Tierler`)
              .setDescription(entries.length
                ? entries.map(([name, record]) => `**${name}:** ${name} ${record.tier}`).join("\n")
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
              .setColor(COLOR)
              .setTitle(`${kit} Tier Listesi`)
              .setDescription(entries.length
                ? entries.map((p, i) => `**${i + 1}.** <@${p.userId}> — **${kit} ${p.tier}** · \`${p.minecraft || "Belirtilmedi"}\``).join("\n")
                : "Henüz tier kaydı yok.")
          ]
        });
      }

      if (interaction.commandName === "sirakur") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = false;
        queue.entries = [];
        queue.channelId = interaction.channelId;

        const message = await interaction.channel.send({
          embeds: [queueEmbed(guild.id, kit)],
          components: queueButtons(kit)
        });

        queue.messageId = message.id;
        saveQueues();

        return interaction.reply({
          content: `${kit} sıra paneli kuruldu. Açmak için /siraac komutunu kullan.`,
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
          content: queue.open ? `${kit} sırası açıldı.` : `${kit} sırası kapatıldı ve temizlendi.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "panelkur") {
        const menu = new StringSelectMenuBuilder()
          .setCustomId("kit_role_select")
          .setPlaceholder("Kit rollerini seç")
          .setMinValues(1)
          .setMaxValues(KITS.length)
          .addOptions(KITS.map(kit => ({
            label: kit,
            value: kit,
            description: `${kit} kit rolünü al`
          })));

        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLOR)
              .setTitle("🎮 SVEYDY • KIT ROLLERİ")
              .setDescription("Almak istediğin mevcut kit rollerini seç.")
          ],
          components: [new ActionRowBuilder().addComponents(menu)]
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
          content: "Seçilen kit rollerinden biri sunucuda bulunamadı.",
          ephemeral: true
        });
      }

      if (roles.some(role => role.position >= botMember.roles.highest.position)) {
        return interaction.reply({
          content: "Bot rolünü kit rollerinin üstüne taşı.",
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

      if (!KITS.includes(kit) || !/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        return interaction.reply({ content: "Geçersiz kit veya Minecraft adı.", ephemeral: true });
      }

      if (!queue.open) {
        return interaction.reply({ content: "Bu sıra kapalı.", ephemeral: true });
      }

      if (queue.entries.some(p =>
        p.userId === interaction.user.id ||
        p.minecraftUsername.toLowerCase() === username.toLowerCase()
      )) {
        return interaction.reply({ content: "Sen veya bu Minecraft adı zaten sırada.", ephemeral: true });
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
        content: `✅ ${kit} sırasına katıldın. Sıra numaran: ${queue.entries.length}.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Etkileşim hatası:", error);

    if (interaction.isRepliable()) {
      const response = {
        content: "İşlem sırasında hata oluştu. Render Logs bölümünü kontrol et.",
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
});

process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));
process.on("uncaughtException", error => console.error("Uncaught exception:", error));

client.login(TOKEN);
