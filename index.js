
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

const KIT_CATEGORIES = {
  sword: {
    label: "Sword PvP",
    description: "Sword ve Axe kitleri",
    emoji: "⚔️",
    kits: ["SWORD", "AXE"]
  },
  mace: {
    label: "Mace PvP",
    description: "Mace kitini seç",
    emoji: "🔨",
    kits: ["MACE"]
  },
  crystal: {
    label: "Crystal PvP",
    description: "Crystal kitini seç",
    emoji: "💎",
    kits: ["CRYSTAL"]
  },
  potion: {
    label: "Potion PvP",
    description: "Pot, NetPot ve DiaPot",
    emoji: "🧪",
    kits: ["POT", "NETPOT", "DIAPOT"]
  },
  other: {
    label: "Diğer Modlar",
    description: "UHC ve SMP",
    emoji: "🛡️",
    kits: ["UHC", "SMP"]
  }
};

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

// Seçilen kitleri kullanıcı onaylayana kadar bellekte tutar.
const pendingKitSelections = new Map();

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
      open: false,
      entries: [],
      channelId: null,
      messageId: null
    };

    saveQueues();
  }

  const queue = queues[guildId];

  if (typeof queue.open !== "boolean") {
    queue.open = false;
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
          `<@${player.userId}> · \`${player.minecraftUsername}\``
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
    .setTitle("⚔️ TIER TEST SIRASI")
    .setDescription(
      "```ansi\n" +
      "   S V E Y D Y   /   T R I E R L I S T\n" +
      "```\n" +
      "Minecraft PvP tier testine katılmak için aşağıdaki butonu kullan.\n\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      `${statusText}\n` +
      `👥 **Kapasite:** ${queue.entries.length}/${MAX_QUEUE_SIZE}\n` +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
      "**📋 GÜNCEL SIRA**\n" +
      playerList +
      "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
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
          .setLabel("Sırayı Kapat / Temizle")
          .setEmoji("🔴")
          .setStyle(ButtonStyle.Danger)
      )
    ];
  }

  // Sıra kapalıyken de temizleme butonu kalır.
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sveydy_queue_open")
        .setLabel("Sırayı Aç")
        .setEmoji("🟢")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("sveydy_queue_close")
        .setLabel("Sırayı Temizle")
        .setEmoji("🧹")
        .setStyle(ButtonStyle.Danger)
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

  if (interaction.user.id === interaction.guild.ownerId) {
    return true;
  }

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
    .setTitle("Tier Test Sırası");

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
// PANELKUR | KATEGORİ VE KİT SEÇİMİ
// ==================================================

function createCategoryMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId("sveydy_category_panel")
    .setPlaceholder("📂 Önce PvP kategorisini seç...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      Object.entries(KIT_CATEGORIES).map(([key, category]) => ({
        label: category.label,
        value: key,
        description: category.description,
        emoji: category.emoji
      }))
    );
}

function createKitMenu(categoryKey, selectedKits = []) {
  const category = KIT_CATEGORIES[categoryKey];

  return new StringSelectMenuBuilder()
    .setCustomId(`sveydy_kit_select_${categoryKey}`)
    .setPlaceholder("🎮 Bu kategoriden kitlerini seç...")
    .setMinValues(1)
    .setMaxValues(category.kits.length)
    .addOptions(
      category.kits.map(kit => ({
        label: kit,
        value: kit,
        description: `${kit} rolünü al`,
        emoji: "⚔️",
        default: selectedKits.includes(kit)
      }))
    );
}

function kitSelectionKey(guildId, userId, categoryKey) {
  return `${guildId}:${userId}:${categoryKey}`;
}

// ==================================================
// SLASH KOMUTLARI
// ==================================================

function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName("ayar")
      .setDescription("Kit ve tier rollerini otomatik oluştur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName("panelkur")
      .setDescription("Kategorili competitive kit seçim panelini oluştur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("sirakur")
      .setDescription("Tier test sırası panelini oluştur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

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
          .addChoices(...KITS.map(kit => ({
            name: kit,
            value: kit
          })))
      )
      .addStringOption(option =>
        option
          .setName("tier")
          .setDescription("Yeni test sonucu")
          .setRequired(true)
          .addChoices(...TIERS.map(tier => ({
            name: tier,
            value: tier
          })))
      )
      .addStringOption(option =>
        option
          .setName("minecraft")
          .setDescription("Oyuncunun Minecraft kullanıcı adı (isteğe bağlı)")
          .setRequired(false)
          .setMinLength(3)
          .setMaxLength(16)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Seçilen kitin tier sıralamasını göster.")
      .addStringOption(option =>
        option
          .setName("kit")
          .setDescription("Kit seç")
          .setRequired(true)
          .addChoices(...KITS.map(kit => ({
            name: kit,
            value: kit
          })))
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

  // Bot yeniden başlarsa sıra güvenli biçimde kapalı başlar.
  for (const [guildId, queue] of Object.entries(queues)) {
    queue.open = false;

    if (!Array.isArray(queue.entries)) {
      queue.entries = [];
    }

    try {
      const guild = await client.guilds.fetch(guildId);

      if (queue.channelId && queue.messageId) {
        await updateQueuePanel(guild, queue);
      }
    } catch (error) {
      console.error(
        `Kuyruk paneli yenilenemedi (${guildId}):`,
        error.message
      );
    }
  }

  saveQueues();
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
    // BUTONLAR
    // ----------------------------------------------

    if (interaction.isButton()) {
      const buttonId = interaction.customId;

      // SIRA KATILIMI / KAPATMA / AÇMA
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
            const position = queue.entries.findIndex(
              entry => entry.userId === interaction.user.id
            ) + 1;

            return interaction.reply({
              content: `⚠️ Zaten sıradasın! Sıra numaran: **${position}**`,
              ephemeral: true
            });
          }

          return interaction.showModal(createQueueModal());
        }

        const allowed = await canManageQueue(interaction);

        if (!allowed) {
          return interaction.reply({
            content:
              "⛔ Bu işlem için tester rolü, Sunucuyu Yönet veya Yönetici izni gerekiyor.",
            ephemeral: true
          });
        }

        // Kapatmak veya temizlemek her zaman sırayı boşaltır.
        if (buttonId === "sveydy_queue_close") {
          queue.open = false;
          queue.entries = [];

          saveQueues();
          await updateQueuePanel(interaction.guild, queue);

          return interaction.reply({
            content:
              "🔴 Sıra kapatıldı. Bütün kayıtlar silindi; tekrar açıldığında boş başlayacak.",
            ephemeral: true
          });
        }

        if (buttonId === "sveydy_queue_open") {
          if (queue.entries.length >= MAX_QUEUE_SIZE) {
            return interaction.reply({
              content:
                "⚠️ Sıra dolu. Önce sırayı temizlemen gerekiyor.",
              ephemeral: true
            });
          }

          queue.open = true;
          saveQueues();

          await updateQueuePanel(interaction.guild, queue);

          return interaction.reply({
            content: "🟢 Tier test sırası açıldı. Oyuncular artık katılabilir.",
            ephemeral: true
          });
        }
      }

      // ROL OLUŞTURMA BUTONU
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

      // KİT SEÇİMİNİ ONAYLA
      if (buttonId.startsWith("sveydy_kit_confirm_")) {
        const categoryKey = buttonId.replace(
          "sveydy_kit_confirm_",
          ""
        );

        const category = KIT_CATEGORIES[categoryKey];

        if (!category) {
          return interaction.reply({
            content: "❌ Kategori bulunamadı. Paneli yeniden aç.",
            ephemeral: true
          });
        }

        const selectionKey = kitSelectionKey(
          interaction.guildId,
          interaction.user.id,
          categoryKey
        );

        const selectedKits = pendingKitSelections.get(selectionKey);

        if (!selectedKits || selectedKits.length === 0) {
          return interaction.reply({
            content: "⚠️ Önce en az bir kit seçmelisin.",
            ephemeral: true
          });
        }

        await interaction.deferUpdate();

        const member = await interaction.guild.members.fetch(
          interaction.user.id
        );

        const added = [];
        const missing = [];

        for (const kit of selectedKits) {
          const roleId = config.kitRoles[kit];

          const role = roleId
            ? await interaction.guild.roles.fetch(roleId).catch(() => null)
            : null;

          if (!role) {
            missing.push(kit);
            continue;
          }

          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role, "SVEYDY kategorili kit paneli");
          }

          added.push(kit);
        }

        pendingKitSelections.delete(selectionKey);

        let resultText = added.length
          ? `✅ **${added.join(", ")}** kit rollerin verildi.`
          : "❌ Kit rolleri bulunamadı. Yetkili önce **/ayar** komutunu çalıştırmalı.";

        if (missing.length) {
          resultText += `\n⚠️ Bulunamayan roller: **${missing.join(", ")}**`;
        }

        return interaction.editReply({
          content: resultText,
          embeds: [],
          components: []
        });
      }
    }

    // ----------------------------------------------
    // SIRA FORMU
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
        queue.entries.some(entry => entry.userId === interaction.user.id)
      ) {
        return interaction.reply({
          content: "⚠️ Zaten sıradasın.",
          ephemeral: true
        });
      }

      const minecraftUsername = interaction.fields
        .getTextInputValue("minecraft_username")
        .trim();

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
          content: "⚠️ Bu Minecraft kullanıcı adı zaten sırada kayıtlı.",
          ephemeral: true
        });
      }

      queue.entries.push({
        userId: interaction.user.id,
        minecraftUsername,
        joinedAt: new Date().toISOString()
      });

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
    // PANELKUR: KATEGORİ SEÇİMİ
    // ----------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "sveydy_category_panel"
    ) {
      const categoryKey = interaction.values[0];
      const category = KIT_CATEGORIES[categoryKey];

      if (!category) {
        return interaction.reply({
          content: "❌ Kategori bulunamadı. Paneli yeniden oluştur.",
          ephemeral: true
        });
      }

      const kitMenu = createKitMenu(categoryKey);

      const confirmButton = new ButtonBuilder()
        .setCustomId(`sveydy_kit_confirm_${categoryKey}`)
        .setLabel("Seçimi Onayla")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success);

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`${category.emoji} ${category.label}`)
        .setDescription(
          `${category.description}.\n\n` +
          "1. Aşağıdan istediğin kitleri seç.\n" +
          "2. Seçimlerin hazır olduğunda **Seçimi Onayla** butonuna bas.\n\n" +
          "💜 Bu seçim ekranını yalnızca sen görebilirsin."
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • KIT SELECTION"
        });

      return interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(kitMenu),
          new ActionRowBuilder().addComponents(confirmButton)
        ],
        ephemeral: true
      });
    }

    // ----------------------------------------------
    // PANELKUR: KİT SEÇİMİ
    // ----------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("sveydy_kit_select_")
    ) {
      const categoryKey = interaction.customId.replace(
        "sveydy_kit_select_",
        ""
      );

      const category = KIT_CATEGORIES[categoryKey];

      if (!category) {
        return interaction.reply({
          content: "❌ Kategori bulunamadı. Paneli yeniden aç.",
          ephemeral: true
        });
      }

      const selectedKits = interaction.values.filter(
        kit => category.kits.includes(kit)
      );

      const selectionKey = kitSelectionKey(
        interaction.guildId,
        interaction.user.id,
        categoryKey
      );

      pendingKitSelections.set(selectionKey, selectedKits);

      const kitMenu = createKitMenu(categoryKey, selectedKits);

      const confirmButton = new ButtonBuilder()
        .setCustomId(`sveydy_kit_confirm_${categoryKey}`)
        .setLabel("Seçimi Onayla")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success);

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`${category.emoji} ${category.label}`)
        .setDescription(
          "**Seçtiğin kitler:**\n" +
          selectedKits.map(kit => `• \`${kit}\``).join("\n") +
          "\n\nBaşka kit eklemek veya seçimini değiştirmek için menüyü kullan. Hazır olunca **Seçimi Onayla** butonuna bas."
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • KIT SELECTION"
        });

      return interaction.update({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(kitMenu),
          new ActionRowBuilder().addComponents(confirmButton)
        ]
      });
    }

    // ----------------------------------------------
    // ESKİ KİT PANELİ MESAJLARIYLA GERİYE DÖNÜK UYUMLULUK
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
          ? await interaction.guild.roles.fetch(roleId).catch(() => null)
          : null;

        if (!role) {
          missing.push(kit);
          continue;
        }

        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, "SVEYDY kit seçim paneli");
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
        .setTitle("⚙️ OTOMATİK ROL KURULUMU")
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
    // /PANELKUR
    // ----------------------------------------------

    if (command === "panelkur") {
      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
          name: "SVEYDY • COMPETITIVE DIVISION"
        })
        .setTitle("⚔️ KIT SELECTION")
        .setDescription(
          "```ansi\n" +
          "   S V E Y D Y   /   C O M P E T I T I V E\n" +
          "```\n" +
          "Oynadığın PvP kategorisini seçerek kit rollerini al.\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "⚔️ **Sword PvP** — SWORD, AXE\n" +
          "🔨 **Mace PvP** — MACE\n" +
          "💎 **Crystal PvP** — CRYSTAL\n" +
          "🧪 **Potion PvP** — POT, NETPOT, DIAPOT\n" +
          "🛡️ **Diğer Modlar** — UHC, SMP\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
          "**NASIL KULLANILIR?**\n" +
          "1. Kategorini seç.\n" +
          "2. İstediğin kitleri işaretle.\n" +
          "3. **Seçimi Onayla** butonuna bas.\n\n" +
          "💜 Kit rolleri seçimin onaylandığında verilir."
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • DEFINE YOUR PLAYSTYLE"
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(createCategoryMenu())
        ]
      });
    }

    // ----------------------------------------------
    // /SIRAKUR
    // ----------------------------------------------

    if (command === "sirakur") {
      const queue = getQueue(interaction.guildId);

      queue.channelId = interaction.channelId;
      queue.messageId = null;
      queue.open = false;

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
      const suppliedMinecraftName = interaction.options
        .getString("minecraft")
        ?.trim();

      if (
        suppliedMinecraftName &&
        !/^[A-Za-z0-9_]{3,16}$/.test(suppliedMinecraftName)
      ) {
        return interaction.reply({
          content:
            "❌ Geçersiz Minecraft adı. 3-16 karakter; yalnızca harf, rakam ve _ kullan.",
          ephemeral: true
        });
      }

      await interaction.deferReply({
        ephemeral: true
      });

      const member = await interaction.guild.members.fetch(user.id);
      const savedRecord = gd[playerKey(user.id, kit)];

      // Önce kayıtlı eski tier'ı bul.
      let oldTier = savedRecord?.tier || null;

      // Kayıt yoksa oyuncunun mevcut tier rollerine bak.
      if (!oldTier) {
        for (const possibleTier of TIERS) {
          const roleId = config.tierRoles[`${kit}:${possibleTier}`];

          const role = roleId
            ? await interaction.guild.roles.fetch(roleId).catch(() => null)
            : null;

          if (role && member.roles.cache.has(role.id)) {
            oldTier = possibleTier;
            break;
          }
        }
      }

      // Minecraft adını komut girdisinden, kuyruktan veya eski kayıttan al.
      const queue = getQueue(interaction.guildId);
      const queueEntry = queue.entries.find(
        entry => entry.userId === user.id
      );

      const minecraftUsername =
        suppliedMinecraftName ||
        queueEntry?.minecraftUsername ||
        savedRecord?.minecraftUsername ||
        "Belirtilmedi";

      const newRole = await getTierRole(
        interaction.guild,
        kit,
        tier
      );

      const oldRoles = [];

      for (const oldTierName of TIERS) {
        const roleId = config.tierRoles[`${kit}:${oldTierName}`];

        const role = roleId
          ? await interaction.guild.roles.fetch(roleId).catch(() => null)
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

      // Yeni kayıt, eski kayıt okunup kullanıldıktan sonra yazılır.
      gd[playerKey(user.id, kit)] = {
        userId: user.id,
        kit,
        tier,
        oldTier,
        minecraftUsername,
        testerId: interaction.user.id,
        timestamp: new Date().toISOString()
      };

      saveData();

      const oldTierText = oldTier || "İlk test";
      const avatarURL = user.displayAvatarURL({
        extension: "png",
        size: 256
      });

      const resultEmbed = new EmbedBuilder()
        .setColor(TIER_COLORS[tier])
        .setAuthor({
          name: "SVEYDY COMPETITIVE • OFFICIAL RESULT"
        })
        .setTitle("🏆 TIER TEST SONUCU")
        .setThumbnail(avatarURL)
        .setDescription(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          `👤 **OYUNCU:** ${user}\n` +
          `🎮 **MINECRAFT:** \`${minecraftUsername}\`\n` +
          `⚔️ **KIT:** ${kit}\n\n` +
          `📉 **ÖNCEKİ TIER:** ${oldTierText}\n` +
          `📈 **YENİ TIER:** ${tier}\n` +
          `🎖️ **VERİLEN ROL:** \`${tier} ${kit}\`\n\n` +
          `🛡️ **TESTER:** ${interaction.user}\n` +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━"
        )
        .setFooter({
          text: "SVEYDY TRIERLIST • OFFICIAL RANKING"
        })
        .setTimestamp();

      let resultPosted = false;

      if (TIER_RESULT_CHANNEL_ID) {
        const channel = await interaction.guild.channels
          .fetch(TIER_RESULT_CHANNEL_ID)
          .catch(() => null);

        if (channel && channel.isTextBased()) {
          await channel.send({
            embeds: [resultEmbed]
          });

          resultPosted = true;
        }
      }

      const channelStatus = resultPosted
        ? "\n📢 Tier sonucu sonuç kanalına gönderildi."
        : "\n⚠️ Sonuç kanalı ayarlanmamış veya bulunamadı. Render'da TIER_RESULT_CHANNEL_ID değerini kontrol et.";

      return interaction.editReply(
        `✅ ${user} oyuncusuna **${tier} ${kit}** rolü verildi.\n` +
        `📊 Önceki tier: **${oldTierText}** → Yeni tier: **${tier}**` +
        channelStatus
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
        .setTitle(`🏆 ${kit} TIER LIST`)
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
            `🎮 **${player.kit}** ─ **${player.tier}**`
          ).join("\n")
        : "_Henüz bir kitte test sonucunuz yok._";

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
          name: "SVEYDY COMPETITIVE • PLAYER PROFILE"
        })
        .setTitle("👤 TIER PROFİLİN")
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

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: errorMessage,
        embeds: [],
        components: []
      }).catch(async () => {
        await interaction.followUp({
          content: errorMessage,
          ephemeral: true
        }).catch(() => {});
      });
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
