
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  KIT_ROLE_IDS,
  TIER_RESULT_CHANNEL_ID,
  TESTER_ROLE_ID
} = process.env;

const KITS = [
  "Sword", "Axe", "Mace", "Crystal", "UHC",
  "Pot", "SMP", "NethOP", "DiaPot"
];

const TIERS = [
  "HT1", "LT1", "HT2", "LT2", "HT3",
  "LT3", "HT4", "LT4", "HT5", "LT5"
];

const MAX_QUEUE = 20;

let roleIds = {};
try {
  roleIds = JSON.parse(KIT_ROLE_IDS || "{}");
} catch {
  console.error("KIT_ROLE_IDS geçerli JSON değil!");
}

const DATA_FILE = path.join(__dirname, "tiers.json");
const QUEUE_FILE = path.join(__dirname, "queue.json");

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

let data = readJSON(DATA_FILE);
let queues = readJSON(QUEUE_FILE);

function saveData() {
  writeJSON(DATA_FILE, data);
}

function saveQueues() {
  writeJSON(QUEUE_FILE, queues);
}

function guildData(guildId) {
  if (!data[guildId]) data[guildId] = {};
  return data[guildId];
}

function playerKey(userId, kit) {
  return `${userId}:${kit}`;
}

function getQueue(guildId) {
  if (!queues[guildId]) {
    queues[guildId] = {
      open: false,
      entries: [],
      channelId: null,
      messageId: null
    };
  }

  const q = queues[guildId];

  if (!Array.isArray(q.entries)) q.entries = [];
  if (typeof q.open !== "boolean") q.open = false;

  return q;
}

function queueEmbed(q) {
  return new EmbedBuilder()
    .setColor(q.open ? 0x2ECC71 : 0xE74C3C)
    .setTitle("🎮 SVEYDY | TEST SIRASI")
    .setDescription(
      q.open
        ? "🟢 **SIRA AÇIK**\nSıraya katılmak için aşağıdaki butona bas."
        : "🔴 **SIRA KAPALI**\nŞu anda yeni kayıt alınmıyor."
    )
    .addFields(
      {
        name: "👥 Kayıtlı Oyuncu",
        value: `**${q.entries.length}/${MAX_QUEUE}**`,
        inline: true
      },
      {
        name: "📌 Boş Yer",
        value: `**${Math.max(0, MAX_QUEUE - q.entries.length)}**`,
        inline: true
      }
    )
    .setFooter({ text: "SVEYDY TRIERLIST • Test Sistemi" })
    .setTimestamp();
}

function queueButtons(q) {
  if (q.open) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sveydy_queue_join")
          .setLabel("🎮 Sıraya Katıl")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("sveydy_queue_close")
          .setLabel("🔴 Sırayı Kapat")
          .setStyle(ButtonStyle.Danger)
      )
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sveydy_queue_open")
        .setLabel("🟢 Sırayı Aç")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

async function updateQueuePanel(guildId) {
  const q = getQueue(guildId);

  if (!q.channelId || !q.messageId) return;

  try {
    const channel = await client.channels.fetch(q.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(q.messageId);

    await message.edit({
      embeds: [queueEmbed(q)],
      components: queueButtons(q)
    });
  } catch (error) {
    console.error("Sıra paneli güncellenemedi:", error.message);
  }
}

async function isTester(interaction) {
  if (!TESTER_ROLE_ID || !interaction.guild) return false;

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  return Boolean(
    member && member.roles.cache.has(TESTER_ROLE_ID)
  );
}

function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName("panelkur")
      .setDescription("Kit rolü seçim panelini oluşturur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("sirapanelkur")
      .setDescription("Üç butonlu test sırası panelini oluşturur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("tierver")
      .setDescription("Oyuncunun tier test sonucunu kaydeder.")
      .addUserOption(o =>
        o.setName("oyuncu")
          .setDescription("Test edilen oyuncu")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("kit")
          .setDescription("Test edilen kit")
          .setRequired(true)
          .addChoices(...KITS.map(k => ({ name: k, value: k }))))
      .addStringOption(o =>
        o.setName("tier")
          .setDescription("Test sonucu")
          .setRequired(true)
          .addChoices(...TIERS.map(t => ({ name: t, value: t }))))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Bir kitin tier sıralamasını gösterir.")
      .addStringOption(o =>
        o.setName("kit")
          .setDescription("Sıralaması görüntülenecek kit")
          .setRequired(true)
          .addChoices(...KITS.map(k => ({ name: k, value: k })))),

    new SlashCommandBuilder()
      .setName("tierim")
      .setDescription("Kendi tierlerini gösterir.")
  ].map(c => c.toJSON());
}

async function registerCommands() {
  if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
    throw new Error(
      "DISCORD_TOKEN, CLIENT_ID ve GUILD_ID Render'a eklenmeli."
    );
  }

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: getCommands() }
  );

  console.log("Slash komutları kaydedildi.");
}

client.once("ready", async () => {
  console.log(`${client.user.tag} aktif!`);

  // Bot yeniden başladığında mevcut sıra panellerini güncelle.
  for (const guildId of Object.keys(queues)) {
    await updateQueuePanel(guildId);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.inGuild()) return;

    // ==========================================
    // KİT ROLÜ SEÇİM PANELİ
    // ==========================================
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "sveydy_kit_panel"
    ) {
      await interaction.deferReply({ ephemeral: true });

      const member = await interaction.guild.members.fetch(
        interaction.user.id
      );

      const added = [];
      const missing = [];

      for (const kit of interaction.values) {
        const roleId = roleIds[kit];
        const role = roleId
          ? interaction.guild.roles.cache.get(roleId)
          : null;

        if (!role) {
          missing.push(kit);
          continue;
        }

        await member.roles.add(role, "SVEYDY kit seçim paneli");
        added.push(kit);
      }

      let reply = added.length
        ? `✅ Aldığın kit rolleri: **${added.join(", ")}**`
        : "Hiçbir kit rolü verilemedi.";

      if (missing.length) {
        reply += `\n⚠️ Rol ayarı eksik: ${missing.join(", ")}`;
      }

      return interaction.editReply(reply);
    }

    // ==========================================
    // BUTONLAR
    // ==========================================
    if (interaction.isButton()) {
      const id = interaction.customId;
      const q = getQueue(interaction.guildId);

      // SIRAYA KATIL
      if (id === "sveydy_queue_join") {
        if (!q.open) {
          return interaction.reply({
            content: "🔴 Sıra şu anda kapalı.",
            ephemeral: true
          });
        }

        if (q.entries.length >= MAX_QUEUE) {
          q.open = false;
          saveQueues();
          await updateQueuePanel(interaction.guildId);

          return interaction.reply({
            content: "❌ Sıra dolu. Yeni kayıt alınmıyor.",
            ephemeral: true
          });
        }

        if (q.entries.some(e => e.userId === interaction.user.id)) {
          return interaction.reply({
            content: "⚠️ Zaten sıraya kayıtlısın.",
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId("sveydy_queue_modal")
          .setTitle("SVEYDY | Sıraya Katıl");

        const username = new TextInputBuilder()
          .setCustomId("minecraft_username")
          .setLabel("Minecraft kullanıcı adın")
          .setPlaceholder("Minecraft adını gir")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(16);

        modal.addComponents(
          new ActionRowBuilder().addComponents(username)
        );

        return interaction.showModal(modal);
      }

      // SIRAYI AÇ / KAPAT — SADECE TESTER ROLÜ
      if (id === "sveydy_queue_open" || id === "sveydy_queue_close") {
        if (!(await isTester(interaction))) {
          return interaction.reply({
            content: "❌ Bu butonu yalnızca tester rolü kullanabilir.",
            ephemeral: true
          });
        }

        if (id === "sveydy_queue_open") {
          // Önceki sıra 20 kişiyle dolduysa yeni sıra başlat.
          if (q.entries.length >= MAX_QUEUE) {
            q.entries = [];
          }

          q.open = true;
        } else {
          q.open = false;
        }

        saveQueues();
        await updateQueuePanel(interaction.guildId);

        return interaction.reply({
          content: q.open
            ? "🟢 Sıra açıldı! Oyuncular artık kayıt olabilir."
            : "🔴 Sıra kapatıldı! Yeni kayıt alınmayacak.",
          ephemeral: true
        });
      }
    }

    // ==========================================
    // SIRAYA KATILMA FORMU
    // ==========================================
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "sveydy_queue_modal"
    ) {
      const q = getQueue(interaction.guildId);

      if (!q.open) {
        return interaction.reply({
          content: "🔴 Sıra kapatılmış. Şu anda kayıt alınmıyor.",
          ephemeral: true
        });
      }

      if (q.entries.length >= MAX_QUEUE) {
        q.open = false;
        saveQueues();
        await updateQueuePanel(interaction.guildId);

        return interaction.reply({
          content: "❌ Sıra doldu. Yeni kayıt alınmıyor.",
          ephemeral: true
        });
      }

      if (q.entries.some(e => e.userId === interaction.user.id)) {
        return interaction.reply({
          content: "⚠️ Zaten sıraya kayıtlısın.",
          ephemeral: true
        });
      }

      const minecraftUsername = interaction.fields
        .getTextInputValue("minecraft_username")
        .trim();

      if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftUsername)) {
        return interaction.reply({
          content: "❌ Geçerli bir Minecraft kullanıcı adı gir.",
          ephemeral: true
        });
      }

      q.entries.push({
        userId: interaction.user.id,
        username: minecraftUsername,
        timestamp: new Date().toISOString()
      });

      // 20. kişi kayıt olduğunda otomatik kapat.
      if (q.entries.length >= MAX_QUEUE) {
        q.open = false;
      }

      saveQueues();
      await updateQueuePanel(interaction.guildId);

      return interaction.reply({
        content:
          `✅ Sıraya kaydoldun!\n` +
          `**Minecraft adı:** ${minecraftUsername}\n` +
          `**Sıradaki kayıt sayısı:** ${q.entries.length}/${MAX_QUEUE}` +
          (q.open
            ? ""
            : "\n🔴 Sıra 20 kişiye ulaştığı için otomatik kapatıldı."),
        ephemeral: true
      });
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const gd = guildData(interaction.guildId);

    // ==========================================
    // KİT ROL PANELİ OLUŞTUR
    // ==========================================
    if (command === "panelkur") {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("sveydy_kit_panel")
        .setPlaceholder("Oynadığın kitleri seç!")
        .setMinValues(1)
        .setMaxValues(KITS.length)
        .addOptions(
          KITS.map(kit => ({
            label: kit,
            value: kit,
            description: `${kit} kitinin rolünü al`
          }))
        );

      const embed = new EmbedBuilder()
        .setColor("#8B5CF6")
        .setTitle("⚔️ SVEYDY | KIT SEÇİMİ")
        .setDescription(
          "Oynadığın kitleri aşağıdaki menüden seç.\n\n" +
          "Seçtiğin kitlerin rollerini alırsın. " +
          "Bu roller ilgili kit kanallarını görmeni sağlar."
        )
        .setFooter({ text: "SVEYDY TRIERLIST" });

      return interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(menu)
        ]
      });
    }

    // ==========================================
    // ÜÇ BUTONLU SIRA PANELİ OLUŞTUR
    // ==========================================
    if (command === "sirapanelkur") {
      const q = getQueue(interaction.guildId);

      q.open = false;

      const message = await interaction.channel.send({
        embeds: [queueEmbed(q)],
        components: queueButtons(q)
      });

      q.channelId = message.channelId;
      q.messageId = message.id;

      saveQueues();

      return interaction.reply({
        content: "✅ Test sırası paneli oluşturuldu.",
        ephemeral: true
      });
    }

    // ==========================================
    // TIER VER + SONUÇ KANALI
    // ==========================================
    if (command === "tierver") {
      const user = interaction.options.getUser("oyuncu");
      const kit = interaction.options.getString("kit");
      const tier = interaction.options.getString("tier");

      gd[playerKey(user.id, kit)] = {
        userId: user.id,
        kit,
        tier,
        testerId: interaction.user.id,
        timestamp: new Date().toISOString()
      };

      saveData();

      const resultEmbed = new EmbedBuilder()
        .setColor("#8B5CF6")
        .setTitle("🏆 SVEYDY | TIER TEST SONUCU")
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: "Oyuncu", value: `${user}`, inline: true },
          { name: "Kit", value: kit, inline: true },
          { name: "Sonuç", value: `**${tier}**`, inline: true },
          { name: "Test Yetkilisi", value: `${interaction.user}` }
        )
        .setTimestamp();

      if (!TIER_RESULT_CHANNEL_ID) {
        return interaction.reply({
          content: "⚠️ TIER_RESULT_CHANNEL_ID Render'a eklenmemiş.",
          ephemeral: true
        });
      }

      const channel = await interaction.guild.channels
        .fetch(TIER_RESULT_CHANNEL_ID)
        .catch(() => null);

      if (!channel || !channel.isTextBased()) {
        return interaction.reply({
          content: "⚠️ Tier kaydedildi ama sonuç kanalı bulunamadı. Kanal ID'sini kontrol et.",
          ephemeral: true
        });
      }

      await channel.send({ embeds: [resultEmbed] });

      return interaction.reply({
        content: `✅ ${user} oyuncusunun ${kit} sonucu **${tier}** olarak kaydedildi.`,
        ephemeral: true
      });
    }

    // ==========================================
    // TIER LIST
    // ==========================================
    if (command === "tierlist") {
      const kit = interaction.options.getString("kit");

      const players = Object.values(gd)
        .filter(p => p.kit === kit)
        .sort((a, b) =>
          TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)
        );

      const description = players.length
        ? players.map((p, i) =>
            `**${i + 1}.** <@${p.userId}> — **${p.tier}**`
          ).join("\n")
        : "Bu kitte henüz test sonucu bulunmuyor.";

      const embed = new EmbedBuilder()
        .setColor("#8B5CF6")
        .setTitle(`🏆 SVEYDY | ${kit} TIER LIST`)
        .setDescription(description.slice(0, 4000))
        .setFooter({ text: `Kayıtlı oyuncu: ${players.length}` });

      return interaction.reply({ embeds: [embed] });
    }

    // ==========================================
    // KENDİ TIERLERİN
    // ==========================================
    if (command === "tierim") {
      const players = Object.values(gd)
        .filter(p => p.userId === interaction.user.id);

      const description = players.length
        ? players.map(p => `**${p.kit}:** ${p.tier}`).join("\n")
        : "Henüz bir kitte test sonucunuz yok.";

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#8B5CF6")
            .setTitle("👤 TIER PROFİLİN")
            .setDescription(description)
        ],
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Interaction hatası:", error);

    const message = {
      content: "❌ Bir hata oluştu. Render loglarını ve bot izinlerini kontrol et.",
      ephemeral: true
    };

    if (interaction.deferred) {
      await interaction.editReply(message).catch(() => {});
    } else if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply(message).catch(() => {});
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})().catch(error => {
  console.error("Başlatma hatası:", error);
  process.exit(1);
});
