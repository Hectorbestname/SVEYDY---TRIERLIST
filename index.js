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
  PermissionFlagsBits
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  TIER_RESULT_CHANNEL_ID
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("DISCORD_TOKEN, CLIENT_ID ve GUILD_ID eksik!");
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

const KIT_COLOR = "#8B5CF6";

const DATA_FILE = path.join(__dirname, "tiers.json");
const CONFIG_FILE = path.join(__dirname, "botconfig.json");

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

let data = readJson(DATA_FILE);
let config = readJson(CONFIG_FILE);

config.kitRoles ??= {};
config.tierRoles ??= {};

function saveData() {
  writeJson(DATA_FILE, data);
}

function saveConfig() {
  writeJson(CONFIG_FILE, config);
}

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

async function createRoleIfMissing(guild, roleName, color) {
  await guild.roles.fetch();

  let role = guild.roles.cache.find(
    r => r.name.toUpperCase() === roleName.toUpperCase()
  );

  if (role) {
    if (role.hexColor.toUpperCase() !== color.toUpperCase()) {
      await role.setColor(color, "SVEYDY tier renk ayarı");
    }

    return { role, created: false };
  }

  role = await guild.roles.create({
    name: roleName,
    color,
    reason: "SVEYDY TRIERLIST otomatik rol sistemi"
  });

  console.log(`Rol oluşturuldu: ${role.name}`);

  return { role, created: true };
}

async function createAllRoles(guild) {
  let created = 0;
  let existing = 0;

  for (const kit of KITS) {
    const kitResult = await createRoleIfMissing(
      guild,
      kit,
      KIT_COLOR
    );

    config.kitRoles[kit] = kitResult.role.id;

    if (kitResult.created) created++;
    else existing++;

    for (const tier of TIERS) {
      const result = await createRoleIfMissing(
        guild,
        tierRoleName(tier, kit),
        TIER_COLORS[tier]
      );

      config.tierRoles[`${kit}:${tier}`] = result.role.id;

      if (result.created) created++;
      else existing++;
    }
  }

  saveConfig();
  return { created, existing };
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

function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName("ayar")
      .setDescription("Kit ve tier rollerini otomatik oluşturur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName("panelkur")
      .setDescription("Kit seçim panelini oluşturur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("tierver")
      .setDescription("Oyuncuya tier sonucu verir.")
      .addUserOption(o =>
        o.setName("oyuncu")
          .setDescription("Test edilen oyuncu")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("kit")
          .setDescription("Test edilen kit")
          .setRequired(true)
          .addChoices(...KITS.map(k => ({ name: k, value: k })))
      )
      .addStringOption(o =>
        o.setName("tier")
          .setDescription("Test sonucu")
          .setRequired(true)
          .addChoices(...TIERS.map(t => ({ name: t, value: t })))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Bir kitin tier sıralamasını gösterir.")
      .addStringOption(o =>
        o.setName("kit")
          .setDescription("Kit seç")
          .setRequired(true)
          .addChoices(...KITS.map(k => ({ name: k, value: k })))
      ),

    new SlashCommandBuilder()
      .setName("tierim")
      .setDescription("Kendi tierlerini gösterir.")
  ].map(c => c.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: getCommands() }
  );

  console.log("Slash komutları kaydedildi.");
}

client.once("ready", () => {
  console.log(`${client.user.tag} aktif!`);
});

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.inGuild()) return;

    if (
      interaction.isButton() &&
      interaction.customId === "sveydy_create_roles"
    ) {
      if (
        !interaction.memberPermissions.has(
          PermissionFlagsBits.ManageRoles
        )
      ) {
        return interaction.reply({
          content: "Bu işlem için Rolleri Yönet iznin olmalı.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await createAllRoles(interaction.guild);

      return interaction.editReply(
        `✅ **SVEYDY rol kurulumu tamamlandı!**\n\n` +
        `🆕 Yeni roller: **${result.created}**\n` +
        `♻️ Mevcut roller: **${result.existing}**\n` +
        `🎮 Kit sayısı: **${KITS.length}**\n` +
        `🏆 Kit başına tier: **${TIERS.length}**\n` +
        `📋 Tier rolü: **${KITS.length * TIERS.length}**\n\n` +
        `🎨 HT1 kırmızı • HT4 turkuaz • LT4 mavi • LT5 gri\n` +
        `Ana kit rolleri mor renktedir.`
      );
    }

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
        const roleId = config.kitRoles[kit];
        const role = roleId
          ? await interaction.guild.roles.fetch(roleId).catch(() => null)
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
        : "Rol verilemedi. Önce /ayar komutunu kullan.";

      if (missing.length) {
        reply += `\n⚠️ Bulunamayan roller: ${missing.join(", ")}`;
      }

      return interaction.editReply(reply);
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const gd = guildData(interaction.guildId);

    if (command === "ayar") {
      const embed = new EmbedBuilder()
        .setColor(KIT_COLOR)
        .setTitle("⚙️ SVEYDY | OTOMATİK ROL SİSTEMİ")
        .setDescription(
          "Butona basarak kit ve tier rollerini otomatik oluştur.\n\n" +
          `🎮 Kit sayısı: **${KITS.length}**\n` +
          `🏆 Tier sayısı: **${TIERS.length}**\n` +
          `📋 Tier rolü: **${KITS.length * TIERS.length}**\n\n` +
          "🔴 `HT1 CRYSTAL`\n" +
          "🔵 `LT4 CRYSTAL`\n" +
          "⚪ `LT5 NETPOT`\n\n" +
          "Mevcut rollerin renkleri de güncellenir."
        )
        .setFooter({ text: "SVEYDY TRIERLIST" });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sveydy_create_roles")
          .setLabel("Kit ve Tier Rollerini Oluştur")
          .setEmoji("⚙️")
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
    }

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
            description: `${kit} kit rolünü al`
          }))
        );

      const embed = new EmbedBuilder()
        .setColor(KIT_COLOR)
        .setTitle("⚔️ SVEYDY | KIT SEÇİMİ")
        .setDescription(
          "Oynadığın kitleri menüden seç.\n" +
          "Seçtiğin kitlerin rollerini otomatik alırsın."
        )
        .setFooter({ text: "SVEYDY TRIERLIST" });

      return interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }

    if (command === "tierver") {
      const user = interaction.options.getUser("oyuncu");
      const kit = interaction.options.getString("kit");
      const tier = interaction.options.getString("tier");

      await interaction.deferReply({ ephemeral: true });

      const member = await interaction.guild.members.fetch(user.id);
      const newRole = await getTierRole(interaction.guild, kit, tier);

      const oldRoles = [];

      for (const oldTier of TIERS) {
        const roleId = config.tierRoles[`${kit}:${oldTier}`];
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

      await member.roles.add(newRole, `${kit} tier sonucu: ${tier}`);

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
        .setTitle("🏆 SVEYDY | TIER TEST SONUCU")
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: "Oyuncu", value: `${user}`, inline: true },
          { name: "Kit", value: kit, inline: true },
          { name: "Sonuç", value: `**${tier}**`, inline: true },
          { name: "Rol", value: `\`${tier} ${kit}\`` },
          { name: "Test Yetkilisi", value: `${interaction.user}` }
        )
        .setTimestamp();

      if (TIER_RESULT_CHANNEL_ID) {
        const channel = await interaction.guild.channels
          .fetch(TIER_RESULT_CHANNEL_ID)
          .catch(() => null);

        if (channel && channel.isTextBased()) {
          await channel.send({ embeds: [resultEmbed] });
        }
      }

      return interaction.editReply(
        `✅ ${user} oyuncusuna **${tier} ${kit}** rolü verildi.`
      );
    }

    if (command === "tierlist") {
      const kit = interaction.options.getString("kit");

      const players = Object.values(gd)
        .filter(p => p.kit === kit)
        .sort(
          (a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)
        );

      const description = players.length
        ? players.map((p, i) =>
            `**${i + 1}.** <@${p.userId}> — **${p.tier}**`
          ).join("\n")
        : "Bu kitte henüz test sonucu bulunmuyor.";

      const embed = new EmbedBuilder()
        .setColor(KIT_COLOR)
        .setTitle(`🏆 SVEYDY | ${kit} TIER LIST`)
        .setDescription(description.slice(0, 4000))
        .setFooter({ text: `Kayıtlı oyuncu: ${players.length}` });

      return interaction.reply({ embeds: [embed] });
    }

    if (command === "tierim") {
      const players = Object.values(gd)
        .filter(p => p.userId === interaction.user.id);

      const description = players.length
        ? players.map(p => `**${p.kit}:** ${p.tier}`).join("\n")
        : "Henüz bir kitte test sonucunuz yok.";

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(KIT_COLOR)
            .setTitle("👤 TIER PROFİLİN")
            .setDescription(description)
        ],
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Etkileşim hatası:", error);

    const message = {
      content: "❌ Hata oluştu. Render loglarını ve bot izinlerini kontrol et.",
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else if (interaction.isRepliable()) {
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
