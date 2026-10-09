const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

// ==================================================
// SVEYDY TRIERLIST | AYARLAR
// ==================================================

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  TIER_RESULT_CHANNEL_ID,
  TESTER_ROLE_ID
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "DISCORD_TOKEN, CLIENT_ID ve GUILD_ID Render Environment bölümünde tanımlanmalı!"
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const KITS = [
  "SWORD",
  "AXE",
  "MACE",
  "CRYSTAL",
  "UHC",
  "POT",
  "SMP",
  "NETPOT",
  "DIAPOT"
];

const TIERS = [
  "HT1", "LT1",
  "HT2", "LT2",
  "HT3", "LT3",
  "HT4", "LT4",
  "HT5", "LT5"
];

const TIER_COLORS = {
  HT1: "#FF3030",
  LT1: "#FF6542",
  HT2: "#FF8C00",
  LT2: "#FFD000",
  HT3: "#A8FF24",
  LT3: "#24D66B",
  HT4: "#00D5D8",
  LT4: "#3288FF",
  HT5: "#9B59FF",
  LT5: "#B0B0B0"
};

const COLORS = {
  primary: "#8B5CF6",
  background: "#171526",
  success: "#22C55E",
  danger: "#EF4444",
  info: "#38BDF8"
};

const MAX_QUEUE_SIZE = 20;

const DATA_FILE = path.join(__dirname, "tiers.json");
const CONFIG_FILE = path.join(__dirname, "botconfig.json");
const QUEUE_FILE = path.join(__dirname, "queue.json");

// ==================================================
// DOSYA SİSTEMİ
// ==================================================

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`${path.basename(file)} okunamadı:`, error);
    return fallback;
  }
}

function writeJson(file, value) {
  const temporaryFile = `${file}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(value, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, file);
}

let data = readJson(DATA_FILE, {});
let config = readJson(CONFIG_FILE, {});
let queues = readJson(QUEUE_FILE, {});

config.kitRoles ??= {};
config.tierRoles ??= {};

function saveData() {
  writeJson(DATA_FILE, data);
}

function saveConfig() {
  writeJson(CONFIG_FILE, config);
}

function saveQueues() {
  writeJson(QUEUE_FILE, queues);
}

// ==================================================
// TIER VERİLERİ
// ==================================================

function guildData(guildId) {
  data[guildId] ??= {};
  return data[guildId];
}

function playerKey(userId, kit) {
  return `${userId}:${kit}`;
}

function tierRoleName(tier, kit) {
  return `${tier} ${kit}`;
}

// ==================================================
// OTOMATİK ROL SİSTEMİ
// ==================================================

async function createRoleIfMissing(guild, roleName, color) {
  let role = guild.roles.cache.find(
    r => r.name.toUpperCase() === roleName.toUpperCase()
  );

  if (role) {
    if (role.hexColor.toUpperCase() !== color.toUpperCase()) {
      await role.setColor(color, "SVEYDY tier renk ayarı");
    }

    return {
      role,
      created: false
    };
  }

  role = await guild.roles.create({
    name: roleName,
    color,
    reason: "SVEYDY TRIERLIST otomatik rol sistemi"
  });

  console.log(`Yeni rol oluşturuldu: ${role.name}`);

  return {
    role,
    created: true
  };
}

async function createAllRoles(guild) {
  await guild.roles.fetch();

  let created = 0;
  let existing = 0;

  for (const kit of KITS) {
    const kitResult = await createRoleIfMissing(
      guild,
      kit,
      COLORS.primary
    );

    config.kitRoles[kit] = kitResult.role.id;

    if (kitResult.created) {
      created++;
    } else {
      existing++;
    }

    for (const tier of TIERS) {
      const result = await createRoleIfMissing(
        guild,
        tierRoleName(tier, kit),
        TIER_COLORS[tier]
      );

      config.tierRoles[`${kit}:${tier}`] = result.role.id;

      if (result.created) {
        created++;
      } else {
        existing++;
      }
    }
  }

  saveConfig();

  return {
    created,
    existing
  };
}

async function getTierRole(guild, kit, tier) {
  const key = `${kit}:${tier}`;
  const savedId = config.tierRoles[key];

  let role = savedId
    ? await guild.roles.fetch(savedId).catch(() => null)
    : null;

  if (!role) {
    const result = await createRoleIfMissing(
      guild,
      tierRoleName(tier, kit),
      TIER_COLORS[tier]
    );

    role = result.role;
    config.tierRoles[key] = role.id;
    saveConfig();
  } else if (
    role.hexColor.toUpperCase() !== TIER_COLORS[tier].toUpperCase()
  ) {
    await role.setColor(TIER_COLORS[tier]);
  }

  return role;
}

// ==================================================
// SIRAKUR | KALICI KUYRUK SİSTEMİ
// ==================================================

function getQueue(guildId) {
  if (!queues[guildId]) {
    queues[guildId] = {
      open: true,
      entries: [],
      channelId: null,
      messageId: null
    };

    saveQueues();
  }

  const queue = queues[guildId];

  if (typeof queue.open !== "boolean") {
    queue.open = true;
  }

  if (!Array.isArray(queue.entries)) {
    queue.entries = [];
  }

  queue.entries = queue.entries.slice(0, MAX_QUEUE_SIZE);

  queue.channelId ??= null;
  queue.messageId ??= null;

  return queue;
}

function queueEmbed(queue) {
  const isOpen = queue.open && queue.entries.length < MAX_QUEUE_SIZE;

  const playerList = queue.entries.length
    ? queue.entries.map((player, index) => {
        return (
          `**${String(index + 1).padStart(2, "0")}.** ` +
          `<@${player.userId}>  ·  \`${player.minecraftUsername}\``
        );
      }).join("\n")
    : "_Henüz sıraya katılan yok. İlk oyuncu sen ol!_";

  const statusText = isOpen
    ? "🟢 **SIRA AÇIK** · Oyuncular katılabilir."
    : "🔴 **SIRA KAPALI** · Yeni oyuncu alınmıyor.";

  return new EmbedBuilder()
    .setColor(isOpen ? COLORS.success : COLORS.danger)
    .setAuthor({
      name: "SVEYDY COMPETITIVE • TIER TEST"
    })
    .setTitle("⚔️  TIER TEST SIRASI")
    .setDescription(
      "```ansi\n" +
      "   S V E Y D Y   /   T R I E R L I S T\n" +
      "```" +
      "\n" +
      "Minecraft PvP tier testine katılmak için aşağıdaki butonu kullan.\n\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      `${statusText}\n` +
      `👥 **Kapasite:** ${queue.entries.length}/${MAX_QUEUE_SIZE}\n` +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
      "**📋 GÜNCEL SIRA**\n" +
      playerList +
      "\n\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "🎮 Minecraft kullanıcı adını doğru gir.\n" +
      "🛡️ Sıra yönetimi yetkili testerlarla sınırlıdır."
    )
    .setFooter({
      text: "SVEYDY TRIERLIST • COMPETITIVE QUEUE"
    })
    .setTimestamp();
}

function queueComponents(queue) {
  const isOpen = queue.open && queue.entries.length < MAX_QUEUE_SIZE;

  if (isOpen) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sveydy_queue_join")
          .setLabel("Sıraya Katıl")
          .setEmoji("🎮")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("sveydy_queue_close")
          .setLabel("Sırayı Kapat")
          .setEmoji("🔴")
          .setStyle(ButtonStyle.Danger)
      )
    ];
  }

  // Sıra kapalıyken yalnızca açma butonu görünür.
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sveydy_queue_open")
        .setLabel("Sırayı Aç")
        .setEmoji("🟢")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

async function updateQueuePanel(guild, queue) {
  if (queue.entries.length >= MAX_QUEUE_SIZE) {
    queue.open = false;
  }

  saveQueues();

  if (!queue.channelId || !queue.messageId) {
    return false;
  }

  const channel = await guild.channels
    .fetch(queue.channelId)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) {
    console.error("Kuyruk paneli kanalı bulunamadı.");
    return false;
  }

  const message = await channel.messages
    .fetch(queue.messageId)
    .catch(() => null);

  if (!message) {
    console.error("Kuyruk paneli mesajı bulunamadı.");
    return false;
  }

  await message.edit({
    embeds: [queueEmbed(queue)],
    components: queueComponents(queue)
  });

  return true;
}

async function canManageQueue(interaction) {
  if (!interaction.guild || !interaction.member) {
    return false;
  }

  // Sunucu sahibi her zaman yönetebilir.
  if (interaction.user.id === interaction.guild.ownerId) {
    return true;
  }

  // Yönetici veya Sunucuyu Yönet izni olanlar yönetebilir.
  if (
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    ) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return true;
  }

  // TESTER_ROLE_ID tanımlıysa bu role sahip kişiler de yönetebilir.
  if (TESTER_ROLE_ID) {
    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);

    if (member?.roles.cache.has(TESTER_ROLE_ID)) {
      return true;
    }
  }

  return false;
}

function createQueueModal() {
  const modal = new ModalBuilder()
    .setCustomId("sveydy_queue_username_modal")
    .setTitle("🎮 Tier Test Sırası");

  const usernameInput = new TextInputBuilder()
    .setCustomId("minecraft_username")
    .setLabel("Minecraft kullanıcı adın")
    .setPlaceholder("Örn: Steve_123")
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(16)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(usernameInput)
  );

  return modal;
}

// ==================================================
// SLASH KOMUTLARI
// ==================================================

function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName("ayar")
      .setDescription("Kit ve tier rollerini otomatik oluştur.")
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageRoles
      ),

    new SlashCommandBuilder()
      .setName("panelkur")
      .setDescription("Competitive kit seçim panelini oluştur.")
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      ),

    new SlashCommandBuilder()
      .setName("sirakur")
      .setDescription("Tier test sırası panelini oluştur.")
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      ),

    new SlashCommandBuilder()
      .setName("tierver")
      .setDescription("Oyuncuya tier test sonucu verir.")
      .addUserOption(option =>
        option
          .setName("oyuncu")
          .setDescription("Test edilen oyuncu")
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName("kit")
          .setDescription("Test edilen kit")
          .setRequired(true)
          .addChoices(
            ...KITS.map(kit => ({
              name: kit,
              value: kit
            }))
          )
      )
      .addStringOption(option =>
        option
          .setName("tier")
          .setDescription("Test sonucu")
          .setRequired(true)
          .addChoices(
            ...TIERS.map(tier => ({
              name: tier,
              value: tier
            }))
          )
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageRoles
      ),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Seçilen kitin tier sıralamasını göster.")
      .addStringOption(option =>
        option
          .setName("kit")
          .setDescription("Kit seç")
          .setRequired(true)
          .addChoices(
            ...KITS.map(kit => ({
              name: kit,
              value: kit
            }))
          )
      ),

    new SlashCommandBuilder()
      .setName("tierim")
      .setDescription("Kendi tier sonuçlarını göster.")
  ].map(command => command.toJSON());
}

async function registerCommands() {
  const rest = new REST({
    version: "10"
  }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    {
      body: getCommands()
    }
  );

  console.log("Slash komutları başarıyla kaydedildi.");
}

// ==================================================
// BOT HAZIR
// ==================================================

client.once("ready", async () => {
  console.log(`${client.user.tag} aktif!`);

  // Bot yeniden başladığında kayıtlı kuyruk panellerini yenile.
  for (const [guildId, queue] of Object.entries(queues)) {
    if (!queue.channelId || !queue.messageId) {
      continue;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      await updateQueuePanel(guild, queue);
    } catch (error) {
      console.error(
        `Kuyruk paneli yenilenemedi (${guildId}):`,
        error.message
      );
    }
  }
});

// ==================================================
// ETKİLEŞİMLER
// ==================================================

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.inGuild()) {
      return;
    }

    // ----------------------------------------------
    // KUYRUK BUTONLARI
    // ----------------------------------------------

    if (interaction.isButton()) {
      const buttonId = interaction.customId;

      if (
        buttonId === "sveydy_queue_join" ||
        buttonId === "sveydy_queue_close" ||
        buttonId === "sveydy_queue_open"
      ) {
        const queue = getQueue(interaction.guildId);

        if (buttonId === "sveydy_queue_join") {
          if (!queue.open || queue.entries.length >= MAX_QUEUE_SIZE) {
            queue.open = false;
            saveQueues();

            await updateQueuePanel(interaction.guild, queue);

            return interaction.reply({
              content: "🔴 Sıra şu anda kapalı veya dolu.",
              ephemeral: true
            });
          }

          const existingPlayer = queue.entries.find(
            entry => entry.userId === interaction.user.id
          );

          if (existingPlayer) {
            return interaction.reply({
              content:
                `⚠️ Zaten sıradasın! Sıra numaran: **${
                  queue.entries.findIndex(
                    entry => entry.userId === interaction.user.id
                  ) + 1
                }**`,
              ephemeral: true
            });
          }

          return interaction.showModal(createQueueModal());
        }

        // Sırayı kapatma/açma yalnızca yetkililerde.
        const allowed = await canManageQueue(interaction);

        if (!allowed) {
          return interaction.reply({
            content:
              "⛔ Bu işlem için tester rolü, Sunucuyu Yönet veya Yönetici izni gerekiyor.",
            ephemeral: true
          });
        }

        if (buttonId === "sveydy_queue_close") {
          queue.open = false;
          saveQueues();

          await updateQueuePanel(interaction.guild, queue);

          return interaction.reply({
            content: "🔴 Tier test sırası kapatıldı.",
            ephemeral: true
          });
        }

        if (buttonId === "sveydy_queue_open") {
          if (queue.entries.length >= MAX_QUEUE_SIZE) {
            return interaction.reply({
              content:
                "⚠️ Sırada 20 oyuncu var. Önce kuyruktaki oyuncuların yer açması gerekiyor.",
              ephemeral: true
            });
          }

          queue.open = true;
          saveQueues();

          await updateQueuePanel(interaction.guild, queue);

          return interaction.reply({
            content: "🟢 Tier test sırası yeniden açıldı.",
            ephemeral: true
          });
        }
      }

      // ----------------------------------------------
      // ROL OLUŞTURMA BUTONU
      // ----------------------------------------------

      if (buttonId === "sveydy_create_roles") {
        if (
          !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageRoles
          )
        ) {
          return interaction.reply({
            content: "⛔ Bu işlem için Rolleri Yönet iznin olmalı.",
            ephemeral: true
          });
        }

        await interaction.deferReply({
          ephemeral: true
        });

        const result = await createAllRoles(interaction.guild);

        return interaction.editReply(
          "✅ **SVEYDY rol kurulumu tamamlandı!**\n\n" +
          `🆕 Yeni roller: **${result.created}**\n` +
          `♻️ Mevcut roller: **${result.existing}**\n` +
          `🎮 Kit sayısı: **${KITS.length}**\n` +
          `🏆 Kit başına tier: **${TIERS.length}**\n` +
          `📋 Tier rolleri: **${KITS.length * TIERS.length}**\n\n` +
          "🎨 HT1 kırmızı • HT4 turkuaz • LT4 mavi • LT5 gri\n" +
          "Ana kit rolleri mor renktedir."
        );
      }
    }

    // ----------------------------------------------
    // KUYRUK FORMU GÖNDERİMİ
    // ----------------------------------------------

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "sveydy_queue_username_modal"
    ) {
      const queue = getQueue(interaction.guildId);

      if (!queue.open || queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
        saveQueues();

        await updateQueuePanel(interaction.guild, queue);

        return interaction.reply({
          content: "🔴 Sıra kapanmış veya dolmuş. Şu anda katılamazsın.",
          ephemeral: true
        });
      }

      if (
        queue.entries.some(
          entry => entry.userId === interaction.user.id
        )
      ) {
        return interaction.reply({
          content: "⚠️ Zaten sıradasın.",
          ephemeral: true
        });
      }

      const minecraftUsername = interaction.fields
        .getTextInputValue("minecraft_username")
        .trim();

      // Minecraft Java kullanıcı adı biçimi.
      if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftUsername)) {
        return interaction.reply({
          content:
            "❌ Geçersiz Minecraft kullanıcı adı. 3-16 karakter; yalnızca harf, rakam ve _ kullan.",
          ephemeral: true
        });
      }

      const duplicateMinecraftName = queue.entries.some(
        entry =>
          entry.minecraftUsername.toLowerCase() ===
          minecraftUsername.toLowerCase()
      );

      if (duplicateMinecraftName) {
        return interaction.reply({
          content:
            "⚠️ Bu Minecraft kullanıcı adı zaten sırada kayıtlı.",
          ephemeral: true
        });
      }

      // Aynı kullanıcı adına sahip ikinci bir kayıt oluşturulmaz.
      queue.entries.push({
        userId: interaction.user.id,
        minecraftUsername,
        joinedAt: new Date().toISOString()
      });

      // 20 oyuncuya ulaştığında sıra otomatik kapanır.
      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
      }

      saveQueues();

      await interaction.reply({
        content:
          `✅ Sıraya katıldın!\n` +
          `🎮 Minecraft: **${minecraftUsername}**\n` +
          `📍 Sıra numaran: **${queue.entries.length}/${MAX_QUEUE_SIZE}**`,
        ephemeral: true
      });

      await updateQueuePanel(interaction.guild, queue);

      return;
    }

    // ----------------------------------------------
    // KIT SEÇİM MENÜSÜ
    // ----------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "sveydy_kit_panel"
    ) {
      await interaction.deferReply({
        ephemeral: true
      });

      const member = await interaction.guild.members.fetch(
        interaction.user.id
      );

      const added = [];
      const missing = [];

      for (const kit of interaction.values) {
        const roleId = config.kitRoles[kit];

        const role = roleId
          ? await interaction.guild.roles
              .fetch(roleId)
              .catch(() => null)
          : null;

        if (!role) {
          missing.push(kit);
          continue;
        }

        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(
            role,
            "SVEYDY kit seçim paneli"
          );
        }

        added.push(kit);
      }

      let reply = added.length
        ? `✅ Kit rollerin: **${added.join(", ")}**`
        : "❌ Roller bulunamadı. Önce yetkili /ayar komutunu çalıştırmalı.";

      if (missing.length) {
        reply += `\n⚠️ Bulunamayan roller: **${missing.join(", ")}**`;
      }

      return interaction.editReply(reply);
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = interaction.commandName;
    const gd = guildData(interaction.guildId);

    // ----------------------------------------------
    // /AYAR
    // ----------------------------------------------

    if (command === "ayar") {
      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
          name: "SVEYDY COMPETITIVE • SYSTEM"
        })
        .setTitle("⚙️  OTOMATİK ROL KURULUMU")
        .setDescription(
          "Kit ve tier rollerini tek işlemle oluştur.\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          `🎮 **KITLER:** ${KITS.length}\n` +
          `🏆 **TIER SİSTEMİ:** ${TIERS.length} seviye\n` +
          `📋 **TOPLAM TIER ROLÜ:** ${KITS.length * TIERS.length}\n` +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
          "🔴 HT1 — Kırmızı\n" +
          "🟠 HT2 — Turuncu\n" +
          "🟢 HT3 — Yeşil\n" +
          "🩵 HT4 — Turkuaz\n" +
          "🔵 LT4 — Mavi\n" +
          "⚪ LT5 — Gri\n\n" +
          "Ana kit rolleri mor renkte oluşturulur.\n" +
          "Var olan rollerin renkleri de güncellenir."
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • ROLE MANAGER"
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sveydy_create_roles")
          .setLabel("Rolleri Oluştur")
          .setEmoji("⚙️")
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // /PANELKUR | COMPETITIVE KIT PANELİ
    // ----------------------------------------------

    if (command === "panelkur") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("sveydy_kit_panel")
        .setPlaceholder("🎮  Oynadığın kitleri seç...")
        .setMinValues(1)
        .setMaxValues(KITS.length)
        .addOptions(
          KITS.map(kit => ({
            label: kit,
            value: kit,
            description: `${kit} kit rolünü al`,
            emoji: "⚔️"
          }))
        );

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
          name: "SVEYDY • COMPETITIVE DIVISION"
        })
        .setTitle("⚔️  KIT SELECTION")
        .setDescription(
          "```ansi\n" +
          "   S V E Y D Y   /   C O M P E T I T I V E\n" +
          "```" +
          "\n" +
          "PvP kimliğini seç. Oynadığın kitleri aşağıdaki menüden işaretle ve sana ait rolleri al.\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "**🎯 AVAILABLE GAME MODES**\n\n" +
          "⚔️ `SWORD`  •  `AXE`\n" +
          "🔨 `MACE`   •  `CRYSTAL`\n" +
          "🛡️ `UHC`    •  `POT`\n" +
          "🌐 `SMP`    •  `NETPOT`  •  `DIAPOT`\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
          "📌 **NASIL ÇALIŞIR?**\n" +
          "1. Aşağıdaki menüyü aç.\n" +
          "2. Oynadığın bir veya daha fazla kiti seç.\n" +
          "3. Seçimini onayla; kit rollerin otomatik verilsin.\n\n" +
          "💜 İstediğin birden fazla kiti seçebilirsin."
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • DEFINE YOUR PLAYSTYLE"
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    // ----------------------------------------------
    // /SIRAKUR | KALICI KUYRUK PANELİ
    // ----------------------------------------------

    if (command === "sirakur") {
      const queue = getQueue(interaction.guildId);

      // Komutun kullanıldığı kanala yeni panel kur.
      queue.channelId = interaction.channelId;
      queue.messageId = null;
      queue.open = queue.entries.length < MAX_QUEUE_SIZE;

      const embed = queueEmbed(queue);
      const components = queueComponents(queue);

      await interaction.reply({
        embeds: [embed],
        components
      });

      const panelMessage = await interaction.fetchReply();

      queue.messageId = panelMessage.id;
      saveQueues();

      return;
    }

    // ----------------------------------------------
    // /TIERVER
    // ----------------------------------------------

    if (command === "tierver") {
      const user = interaction.options.getUser("oyuncu");
      const kit = interaction.options.getString("kit");
      const tier = interaction.options.getString("tier");

      await interaction.deferReply({
        ephemeral: true
      });

      const member = await interaction.guild.members.fetch(user.id);
      const newRole = await getTierRole(
        interaction.guild,
        kit,
        tier
      );

      const oldRoles = [];

      for (const oldTier of TIERS) {
        const roleId = config.tierRoles[`${kit}:${oldTier}`];

        const role = roleId
          ? await interaction.guild.roles
              .fetch(roleId)
              .catch(() => null)
          : null;

        if (role && member.roles.cache.has(role.id)) {
          oldRoles.push(role);
        }
      }

      if (oldRoles.length) {
        await member.roles.remove(
          oldRoles,
          `${kit} tier sonucu güncellendi`
        );
      }

      await member.roles.add(
        newRole,
        `${kit} tier sonucu: ${tier}`
      );

      gd[playerKey(user.id, kit)] = {
        userId: user.id,
        kit,
        tier,
        testerId: interaction.user.id,
        timestamp: new Date().toISOString()
      };

      saveData();

      const resultEmbed = new EmbedBuilder()
        .setColor(TIER_COLORS[tier])
        .setAuthor({
          name: "SVEYDY COMPETITIVE • OFFICIAL RESULT"
        })
        .setTitle("🏆  TIER TEST SONUCU")
        .setThumbnail(user.displayAvatarURL())
        .setDescription(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          `👤 **OYUNCU:** ${user}\n` +
          `🎮 **KIT:** ${kit}\n` +
          `🏅 **TIER:** ${tier}\n` +
          `🎖️ **ROL:** \`${tier} ${kit}\`\n` +
          `🛡️ **TESTER:** ${interaction.user}\n` +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━"
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • OFFICIAL RANKING"
        })
        .setTimestamp();

      if (TIER_RESULT_CHANNEL_ID) {
        const channel = await interaction.guild.channels
          .fetch(TIER_RESULT_CHANNEL_ID)
          .catch(() => null);

        if (channel && channel.isTextBased()) {
          await channel.send({
            embeds: [resultEmbed]
          });
        }
      }

      return interaction.editReply(
        `✅ ${user} oyuncusuna **${tier} ${kit}** rolü verildi.`
      );
    }

    // ----------------------------------------------
    // /TIERLIST
    // ----------------------------------------------

    if (command === "tierlist") {
      const kit = interaction.options.getString("kit");

      const players = Object.values(gd)
        .filter(player => player.kit === kit)
        .sort(
          (a, b) =>
            TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)
        );

      const description = players.length
        ? players.map((player, index) =>
            `**${String(index + 1).padStart(2, "0")}.** ` +
            `<@${player.userId}> — **${player.tier}**`
          ).join("\n")
        : "_Bu kitte henüz test sonucu bulunmuyor._";

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
          name: "SVEYDY COMPETITIVE • RANKINGS"
        })
        .setTitle(`🏆  ${kit} TIER LIST`)
        .setDescription(
          "```ansi\n   OFFICIAL PLAYER RANKING\n```\n" +
          description.slice(0, 3800)
        )
        .setFooter({
          text: `SVEYDY TRIERLIST • Kayıtlı oyuncu: ${players.length}`
        });

      return interaction.reply({
        embeds: [embed]
      });
    }

    // ----------------------------------------------
    // /TIERIM
    // ----------------------------------------------

    if (command === "tierim") {
      const players = Object.values(gd)
        .filter(player => player.userId === interaction.user.id)
        .sort(
          (a, b) =>
            KITS.indexOf(a.kit) - KITS.indexOf(b.kit)
        );

      const description = players.length
        ? players.map(player =>
            `🎮 **${player.kit}**  ─  **${player.tier}**`
          ).join("\n")
        : "_Henüz bir kitte test sonucunuz yok._";

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
          name: "SVEYDY COMPETITIVE • PLAYER PROFILE"
        })
        .setTitle("👤  TIER PROFİLİN")
        .setThumbnail(interaction.user.displayAvatarURL())
        .setDescription(
          `**Oyuncu:** ${interaction.user}\n\n` +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          description +
          "\n━━━━━━━━━━━━━━━━━━━━━━━━━━"
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • YOUR RANKS"
        });

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Etkileşim hatası:", error);

    const errorMessage =
      "❌ İşlem başarısız oldu. Render loglarını, bot izinlerini ve rol sıralamasını kontrol et.";

    if (interaction.deferred) {
      await interaction.editReply({
        content: errorMessage
      }).catch(() => {});
    } else if (interaction.replied) {
      await interaction.followUp({
        content: errorMessage,
        ephemeral: true
      }).catch(() => {});
    } else if (interaction.isRepliable()) {
      await interaction.reply({
        content: errorMessage,
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ==================================================
// BAŞLAT
// ==================================================

(async () => {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})().catch(error => {
  console.error("Bot başlatılamadı:", error);
  process.exit(1);
});
