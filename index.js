
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  KIT_ROLE_IDS,
  TIER_RESULT_CHANNEL_ID
} = process.env;

const KITS = [
  "Sword", "Axe", "Mace", "Crystal", "UHC",
  "Pot", "SMP", "NethOP", "DiaPot"
];

const TIERS = [
  "HT1", "LT1", "HT2", "LT2", "HT3",
  "LT3", "HT4", "LT4", "HT5", "LT5"
];

let roleIds;

try {
  roleIds = JSON.parse(KIT_ROLE_IDS || "{}");
} catch {
  roleIds = {};
}

const DATA_FILE = path.join(__dirname, "tiers.json");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

let data = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function guildData(guildId) {
  if (!data[guildId]) data[guildId] = {};
  return data[guildId];
}

function playerKey(userId, kit) {
  return `${userId}:${kit}`;
}

function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName("panelkur")
      .setDescription("Kit seçme panelini oluşturur.")
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

  const rest = new REST({ version: "10" })
    .setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: getCommands() }
  );

  console.log("Slash komutları sunucuya kaydedildi.");
}

client.once("ready", () => {
  console.log(`${client.user.tag} aktif!`);
});

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.inGuild()) return;

    // KIT PANELİ
    if (interaction.isStringSelectMenu() &&
        interaction.customId === "sveydy_kit_panel") {

      await interaction.deferReply({ ephemeral: true });

      const member = await interaction.guild.members.fetch(
        interaction.user.id
      );

      const added = [];
      const missing = [];

      for (const kit of interaction.values) {
        const roleId = roleIds[kit];

        if (!roleId) {
          missing.push(kit);
          continue;
        }

        const role = interaction.guild.roles.cache.get(roleId);

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
        reply += `\n⚠️ Rol ayarı eksik olan kitler: ${missing.join(", ")}`;
      }

      return interaction.editReply(reply);
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const gd = guildData(interaction.guildId);

    // PANEL KUR
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

    // TIER VER + SONUÇ KANALI
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

      if (TIER_RESULT_CHANNEL_ID) {
        const channel = await interaction.guild.channels
          .fetch(TIER_RESULT_CHANNEL_ID)
          .catch(() => null);

        if (channel && channel.isTextBased()) {
          await channel.send({ embeds: [resultEmbed] });
        } else {
          await interaction.reply({
            content: "Tier kaydedildi fakat sonuç kanalı bulunamadı. Kanal ID'sini kontrol et.",
            ephemeral: true
          });
          return;
        }
      } else {
        await interaction.reply({
          content: "Tier kaydedildi fakat TIER_RESULT_CHANNEL_ID ayarlanmamış.",
          ephemeral: true
        });
        return;
      }

      return interaction.reply({
        content: `✅ ${user} oyuncusunun ${kit} sonucu **${tier}** olarak kaydedildi ve sonuç kanalına gönderildi.`,
        ephemeral: true
      });
    }

    // KIT SIRALAMASI
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

    // KENDİ TIERLERİN
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
    console.error(error);

    const message = {
      content: "Bir hata oluştu. Render loglarını ve bot izinlerini kontrol et.",
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
