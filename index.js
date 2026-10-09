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
  MessageFlags,
  Events,
  REST,
  Routes
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

// ───────────────────────── AYARLAR ─────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const RESULT_CHANNEL_ID = process.env.TIER_RESULT_CHANNEL_ID || "";
// Opsiyonel: Tester rolü. Bu role sahip olanlar /tierver, /tiersil, /siraac vb. kullanabilir.
const TESTER_ROLE_ID = process.env.TESTER_ROLE_ID || "";
// Render'de Persistent Disk bağlarsan (örn. /data) verilerin deploy'da silinmez.
const DATA_DIR = process.env.DATA_DIR || __dirname;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("DISCORD_TOKEN, CLIENT_ID ve GUILD_ID değişkenlerini ayarla.");
}

const KITS = ["SWORD", "AXE", "MACE", "CRYSTAL", "UHC", "POT", "SMP", "NETPOT", "DIAPOT"];
const TIERS = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"];

const MAX_QUEUE_SIZE = 20;
const PAGE_SIZE = 10;
const COLOR = 0x7c3aed;
const EPHEMERAL = MessageFlags.Ephemeral;

fs.mkdirSync(DATA_DIR, { recursive: true });
const FILES = {
  tiers: path.join(DATA_DIR, "tiers.json"),
  queues: path.join(DATA_DIR, "queue.json")
};

// ───────────────────────── VERİ ─────────────────────────
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

// Önce geçici dosyaya yazıp yeniden adlandırır; yarım yazılmış dosya riskini önler.
function saveJSON(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

let tierData = readJSON(FILES.tiers, {});
let queueData = readJSON(FILES.queues, {});

const saveTiers = () => saveJSON(FILES.tiers, tierData);
const saveQueues = () => saveJSON(FILES.queues, queueData);

// GuildMembers intent'i gerekmez; tekil üye çekme REST ile çalışır.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ───────────────────────── YARDIMCILAR ─────────────────────────
const normalize = v => String(v || "").trim().toUpperCase();

function getTierRole(guild, kit, tier) {
  const expected = normalize(`${kit} ${tier}`);
  return guild.roles.cache.find(r => normalize(r.name) === expected) || null;
}

function getKitRole(guild, kit) {
  const expected = normalize(kit);
  return guild.roles.cache.find(r => normalize(r.name) === expected) || null;
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function isTester(interaction) {
  if (isAdmin(interaction)) return true;
  if (!TESTER_ROLE_ID) return false;
  const roles = interaction.member?.roles;
  if (!roles) return false;
  return Array.isArray(roles) ? roles.includes(TESTER_ROLE_ID) : roles.cache.has(TESTER_ROLE_ID);
}

function reply(interaction, content, extra = {}) {
  const payload = { content, flags: EPHEMERAL, ...extra };
  if (interaction.deferred || interaction.replied) {
    const { flags, ...rest } = payload;
    return interaction.editReply(rest);
  }
  return interaction.reply(payload);
}

function getQueue(guildId, kit) {
  if (!queueData[guildId] || Array.isArray(queueData[guildId])) queueData[guildId] = {};

  if (!queueData[guildId][kit]) {
    queueData[guildId][kit] = { open: false, entries: [], channelId: null, messageId: null };
  }

  const queue = queueData[guildId][kit];
  if (!Array.isArray(queue.entries)) queue.entries = [];
  return queue;
}

function isQueueOpen(queue) {
  return queue.open && queue.entries.length < MAX_QUEUE_SIZE;
}

function queueEmbed(guildId, kit) {
  const queue = getQueue(guildId, kit);
  const open = isQueueOpen(queue);

  const players = queue.entries.length
    ? queue.entries.map((p, i) => `**${i + 1}.** <@${p.userId}> · \`${p.minecraftUsername}\``).join("\n")
    : "_Sıra boş._";

  return new EmbedBuilder()
    .setColor(open ? 0x22c55e : 0xef4444)
    .setTitle(`⚔️ ${kit} TIER SIRASI`)
    .setDescription(`${open ? "🟢 Açık" : "🔴 Kapalı"} · **${queue.entries.length}/${MAX_QUEUE_SIZE}**\n\n${players}`)
    .setFooter({ text: "SVEYDY • TIER TEST" })
    .setTimestamp();
}

function queueButtons(guildId, kit) {
  const open = isQueueOpen(getQueue(guildId, kit));
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue_join:${kit}`)
        .setLabel("Sıraya Katıl")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("⚔️")
        .setDisabled(!open),
      new ButtonBuilder()
        .setCustomId(`queue_leave:${kit}`)
        .setLabel("Sıradan Ayrıl")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🚪")
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
      components: queueButtons(guild.id, kit)
    });
  } catch (error) {
    console.error(`${kit} sıra paneli güncellenemedi:`, error.message);
  }
}

// Tier listesi (sayfalı)
function tierListPayload(guildId, kit, page = 0) {
  const entries = [];
  for (const [userId, kits] of Object.entries(tierData[guildId] || {})) {
    const record = kits?.[kit];
    if (record?.tier && TIERS.includes(record.tier)) entries.push({ userId, ...record });
  }

  entries.sort(
    (a, b) =>
      TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) ||
      (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)
  );

  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  page = Math.min(Math.max(page, 0), pages - 1);

  const medals = ["🥇", "🥈", "🥉"];
  const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const description = slice.length
    ? slice
        .map((p, i) => {
          const rank = page * PAGE_SIZE + i;
          const badge = medals[rank] || `**${rank + 1}.**`;
          return `${badge} <@${p.userId}> — **${kit} ${p.tier}** · \`${p.minecraft || "Belirtilmedi"}\``;
        })
        .join("\n")
    : "Henüz tier kaydı yok.";

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🏆 ${kit} Tier Listesi`)
    .setDescription(description)
    .setFooter({ text: `Sayfa ${page + 1}/${pages} • Toplam ${entries.length} oyuncu` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tl:${kit}:${page - 1}`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId("tl_page")
      .setLabel(`${page + 1}/${pages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`tl:${kit}:${page + 1}`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages - 1)
  );

  return { embeds: [embed], components: pages > 1 ? [row] : [], allowedMentions: { parse: [] } };
}

// ───────────────────────── KOMUTLAR ─────────────────────────
const kitChoices = KITS.map(k => ({ name: k, value: k }));
const tierChoices = TIERS.map(t => ({ name: t, value: t }));

async function deployCommands() {
  // TESTER_ROLE_ID varsa tester komutları herkese görünür, yetki kodda kontrol edilir.
  const testerPerm = TESTER_ROLE_ID ? null : PermissionFlagsBits.ManageGuild;

  const commands = [
    new SlashCommandBuilder()
      .setName("tierver")
      .setDescription("Oyuncuya kit tieri ver.")
      .setDefaultMemberPermissions(testerPerm)
      .addUserOption(o => o.setName("oyuncu").setDescription("Oyuncu").setRequired(true))
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true).addChoices(...kitChoices))
      .addStringOption(o => o.setName("tier").setDescription("Tier").setRequired(true).addChoices(...tierChoices))
      .addStringOption(o => o.setName("minecraft").setDescription("Minecraft kullanıcı adı").setRequired(false)),

    new SlashCommandBuilder()
      .setName("tiersil")
      .setDescription("Oyuncunun kit tierini sil.")
      .setDefaultMemberPermissions(testerPerm)
      .addUserOption(o => o.setName("oyuncu").setDescription("Oyuncu").setRequired(true))
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true).addChoices(...kitChoices)),

    new SlashCommandBuilder()
      .setName("tierim")
      .setDescription("Tierlerini (veya başka bir oyuncunun tierlerini) göster.")
      .addUserOption(o => o.setName("oyuncu").setDescription("Başka bir oyuncu").setRequired(false))
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(false).addChoices(...kitChoices)),

    new SlashCommandBuilder()
      .setName("tierlist")
      .setDescription("Kit tier listesini göster.")
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true).addChoices(...kitChoices)),

    new SlashCommandBuilder()
      .setName("sirakur")
      .setDescription("Kit sıra paneli kur.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true).addChoices(...kitChoices)),

    new SlashCommandBuilder()
      .setName("siraac")
      .setDescription("Kit sırasını aç.")
      .setDefaultMemberPermissions(testerPerm)
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true).addChoices(...kitChoices)),

    new SlashCommandBuilder()
      .setName("sirakapat")
      .setDescription("Kit sırasını kapat ve temizle.")
      .setDefaultMemberPermissions(testerPerm)
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true).addChoices(...kitChoices)),

    new SlashCommandBuilder()
      .setName("sirasonraki")
      .setDescription("Sıradaki oyuncuyu çağır.")
      .setDefaultMemberPermissions(testerPerm)
      .addStringOption(o => o.setName("kit").setDescription("Kit").setRequired(true).addChoices(...kitChoices)),

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
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// ───────────────────────── HAZIR ─────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} aktif.`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.roles.fetch();

    const missing = [];
    for (const kit of KITS) {
      for (const tier of TIERS) {
        if (!getTierRole(guild, kit, tier)) missing.push(`${kit} ${tier}`);
      }
    }
    if (missing.length) console.warn("Sunucuda bulunamayan kit+tier rolleri:", missing.join(", "));

    await deployCommands();
    console.log("Slash komutları yüklendi.");

    // Yeniden başlatma sonrası sıra panellerini güncel duruma getir.
    for (const kit of KITS) {
      if (queueData[guild.id]?.[kit]) await refreshQueue(guild, kit);
    }
  } catch (error) {
    console.error("Bot başlangıç hatası:", error);
  }
});

// ───────────────────────── ETKİLEŞİMLER ─────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  try {
    const guild = interaction.guild;
    if (!guild) {
      if (interaction.isRepliable()) return reply(interaction, "Bu komut sunucuda kullanılmalı.");
      return;
    }

    // ── Slash komutlar ──
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      const testerCommands = ["tierver", "tiersil", "siraac", "sirakapat", "sirasonraki"];
      const adminCommands = ["sirakur", "panelkur", "ayar"];

      if (testerCommands.includes(cmd) && !isTester(interaction)) {
        return reply(interaction, "❌ Bu komut için yetkin yok.");
      }
      if (adminCommands.includes(cmd) && !isAdmin(interaction)) {
        return reply(interaction, "❌ Bu komut için yetkin yok.");
      }

      // /ayar
      if (cmd === "ayar") {
        await guild.roles.fetch();

        const missing = [];
        for (const kit of KITS) {
          for (const tier of TIERS) {
            if (!getTierRole(guild, kit, tier)) missing.push(`${kit} ${tier}`);
          }
        }
        const missingKits = KITS.filter(kit => !getKitRole(guild, kit));

        const shown = missing.slice(0, 40).join(", ");
        const extra = missing.length > 40 ? ` ... ve ${missing.length - 40} rol daha` : "";

        const embed = new EmbedBuilder()
          .setColor(missing.length || missingKits.length ? 0xef4444 : 0x22c55e)
          .setTitle("⚙️ SVEYDY • Rol Kontrolü")
          .setDescription(
            `**Eksik kit+tier rolleri:**\n${missing.length ? shown + extra : "Yok"}\n\n` +
              `**Eksik kit rolleri:**\n${missingKits.length ? missingKits.join(", ") : "Yok"}`
          );

        return reply(interaction, undefined, { embeds: [embed] });
      }

      // /tierver
      if (cmd === "tierver") {
        await interaction.deferReply({ flags: EPHEMERAL });

        const target = interaction.options.getUser("oyuncu");
        const kit = interaction.options.getString("kit");
        const tier = interaction.options.getString("tier");
        const minecraftInput = interaction.options.getString("minecraft")?.trim();

        if (minecraftInput && !/^[A-Za-z0-9_]{3,16}$/.test(minecraftInput)) {
          return reply(interaction, "❌ Geçersiz Minecraft kullanıcı adı (3-16 karakter, harf/rakam/_).");
        }

        await guild.roles.fetch();

        const member = await guild.members.fetch(target.id).catch(() => null);
        if (!member) return reply(interaction, "❌ Oyuncu sunucuda bulunamadı.");

        const botMember = await guild.members.fetchMe();
        const botTop = botMember.roles.highest.position;
        const newRole = getTierRole(guild, kit, tier);
        const kitRole = getKitRole(guild, kit);

        if (!newRole) {
          return reply(interaction, `❌ **${kit} ${tier}** rolü sunucuda bulunamadı. Önce doğru rolü oluştur.`);
        }
        if (!kitRole) return reply(interaction, `❌ **${kit}** kit rolü bulunamadı.`);

        // Aynı kitin diğer tier rolleri (veri kaybolsa bile eski rol kalmasın).
        const staleRoles = TIERS.filter(t => t !== tier)
          .map(t => getTierRole(guild, kit, t))
          .filter(r => r && member.roles.cache.has(r.id));

        if ([newRole, kitRole, ...staleRoles].some(r => r.position >= botTop)) {
          return reply(interaction, "❌ Bot rolünü kit ve tier rollerinin üstüne taşı.");
        }

        const previous = tierData[guild.id]?.[target.id]?.[kit];
        const oldTier = previous?.tier || staleRoles[0]?.name.split(" ").pop()?.toUpperCase();

        if (staleRoles.length) await member.roles.remove(staleRoles);
        await member.roles.add([newRole, kitRole]);

        const history = Array.isArray(previous?.history) ? previous.history : [];
        if (previous?.tier) {
          history.push({ tier: previous.tier, at: previous.updatedAt, tester: previous.tester });
        }

        tierData[guild.id] ??= {};
        tierData[guild.id][target.id] ??= {};
        tierData[guild.id][target.id][kit] = {
          tier,
          minecraft: minecraftInput || previous?.minecraft || "Belirtilmedi",
          tester: interaction.user.id,
          updatedAt: new Date().toISOString(),
          history: history.slice(-10)
        };
        saveTiers();

        const record = tierData[guild.id][target.id][kit];
        const oldIndex = TIERS.indexOf(oldTier);
        const newIndex = TIERS.indexOf(tier);
        let trend = "🆕";
        if (oldIndex !== -1) trend = newIndex < oldIndex ? "📈 Yükseldi" : newIndex > oldIndex ? "📉 Düştü" : "➖ Aynı";

        const embed = new EmbedBuilder()
          .setColor(COLOR)
          .setTitle("🏆 TIER SONUCU")
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: "Oyuncu", value: `<@${target.id}>`, inline: true },
            { name: "Kit", value: kit, inline: true },
            { name: "Yeni rol", value: `**${kit} ${tier}**`, inline: true },
            { name: "Önceki tier", value: oldTier || "Yeni kayıt", inline: true },
            { name: "Durum", value: trend, inline: true },
            { name: "Minecraft", value: record.minecraft, inline: true },
            { name: "Test eden", value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();

        if (RESULT_CHANNEL_ID) {
          const channel = await guild.channels.fetch(RESULT_CHANNEL_ID).catch(() => null);
          if (channel?.isTextBased()) {
            await channel.send({ embeds: [embed] }).catch(console.error);
          }
        }

        return reply(interaction, `✅ <@${target.id}> oyuncusuna **${kit} ${tier}** rolü verildi.`, {
          embeds: [embed],
          allowedMentions: { parse: [] }
        });
      }

      // /tiersil
      if (cmd === "tiersil") {
        await interaction.deferReply({ flags: EPHEMERAL });

        const target = interaction.options.getUser("oyuncu");
        const kit = interaction.options.getString("kit");

        await guild.roles.fetch();
        const member = await guild.members.fetch(target.id).catch(() => null);
        const botMember = await guild.members.fetchMe();

        if (member) {
          const roles = TIERS.map(t => getTierRole(guild, kit, t)).filter(r => r && member.roles.cache.has(r.id));
          if (roles.some(r => r.position >= botMember.roles.highest.position)) {
            return reply(interaction, "❌ Bot rolünü tier rollerinin üstüne taşı.");
          }
          if (roles.length) await member.roles.remove(roles);
        }

        const existed = Boolean(tierData[guild.id]?.[target.id]?.[kit]);
        if (existed) {
          delete tierData[guild.id][target.id][kit];
          if (!Object.keys(tierData[guild.id][target.id]).length) delete tierData[guild.id][target.id];
          saveTiers();
        }

        return reply(
          interaction,
          existed
            ? `🗑️ <@${target.id}> oyuncusunun **${kit}** tieri silindi.`
            : `ℹ️ <@${target.id}> için **${kit}** kaydı yoktu; varsa tier rolleri kaldırıldı.`,
          { allowedMentions: { parse: [] } }
        );
      }

      // /tierim
      if (cmd === "tierim") {
        const target = interaction.options.getUser("oyuncu") || interaction.user;
        const kit = interaction.options.getString("kit");
        const records = tierData[guild.id]?.[target.id] || {};

        const entries = Object.entries(records)
          .filter(([name, record]) => KITS.includes(name) && record?.tier)
          .filter(([name]) => !kit || name === kit)
          .sort((a, b) => TIERS.indexOf(a[1].tier) - TIERS.indexOf(b[1].tier));

        const mc = entries[0]?.[1]?.minecraft;
        const embed = new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(`${target.username} • Tierler`)
          .setThumbnail(target.displayAvatarURL())
          .setDescription(
            entries.length
              ? entries.map(([name, r]) => `**${name}** — ${name} ${r.tier}`).join("\n")
              : "Kayıtlı tier bulunamadı."
          );

        if (mc && mc !== "Belirtilmedi") embed.setFooter({ text: `Minecraft: ${mc}` });

        return reply(interaction, undefined, { embeds: [embed] });
      }

      // /tierlist
      if (cmd === "tierlist") {
        const kit = interaction.options.getString("kit");
        return interaction.reply(tierListPayload(guild.id, kit, 0));
      }

      // /sirakur
      if (cmd === "sirakur") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = false;
        queue.entries = [];
        queue.channelId = interaction.channelId;

        const message = await interaction.channel.send({
          embeds: [queueEmbed(guild.id, kit)],
          components: queueButtons(guild.id, kit)
        });

        queue.messageId = message.id;
        saveQueues();

        return reply(interaction, `${kit} sıra paneli kuruldu. Açmak için /siraac komutunu kullan.`);
      }

      // /siraac, /sirakapat
      if (cmd === "siraac" || cmd === "sirakapat") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);

        queue.open = cmd === "siraac";
        if (!queue.open) queue.entries = [];

        saveQueues();
        await refreshQueue(guild, kit);

        return reply(interaction, queue.open ? `${kit} sırası açıldı.` : `${kit} sırası kapatıldı ve temizlendi.`);
      }

      // /sirasonraki
      if (cmd === "sirasonraki") {
        const kit = interaction.options.getString("kit");
        const queue = getQueue(guild.id, kit);
        const next = queue.entries.shift();

        if (!next) return reply(interaction, `${kit} sırası boş.`);

        // Yer açıldıysa ve sıra "dolu" yüzünden kapanmışsa otomatik açılmaz; tester karar verir.
        saveQueues();
        await refreshQueue(guild, kit);

        return interaction.reply({
          content: `🎯 <@${next.userId}> sıran geldi! **${kit}** testi için hazır ol.\nMinecraft: \`${next.minecraftUsername}\` · Tester: <@${interaction.user.id}>`,
          allowedMentions: { users: [next.userId] }
        });
      }

      // /panelkur
      if (cmd === "panelkur") {
        const menu = new StringSelectMenuBuilder()
          .setCustomId("kit_role_select")
          .setPlaceholder("Kit rollerini seç")
          .setMinValues(1)
          .setMaxValues(KITS.length)
          .addOptions(KITS.map(kit => ({ label: kit, value: kit, description: `${kit} kit rolünü al` })));

        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLOR)
              .setTitle("🎮 SVEYDY • KIT ROLLERİ")
              .setDescription("Almak istediğin mevcut kit rollerini seç.")
          ],
          components: [new ActionRowBuilder().addComponents(menu)]
        });

        return reply(interaction, "Kit paneli kuruldu.");
      }
    }

    // ── Kit rol menüsü ──
    if (interaction.isStringSelectMenu() && interaction.customId === "kit_role_select") {
      await interaction.deferReply({ flags: EPHEMERAL });
      await guild.roles.fetch();

      const member = await guild.members.fetch(interaction.user.id);
      const botMember = await guild.members.fetchMe();
      const roles = interaction.values.map(kit => getKitRole(guild, kit));

      if (roles.some(role => !role)) {
        return reply(interaction, "Seçilen kit rollerinden biri sunucuda bulunamadı.");
      }
      if (roles.some(role => role.position >= botMember.roles.highest.position)) {
        return reply(interaction, "Bot rolünü kit rollerinin üstüne taşı.");
      }

      await member.roles.add(roles);
      return reply(interaction, `Kit rollerin verildi: ${interaction.values.join(", ")}`);
    }

    // ── Tier list sayfa butonları ──
    if (interaction.isButton() && interaction.customId.startsWith("tl:")) {
      const [, kit, pageRaw] = interaction.customId.split(":");
      if (!KITS.includes(kit)) return;
      return interaction.update(tierListPayload(guild.id, kit, Number(pageRaw) || 0));
    }

    // ── Sıraya katıl butonu ──
    if (interaction.isButton() && interaction.customId.startsWith("queue_join:")) {
      const kit = interaction.customId.split(":")[1];
      if (!KITS.includes(kit)) return;

      const queue = getQueue(guild.id, kit);

      if (!queue.open) return reply(interaction, "Bu sıra kapalı.");

      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
        saveQueues();
        await refreshQueue(guild, kit);
        return reply(interaction, "Sıra dolu.");
      }

      if (queue.entries.some(p => p.userId === interaction.user.id)) {
        return reply(interaction, "Zaten sıradasın.");
      }

      const previousMc = tierData[guild.id]?.[interaction.user.id]?.[kit]?.minecraft;

      const input = new TextInputBuilder()
        .setCustomId("minecraft_username")
        .setLabel("Minecraft kullanıcı adın")
        .setPlaceholder("Steve123")
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(16)
        .setRequired(true);

      if (previousMc && /^[A-Za-z0-9_]{3,16}$/.test(previousMc)) input.setValue(previousMc);

      const modal = new ModalBuilder()
        .setCustomId(`queue_modal:${kit}`)
        .setTitle(`${kit} Sırasına Katıl`)
        .addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }

    // ── Sıradan ayrıl butonu ──
    if (interaction.isButton() && interaction.customId.startsWith("queue_leave:")) {
      const kit = interaction.customId.split(":")[1];
      if (!KITS.includes(kit)) return;

      const queue = getQueue(guild.id, kit);
      const index = queue.entries.findIndex(p => p.userId === interaction.user.id);

      if (index === -1) return reply(interaction, "Zaten sırada değilsin.");

      queue.entries.splice(index, 1);
      saveQueues();
      await refreshQueue(guild, kit);

      return reply(interaction, `🚪 ${kit} sırasından ayrıldın.`);
    }

    // ── Sıra modalı ──
    if (interaction.isModalSubmit() && interaction.customId.startsWith("queue_modal:")) {
      const kit = interaction.customId.split(":")[1];
      const username = interaction.fields.getTextInputValue("minecraft_username").trim();

      if (!KITS.includes(kit) || !/^[A-Za-z0-9_]{3,16}$/.test(username)) {
        return reply(interaction, "Geçersiz kit veya Minecraft adı.");
      }

      const queue = getQueue(guild.id, kit);

      if (!queue.open) return reply(interaction, "Bu sıra kapalı.");

      if (
        queue.entries.some(
          p => p.userId === interaction.user.id || p.minecraftUsername.toLowerCase() === username.toLowerCase()
        )
      ) {
        return reply(interaction, "Sen veya bu Minecraft adı zaten sırada.");
      }

      if (queue.entries.length >= MAX_QUEUE_SIZE) {
        queue.open = false;
        saveQueues();
        await refreshQueue(guild, kit);
        return reply(interaction, "Sıra dolu.");
      }

      queue.entries.push({
        userId: interaction.user.id,
        minecraftUsername: username,
        joinedAt: new Date().toISOString()
      });

      if (queue.entries.length >= MAX_QUEUE_SIZE) queue.open = false;

      saveQueues();
      await refreshQueue(guild, kit);

      return reply(interaction, `✅ ${kit} sırasına katıldın. Sıra numaran: ${queue.entries.length}.`);
    }
  } catch (error) {
    console.error("Etkileşim hatası:", error);

    if (interaction.isRepliable()) {
      const message = "İşlem sırasında hata oluştu. Logları kontrol et.";
      try {
        if (interaction.deferred) await interaction.editReply({ content: message });
        else if (interaction.replied) await interaction.followUp({ content: message, flags: EPHEMERAL });
        else await interaction.reply({ content: message, flags: EPHEMERAL });
      } catch {
        /* yoksay */
      }
    }
  }
});

process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));
process.on("uncaughtException", error => console.error("Uncaught exception:", error));

client.login(TOKEN);
